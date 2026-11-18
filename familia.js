// Partida em família: cada um joga no próprio celular e os placares só
// aparecem para todos quando o último jogador termina (pódio).
// Usa Firebase (login anônimo + Realtime Database).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Configuração do projeto "yam-familia". Não é segredo: o que protege o banco
// são as regras de segurança configuradas no console do Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyAG_-doO1gG3E_y6eKmAf51ez1luLLTLOM",
  authDomain: "yam-familia.firebaseapp.com",
  databaseURL: "https://yam-familia-default-rtdb.firebaseio.com",
  projectId: "yam-familia",
  storageBucket: "yam-familia.firebasestorage.app",
  messagingSenderId: "71560505019",
  appId: "1:71560505019:web:bc0e4f91bc25638ebeeb9e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const CHAVE_SESSAO = "yam-familia";   // { codigo, chave } da partida em família atual
let sessao = lerSessao();
let partida = null;                    // último estado recebido do banco
let pararEscuta = null;
let ultimoEnvio = "";
let podioMostrado = false;
let resultadoSala = null;              // colocação deste jogador no último pódio
const CHAVE_MODO = "yam-modo-sala";    // última escolha ao criar: "livre" ou "vez"
let modoEscolhido = localStorage.getItem(CHAVE_MODO) === "vez" ? "vez" : "livre";

// ---------- utilidades ----------

function lerSessao() {
  try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch { return null; }
}

function guardarSessao(s) {
  sessao = s;
  if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
  else localStorage.removeItem(CHAVE_SESSAO);
}

// "Daví  Carvalho" e "davi carvalho" viram a mesma chave: nomes não podem repetir.
function chaveDoNome(nome) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ").replace(/[.#$[\]/]/g, "_");
}

async function usuario() {
  if (auth.currentUser) return auth.currentUser;
  await new Promise(pronto => { const parar = onAuthStateChanged(auth, () => { parar(); pronto(); }); });
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

function mensagemDeErro(erro) {
  const texto = String((erro && (erro.code || erro.message)) || erro);
  if (/permission/i.test(texto)) return "O banco recusou o acesso. Confira se as regras do Firebase foram publicadas.";
  if (/network|offline|unavailable/i.test(texto)) return "Sem conexão. A sala precisa de internet.";
  return (erro && erro.message) || "Algo deu errado. Tente de novo.";
}

const jogadoresDe = p => Object.entries((p && p.jogadores) || {}).map(([uid, j]) => ({ uid, ...j }));
const $ = id => document.getElementById(id);

// ---------- criar / entrar / sair ----------

async function entrar(codigo, nome, modo = null) {
  const user = await usuario();
  const raiz = `partidas/${codigo}`;
  const snap = await get(ref(db, raiz));
  if (!snap.exists() || !snap.child("criador").exists()) throw new Error("Não existe sala com esse código.");
  if (snap.child("revelada").val()) throw new Error("A partida dessa sala já terminou.");

  const chave = chaveDoNome(nome);
  const resultado = await runTransaction(ref(db, `${raiz}/nomes/${chave}`),
    atual => (atual === null || atual === user.uid) ? user.uid : undefined);
  if (!resultado.committed) {
    throw new Error(`Já tem alguém chamado "${nome}" nesta sala. Use outro nome (pode ser com sobrenome ou apelido).`);
  }

  // se esse celular já estava na partida com outro nome, libera o nome antigo
  const chaveAntiga = snap.child(`jogadores/${user.uid}/chave`).val();
  if (chaveAntiga && chaveAntiga !== chave) await remove(ref(db, `${raiz}/nomes/${chaveAntiga}`));

  // sala com vez: o modo vem de quem criou; quem entra no meio começa na rodada atual
  const sala = snap.val();
  const modoDaSalaAgora = modo || modoDaSala(sala);
  const outros = jogadoresDe(sala).filter(j => j.uid !== user.uid && !j.terminou);
  const pulos = pulosDe(sala);
  const base = outros.length
    ? Math.min(...outros.map(j => (j.casas || 0) + (j.base || 0) + (pulos[j.uid] || 0)))
    : 0;
  const jaEstava = snap.child(`jogadores/${user.uid}/entrouEm`).exists();

  await update(ref(db, `${raiz}/jogadores/${user.uid}`), {
    nome, chave, terminou: false, total: null, colunas: null, valores: null,
    modo: modoDaSalaAgora, casas: casasMarcadas(), base: jaEstava ? (sala.jogadores[user.uid].base || 0) : base,
    ...(jaEstava ? {} : { entrouEm: serverTimestamp() }) // a ordem da vez não muda se entrar de novo
  });
  guardarSessao({ codigo, chave });
  ultimoEnvio = "";
  podioMostrado = false;
  reiniciarVez();
  escutar();
}

// Salas com mais de 3 dias são apagadas pelo celular que as criou: cada celular
// guarda os códigos das salas que criou e, ao abrir o app ou criar outra sala,
// apaga as que já passaram de 3 dias. As regras do Firebase só deixam apagar
// uma sala inteira quando ela tem mais de 3 dias (aqui: 3,5 dias, de folga
// caso o relógio do celular esteja adiantado).
const DIA = 24 * 60 * 60 * 1000;
const CHAVE_CRIADAS = "yam-salas-criadas"; // [{ codigo, em }]

function salasCriadas() {
  try { return JSON.parse(localStorage.getItem(CHAVE_CRIADAS)) || []; } catch { return []; }
}

function guardarSalaCriada(codigo) {
  localStorage.setItem(CHAVE_CRIADAS, JSON.stringify([...salasCriadas(), { codigo, em: Date.now() }]));
}

async function limparSalasAntigas() {
  const limite = Date.now() - 3.5 * DIA;
  const antigas = salasCriadas().filter(s => s.em < limite);
  if (!antigas.length) return [];
  try { await usuario(); } catch { return []; }
  const apagadas = [];
  for (const sala of antigas) {
    if (sessao && sessao.codigo === sala.codigo) continue; // ainda estou nela
    try {
      const existe = (await get(ref(db, `partidas/${sala.codigo}/criadaEm`))).exists();
      if (existe) await remove(ref(db, `partidas/${sala.codigo}`));
      apagadas.push(sala.codigo); // apagada agora ou já não existia
    } catch {
      // sem conexão ou ainda não pode: tenta de novo outra vez (desiste depois de 30 dias)
      if (sala.em < Date.now() - 30 * DIA) apagadas.push(sala.codigo);
    }
  }
  localStorage.setItem(CHAVE_CRIADAS, JSON.stringify(salasCriadas().filter(s => !apagadas.includes(s.codigo))));
  return apagadas;
}

async function criar(nome, modo = "livre") {
  const user = await usuario();
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const codigo = String(Math.floor(10000 + Math.random() * 90000));
    const r = await runTransaction(ref(db, `partidas/${codigo}/criador`),
      atual => atual === null ? user.uid : undefined);
    if (r.committed) {
      await update(ref(db, `partidas/${codigo}`), { criadaEm: serverTimestamp() });
      await entrar(codigo, nome, modo);
      guardarSalaCriada(codigo);
      limparSalasAntigas(); // em segundo plano
      return codigo;
    }
  }
  throw new Error("Não foi possível criar a sala. Tente de novo.");
}

