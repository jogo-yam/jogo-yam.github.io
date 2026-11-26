// Servidor de avisos do YAM (Cloudflare Worker, plano grátis).
//
// Na sala "cada um na sua vez", quem acabou de jogar chama POST /vez com o
// código da sala e o próprio token do Firebase. O servidor lê a sala no
// Firebase com esse token (só funciona para quem está logado), confere que
// quem chamou está na sala, calcula de quem é a vez (mesma regra do app) e
// manda uma notificação (Web Push) para o celular dessa pessoa, se ela pediu
// avisos e não está com o app aberto na tela.
//
// Todo dia, sozinho, avisa quem pausou no último dia da sala e apaga as salas
// vencidas (tarefaDiaria, mais abaixo). A cada 5 minutos, avisa quem criou a
// sala quando a vez está parada (vigiarVezes).
//
// Segredos (guardados na Cloudflare): VAPID_PRIVADA (chave privada, JWK) e
// FIREBASE_RENOVAR (login do visitante anônimo do servidor; opcional).
// Variáveis: VAPID_PUBLICA, FIREBASE_DB, FIREBASE_CHAVE, ORIGENS (wrangler.toml).

const enc = new TextEncoder();

// ---------- base64url ----------

export function paraB64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deB64url(texto) {
  const s = atob(String(texto).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(texto).length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

const juntar = (...partes) => {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { saida.set(p, i); i += p.length; }
  return saida;
};

// ---------- de quem é a vez (igual ao vezDaSala do app.js) ----------

// Sem fantasmas (sem nome) e cada pessoa uma vez só: se continuou em outro
// aparelho, vale o lugar assumido por último (igual ao jogadoresValidos do app.js).
export function jogadoresValidos(sala) {
  const reais = Object.entries((sala && sala.jogadores) || {}).map(([uid, j]) => ({ uid, ...j }))
    .filter(j => typeof j.nome === "string" && j.nome !== "");
  const em = j => (typeof j.assumiuEm === "number" ? j.assumiuEm : 0);
  const ultimo = {};
  for (const j of reais) if (typeof j.chave === "string" && (!(j.chave in ultimo) || em(j) > ultimo[j.chave])) ultimo[j.chave] = em(j);
  return reais.filter(j => typeof j.chave !== "string" || em(j) === ultimo[j.chave]);
}

export function vezDaSala(sala) {
  const jogadores = jogadoresValidos(sala);
  const criador = sala && sala.jogadores && sala.jogadores[sala.criador];
  const pulos = (criador && criador.pulos) || {};
  const naRoda = jogadores.filter(j => !j.terminou)
    .sort((a, b) => (a.entrouEm || 0) - (b.entrouEm || 0) || String(a.uid).localeCompare(String(b.uid)));
  if (!naRoda.length) return null;
  const vezes = j => (j.casas || 0) + (j.base || 0) + (pulos[j.uid] || 0);
  const menor = Math.min(...naRoda.map(vezes));
  return naRoda.find(j => vezes(j) === menor).uid;
}

export function modoDaSala(sala) {
  const jogadores = (sala && sala.jogadores) || {};
  const criador = jogadores[sala && sala.criador];
  if (criador && criador.modo) return criador.modo;
  return Object.values(jogadores).some(j => j.modo === "vez") ? "vez" : "livre";
}

// ---------- VAPID: quem manda o push se identifica com um JWT assinado ----------

export async function jwtVapid(endpoint, chavePrivadaJwk, agora = Date.now()) {
  const chave = await crypto.subtle.importKey("jwk", chavePrivadaJwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cabecalho = paraB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = paraB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(agora / 1000) + 12 * 60 * 60,
    sub: "https://jogo-yam.github.io/"
  })));
  const assinatura = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, enc.encode(`${cabecalho}.${corpo}`));
  return `${cabecalho}.${corpo}.${paraB64url(assinatura)}`;
}

// ---------- conteúdo cifrado (RFC 8291 + RFC 8188, "aes128gcm") ----------

async function hkdf(salt, ikm, info, bytes) {
  const chave = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, chave, bytes * 8));
}

