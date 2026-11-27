// Servidor de avisos (worker/avisos.mjs): de quem é a vez, a assinatura VAPID,
// o conteúdo cifrado do push (conferido decifrando do jeito do celular) e o
// pedido "passei a vez".
const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const carregar = () => import(pathToFileURL(path.join(__dirname, "..", "worker", "avisos.mjs")).href);

// um "celular" inscrito: par de chaves ECDH P-256 e segredo de 16 bytes
function celular() {
  const ecdh = nodeCrypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url"), authBytes: auth };
}

// decifra como o navegador faz (RFC 8291 + RFC 8188), sem usar o código do servidor
function decifrar(corpo, cel) {
  const buf = Buffer.from(corpo);
  const sal = buf.subarray(0, 16);
  const idlen = buf[20];
  const publicaDoServidor = buf.subarray(21, 21 + idlen);
  const cifrado = buf.subarray(21 + idlen);
  const segredo = cel.ecdh.computeSecret(publicaDoServidor);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), cel.ecdh.getPublicKey(), publicaDoServidor]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync("sha256", segredo, cel.authBytes, info, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decifrador = nodeCrypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decifrador.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([decifrador.update(cifrado.subarray(0, cifrado.length - 16)), decifrador.final()]);
  assert.equal(claro[claro.length - 1], 2, "delimitador do último pedaço");
  return claro.subarray(0, claro.length - 1).toString("utf8");
}

function chavesVapid() {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const publica = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url");
  return { jwk, publicKey, publica };
}

test("push cifrado: o celular consegue decifrar a mensagem", async () => {
  const { cifrarPush } = await carregar();
  const cel = celular();
  const mensagem = JSON.stringify({ titulo: "Sua vez no YAM!", texto: "Maria marcou 18 no 6 na descida (↓)" });
  const corpo = await cifrarPush(mensagem, cel.p256dh, cel.auth);
  assert.equal(decifrar(corpo, cel), mensagem);
  assert.equal(Buffer.from(corpo).readUInt32BE(16), 4096, "tamanho do pedaço");
});