function pararDeEscutar() {
  if (pararEscuta) pararEscuta();
  pararEscuta = null;
}

async function sair() {
  if (!sessao) return;
  const { codigo, chave } = sessao;
  const uid = auth.currentUser && auth.currentUser.uid;
  pararDeEscutar();
  guardarSessao(null);
  partida = null;
  reiniciarVez();
  atualizarBarra();
  fecharEspera();
  if (uid) {
    try {
      await remove(ref(db, `partidas/${codigo}/jogadores/${uid}`));
      await remove(ref(db, `partidas/${codigo}/nomes/${chave}`));
    } catch { /* sem conexão: tudo bem, a partida segue sem este jogador */ }
  }
}

// ---------- nome de usuário ----------
// usuarios/<chave do nome> = { dono, segredo, nome }. As regras deixam gravar
// um nome livre, regravar o próprio e "pegar" um nome de outro celular só com
// o mesmo segredo (o resumo SHA-256 do código de recuperação). Ninguém lê essa
// lista: um nome tomado aparece como "permissão negada" ao tentar gravar.

const formatarCodigo = digitos => `${digitos.slice(0, 4)}-${digitos.slice(4, 8)}`;

function gerarCodigo() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return formatarCodigo(String(n[0] % 100000000).padStart(8, "0"));
}

