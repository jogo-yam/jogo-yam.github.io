// Partida em família: cada um joga no próprio celular e os placares só
// aparecem para todos quando o último jogador termina (pódio).
// Usa Firebase (login anônimo + Realtime Database).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, update, remove, onValue, runTransaction, serverTimestamp
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

async function entrar(codigo, nome) {
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

  await update(ref(db, `${raiz}/jogadores/${user.uid}`), {
    nome, chave, entrouEm: serverTimestamp(), terminou: false, total: null, colunas: null, valores: null
  });
  guardarSessao({ codigo, chave });
  ultimoEnvio = "";
  podioMostrado = false;
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

async function criar(nome) {
  const user = await usuario();
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const codigo = String(Math.floor(10000 + Math.random() * 90000));
    const r = await runTransaction(ref(db, `partidas/${codigo}/criador`),
      atual => atual === null ? user.uid : undefined);
    if (r.committed) {
      await update(ref(db, `partidas/${codigo}`), { criadaEm: serverTimestamp() });
      await entrar(codigo, nome);
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
  atualizarBarra();
  fecharEspera();
  if (uid) {
    try {
      await remove(ref(db, `partidas/${codigo}/jogadores/${uid}`));
      await remove(ref(db, `partidas/${codigo}/nomes/${chave}`));
    } catch { /* sem conexão: tudo bem, a partida segue sem este jogador */ }
  }
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
      atualizarBarra();
      return;
    }
    sincronizar();
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
  if (!sessao || !partida || partida.revelada || !auth.currentUser) return;
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

  if (!sessao) {
    const botao = document.createElement("button");
    botao.className = "familia-entrar";
    botao.textContent = "👥 Jogar em sala";
    botao.onclick = () => escolherSala(); // pergunta: criar ou entrar
    barra.appendChild(botao);
    return;
  }

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
    status.textContent = `${jogadores.length} jogador${jogadores.length === 1 ? "" : "es"} · ${terminaram} ${terminaram === 1 ? "terminou" : "terminaram"}`;
  } else {
    status.textContent = "Conectando…";
  }
  info.append(titulo, status);
  barra.appendChild(info);

  const codigo = document.createElement("button");
  codigo.textContent = "📲 Código";
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
  $("familia-confirmar").textContent = entrar ? "Entrar na sala" : "Criar sala";
  $("familia-nome").value = nomeJogador;
  $("familia-codigo").value = "";
  $("familia-erro").textContent = "";
  $("janela-familia").hidden = false;
  (entrar && nomeJogador ? $("familia-codigo") : $("familia-nome")).focus();
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
  if (!await prepararTabela()) return;

  erro.textContent = tipo === "criar" ? "Criando a sala…" : "Entrando na sala…";
  document.querySelectorAll("#janela-familia button").forEach(b => { b.disabled = true; });
  try {
    if (tipo === "criar") await criar(nome);
    else await entrar(codigo, nome);
    definirNome(nome); // só depois de entrar (nome aceito na sala)
    fecharJanela();
    atualizarBarra();
    if (tipo === "criar") {
      ultimoAviso = Date.now();
      mostrarLegenda(["Sala criada!", `Passe o código ${sessao.codigo} para os outros jogadores (botão 📲 Código).`]);
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
  if (!botao.disabled) botao.textContent = convite ? "🔁 Entrar na revanche" : "🔁 Jogar de novo";
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
}

async function jogarDeNovo() {
  const botao = $("podio-revanche");
  if (botao.disabled) return;
  const convite = revancheDeOutro();
  const antigo = sessao && sessao.codigo;
  const uid = auth.currentUser && auth.currentUser.uid;
  botao.disabled = true;
  botao.textContent = convite ? "Entrando…" : "Criando sala…";
  try {
    // a partida que acabou já está no histórico: começa uma tabela nova
    if (partidaTemValores(state) && !entradaDaPartidaAtual()) salvarPartidaAtual();
    comecarNovaPartida();
    sairDoPodio();
    if (convite) {
      await entrar(convite.codigo, nomeJogador);
      ultimoAviso = Date.now();
      mostrarLegenda(["Revanche!", `Você entrou na sala ${convite.codigo}. Boa sorte!`]);
    } else {
      const codigo = await criar(nomeJogador);
      // avisa quem ainda está no pódio da sala antiga
      if (antigo && uid) update(ref(db, `partidas/${antigo}/jogadores/${uid}`), { revanche: codigo }).catch(() => {});
      ultimoAviso = Date.now();
      mostrarLegenda(["Revanche criada!", `Quem ainda está no pódio vê o botão para entrar. Para os outros, passe o código ${codigo} (botão 📲 Código).`]);
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
  const cores = ["#f2b134", "#3d6ea8", "#ffffff", "#e8604c", "#5cb85c"];
  const area = $("confete-podio");
  area.innerHTML = "";
  for (let i = 0; i < 80; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = cores[i % cores.length];
    p.style.animationDelay = Math.random() * 0.8 + "s";
    p.style.animationDuration = 2 + Math.random() * 1.5 + "s";
    area.appendChild(p);
  }
  setTimeout(() => { area.innerHTML = ""; }, 4500);
}

// Fechar o pódio encerra a partida em família neste celular.
function fecharPodio() {
  $("podio").hidden = true;
  pararDeEscutar();
  guardarSessao(null);
  partida = null;
  atualizarBarra();
  aposPodio(); // depois do pódio, o resultado pessoal
}

// ---------- ligação com o resto do app ----------

window.familia = {
  abrir, fecharJanela, acaoJanela, sair, confirmarSair, compartilharCodigo,
  aoTerminar, fecharEspera, fecharPodio, jogarDeNovo, limparSalasAntigas, sincronizar, registrarResultado,
  ativa: () => !!sessao,
  revelada: () => !!(partida && (partida.revelada || partida.encerrada))
};

atualizarBarra();
setTimeout(limparSalasAntigas, 3000); // depois que o app abriu, sem atrapalhar
if (sessao) usuario().then(escutar).catch(e => atualizarBarra(mensagemDeErro(e)));