test("VAPID: JWT assinado com a chave privada e para o servidor de push certo", async () => {
  const { jwtVapid } = await carregar();
  const { jwk, publicKey } = chavesVapid();
  const jwt = await jwtVapid("https://web.push.apple.com/abc123", jwk, Date.parse("2026-11-18T12:00:00Z"));
  const [cab, corpo, assinatura] = jwt.split(".");
  const ok = nodeCrypto.verify("sha256", Buffer.from(`${cab}.${corpo}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(assinatura, "base64url"));
  assert.ok(ok, "assinatura confere");
  const dados = JSON.parse(Buffer.from(corpo, "base64url").toString());
  assert.equal(dados.aud, "https://web.push.apple.com");
  assert.equal(dados.exp, Date.parse("2026-11-18T12:00:00Z") / 1000 + 12 * 3600);
  assert.match(dados.sub, /^https:\/\//);
});

// ---------- o pedido "passei a vez" ----------

const tokenDe = uid => ["x", Buffer.from(JSON.stringify({ user_id: uid })).toString("base64url"), "y"].join(".");

function salaCom(extra = {}) {
  return {
    criador: "davi",
    jogadores: {
      davi: { nome: "Davi", entrouEm: 1, casas: 1, modo: "vez" },
      maria: { nome: "Maria", entrouEm: 2, casas: 0, modo: "vez", ...extra }
    }
  };
}

async function pedir(sala, uid, buscarFirebaseOk = true) {
  const { tratarVez } = await carregar();
  const { jwk, publica } = chavesVapid();
  const enviados = [];
  const buscar = async (url, opcoes) => {
    if (url.includes("firebaseio")) {
      return { ok: buscarFirebaseOk, json: async () => sala };
    }
    enviados.push({ url, opcoes });
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const r = await tratarVez({ codigo: "12345", token: tokenDe(uid), texto: "Davi marcou 1 no 1" }, env, 1000000, buscar);
  return { r, enviados };
}

test("avisa quem está na vez, com os cabeçalhos do Web Push", async () => {
  const cel = celular();
  const { r, enviados } = await pedir(salaCom({ push: { endpoint: "https://fcm.googleapis.com/wp/abc", p256dh: cel.p256dh, auth: cel.auth } }), "davi");
  assert.equal(r.status, 200, r.motivo);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].url, "https://fcm.googleapis.com/wp/abc");
  const h = enviados[0].opcoes.headers;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel));
  assert.equal(dados.titulo, "Sua vez no YAM!");
  assert.equal(dados.texto, "Davi marcou 1 no 1");
});

test("não avisa: sem pedir avisos, app aberto, fora da sala ou token recusado", async () => {
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/abc", p256dh: cel.p256dh, auth: cel.auth };
  assert.equal((await pedir(salaCom(), "davi")).enviados.length, 0, "não pediu avisos");
  assert.equal((await pedir(salaCom({ push, visivel: true, vistoEm: 1000000 - 30000 }), "davi")).enviados.length, 0, "app aberto");
  assert.equal((await pedir(salaCom({ push, visivel: true, vistoEm: 1000000 - 10 * 60000 }), "davi")).enviados.length, 1,
    "aberto há muito tempo (o celular pode ter fechado sem avisar): avisa");
  assert.equal((await pedir(salaCom({ push }), "joao")).r.status, 403, "quem chamou não está na sala");
  assert.equal((await pedir(salaCom({ push }), "davi", false)).r.status, 403, "Firebase recusou o token");
  const daVezDeDavi = salaCom({ push, casas: 1 });
  daVezDeDavi.jogadores.davi.casas = 1;
  assert.equal((await pedir(daVezDeDavi, "davi")).enviados.length, 0, "a vez voltou para quem chamou");
});

test("servidor e app: mesma regra da vez e mesma chave pública", async () => {
  const { vezDaSala } = await carregar();
  const { carregarApp, lerArquivo } = require("./carregar-app.js");
  const { app, rodar } = carregarApp();
  for (let n = 0; n < 300; n++) {
    const jogadores = {};
    const qtd = 2 + (n % 4);
    for (let i = 0; i < qtd; i++) {
      jogadores[`u${i}`] = { nome: `J${i}`, entrouEm: (i * 7) % qtd, casas: (n * (i + 3)) % 5, base: i === 2 ? n % 3 : 0, terminou: (n + i) % 11 === 0 };
    }
    if (n % 5 === 0) jogadores.fantasma = { aberto: false }; // quem saiu, recriado sem nome
    const sala = { criador: "u0", jogadores };
    if (n % 3 === 0) jogadores.u0.pulos = { u1: n % 2 };
    const lista = Object.entries(jogadores).map(([uid, j]) => ({ uid, ...j }));
    assert.equal(vezDaSala(sala), app.vezDaSala(lista, jogadores.u0.pulos || {}), `caso ${n}`);
  }
  const doApp = rodar("VAPID_PUBLICA");
  const doServidor = lerArquivo("worker/wrangler.toml").match(/VAPID_PUBLICA = "([^"]+)"/)[1];
  assert.equal(doApp, doServidor);
});

test("app minimizado: o servidor grava a vez de quem jogou e avisa o próximo", async () => {
  const { tratarVez } = await carregar();
  const { jwk, publica } = chavesVapid();
  const cel = celular();
  const sala = salaCom({ push: { endpoint: "https://web.push.apple.com/abc", p256dh: cel.p256dh, auth: cel.auth } });
  sala.jogadores.davi.casas = 0; // Davi marcou, mas a gravação normal não chegou (app pausado)
  const chamadas = [];
  const buscar = async (url, opcoes = {}) => {
    chamadas.push(`${opcoes.method || "GET"} ${url.split("?")[0]}`);
    if (url.includes("firebaseio") && opcoes.method === "PATCH") {
      Object.assign(sala.jogadores.davi, JSON.parse(opcoes.body));
      return { ok: true };
    }
    if (url.includes("firebaseio")) return { ok: true, json: async () => JSON.parse(JSON.stringify(sala)) };
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const r = await tratarVez({
    codigo: "12345", token: tokenDe("davi"), esperar: true, texto: "Davi marcou 3 no 1 na descida (↓)",
    gravar: { casas: 1, ultima: { key: "0-0", valor: 3, n: 1 } }
  }, env, 1000000, buscar, async () => {});
  assert.equal(r.status, 200, r.motivo);
  assert.deepEqual(chamadas, [
    "PATCH https://teste.firebaseio.com/partidas/12345/jogadores/davi.json",
    "GET https://teste.firebaseio.com/partidas/12345.json",
    "POST https://web.push.apple.com/abc"
  ]);
  assert.equal(sala.jogadores.davi.casas, 1);
  assert.deepEqual(sala.jogadores.davi.ultima.em, { ".sv": "timestamp" });
});

test("app minimizado: espera a gravação chegar antes de desistir", async () => {
  const { tratarVez } = await carregar();
  const { jwk, publica } = chavesVapid();
  const cel = celular();
  const sala = salaCom({ push: { endpoint: "https://web.push.apple.com/abc", p256dh: cel.p256dh, auth: cel.auth } });
  sala.jogadores.davi.casas = 0;
  let leituras = 0;
  const buscar = async (url, opcoes = {}) => {
    if (url.includes("firebaseio")) {
      if (++leituras === 3) sala.jogadores.davi.casas = 1; // a gravação normal chegou depois
      return { ok: true, json: async () => JSON.parse(JSON.stringify(sala)) };
    }
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const r = await tratarVez({ codigo: "12345", token: tokenDe("davi"), esperar: true }, env, 1000000, buscar, async () => {});
  assert.equal(r.status, 200, r.motivo);
  assert.equal(leituras, 3);
});

// ---------- o pedido "chamar quem pausou" ----------

async function pedirPausa(sala, uid, motivo, agora = 1000000) {
  const { tratarPausa } = await carregar();
  const { jwk, publica } = chavesVapid();
  const enviados = [];
  const buscar = async (url, opcoes) => {
    if (url.includes("firebaseio")) return { ok: true, json: async () => sala };
    enviados.push({ url, opcoes });
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  return { r: await tratarPausa({ codigo: "12345", token: tokenDe(uid), motivo }, env, agora, buscar), enviados };
}

test("quem voltou da pausa chama quem ainda está fora (e só quem pediu avisos)", async () => {
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/maria", p256dh: cel.p256dh, auth: cel.auth };
  const sala = salaCom({ fora: true, push });
  sala.jogadores.joao = { nome: "João", entrouEm: 3, fora: true }; // fora, mas sem avisos
  sala.jogadores.fantasma = { aberto: false, fora: true, push };   // sem nome: não é jogador
  const { r, enviados } = await pedirPausa(sala, "davi", "voltou");
  assert.equal(r.status, 200, r.motivo);
  assert.equal(enviados.length, 1);
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel));
  assert.equal(dados.titulo, "Esperando você no YAM");
  assert.match(dados.texto, /^Davi voltou para a sala 12345/);
  assert.equal((await pedirPausa(sala, "maria", "voltou")).enviados.length, 0, "quem chamou ainda está fora");
  assert.equal((await pedirPausa(sala, "davi", "qualquer")).r.status, 400);
});

test("sala no último dia: avisa quem pausou que ela vai fechar (antes disso, não)", async () => {
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/maria", p256dh: cel.p256dh, auth: cel.auth };
  const dia = 24 * 60 * 60 * 1000;
  const sala = { ...salaCom({ fora: true, push }), criadaEm: 0 };
  const cedo = await pedirPausa(sala, "davi", "prazo", 1 * dia);
  assert.equal(cedo.enviados.length, 0, "faltam 2 dias");
  const { r, enviados } = await pedirPausa(sala, "davi", "prazo", 3 * dia - 5 * 60 * 60 * 1000);
  assert.equal(r.status, 200, r.motivo);
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel));
  assert.equal(dados.titulo, "Sua sala vai fechar");
  assert.match(dados.texto, /fecha em 5 h/);
  assert.equal((await pedirPausa(sala, "davi", "prazo", 3 * dia + 1)).enviados.length, 0, "já fechou");
});

test("tarefa diária: apaga a sala vencida, tira da lista a que sumiu e avisa quem pausou no último dia", async () => {
  const { tarefaDiaria } = await carregar();
  const { jwk, publica } = chavesVapid();
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/maria", p256dh: cel.p256dh, auth: cel.auth };
  const dia = 24 * 60 * 60 * 1000;
  const agora = 10 * dia;
  const banco = {
    abertas: { 11111: true, 22222: true, 33333: true, 44444: true, lixo: true },
    partidas: {
      11111: { ...salaCom(), criadaEm: agora - 4 * dia },                          // vencida
      // 22222 já não existe
      33333: { ...salaCom({ fora: true, push }), criadaEm: agora - 3 * dia + 6 * 60 * 60 * 1000 }, // fecha em 6 h
      44444: { ...salaCom({ fora: true, push }), criadaEm: agora - 1 * dia }      // ainda tem 2 dias
    },
    convites: {
      jbia: { 33333: { de: "Davi", deUid: "davi", em: agora - 2 * dia }, 44444: { de: "Davi", deUid: "davi", em: agora - 60000 } }
    }
  };
  const pedidos = [];
  const buscar = async (url, opcoes = {}) => {
    pedidos.push(`${opcoes.method || "GET"} ${url.replace(/\?.*/, "")}`);
    if (url.includes("identitytoolkit")) return { ok: true, json: async () => ({ idToken: "tok" }) };
    if (url.includes("firebaseio")) {
      assert.ok(url.endsWith("?auth=tok"), "lê com o login anônimo");
      const caminho = url.replace(/^https:\/\/teste\.firebaseio\.com\//, "").replace(/\.json\?.*/, "").split("/");
      const pai = caminho.slice(0, -1).reduce((o, k) => (o ? o[k] : undefined), banco);
      if (opcoes.method === "DELETE") { if (pai) delete pai[caminho.at(-1)]; return { ok: true }; }
      const valor = (pai ? pai[caminho.at(-1)] : undefined) ?? null;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(valor)) };
    }
    return { ok: true, status: 201 }; // push
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", FIREBASE_CHAVE: "chave", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const r = await tarefaDiaria(env, agora, buscar);
  assert.equal(r.status, 200, r.motivo);
  assert.deepEqual(r.feito, { salas: 4, apagadas: 1, tiradas: 2, avisados: 1, convites: 1 });
  assert.deepEqual(Object.keys(banco.convites.jbia), ["44444"], "o convite de 2 dias atrás saiu; o de agora fica");
  assert.equal(banco.partidas[11111], undefined, "a vencida foi apagada");
  assert.deepEqual(Object.keys(banco.abertas).sort(), ["33333", "44444", "lixo"]);
  assert.ok(banco.partidas[33333] && banco.partidas[44444], "as outras continuam");
  const pushes = pedidos.filter(p => p.includes("fcm.googleapis.com"));
  assert.equal(pushes.length, 1, "só quem pausou na sala do último dia");
});

test("vez parada há 10 min com a pessoa fora do app: avisa quem criou, uma vez só", async () => {
  const { avisarVezParada, desdeDaVez } = await carregar();
  const { jwk, publica } = chavesVapid();
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/davi", p256dh: cel.p256dh, auth: cel.auth };
  const min = 60 * 1000;
  const agora = 100 * min;
  // Davi criou e jogou há 12 min; é a vez da Maria, que está com o app fechado
  const sala = salaCom();
  sala.iniciada = true;
  sala.jogadores.davi = { ...sala.jogadores.davi, push, ultima: { key: "0-0", valor: 3, n: 1, em: agora - 12 * min } };
  assert.equal(desdeDaVez(sala), agora - 12 * min);
  const enviados = [];
  const buscar = async (url, opcoes) => { enviados.push({ url, opcoes }); return { ok: true, status: 201 }; };
  const env = { VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  assert.equal(await avisarVezParada("12345", sala, env, agora, buscar), 1);
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel));
  assert.equal(dados.titulo, "A vez está parada");
  assert.match(dados.texto, /^A vez de Maria está parada há 12 min/);
  assert.equal(await avisarVezParada("12345", sala, env, agora + 5 * min, buscar), 0, "na passada seguinte, não repete");
  assert.equal(await avisarVezParada("12345", sala, env, agora - 4 * min, buscar), 0, "antes dos 10 min, não");
  const aberta = { ...sala, jogadores: { ...sala.jogadores, maria: { ...sala.jogadores.maria, visivel: true, vistoEm: agora - 30000 } } };
  assert.equal(await avisarVezParada("12345", aberta, env, agora, buscar), 0, "Maria está no app: só pensando");
  const pausada = { ...sala, jogadores: { ...sala.jogadores, maria: { ...sala.jogadores.maria, fora: true } } };
  assert.equal(await avisarVezParada("12345", pausada, env, agora, buscar), 0, "partida pausada");
  const pulou = { ...sala, jogadores: { ...sala.jogadores, davi: { ...sala.jogadores.davi, pulouEm: agora - 2 * min } } };
  assert.equal(await avisarVezParada("12345", pulou, env, agora, buscar), 0, "a vez acabou de mudar (pulo)");
  const livre = { ...sala, jogadores: { ...sala.jogadores, davi: { ...sala.jogadores.davi, modo: "livre" } } };
  assert.equal(await avisarVezParada("12345", livre, env, agora, buscar), 0, "sala sem vez");
  assert.equal(enviados.length, 1);
});

test("o servidor entra sempre como o mesmo visitante quando tem o FIREBASE_RENOVAR", async () => {
  const { entrarAnonimo } = await carregar();
  const pedidos = [];
  const buscar = async (url, opcoes) => {
    pedidos.push(url.replace(/\?.*/, ""));
    return { ok: true, json: async () => (url.includes("securetoken") ? { id_token: "renovado" } : { idToken: "novo" }) };
  };
  assert.equal(await entrarAnonimo({ FIREBASE_CHAVE: "k", FIREBASE_RENOVAR: "r" }, buscar), "renovado");
  assert.equal(await entrarAnonimo({ FIREBASE_CHAVE: "k" }, buscar), "novo");
  assert.deepEqual(pedidos, ["https://securetoken.googleapis.com/v1/token", "https://identitytoolkit.googleapis.com/v1/accounts:signUp"]);
});

test("convite: avisa os aparelhos de quem foi convidado, com o nome que está na sala, uma vez só", async () => {
  const { tratarConvite } = await carregar();
  const { jwk, publica } = chavesVapid();
  const cel1 = celular(), cel2 = celular();
  const agora = 50 * 24 * 60 * 60 * 1000;
  const banco = {
    convites: { jbia: { 12345: { de: "Davi", deUid: "davi", em: agora - 5000 }, 54321: { de: "Davi", deUid: "davi", em: agora - 10 * 60000 } } },
    avisos: { jbia: {
      celular: { endpoint: "https://fcm.googleapis.com/wp/bia1", p256dh: cel1.p256dh, auth: cel1.auth, em: 1 },
      tablet: { endpoint: "https://web.push.apple.com/bia2", p256dh: cel2.p256dh, auth: cel2.auth, em: 1 }
    } },
    partidas: { 12345: salaCom(), 54321: salaCom() }
  };
  const enviados = [];
  const buscar = async (url, opcoes = {}) => {
    if (url.includes("firebaseio")) {
      assert.ok(url.includes("?auth="), "lê com o token de quem chamou");
      const caminho = url.replace(/^https:\/\/teste\.firebaseio\.com\//, "").replace(/\.json\?.*/, "").split("/");
      const valor = caminho.reduce((o, k) => (o ? o[k] : undefined), banco) ?? null;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(valor)) };
    }
    enviados.push({ url, opcoes });
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const pedido = (codigo, uid = "davi", para = "jbia") => tratarConvite({ codigo, token: tokenDe(uid), para }, env, agora, buscar);

  const r = await pedido("12345");
  assert.equal(r.status, 200, r.motivo);
  assert.deepEqual(enviados.map(e => e.url), ["https://fcm.googleapis.com/wp/bia1", "https://web.push.apple.com/bia2"], "os dois aparelhos");
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel1));
  assert.equal(dados.tipo, "convite");
  assert.equal(dados.codigo, "12345");
  assert.match(dados.texto, /^Davi está te convidando para jogar!/);

  enviados.length = 0;
  assert.equal((await pedido("12345")).motivo, "já avisado");
  assert.equal((await pedido("54321")).motivo, "convite antigo", "convite de 10 min atrás: não manda de novo");
  assert.equal((await pedido("12345", "maria")).status, 403, "o convite não é de quem chamou");
  assert.equal((await pedido("12345", "davi", "../x")).status, 400);
  assert.equal((await pedido("99999")).status, 403, "convite que não existe");
  assert.equal(enviados.length, 0);
});