async function segredoDe(chave, codigo) {
  const digitos = String(codigo).replace(/\D/g, "");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`yam:${chave}:${digitos}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const negado = e => /permission/i.test(String((e && (e.code || e.message)) || e));

async function gravarNome(nome, codigo) {
  const user = await usuario();
  const chave = chaveDoNome(nome);
  const cod = formatarCodigo(String(codigo).replace(/\D/g, ""));
  await set(ref(db, `usuarios/${chave}`), {
    dono: user.uid, segredo: await segredoDe(chave, cod), nome, em: serverTimestamp()
  });
  return { nome, chave, codigo: cod };
}

function nomeTomado(nome) {
  const erro = new Error(`Já existe alguém com o nome "${nome}". Escolha outro nome ` +
    "(pode ser com sobrenome ou apelido). Se é você em outro celular, recupere com o código.");
  erro.tomado = true;
  return erro;
}

// Antes de criar ou entrar numa sala. Devolve true se registrou agora (nome novo).
async function garantirUsuario(nome) {
  const local = lerUsuario();
  const mesmo = !!local && local.chave === chaveDoNome(nome);
  try {
    const u = await gravarNome(nome, mesmo ? local.codigo : gerarCodigo());
    guardarUsuario(u);
    return !mesmo;
  } catch (e) {
    if (negado(e)) throw nomeTomado(nome);
    throw e;
  }
}

// Outro celular: o nome volta com o código certo.
async function recuperar(nome, codigo) {
  try {
    guardarUsuario(await gravarNome(nome, codigo));
  } catch (e) {
    if (negado(e)) throw new Error("Nome ou código não confere. Confira e tente de novo.");
    throw new Error(mensagemDeErro(e));
  }
}

// Trocar o nome de usuário: registra o novo (mesmo código) e libera o antigo.
async function trocarNome(novo) {
  const antigo = lerUsuario();
  let u;
  try {
    u = await gravarNome(novo, antigo.codigo);
  } catch (e) {
    if (negado(e)) throw nomeTomado(novo);
    throw new Error(mensagemDeErro(e));
  }
  if (antigo.chave !== u.chave) await remove(ref(db, `usuarios/${antigo.chave}`)).catch(() => {});
  guardarUsuario(u);
}

// ---------- acompanhar a partida ----------

function escutar() {
  pararDeEscutar();
  if (!sessao) return;
  pararEscuta = onValue(ref(db, `partidas/${sessao.codigo}`), snap => {
    partida = snap.val();
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!partida || !partida.jogadores || !partida.jogadores[uid]) {
      // a partida sumiu ou este jogador saiu em outro lugar
      pararDeEscutar();
      guardarSessao(null);
      partida = null;
      reiniciarVez();
      atualizarBarra();
      return;
    }
    sincronizar();
    avisarDaVez();
    atualizarBarra();
    atualizarEspera();
    verificarRevelacao();
    if (podioMostrado) atualizarRevanche();
  }, erro => {
    console.warn("familia:", erro);
    atualizarBarra(mensagemDeErro(erro));
  });
}

// Envia só "terminou / total" quando a tabela fica completa (nunca os pontos no meio do jogo).
function sincronizar() {
  if (!sessao || !partida || partida.revelada || !auth.currentUser) {
    atualizarBarraVez();
    return;
  }
  acompanharVez();
  // só conta como terminada se todas as casas têm valores possíveis
  const completa = partidaCompleta() && tabelaValida(state);
  const { calculados, geral } = calcularTotais(state);
  const valores = {};
  if (completa) {
    for (const l of LINHAS_JOGO) for (const c of [0, 1, 2, 3]) valores[`${l}-${c}`] = String(state[`${l}-${c}`]);
  }
  const dados = completa
    ? { terminou: true, total: geral, colunas: [0, 1, 2, 3].map(c => calculados[`17-${c}`]), valores }
    : { terminou: false, total: null, colunas: null, valores: null };
  const assinatura = JSON.stringify(dados);
  if (assinatura === ultimoEnvio) return;
  ultimoEnvio = assinatura;
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${auth.currentUser.uid}`),
    { ...dados, atualizadoEm: serverTimestamp() })
    .catch(() => { ultimoEnvio = ""; });
}

function verificarRevelacao() {
  const jogadores = jogadoresDe(partida);
  const todosTerminaram = jogadores.length > 0 && jogadores.every(j => j.terminou);
  const revelar = partida.revelada || partida.encerrada || todosTerminaram;
  if (!revelar) return;
  if (!partida.revelada) update(ref(db, `partidas/${sessao.codigo}`), { revelada: true }).catch(() => {});
  if (!podioMostrado) mostrarPodio();
}

// ---------- barra da partida em família (acima da tabela) ----------