// p256dh e auth vêm da inscrição do celular. `extras` só serve para os testes.
export async function cifrarPush(texto, p256dh, auth, extras = {}) {
  const publicaDoCelular = deB64url(p256dh);
  const segredoDoCelular = deB64url(auth);
  const meuPar = extras.par || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const minhaPublica = new Uint8Array(await crypto.subtle.exportKey("raw", meuPar.publicKey));
  const chaveDoCelular = await crypto.subtle.importKey("raw", publicaDoCelular, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const segredoEcdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: chaveDoCelular }, meuPar.privateKey, 256));

  const ikm = await hkdf(segredoDoCelular, segredoEcdh,
    juntar(enc.encode("WebPush: info\0"), publicaDoCelular, minhaPublica), 32);
  const sal = extras.sal || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const chaveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const claro = juntar(enc.encode(texto), new Uint8Array([2])); // 2 = último (e único) pedaço
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, chaveAes, claro));

  const tamanhoDoPedaco = new Uint8Array([0, 0, 16, 0]); // 4096
  return juntar(sal, tamanhoDoPedaco, new Uint8Array([minhaPublica.length]), minhaPublica, cifrado);
}

export async function enviarPush(inscricao, dados, env, buscar = fetch) {
  const corpo = await cifrarPush(JSON.stringify(dados), inscricao.p256dh, inscricao.auth);
  const jwt = await jwtVapid(inscricao.endpoint, JSON.parse(env.VAPID_PRIVADA));
  return buscar(inscricao.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLICA}`
    },
    body: corpo
  });
}

// ---------- o pedido "passei a vez" ----------

const ABERTO_HA_POUCO = 2 * 60 * 1000; // app aberto na tela há menos de 2 min: não manda push

function uidDoToken(token) {
  try {
    const dados = JSON.parse(new TextDecoder().decode(deB64url(String(token).split(".")[1])));
    return dados.user_id || dados.sub || null;
  } catch { return null; }
}

export async function tratarVez(pedido, env, agora = Date.now(), buscar = fetch, esperar = ms => new Promise(r => setTimeout(r, ms))) {
  const { codigo, token, texto } = pedido || {};
  if (!/^\d{5}$/.test(String(codigo)) || typeof token !== "string") return { status: 400, motivo: "pedido inválido" };
  const quemChamou = uidDoToken(token);

  // o app foi minimizado: grava a vez de quem chamou (com o token dele; as
  // regras do banco só deixam gravar no próprio jogador)
  const g = pedido.gravar;
  if (g && quemChamou && Number.isInteger(g.casas) && g.casas >= 0 && g.casas <= 52) {
    const ultima = g.ultima && /^\d{1,2}-[0-3]$/.test(String(g.ultima.key)) && Number.isInteger(g.ultima.valor)
      ? { key: g.ultima.key, valor: g.ultima.valor, n: g.casas, em: { ".sv": "timestamp" } } : null;
    await buscar(`${env.FIREBASE_DB}/partidas/${codigo}/jogadores/${quemChamou}.json?auth=${encodeURIComponent(token)}`, {
      method: "PATCH",
      body: JSON.stringify({ casas: g.casas, mesa: null, ...(ultima ? { ultima } : {}) })
    });
  }

  // ler a sala com o token de quem chamou: se o token não vale, o Firebase recusa.
  // Com "esperar" (o app foi minimizado e a gravação da vez vai junto), se a vez
  // ainda é de quem chamou, espera a gravação chegar e lê de novo (até 3 vezes).
  let sala = null;
  let vez = null;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const resposta = await buscar(`${env.FIREBASE_DB}/partidas/${codigo}.json?auth=${encodeURIComponent(token)}`);
    if (!resposta.ok) return { status: 403, motivo: "sem acesso à sala" };
    sala = await resposta.json();
    if (!sala || !sala.jogadores || !sala.jogadores[quemChamou]) return { status: 403, motivo: "não está na sala" };
    if (sala.revelada || sala.encerrada || modoDaSala(sala) !== "vez") return { status: 204, motivo: "sala sem vez" };
    vez = vezDaSala(sala);
    if (vez !== quemChamou || !pedido.esperar || tentativa === 3) break;
    await esperar(1500);
  }
  if (!vez || vez === quemChamou) return { status: 204, motivo: "a vez é de quem chamou" };
  const alvo = sala.jogadores[vez];
  if (!alvo.push || !alvo.push.endpoint) return { status: 204, motivo: "não pediu avisos" };
  if (alvo.visivel === true && typeof alvo.vistoEm === "number" && agora - alvo.vistoEm < ABERTO_HA_POUCO) {
    return { status: 204, motivo: "está com o app aberto" };
  }

  const dados = {
    titulo: "Sua vez no YAM!",
    texto: String(texto || "Toque para jogar.").slice(0, 140),
    codigo: String(codigo)
  };
  const envio = await enviarPush(alvo.push, dados, env, buscar);
  return { status: envio.ok ? 200 : 502, motivo: envio.ok ? "avisado" : `push ${envio.status}` };
}

// ---------- o pedido "chamar quem pausou" ----------
// POST /pausa { codigo, token, motivo }: "voltou" (quem chamou voltou da pausa)
// ou "prazo" (a sala fecha em menos de 1 dia). Avisa quem ainda está fora (e
// pediu avisos). O texto é montado aqui, com o que está no banco.

const PRAZO_DA_SALA = 3 * 24 * 60 * 60 * 1000;
const UM_DIA = 24 * 60 * 60 * 1000;
const temNome = j => !!j && typeof j.nome === "string" && j.nome !== "";

export async function tratarPausa(pedido, env, agora = Date.now(), buscar = fetch) {
  const { codigo, token, motivo } = pedido || {};
  if (!/^\d{5}$/.test(String(codigo)) || typeof token !== "string" || !["voltou", "prazo"].includes(motivo)) {
    return { status: 400, motivo: "pedido inválido" };
  }
  const quemChamou = uidDoToken(token);
  const resposta = await buscar(`${env.FIREBASE_DB}/partidas/${codigo}.json?auth=${encodeURIComponent(token)}`);
  if (!resposta.ok) return { status: 403, motivo: "sem acesso à sala" };
  const sala = await resposta.json();
  const eu = sala && sala.jogadores && sala.jogadores[quemChamou];
  if (!temNome(eu)) return { status: 403, motivo: "não está na sala" };
  if (sala.revelada || sala.encerrada) return { status: 204, motivo: "a partida acabou" };
  if (eu.fora === true) return { status: 204, motivo: "quem chamou também está fora" };

  let texto;
  if (motivo === "voltou") {
    texto = `${eu.nome} voltou para a sala ${codigo}. A partida continua quando você voltar.`;
  } else {
    const prazo = typeof sala.criadaEm === "number" ? sala.criadaEm + PRAZO_DA_SALA : null;
    if (!prazo || prazo <= agora || prazo - agora > UM_DIA) return { status: 204, motivo: "fora do último dia" };
    const horas = Math.max(1, Math.round((prazo - agora) / (60 * 60 * 1000)));
    texto = `A sala ${codigo} fecha em ${horas} h. Volte para terminar a partida com os outros.`;
  }

  const criador = sala.jogadores[sala.criador];
  const dispensados = (criador && criador.dispensados) || {};
  const alvos = jogadoresValidos(sala).map(j => [j.uid, j]).filter(([uid, j]) =>
    uid !== quemChamou && j.fora === true && !j.terminou && !dispensados[uid] && j.push && j.push.endpoint);
  if (!alvos.length) return { status: 204, motivo: "ninguém fora com avisos" };
  const dados = { titulo: motivo === "voltou" ? "Esperando você no YAM" : "Sua sala vai fechar", texto, codigo: String(codigo) };
  let enviados = 0;
  for (const [, j] of alvos) {
    try { if ((await enviarPush(j.push, dados, env, buscar)).ok) enviados++; } catch { /* segue para o próximo */ }
  }
  return { status: enviados ? 200 : 502, motivo: `avisados ${enviados} de ${alvos.length}` };
}

// ---------- todo dia: o prazo de quem pausou e a limpeza ----------
// O app põe cada sala nova em abertas/<código>. Uma vez por dia (cron, no fim da
// tarde no Brasil) o servidor entra no Firebase como visitante anônimo e, para
// cada sala da lista: apaga a vencida (mais de 3 dias: as regras só deixam
// isso), tira da lista a que não existe mais e, no último dia da sala, avisa
// quem pausou que ela vai fechar. Assim não depende de alguém abrir o app.

const FOLGA = 10 * 60 * 1000; // relógio: só apaga 10 min depois do que as regras deixam

// Com FIREBASE_RENOVAR (segredo: o "refresh token" de um visitante anônimo
// criado uma vez), entra sempre como o mesmo visitante; sem ele, cria um novo.
export async function entrarAnonimo(env, buscar = fetch) {
  if (env.FIREBASE_RENOVAR) {
    const r = await buscar(`https://securetoken.googleapis.com/v1/token?key=${env.FIREBASE_CHAVE}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(env.FIREBASE_RENOVAR)}`
    });
    if (r.ok) return (await r.json()).id_token;
  }
  const r = await buscar(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_CHAVE}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
  });
  if (!r.ok) throw new Error(`login anônimo: ${r.status}`);
  return (await r.json()).idToken;
}