function atualizarBarra(erro) {
  const barra = $("familia-barra");
  if (!barra) return;
  barra.innerHTML = "";

  // fora de sala: só o botão "Jogar em sala" no topo, ao lado do YAM
  $("botao-sala").hidden = !!sessao;
  barra.hidden = !sessao;
  if (!sessao) return;

  const info = document.createElement("div");
  info.className = "familia-info";
  const titulo = document.createElement("strong");
  titulo.textContent = `Sala ${sessao.codigo}`;
  const status = document.createElement("small");
  if (erro) {
    status.textContent = erro;
  } else if (partida) {
    const jogadores = jogadoresDe(partida);
    const terminaram = jogadores.filter(j => j.terminou).length;
    status.textContent = `${jogadores.length} jogador${jogadores.length === 1 ? "" : "es"} · ${terminaram} ${terminaram === 1 ? "terminou" : "terminaram"}` +
      (modoDaSala() === "vez" ? " · um de cada vez" : "");
  } else {
    status.textContent = "Conectando…";
  }
  info.append(titulo, status);
  barra.appendChild(info);

  const codigo = document.createElement("button");
  rotular(codigo, "enviar", "Código");
  codigo.onclick = compartilharCodigo;
  barra.appendChild(codigo);

  const uid = auth.currentUser && auth.currentUser.uid;
  if (partida && partida.criador === uid && !partida.revelada &&
      jogadoresDe(partida).some(j => j.terminou)) {
    const encerrar = document.createElement("button");
    encerrar.textContent = "Encerrar";
    encerrar.onclick = encerrarPartida;
    barra.appendChild(encerrar);
  }

  const botaoSair = document.createElement("button");
  botaoSair.textContent = "Sair";
  botaoSair.onclick = confirmarSair;
  barra.appendChild(botaoSair);
}

async function compartilharCodigo() {
  const texto = `Entre na minha sala de YAM com o código ${sessao.codigo}`;
  try {
    if (navigator.share) { await navigator.share({ text: `${texto}: ${ENDERECO_APP}` }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  avisar(`Passe este código para os outros jogadores: ${sessao.codigo}`, "Código da sala");
}

async function encerrarPartida() {
  const faltam = jogadoresDe(partida).filter(j => !j.terminou).map(j => j.nome);
  if (!await confirmar("Encerrar a partida?",
    `O resultado aparece agora. Quem ainda não terminou (${faltam.join(", ")}) fica fora do pódio.`, "Encerrar")) return;
  try { await update(ref(db, `partidas/${sessao.codigo}`), { encerrada: true }); }
  catch (e) { avisar(mensagemDeErro(e), "Não deu para encerrar"); }
}

async function confirmarSair() {
  if (!await confirmar("Sair da sala?", "Sua tabela continua aqui, mas você sai do resultado da sala.", "Sair")) return;
  await sair();
}

// ---------- janela de criar / entrar ----------

let modoJanela = "criar";

// modo "criar": só o nome. modo "entrar": nome + código.
function abrir(modo = "criar") {
  modoJanela = modo;
  const entrar = modo === "entrar";
  $("familia-titulo").textContent = entrar ? "Entrar em sala" : "Criar sala";
  $("familia-explica").textContent = entrar
    ? "Digite o código que quem criou a sala te passou."
    : "Cada um joga no próprio celular. Os pontos de todos aparecem juntos, num pódio, quando o último terminar.";
  $("familia-campo-codigo").hidden = !entrar;
  $("familia-modo").hidden = entrar;
  escolherModo(modoEscolhido);
  $("familia-confirmar").textContent = entrar ? "Entrar na sala" : "Criar sala";
  const registrado = lerUsuario();
  $("familia-nome").value = registrado ? registrado.nome : nomeJogador;
  $("familia-nome").readOnly = !!registrado;
  $("familia-nota-nome").textContent = registrado
    ? "Seu nome de usuário. Para trocar, vá em Mais opções."
    : "Vai ser o seu nome de usuário, só seu. Use seu nome de verdade (ou o apelido que a família conhece): assim todo mundo sabe quem é quem no pódio.";
  $("familia-recuperar").hidden = true;
  $("familia-codigo").value = "";
  $("familia-erro").textContent = "";
  $("janela-familia").hidden = false;
  (entrar && $("familia-nome").value ? $("familia-codigo") : $("familia-nome")).focus();
}

function fecharJanela() {
  $("janela-familia").hidden = true;
}

// A partida em família começa com a tabela zerada.
async function prepararTabela() {
  if (!partidaTemValores(state)) return true;
  if (!await confirmar("Começar com a tabela zerada?",
    "Para jogar em sala, sua tabela começa zerada. A partida atual vai para o histórico.", "Continuar")) return false;
  salvarPartidaAtual();
  comecarNovaPartida();
  return true;
}

async function acaoJanela(tipo = modoJanela) {
  const erro = $("familia-erro");
  const nome = $("familia-nome").value.trim().replace(/\s+/g, " ").slice(0, 20);
  const codigo = $("familia-codigo").value.replace(/\D/g, "");
  if (!nome) { erro.textContent = "Digite seu nome para entrar na sala."; $("familia-nome").focus(); return; }
  if (tipo === "entrar" && codigo.length !== 5) { erro.textContent = "O código tem 5 números."; $("familia-codigo").focus(); return; }
  $("familia-recuperar").hidden = true;

  // o nome de usuário tem que ser deste celular (registra na primeira vez)
  erro.textContent = "Conferindo seu nome…";
  let registrouAgora = false;
  try {
    registrouAgora = await garantirUsuario(nome);
  } catch (e) {
    erro.textContent = e.tomado ? e.message : mensagemDeErro(e);
    $("familia-recuperar").hidden = !e.tomado;
    return;
  }
  if (!await prepararTabela()) { erro.textContent = ""; return; }

  erro.textContent = tipo === "criar" ? "Criando a sala…" : "Entrando na sala…";
  document.querySelectorAll("#janela-familia button").forEach(b => { b.disabled = true; });
  try {
    if (tipo === "criar") await criar(nome, modoEscolhido);
    else await entrar(codigo, nome);
    definirNome(nome); // só depois de entrar (nome aceito na sala)
    fecharJanela();
    atualizarBarra();
    if (registrouAgora) {
      avisar(`"${nome}" agora é o seu nome de usuário: ninguém mais pode usar. ` +
        `Se trocar de celular, recupere com o código ${lerUsuario().codigo}. ` +
        "Ele fica em Mais opções e vai junto no backup.", "Guarde seu código");
    } else if (tipo === "criar") {
      ultimoAviso = Date.now();
      mostrarLegenda(["Sala criada!", `Passe o código ${sessao.codigo} para os outros jogadores (botão Código).`]);
    }
  } catch (e) {
    erro.textContent = mensagemDeErro(e);
  } finally {
    document.querySelectorAll("#janela-familia button").forEach(b => { b.disabled = false; });
  }
}

// ---------- esperando os outros ----------

function aoTerminar() {
  sincronizar();
  if (podioMostrado) return; // o envio já revelou o pódio (era o último a terminar)
  $("familia-espera").hidden = false;
  atualizarEspera();
}

function atualizarEspera() {
  const caixa = $("familia-espera");
  if (!caixa || caixa.hidden || !partida) return;
  const { geral } = calcularTotais(state);
  $("espera-total").textContent = geral;
  const faltam = jogadoresDe(partida).filter(j => !j.terminou).map(j => j.nome);
  $("espera-faltam").textContent = faltam.length
    ? `Esperando: ${faltam.join(", ")}`
    : "Todos terminaram!";
}

function fecharEspera() {
  const caixa = $("familia-espera");
  if (caixa) caixa.hidden = true;
}

// ---------- pódio ----------

function mostrarPodio() {
  podioMostrado = true;
  fecharEspera();
  document.getElementById("fim-de-jogo").hidden = true;

  const uid = auth.currentUser && auth.currentUser.uid;
  const jogadores = jogadoresDe(partida);
  const terminaram = jogadores.filter(j => j.terminou && typeof j.total === "number")
    .sort((a, b) => b.total - a.total);
  const naoTerminaram = jogadores.filter(j => !(j.terminou && typeof j.total === "number"));

  // empate fica na mesma posição (1º, 1º, 3º...)
  const posicao = j => 1 + terminaram.filter(o => o.total > j.total).length;
  const vencedores = terminaram.filter(j => posicao(j) === 1);
  const euSou = j => (j.uid === uid ? { eu: true } : {});

  // o pódio inteiro (com as tabelas de quem enviou) fica guardado na partida do histórico
  const podio = {
    titulo: tituloDoPodio(vencedores.map(v => v.nome)),
    terminaram: terminaram.map(j => ({
      nome: j.nome, total: j.total, posicao: posicao(j), ...euSou(j),
      ...(j.valores && typeof j.valores === "object" ? { valores: j.valores } : {})
    })),
    naoTerminaram: naoTerminaram.map(j => ({ nome: j.nome, ...euSou(j) }))
  };

  // tocar no nome abre a tabela daquela pessoa
  desenharPodio(podio, j => () => {
    $("podio").hidden = true;
    abrirTabelaJogador(j.nome, j.valores, j.total, () => {
      mostrarTela("tela-jogo");
      $("podio").hidden = false;
    });
  });

  // guarda na partida do histórico deste jogador como foi a sala
  const eu = terminaram.find(j => j.uid === uid);
  resultadoSala = eu ? {
    codigo: sessao.codigo, total: eu.total, posicao: posicao(eu), meuNome: eu.nome,
    jogadores: jogadores.length, vencedores: vencedores.map(v => v.nome), podio
  } : null;
  registrarResultado();

  atualizarRevanche();
  $("podio").hidden = false;
  confetePodio();
}

// ---------- revanche ----------
// Quem toca em "Jogar de novo" cria uma sala nova e marca o código dela no
// próprio jogador da sala antiga. Quem ainda está no pódio vê "Entrar na revanche".

function revancheDeOutro() {
  const uid = auth.currentUser && auth.currentUser.uid;
  const j = jogadoresDe(partida).find(j => j.revanche && j.uid !== uid);
  return j ? { codigo: j.revanche, nome: j.nome } : null;
}

function atualizarRevanche() {
  const convite = partida ? revancheDeOutro() : null;
  const botao = $("podio-revanche");
  if (!botao.disabled) rotular(botao, "repetir", convite ? "Entrar na revanche" : "Jogar de novo");
  const info = $("podio-revanche-info");
  info.textContent = convite ? `${convite.nome} chamou para uma revanche!` : "";
  info.hidden = !convite;
}

// Sai da sala antiga sem mostrar o resultado pessoal (ele já está no histórico).
function sairDoPodio() {
  $("podio").hidden = true;
  pararDeEscutar();
  guardarSessao(null);
  partida = null;
  reiniciarVez();
}

async function jogarDeNovo() {
  const botao = $("podio-revanche");
  if (botao.disabled) return;
  const convite = revancheDeOutro();
  const antigo = sessao && sessao.codigo;
  const modo = modoDaSala();
  const uid = auth.currentUser && auth.currentUser.uid;
  botao.disabled = true;
  botao.textContent = convite ? "Entrando…" : "Criando sala…";
  try {
    // a partida que acabou já está no histórico: começa uma tabela nova
    if (partidaTemValores(state) && !entradaDaPartidaAtual()) salvarPartidaAtual();
    comecarNovaPartida();
    sairDoPodio();
    await garantirUsuario(nomeJogador);
    if (convite) {
      await entrar(convite.codigo, nomeJogador);
      ultimoAviso = Date.now();
      mostrarLegenda(["Revanche!", `Você entrou na sala ${convite.codigo}. Boa sorte!`]);
    } else {
      const codigo = await criar(nomeJogador, modo);
      // avisa quem ainda está no pódio da sala antiga
      if (antigo && uid) update(ref(db, `partidas/${antigo}/jogadores/${uid}`), { revanche: codigo }).catch(() => {});
      ultimoAviso = Date.now();
      mostrarLegenda(["Revanche criada!", `Quem ainda está no pódio vê o botão para entrar. Para os outros, passe o código ${codigo} (botão Código).`]);
    }
  } catch (e) {
    ultimoAviso = Date.now();
    mostrarLegenda(["Não deu para começar a revanche", mensagemDeErro(e)], "erro");
  } finally {
    botao.disabled = false;
    atualizarBarra();
  }
}

// O pódio pode abrir antes de a partida ir para o histórico (último a terminar):
// por isso o app chama isto de novo depois de salvar.
function registrarResultado() {
  if (resultadoSala) registrarResultadoSala({ ...resultadoSala });
}

function confetePodio() {
  soltarConfete(80);
  vibrar([40, 60, 40, 60, 120]);
  tocar("podio");
}

// Fechar o pódio encerra a partida em família neste celular.
function fecharPodio() {
  $("podio").hidden = true;
  pararDeEscutar();
  guardarSessao(null);
  partida = null;
  reiniciarVez();
  atualizarBarra();
  aposPodio(); // depois do pódio, o resultado pessoal
}

// ---------- cada um na sua vez ----------
// A vez não fica guardada num lugar só: as regras do banco só deixam cada um
// escrever no próprio jogador. Cada um publica quantas casas já marcou
// ("casas") e todos calculam de quem é a vez (vezDaSala, no app.js). Ao marcar,
// a vez passa depois de 3 s (dá para desfazer antes). O criador pode pular a
// vez de alguém: guarda "pulos" no próprio jogador.

const ESPERA_PASSAR = 3000;
let casasPublicadas = null;   // casas que este celular já publicou na sala
let timerVez = null;
let vezAnterior;              // de quem era a vez no último retrato da sala
let jogadasVistas = null;     // uid -> número da última jogada já avisada
let pulosVistos = null;       // quantas vezes já fui pulado (para avisar)

function escolherModo(modo) {
  modoEscolhido = modo === "vez" ? "vez" : "livre";
  localStorage.setItem(CHAVE_MODO, modoEscolhido);
  document.querySelectorAll("#familia-modo button").forEach(b => {
    b.setAttribute("aria-checked", String(b.dataset.modo === modoEscolhido));
  });
}

function modoDaSala(p = partida) {
  if (!p || !p.jogadores) return "livre";
  const criador = p.jogadores[p.criador];
  if (criador && criador.modo) return criador.modo;
  return jogadoresDe(p).some(j => j.modo === "vez") ? "vez" : "livre";
}

function pulosDe(p) {
  const criador = p && p.jogadores && p.jogadores[p.criador];
  return (criador && criador.pulos) || {};
}

const minhaUid = () => auth.currentUser && auth.currentUser.uid;
const comVez = () => !!(sessao && partida && !partida.revelada && !partida.encerrada &&
  partida.jogadores && partida.jogadores[minhaUid()] && modoDaSala() === "vez");
const daVez = (p = partida) => vezDaSala(jogadoresDe(p), pulosDe(p));
const nomeDe = uid => (uid && partida && partida.jogadores[uid] && partida.jogadores[uid].nome) || "";
const esperandoPassar = () => casasPublicadas !== null && casasMarcadas() > casasPublicadas;

function reiniciarVez() {
  clearTimeout(timerVez);
  timerVez = null;
  casasPublicadas = null;
  vezAnterior = undefined;
  jogadasVistas = null;
  pulosVistos = null;
  atualizarBarraVez();
}

// O app pergunta antes de deixar mexer na tabela ou nos dados.
function podeJogar() {
  return !comVez() || (daVez() === minhaUid() && !esperandoPassar());
}

function porQueNaoPode() {
  if (esperandoPassar()) return ["Você já jogou", "A vez está passando para o próximo. Para trocar, use Desfazer."];
  return ["Não é a sua vez", `Agora é a vez de ${nomeDe(daVez())}. Avisamos quando chegar a sua.`];
}

// Desfazer só antes de a vez passar (depois, a jogada já é dos outros).
function podeDesfazer() {
  return !comVez() || esperandoPassar();
}

// Marcou uma casa na sua vez: espera 3 s e passa a vez.
function acompanharVez() {
  if (!comVez()) {
    clearTimeout(timerVez);
    timerVez = null;
    atualizarBarraVez();
    return;
  }
  const eu = partida.jogadores[minhaUid()];
  if (casasPublicadas === null) casasPublicadas = typeof eu.casas === "number" ? eu.casas : 0;
  const agora = casasMarcadas();
  if (agora > casasPublicadas) {
    if (!timerVez) timerVez = setTimeout(passarVez, ESPERA_PASSAR);
  } else {
    clearTimeout(timerVez);
    timerVez = null;
    if (agora < casasPublicadas) {
      // a tabela ficou com menos casas (zerada, ou um backup importado): a sala acompanha
      casasPublicadas = agora;
      update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), { casas: agora }).catch(() => {});
    }
  }
  atualizarBarraVez();
}

function passarVez() {
  timerVez = null;
  if (!comVez()) return;
  // ainda digitando o número: espera terminar
  const ativo = document.activeElement;
  if (ativo && ativo.tagName === "INPUT" && $("tableBody").contains(ativo)) {
    timerVez = setTimeout(passarVez, 800);
    return;
  }
  const agora = casasMarcadas();
  if (agora <= casasPublicadas) return;
  const anterior = casasPublicadas;
  casasPublicadas = agora;
  const ultima = ultimaJogadaFeita();
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), {
    casas: agora, mesa: null,
    ultima: ultima ? { ...ultima, n: agora, em: serverTimestamp() } : null
  }).catch(() => { casasPublicadas = anterior; acompanharVez(); }); // sem conexão: tenta de novo
  atualizarBarraVez();
}