// Avisa quem pausou (e pediu avisos) que a sala fecha em menos de 1 dia. Devolve quantos.
export async function avisarPrazo(codigo, sala, env, agora = Date.now(), buscar = fetch) {
  if (!sala || sala.revelada || sala.encerrada) return 0;
  const prazo = typeof sala.criadaEm === "number" ? sala.criadaEm + PRAZO_DA_SALA : null;
  if (!prazo || prazo <= agora || prazo - agora > UM_DIA) return 0;
  const criador = sala.jogadores && sala.jogadores[sala.criador];
  const dispensados = (criador && criador.dispensados) || {};
  const alvos = jogadoresValidos(sala).filter(j =>
    j.fora === true && !j.terminou && !dispensados[j.uid] && j.push && j.push.endpoint);
  const horas = Math.max(1, Math.round((prazo - agora) / (60 * 60 * 1000)));
  const dados = {
    titulo: "Sua sala vai fechar",
    texto: `A sala ${codigo} fecha em ${horas} h. Volte para terminar a partida com os outros.`,
    codigo: String(codigo)
  };
  let enviados = 0;
  for (const j of alvos) {
    try { if ((await enviarPush(j.push, dados, env, buscar)).ok) enviados++; } catch { /* segue para o próximo */ }
  }
  return enviados;
}

// ---------- a cada 5 minutos: vez parada ----------
// Na sala com vez, se a vez está parada há 10 minutos com a pessoa fora do app,
// avisa quem criou (que pode pular a vez). Sem guardar nada: só avisa na passada
// em que a parada cai entre 10 e 15 minutos, então é um aviso por vez parada.

const VEZ_PARADA = 10 * 60 * 1000;
const ENTRE_PASSADAS = 5 * 60 * 1000;
const estaNoApp = (j, agora) => !!j && j.visivel === true && typeof j.vistoEm === "number" && agora - j.vistoEm < ABERTO_HA_POUCO;

// Desde quando a vez de agora está parada (igual ao desdeDaVez do familia.js).
export function desdeDaVez(sala) {
  let desde = null;
  for (const j of jogadoresValidos(sala)) {
    for (const t of [j.ultima && j.ultima.em, j.voltouEm, j.pulouEm, j.comecouEm]) {
      if (typeof t === "number" && (desde === null || t > desde)) desde = t;
    }
  }
  return desde;
}

export async function avisarVezParada(codigo, sala, env, agora = Date.now(), buscar = fetch) {
  if (!sala || sala.revelada || sala.encerrada || sala.iniciada === false || modoDaSala(sala) !== "vez") return 0;
  const criador = sala.jogadores && sala.jogadores[sala.criador];
  if (!temNome(criador) || !criador.push || !criador.push.endpoint || estaNoApp(criador, agora)) return 0;
  const dispensados = criador.dispensados || {};
  if (jogadoresValidos(sala).some(j => j.fora === true && !j.terminou && !dispensados[j.uid])) return 0; // pausada
  const vez = vezDaSala(sala);
  if (!vez || vez === sala.criador || estaNoApp(sala.jogadores[vez], agora)) return 0;
  const desde = desdeDaVez(sala);
  if (desde === null || agora - desde < VEZ_PARADA || agora - desde >= VEZ_PARADA + ENTRE_PASSADAS) return 0;
  const nome = sala.jogadores[vez].nome;
  const dados = {
    titulo: "A vez está parada",
    texto: `A vez de ${nome} está parada há ${Math.floor((agora - desde) / 60000)} min, com o app fechado. Toque para pular ou continuar esperando.`,
    codigo: String(codigo)
  };
  try { return (await enviarPush(criador.push, dados, env, buscar)).ok ? 1 : 0; } catch { return 0; }
}