// Na sua vez, os dados vão para a sala (os outros veem rolando).
function mesaMudou() {
  if (!comVez() || daVez() !== minhaUid() || esperandoPassar()) return;
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), {
    mesa: { valores: [...mesa.valores], segurados: [...mesa.segurados], jogada: mesa.jogada }
  }).catch(() => {});
}

async function pularVez(uid) {
  const nome = nomeDe(uid);
  if (!await confirmar(`Pular a vez de ${nome}?`,
    `${nome} perde esta jogada e a vez passa para o próximo.`, "Pular")) return;
  if (daVez() !== uid) return; // a vez mudou enquanto perguntava
  try {
    await runTransaction(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}/pulos/${uid}`), n => (n || 0) + 1);
  } catch (e) { avisar(mensagemDeErro(e), "Não deu para pular"); }
}

// Avisos: "Sua vez!" e o que cada um marcou.
function avisarDaVez() {
  if (!comVez()) return;
  const uid = minhaUid();
  const vez = daVez();

  const vistas = {};
  for (const j of jogadoresDe(partida)) {
    const n = j.ultima ? j.ultima.n : 0;
    vistas[j.uid] = n;
    if (jogadasVistas && j.uid !== uid && j.ultima && n > (jogadasVistas[j.uid] || 0)) {
      ultimoAviso = Date.now();
      mostrarLegenda([textoDaJogada(j.nome, j.ultima.key, j.ultima.valor),
        vez === uid ? "Agora é a sua vez!" : `Agora é a vez de ${nomeDe(vez)}.`]);
    }
  }
  jogadasVistas = vistas;

  const meusPulos = pulosDe(partida)[uid] || 0;
  if (pulosVistos !== null && meusPulos > pulosVistos) {
    ultimoAviso = Date.now();
    mostrarLegenda(["Sua vez foi pulada", `${nomeDe(partida.criador)} passou a vez. Agora é a vez de ${nomeDe(vez)}.`]);
  }
  pulosVistos = meusPulos;

  if (vez === uid && vezAnterior !== uid && !esperandoPassar()) {
    vibrar([60, 50, 60]);
    tocar("suaVez");
    if (vezAnterior !== undefined && Date.now() - ultimoAviso > 800) {
      ultimoAviso = Date.now();
      mostrarLegenda(["Sua vez!", "Role os dados ou marque na tabela."]);
    }
  }
  vezAnterior = vez;
}

// Faixa acima da tabela: de quem é a vez, os dados dela e a última jogada.
function atualizarBarraVez() {
  const barra = $("barra-vez");
  if (!barra) return;
  if (!comVez()) { barra.hidden = true; return; }
  barra.hidden = false;
  const uid = minhaUid();
  const vez = daVez();
  const quem = $("vez-quem"), dados = $("vez-dados"), acao = $("vez-acao");
  const passando = esperandoPassar();
  barra.classList.toggle("minha", vez === uid && !passando);
  dados.innerHTML = "";
  acao.hidden = true;

  if (passando) {
    // quem vem depois de mim
    const simulado = jogadoresDe(partida).map(j => (j.uid === uid ? { ...j, casas: casasMarcadas() } : j));
    quem.textContent = `Passando a vez para ${nomeDe(vezDaSala(simulado, pulosDe(partida))) || "o próximo"}…`;
    acao.hidden = false;
    rotular(acao, "desfazer", "Desfazer");
    acao.onclick = () => desfazer();
  } else if (vez === uid) {
    quem.textContent = "Sua vez!";
  } else {
    const j = partida.jogadores[vez];
    quem.textContent = `Vez de ${nomeDe(vez)}`;
    if (j && j.mesa && j.mesa.jogada > 0 && Array.isArray(j.mesa.valores)) {
      quem.textContent += ` · ${j.mesa.jogada}ª jogada`;
      const segurados = j.mesa.segurados || [];
      dados.innerHTML = j.mesa.valores.map((f, i) => dadoMini(f, !!segurados[i])).join("");
      dados.setAttribute("aria-label", `Dados de ${j.nome}: ${j.mesa.valores.join(", ")} (${j.mesa.jogada}ª jogada)`);
    }
    if (partida.criador === uid) {
      acao.hidden = false;
      acao.textContent = "Pular";
      acao.onclick = () => pularVez(vez);
    }
  }

  // a jogada mais recente da sala
  const ultima = jogadoresDe(partida).filter(j => j.ultima && j.ultima.key)
    .sort((a, b) => (b.ultima.em || 0) - (a.ultima.em || 0))[0];
  $("vez-ultima").textContent = ultima
    ? (ultima.uid === uid ? textoDaJogada("Você", ultima.ultima.key, ultima.ultima.valor)
      : textoDaJogada(ultima.nome, ultima.ultima.key, ultima.ultima.valor))
    : (vez === uid ? "Você começa." : "Ninguém jogou ainda.");
}

// ---------- ligação com o resto do app ----------

window.familia = {
  abrir, fecharJanela, acaoJanela, sair, confirmarSair, compartilharCodigo,
  aoTerminar, fecharEspera, fecharPodio, jogarDeNovo, limparSalasAntigas, sincronizar, registrarResultado,
  escolherModo, podeJogar, porQueNaoPode, podeDesfazer, mesaMudou, recuperar, trocarNome,
  ativa: () => !!sessao,
  revelada: () => !!(partida && (partida.revelada || partida.encerrada))
};

atualizarBarra();
setTimeout(limparSalasAntigas, 3000); // depois que o app abriu, sem atrapalhar
if (sessao) usuario().then(escutar).catch(e => atualizarBarra(mensagemDeErro(e)));