export async function vigiarVezes(env, agora = Date.now(), buscar = fetch) {
  const token = await entrarAnonimo(env, buscar);
  const com = caminho => `${env.FIREBASE_DB}/${caminho}.json?auth=${encodeURIComponent(token)}`;
  const lista = await buscar(com("abertas"));
  if (!lista.ok) return { status: 403, motivo: "sem acesso à lista de salas" };
  let avisados = 0;
  for (const codigo of Object.keys((await lista.json()) || {}).filter(c => /^\d{5}$/.test(c))) {
    try {
      const resposta = await buscar(com(`partidas/${codigo}`));
      if (resposta.ok) avisados += await avisarVezParada(codigo, await resposta.json(), env, agora, buscar);
    } catch { /* segue para a próxima sala */ }
  }
  return { status: 200, motivo: `vez parada: avisados ${avisados}`, avisados };
}

export async function tarefaDiaria(env, agora = Date.now(), buscar = fetch) {
  const token = await entrarAnonimo(env, buscar);
  const com = caminho => `${env.FIREBASE_DB}/${caminho}.json?auth=${encodeURIComponent(token)}`;
  const lista = await buscar(com("abertas"));
  if (!lista.ok) return { status: 403, motivo: "sem acesso à lista de salas" };
  const codigos = Object.keys((await lista.json()) || {}).filter(c => /^\d{5}$/.test(c));
  const feito = { salas: codigos.length, apagadas: 0, tiradas: 0, avisados: 0 };
  for (const codigo of codigos) {
    try {
      const resposta = await buscar(com(`partidas/${codigo}`));
      if (!resposta.ok) continue;
      const sala = await resposta.json();
      const vencida = !!sala && typeof sala.criadaEm === "number" && sala.criadaEm < agora - PRAZO_DA_SALA - FOLGA;
      if (vencida) {
        if (!(await buscar(com(`partidas/${codigo}`), { method: "DELETE" })).ok) continue;
        feito.apagadas++;
      }
      if (vencida || !sala || !sala.criador) {
        if ((await buscar(com(`abertas/${codigo}`), { method: "DELETE" })).ok) feito.tiradas++;
        continue;
      }
      feito.avisados += await avisarPrazo(codigo, sala, env, agora, buscar);
    } catch { /* segue para a próxima sala */ }
  }
  return { status: 200, motivo: JSON.stringify(feito), feito };
}

// ---------- Worker ----------

function cabecalhosCors(origem, env) {
  const permitidas = String(env.ORIGENS || "").split(",").map(s => s.trim());
  return {
    "Access-Control-Allow-Origin": permitidas.includes(origem) ? origem : permitidas[0] || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

export default {
  async fetch(request, env) {
    const cors = cabecalhosCors(request.headers.get("Origin") || "", env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const tratar = { "/vez": tratarVez, "/pausa": tratarPausa }[url.pathname];
    if (request.method !== "POST" || !tratar) {
      return new Response("YAM avisos", { status: url.pathname === "/" ? 200 : 404, headers: cors });
    }
    let pedido;
    try { pedido = JSON.parse(await request.text()); } catch { pedido = null; }
    try {
      const r = await tratar(pedido, env);
      return new Response(r.motivo, { status: r.status === 204 ? 200 : r.status, headers: cors });
    } catch (e) {
      return new Response("erro", { status: 500, headers: cors });
    }
  },

  // wrangler.toml, [triggers]: todo dia (prazo e limpeza) e a cada 5 min (vez parada)
  async scheduled(evento, env, ctx) {
    if (evento.cron === "0 22 * * *") {
      ctx.waitUntil(tarefaDiaria(env).then(r => console.log("tarefa diária", r.motivo), e => console.log("tarefa diária falhou", String(e))));
    } else {
      ctx.waitUntil(vigiarVezes(env).then(r => { if (r.avisados || r.status !== 200) console.log(r.motivo); },
        e => console.log("vez parada falhou", String(e))));
    }
  }
};
