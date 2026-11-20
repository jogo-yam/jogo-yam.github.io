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
const CHAVE_SO_DADOS = "yam-so-dados"; // última escolha de "só os dados do app" ("0" = desmarcado)

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

const ehErroDeConexao = erro => /network|offline|unavailable/i.test(String((erro && (erro.code || erro.message)) || erro));

function mensagemDeErro(erro) {
  const texto = String((erro && (erro.code || erro.message)) || erro);
  if (/permission/i.test(texto)) return "O banco recusou o acesso. Atualize o app (feche e abra) e tente de novo.";
  if (ehErroDeConexao(erro)) {
    return `Não deu para falar com o servidor das salas. Confira a internet e tente de novo em alguns segundos. (${texto.slice(0, 60)})`;
  }
  return (erro && erro.message) || "Algo deu errado. Tente de novo.";
}

// Espera a conexão com o banco abrir (até `ms`). Ao voltar do segundo plano, o
// celular leva alguns segundos para reconectar.
function esperarConexao(ms) {
  return new Promise(pronto => {
    let parar = null;
    let acabou = false;
    const terminar = valor => {
      if (acabou) return;
      acabou = true;
      clearTimeout(limite);
      if (parar) parar();
      pronto(valor);
    };
    const limite = setTimeout(() => terminar(false), ms);
    parar = onValue(ref(db, ".info/connected"), snap => { if (snap.val() === true) terminar(true); });
    if (acabou && parar) parar();
  });
}

// Gravações esperam o servidor sem limite: aqui, depois de `ms`, desiste com erro de conexão.
function comLimite(promessa, ms = 15000) {
  return Promise.race([
    promessa,
    new Promise((_, falhou) => setTimeout(() => falhou(new Error("network: o servidor não respondeu")), ms))
  ]);
}

// Antes de criar ou entrar: espera a conexão (até 8 s); sem ela, avisa em vez de travar.
async function precisaDeConexao() {
  if (!await esperarConexao(8000)) throw new Error("network: sem conexão com o banco");
}

// get() falha na hora ("client is offline") se a conexão ainda está abrindo:
// espera conectar e tenta de novo (até 3 vezes) antes de desistir.
async function lerDoBanco(caminho) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      return await get(ref(db, caminho));
    } catch (e) {
      if (!ehErroDeConexao(e)) throw e;
      await esperarConexao(5000);
    }
  }
  return get(ref(db, caminho));
}

const jogadoresDe = p => Object.entries((p && p.jogadores) || {}).map(([uid, j]) => ({ uid, ...j }));
const $ = id => document.getElementById(id);

// ---------- criar / entrar / sair ----------

async function entrar(codigo, nome, modo = null, soDados = null) {
  const user = await usuario();
  const raiz = `partidas/${codigo}`;
  const snap = await lerDoBanco(raiz);
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
  const soDadosAgora = soDados === null ? soDadosDaSala(sala) : soDados;
  const outros = jogadoresDe(sala).filter(j => j.uid !== user.uid && !j.terminou);
  const pulos = pulosDe(sala);
  const base = outros.length
    ? Math.min(...outros.map(j => (j.casas || 0) + (j.base || 0) + (pulos[j.uid] || 0)))
    : 0;
  const jaEstava = snap.child(`jogadores/${user.uid}/entrouEm`).exists();

  const identidade = (lerUsuario() || {}).id || null; // as estatísticas dos outros acham a pessoa por ela
  await update(ref(db, `${raiz}/jogadores/${user.uid}`), {
    nome, chave, id: identidade, terminou: false, total: null, colunas: null, valores: null,
    modo: modoDaSalaAgora, soDados: soDadosAgora,
    casas: casasMarcadas(), base: jaEstava ? (sala.jogadores[user.uid].base || 0) : base,
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
      const existe = (await lerDoBanco(`partidas/${sala.codigo}/criadaEm`)).exists();
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

async function criar(nome, modo = "livre", soDados = false) {
  const user = await usuario();
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const codigo = String(Math.floor(10000 + Math.random() * 90000));
    const r = await runTransaction(ref(db, `partidas/${codigo}/criador`),
      atual => atual === null ? user.uid : undefined);
    if (r.committed) {
      await update(ref(db, `partidas/${codigo}`), { criadaEm: serverTimestamp() });
      await entrar(codigo, nome, modo, soDados);
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
// o mesmo segredo (o resumo SHA-256 do código de recuperação). Da lista só dá
// para ler o campo "nome" (para conferir se existe); o segredo e o dono, não.
// Um nome tomado aparece como "permissão negada" ao tentar gravar.

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

// Identidade do jogador: fixa, não muda quando ele troca de nome. Fica em
// usuarios/<chave>/id (todos podem ler) e é por ela que o histórico na nuvem e
// as estatísticas de quem jogou contra ele acham a pessoa.
function gerarId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return "j" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// A identidade registrada para um nome: o id, null (sem identidade ainda) ou
// undefined (o banco ainda está com as regras antigas e não deixa ler).
async function idPublicoDe(chave) {
  try {
    return (await comLimite(lerDoBanco(`usuarios/${chave}/id`))).val() || null;
  } catch (e) {
    if (negado(e)) return undefined;
    throw e;
  }
}

// update (e não set): sem `id`, a identidade que já estava no nome continua lá
async function gravarNome(nome, codigo, id) {
  const user = await usuario();
  const chave = chaveDoNome(nome);
  const cod = formatarCodigo(String(codigo).replace(/\D/g, ""));
  await comLimite(update(ref(db, `usuarios/${chave}`), {
    dono: user.uid, segredo: await segredoDe(chave, cod), nome, em: serverTimestamp(), ...(id ? { id } : {})
  }));
  return { nome, chave, codigo: cod, ...(id ? { id } : {}) };
}

function nomeTomado(nome) {
  const erro = new Error(`Já existe alguém com o nome "${nome}". Escolha outro nome ` +
    "(pode ser com sobrenome ou apelido). Se é você em outro aparelho, recupere com o código.");
  erro.tomado = true;
  return erro;
}

// Antes de criar ou entrar numa sala. Devolve true se registrou agora (nome novo).
async function garantirUsuario(nome) {
  const local = lerUsuario();
  const mesmo = !!local && local.chave === chaveDoNome(nome);
  try {
    // o mesmo nome continua com a mesma identidade; um nome novo ganha uma nova
    const u = await gravarNome(nome, mesmo ? local.codigo : gerarCodigo(), mesmo ? local.id : gerarId());
    guardarUsuario(mesmo ? { ...local, ...u } : u);
    if (!mesmo) historicoMudou(); // nome novo: o histórico daqui sobe para a nuvem
    return !mesmo;
  } catch (e) {
    if (negado(e)) throw nomeTomado(nome);
    throw e;
  }
}

// Outro aparelho: o nome volta com o código certo. Antes confere se o nome
// existe (senão um erro de digitação criaria um nome novo). As regras deixam ler
// só o campo "nome" de cada usuário; com as regras antigas a leitura é negada e
// segue como antes.
async function recuperar(nome, codigo) {
  await usuario();
  let existe = true;
  try {
    existe = (await comLimite(lerDoBanco(`usuarios/${chaveDoNome(nome)}/nome`))).exists();
  } catch (e) {
    if (!negado(e)) throw new Error(mensagemDeErro(e));
  }
  if (!existe) {
    throw new Error(`Não existe o nome de usuário "${nome}". Confira como ele está escrito em Mais, no outro aparelho.`);
  }
  try {
    // a identidade que já está no nome vem junto (gravarNome não mexe nela)
    const id = await idPublicoDe(chaveDoNome(nome)).catch(() => null);
    guardarUsuario(await gravarNome(nome, codigo, id || undefined));
  } catch (e) {
    if (negado(e)) throw new Error("Nome ou código não confere. Confira e tente de novo.");
    throw new Error(mensagemDeErro(e));
  }
  return sincronizarHistorico(); // as partidas da nuvem voltam (devolve quantas)
}

// Trocar o nome de usuário: o nome novo fica com o mesmo código e a mesma
// identidade, então o histórico na nuvem (guardado pela identidade) não muda de
// lugar. O cofre passa a dizer o nome novo, e os outros aparelhos da pessoa
// trocam sozinhos (seguirTrocaDeNome). Só então o nome antigo é liberado.
async function trocarNome(novo) {
  await sincronizarHistorico(); // garante a identidade e o histórico em dia antes
  const antigo = lerUsuario();
  const id = antigo.id || gerarId();
  let u;
  try {
    u = await gravarNome(novo, antigo.codigo, id);
  } catch (e) {
    if (negado(e)) throw nomeTomado(novo);
    throw new Error(mensagemDeErro(e));
  }
  if (antigo.chave !== u.chave) {
    const cofre = await cofreDe(id, u.codigo);
    await comLimite(update(ref(db, `historicos/${cofre}`), { perfil: { nome: u.nome, chave: u.chave } })).catch(() => {});
    // a lista pública de nomes: o de agora e os que a pessoa já usou
    await comLimite(update(ref(db, `identidades/${id}`), {
      nome: u.nome, chave: u.chave, [`antigos/${antigo.chave}`]: true
    })).catch(() => {});
    // só o aparelho dono do nome pode apagá-lo: com o código, o nome antigo volta para cá antes
    await gravarNome(antigo.nome, antigo.codigo, id).catch(() => {});
    await remove(ref(db, `ranking/${antigo.chave}`)).catch(() => {}); // o recorde volta no nome novo
    await remove(ref(db, `usuarios/${antigo.chave}`)).catch(() => {});
  }
  guardarUsuario({ ...antigo, ...u });
  historicoMudou();
}

// ---------- histórico na nuvem ----------
// historicos/<cofre>/<id> = a partida (ou {excluida: true}), e
// historicos/<cofre>/perfil = { nome, chave } (o nome atual da pessoa). O cofre
// é o resumo SHA-256 de "yam-historico:<identidade>:<código>": só quem tem o
// nome e o código acha, em qualquer aparelho, e trocar de nome não muda o
// cofre. Antes da identidade, o cofre era pelo nome ("cofre antigo"): ele é
// lido uma vez em cada aparelho e as partidas passam para o cofre novo.
// A conta de juntar está no app.js (mesclarHistorico).

async function resumo(texto) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const digitosDe = codigo => String(codigo).replace(/\D/g, "");
const cofreDe = (id, codigo) => resumo(`yam-historico:${id}:${digitosDe(codigo)}`);
const cofreAntigoDe = (chave, codigo) => resumo(`yam-historico:${chave}:${digitosDe(codigo)}`);

// Outro aparelho trocou o nome? O cofre diz o nome atual; troca aqui também se
// o nome novo é mesmo desta pessoa (mesma identidade).
async function seguirTrocaDeNome(u) {
  const perfil = (await comLimite(lerDoBanco(`historicos/${await cofreDe(u.id, u.codigo)}/perfil`))).val();
  if (!perfil || !perfil.chave || perfil.chave === u.chave || typeof perfil.nome !== "string") return u;
  if (await idPublicoDe(perfil.chave) !== u.id) return u;
  const novo = { ...u, nome: perfil.nome, chave: perfil.chave };
  guardarUsuario(novo);
  ultimoAviso = Date.now();
  mostrarLegenda(["Seu nome mudou", `Você trocou o nome para ${perfil.nome} em outro aparelho. Aqui também já está assim.`]);
  return novo;
}

// A identidade que vale é a registrada no nome. Nome antigo, sem identidade
// ainda: este aparelho cria (e, se dois criarem juntos, todos ficam com a do banco).
async function garantirIdentidade(u) {
  const publico = await idPublicoDe(u.chave);
  if (publico === undefined) return null; // regras antigas: segue com o cofre antigo
  if (publico) {
    if (publico !== u.id) { u = { ...u, id: publico }; guardarUsuario(u); }
    return u;
  }
  if (!(await comLimite(lerDoBanco(`usuarios/${u.chave}/nome`))).exists()) return null; // o nome não existe mais
  const gravado = await gravarNome(u.nome, u.codigo, u.id || gerarId());
  u = { ...u, ...gravado };
  guardarUsuario(u);
  return u;
}

// O cofre antigo (pelo nome) é lido uma vez neste aparelho: o que tiver lá
// entra no histórico daqui e, daí, vai para o cofre novo.
async function trazerCofreAntigo(u) {
  const cofre = await cofreAntigoDe(u.chave, u.codigo);
  if (localStorage.getItem("yam-cofre-antigo-lido") === cofre) return 0;
  const antigo = (await comLimite(lerDoBanco(`historicos/${cofre}`))).val();
  let chegaram = 0;
  if (antigo) {
    const r = mesclarHistorico(historico, antigo, lerExcluidas());
    chegaram = aplicarHistoricoDaNuvem({ ...r, enviar: {} });
  }
  localStorage.setItem("yam-cofre-antigo-lido", cofre);
  return chegaram;
}

async function sincronizarCofre(cofre, u) {
  const remoto = { ...((await comLimite(lerDoBanco(`historicos/${cofre}`))).val() || {}) };
  const perfil = remoto.perfil;
  delete remoto.perfil;
  const r = mesclarHistorico(historico, remoto, lerExcluidas());
  const enviar = { ...r.enviar };
  if (u && (!perfil || perfil.nome !== u.nome || perfil.chave !== u.chave)) enviar.perfil = { nome: u.nome, chave: u.chave };
  if (Object.keys(enviar).length) await comLimite(update(ref(db, `historicos/${cofre}`), enviar));
  if (u) publicarIdentidade(u).catch(() => {});
  return aplicarHistoricoDaNuvem(r);
}

// ---------- nomes de agora ----------
// identidades/<id> = { nome, chave, antigos: { <chave>: true } }: todos leem, e
// só o dono do nome grava (com o nome igual ao registrado). O app de cada um
// usa a lista para mostrar o nome atual de quem trocou (app.js: nomeAtual).

async function publicarIdentidade(u) {
  const atual = (await comLimite(lerDoBanco(`identidades/${u.id}`))).val();
  if (atual && atual.nome === u.nome && atual.chave === u.chave) return;
  await comLimite(update(ref(db, `identidades/${u.id}`), { nome: u.nome, chave: u.chave }));
}

let nomesLidosEm = 0;
async function atualizarNomes() {
  if (navigator.onLine === false || Date.now() - nomesLidosEm < 5 * 60 * 1000) return;
  nomesLidosEm = Date.now();
  try {
    await usuario();
    guardarNomesAtuais((await comLimite(lerDoBanco("identidades"))).val() || {});
  } catch {
    nomesLidosEm = 0; // tenta de novo na próxima
  }
}

async function sincronizarAgora() {
  let u = lerUsuario();
  if (!u || !u.chave || !u.codigo || navigator.onLine === false) return null;
  await usuario();
  if (u.id) u = await seguirTrocaDeNome(u).catch(() => u);
  const comIdentidade = await garantirIdentidade(u);
  if (!comIdentidade) return sincronizarCofre(await cofreAntigoDe(u.chave, u.codigo), null); // como antes
  u = comIdentidade;
  const doAntigo = await trazerCofreAntigo(u).catch(() => 0);
  return doAntigo + await sincronizarCofre(await cofreDe(u.id, u.codigo), u);
}

let sincronizacao = null;
let sincronizarDeNovo = false;

// Devolve quantas partidas chegaram da nuvem (ou null se não deu para falar com ela).
async function sincronizarHistorico() {
  if (sincronizacao) { sincronizarDeNovo = true; return sincronizacao; }
  sincronizacao = sincronizarAgora().catch(() => null); // sem internet: fica para depois
  let resultado = null;
  try {
    resultado = await sincronizacao;
    return resultado;
  } finally {
    sincronizacao = null;
    publicarRecorde(resultado !== null).catch(() => {});
    atualizarNomes();
    if (sincronizarDeNovo) { sincronizarDeNovo = false; historicoMudou(); }
  }
}

// ---------- ranking geral ----------
// ranking/<chave do nome> = { nome, total, data }: o recorde de cada jogador
// (só o dono do nome grava). Publica o melhor do histórico deste aparelho; se o
// histórico não veio inteiro da nuvem (sem internet), só sobe, nunca desce.

let recordeConferido = null; // "total|data" já publicado por este aparelho

async function publicarRecorde(historicoCompleto) {
  const u = lerUsuario();
  const melhor = melhorPartida(historico);
  if (!u || !melhor || navigator.onLine === false) return;
  const chave = `${u.chave}|${melhor.total}|${melhor.data}`;
  if (recordeConferido === chave) return;
  await usuario();
  const atual = (await comLimite(lerDoBanco(`ranking/${u.chave}`))).val();
  const igual = atual && atual.total === melhor.total && atual.data === melhor.data && atual.nome === u.nome;
  const desceria = atual && typeof atual.total === "number" && atual.total > melhor.total;
  if (!igual && !(desceria && !historicoCompleto)) {
    // o nome precisa ser deste aparelho para gravar (com o código, ele volta para cá)
    await garantirUsuario(u.nome);
    await comLimite(set(ref(db, `ranking/${u.chave}`), {
      nome: u.nome, total: melhor.total, data: melhor.data, em: serverTimestamp()
    }));
  }
  recordeConferido = chave;
}

async function lerRanking() {
  await usuario();
  await publicarRecorde(false).catch(() => {}); // o seu recorde já entra atualizado
  const snap = await comLimite(lerDoBanco("ranking"));
  return Object.entries(snap.val() || {})
    .filter(([, r]) => r && typeof r.nome === "string" && typeof r.total === "number")
    .map(([chave, r]) => ({ chave, nome: r.nome, total: r.total, data: r.data }));
}

let timerHistorico = null;
function historicoMudou() {
  clearTimeout(timerHistorico);
  timerHistorico = setTimeout(sincronizarHistorico, 1500);
}

// Quem tem só o nome (nunca jogou em sala) ganha um nome de usuário, com
// código, para o histórico ir para a nuvem. Se o nome já é de outra pessoa,
// avisa uma vez e segue só neste aparelho.
async function registrarNomeSePrecisar() {
  if (lerUsuario() || !nomeJogador || navigator.onLine === false) return;
  try {
    await usuario();
    // só registra nome que ainda não existe: um nome que já existe é de outra
    // pessoa ou é seu com o código guardado em outro aparelho (nunca troca o código)
    const existe = (await comLimite(lerDoBanco(`usuarios/${chaveDoNome(nomeJogador)}/nome`))).exists();
    if (existe) throw nomeTomado(nomeJogador);
    await garantirUsuario(nomeJogador);
    historicoMudou();
  } catch (e) {
    if (!e.tomado) return; // sem internet: tenta na próxima vez
    const chave = chaveDoNome(nomeJogador);
    try {
      if (localStorage.getItem("yam-nome-tomado") === chave) return;
      localStorage.setItem("yam-nome-tomado", chave);
    } catch { return; }
    ultimoAviso = Date.now();
    mostrarLegenda([`O nome ${nomeJogador} já é de outra pessoa`,
      "Se é você em outro aparelho, entre com o código em Mais. Senão, troque o nome (pode ser com sobrenome) " +
      "para guardar suas partidas na nuvem."]);
  }
}

let ultimaSincronizacao = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || Date.now() - ultimaSincronizacao < 60000) return;
  ultimaSincronizacao = Date.now();
  if (lerUsuario()) sincronizarHistorico(); else registrarNomeSePrecisar();
});
window.addEventListener("online", () => { if (lerUsuario()) historicoMudou(); });

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
    sugerirAvisos();
    atualizarBarra();
    verReacoes();
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
  atualizarBotaoNovoJogo();
  atualizarBotaoDesfazer();
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
      (modoDaSala() === "vez" ? " · um de cada vez" : "") + (soDadosDaSala() ? " · só dados do app" : "");
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
  const codigo = sessao.codigo;
  const texto = `Vem jogar YAM comigo! Código da sala: ${codigo}\n` +
    "No app: Jogar em sala → Entrar em sala.\n" +
    `Ou toque no link: ${ENDERECO_APP}?sala=${codigo}`;
  try {
    if (navigator.share) { await navigator.share({ text: texto }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  avisar(`Passe este código para os outros jogadores: ${codigo}`, "Código da sala");
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
  $("familia-so-dados").hidden = entrar;
  $("familia-so-dados-campo").checked = localStorage.getItem(CHAVE_SO_DADOS) !== "0";
  escolherModo(modoEscolhido);
  $("familia-confirmar").textContent = entrar ? "Entrar na sala" : "Criar sala";
  const registrado = lerUsuario();
  $("familia-nome").value = registrado ? registrado.nome : nomeJogador;
  $("familia-nome").readOnly = !!registrado;
  $("familia-nota-nome").textContent = registrado
    ? "Seu nome de usuário. Para trocar, vá em Mais opções."
    : "Vai ser o seu nome de usuário, só seu. Use seu nome de verdade (ou o apelido que a família e os amigos conhecem): assim todo mundo sabe quem é quem no pódio.";
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
  erro.textContent = "Conectando…";
  let registrouAgora = false;
  try {
    await usuario();
    await precisaDeConexao();
    erro.textContent = "Conferindo seu nome…";
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
    const soDados = $("familia-so-dados-campo").checked;
    if (tipo === "criar") localStorage.setItem(CHAVE_SO_DADOS, soDados ? "1" : "0");
    if (tipo === "criar") await criar(nome, modoEscolhido, soDados);
    else await entrar(codigo, nome);
    definirNome(nome); // só depois de entrar (nome aceito na sala)
    fecharJanela();
    atualizarBarra();
    if (registrouAgora) {
      avisar(`"${nome}" agora é o seu nome de usuário: ninguém mais pode usar. ` +
        `Se trocar de aparelho, recupere com o código ${lerUsuario().codigo}. ` +
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
  // anti-trapaça: o total é refeito a partir da tabela que cada um enviou; quem
  // mandou tabela incompleta ou com valores impossíveis fica fora do pódio
  for (const j of jogadores) {
    const tabelaOk = j.valores && typeof j.valores === "object" &&
      partidaEstaCompleta(j.valores) && tabelaValida(j.valores);
    j.total = j.terminou && tabelaOk ? calcularTotais(j.valores).geral : null;
  }
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
      nome: j.nome, total: j.total, posicao: posicao(j), ...euSou(j), ...(typeof j.id === "string" ? { id: j.id } : {}),
      ...(j.valores && typeof j.valores === "object" ? { valores: j.valores } : {})
    })),
    naoTerminaram: naoTerminaram.map(j => ({ nome: j.nome, ...euSou(j), ...(typeof j.id === "string" ? { id: j.id } : {}) }))
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
  const soDados = soDadosDaSala(partida);
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
      const codigo = await criar(nomeJogador, modo, soDados);
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
let avisosPublicados = null;  // inscrição de push já gravada nesta sala ("" = nenhuma)
let perguntouAvisos = false;  // já sugeriu ligar os avisos nesta sala
let timerVisto = null;
let rolagemVista = null;      // { uid, jogada }: a última rolagem de quem está jogando já mostrada

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

// "Só os dados do app": vem de quem criou a sala (cada um copia ao entrar).
function soDadosDaSala(p = partida) {
  if (!p || !p.jogadores) return false;
  const criador = p.jogadores[p.criador];
  if (criador && typeof criador.soDados === "boolean") return criador.soDados;
  return jogadoresDe(p).some(j => j.soDados === true);
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
  rolagemVista = null;
  reacoesVistas = null;
  alternarReacoes(false);
  jogadasVistas = null;
  pulosVistos = null;
  avisosPublicados = null;
  perguntouAvisos = false;
  clearInterval(timerVisto);
  timerVisto = null;
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
  guardarToken(); // para passar a vez mesmo se o app for minimizado
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

// semAviso: o servidor de avisos já foi chamado (app minimizado), não pede de novo.
function passarVez(semAviso = false) {
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
  }).then(() => {
    if (!semAviso) avisarProximo(ultima ? textoDaJogada(nomeJogador, ultima.key, ultima.valor) : `${nomeJogador} jogou.`);
  })
    .catch(() => { casasPublicadas = anterior; acompanharVez(); }); // sem conexão: tenta de novo
  atualizarBarraVez();
}

// Minimizou o app (ou trocou de app) com a jogada marcada: passa a vez na hora.
// Em segundo plano o celular pausa o app e os 3 s não chegariam ao fim. Além da
// gravação normal (que pode não dar tempo), pede ao servidor de avisos que grave
// a vez e avise o próximo, num envio que o celular termina mesmo com o app pausado.
let tokenGuardado = null;

function guardarToken() {
  if (auth.currentUser) auth.currentUser.getIdToken().then(t => { tokenGuardado = t; }).catch(() => {});
}

function passarVezAgora() {
  if (!comVez() || daVez() !== minhaUid()) return;
  // estava digitando: termina a casa (o "sair da casa" confirma o número)
  const ativo = document.activeElement;
  if (ativo && ativo.tagName === "INPUT" && $("tableBody").contains(ativo)) ativo.blur();
  if (!esperandoPassar()) return;
  clearTimeout(timerVez);
  timerVez = null;
  const agora = casasMarcadas();
  const ultima = ultimaJogadaFeita();
  const peloServidor = !!(tokenGuardado && sessao && AVISOS_URL);
  passarVez(peloServidor); // gravação normal (sem pedir aviso de novo se o servidor já vai avisar)
  if (!peloServidor) return;
  try {
    fetch(`${AVISOS_URL}/vez`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        codigo: sessao.codigo, token: tokenGuardado, esperar: true,
        gravar: { casas: agora, ultima: ultima ? { key: ultima.key, valor: ultima.valor, n: agora } : null },
        texto: ultima ? textoDaJogada(nomeJogador, ultima.key, ultima.valor) : `${nomeJogador} jogou.`
      }),
      keepalive: true
    }).catch(() => {});
  } catch { /* sem envio extra: a gravação normal passa a vez ao voltar */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") passarVezAgora();
});
window.addEventListener("pagehide", passarVezAgora);

// ---------- avisos com o app fechado ----------

// Pede ao servidor de avisos que avise quem está na vez agora (ele confere tudo no banco).
async function avisarProximo(texto) {
  if (!AVISOS_URL || !auth.currentUser || !sessao) return;
  try {
    const token = await auth.currentUser.getIdToken();
    await fetch(`${AVISOS_URL}/vez`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ codigo: sessao.codigo, token, texto }),
      keepalive: true
    });
  } catch { /* sem aviso desta vez; o jogo segue */ }
}

// Grava (ou apaga) na sala a inscrição de push deste celular.
async function avisosMudaram() {
  if (!sessao || !partida || !comVez()) return;
  const caminho = `partidas/${sessao.codigo}/jogadores/${minhaUid()}`;
  if (!avisosLigados()) {
    if (avisosPublicados !== "") {
      avisosPublicados = "";
      update(ref(db, caminho), { push: null, visivel: null, vistoEm: null }).catch(() => { avisosPublicados = null; });
    }
    clearInterval(timerVisto);
    timerVisto = null;
    return;
  }
  try {
    const inscricao = await inscricaoPush();
    if (avisosPublicados !== inscricao.endpoint) {
      avisosPublicados = inscricao.endpoint;
      await update(ref(db, caminho), { push: inscricao });
    }
  } catch { avisosPublicados = null; }
  marcarVisto();
  if (!timerVisto) timerVisto = setInterval(marcarVisto, 60 * 1000);
}

// "Estou com o app aberto": o servidor não manda notificação para quem está olhando.
function marcarVisto() {
  if (!sessao || !auth.currentUser || !avisosLigados() || !comVez()) return;
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), {
    visivel: document.visibilityState === "visible", vistoEm: serverTimestamp()
  }).catch(() => {});
}

document.addEventListener("visibilitychange", marcarVisto);

// Na primeira vez numa sala com vez, sugere ligar os avisos (uma vez por sala).
function sugerirAvisos() {
  if (perguntouAvisos || !comVez()) return;
  perguntouAvisos = true;
  if (avisosLigados()) { avisosMudaram(); return; }
  let permissao = "default";
  try { permissao = Notification.permission; } catch {}
  if (!avisosSuportados() || localStorage.getItem(CHAVE_AVISOS) === "0" || permissao === "denied") return;
  setTimeout(() => {
    ultimoAviso = Date.now();
    mostrarLegenda(["Quer ser avisado da sua vez?",
      "Chega uma notificação quando for a sua vez, mesmo com o app fechado."], "",
      { texto: "Avisar minha vez", fazer: ligarAvisos });
  }, 1500);
}

// Na sua vez, os dados vão para a sala (os outros veem rolando).
// Ao rolar, vai já o resultado (sorteado no começo): os outros veem a rolagem
// junto com quem rolou, não só depois que os dados param.
function mesaMudou(valores = mesa.valores) {
  if (!comVez() || daVez() !== minhaUid() || esperandoPassar()) return;
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), {
    mesa: { valores: [...valores], segurados: [...mesa.segurados], jogada: mesa.jogada }
  }).catch(() => {});
}

async function pularVez(uid) {
  const nome = nomeDe(uid);
  if (!await confirmar(`Pular a vez de ${nome}?`,
    `${nome} perde esta jogada e a vez passa para o próximo.`, "Pular")) return;
  if (daVez() !== uid) return; // a vez mudou enquanto perguntava
  try {
    await runTransaction(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}/pulos/${uid}`), n => (n || 0) + 1);
    avisarProximo(`${nomeJogador} pulou a vez de ${nome}.`);
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
  atualizarBotaoDesfazer(); // o Desfazer depende de a vez ter passado ou não
  const barra = $("barra-vez");
  if (!barra) return;
  if (!comVez()) { barra.hidden = true; alternarReacoes(false); return; }
  barra.hidden = false;
  $("vez-reagir").hidden = jogadoresDe(partida).length < 2; // reagir: só com mais alguém na sala
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
    rolagemVista = { uid: vez, jogada: 0 };
  } else {
    const j = partida.jogadores[vez];
    quem.textContent = `Vez de ${nomeDe(vez)}`;
    if (j && j.mesa && j.mesa.jogada > 0 && Array.isArray(j.mesa.valores)) {
      quem.textContent += ` · ${j.mesa.jogada}ª jogada`;
      const segurados = j.mesa.segurados || [];
      dados.innerHTML = j.mesa.valores.map((f, i) => dadoMini(f, !!segurados[i])).join("");
      dados.setAttribute("aria-label", `Dados de ${j.nome}: ${j.mesa.valores.join(", ")} (${j.mesa.jogada}ª jogada)`);
      // rolou agora (não é só alguém segurando um dado, nem o app abrindo): som e animação
      const rolouAgora = rolagemVista !== null &&
        (rolagemVista.uid !== vez || j.mesa.jogada > rolagemVista.jogada);
      rolagemVista = { uid: vez, jogada: j.mesa.jogada };
      if (rolouAgora) animarRolagemDoOutro(dados, j.mesa);
    } else {
      rolagemVista = { uid: vez, jogada: 0 };
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

// Os dados de quem está jogando rolam aqui também: mesmo som da sua rolagem, e
// os dados que não estavam segurados pulam, giram e trocam de face até parar no
// resultado. Com o app em segundo plano, nada (ninguém está vendo).
function animarRolagemDoOutro(caixa, mesaDoOutro) {
  if (document.visibilityState === "hidden") return;
  tocar("rolar");
  const segurados = mesaDoOutro.segurados || [];
  const rolaram = [...caixa.children].map((svg, i) => ({ svg, final: mesaDoOutro.valores[i] }))
    .filter((_, i) => !segurados[i]);
  // com "menos animação" no sistema (comum no Windows), o CSS tira o pulo e o
  // giro, mas as faces continuam trocando, como nos seus próprios dados
  rolaram.forEach(({ svg }) => {
    svg.style.setProperty("--giro", `${(Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 360 : 720)}deg`);
    svg.style.animationDelay = `${Math.floor(Math.random() * 40)}ms`;
    svg.classList.add("rolando");
  });
  let passos = 0;
  const timer = setInterval(() => {
    const acabou = ++passos >= 8;
    rolaram.forEach(({ svg, final }) => {
      if (!svg.isConnected) return; // a barra foi redesenhada: já está com o resultado
      trocarFaceMini(svg, acabou ? final : 1 + Math.floor(Math.random() * 6));
      if (acabou) { svg.classList.remove("rolando"); svg.classList.add("assentou"); }
    });
    if (acabou) clearInterval(timer);
  }, 60);
}

// ---------- reações ----------
// Na barra da vez, um toque manda uma reação (👏 😂 …) e ela sobe na tela de
// todos da sala, com o nome de quem mandou. Vai no próprio jogador
// (jogadores/<uid>/reacao), que cada um já pode gravar: não precisa de regra nova.

const REACOES = ["👏", "😂", "😮", "😭", "💩", "🍀"];
let reacoesVistas = null;     // uid -> id da última reação já mostrada (null: ainda não olhou a sala)
let ultimaReacaoEnviada = 0;

function alternarReacoes(abrir) {
  const caixa = $("vez-reacoes"), botao = $("vez-reagir");
  if (!caixa || !botao) return;
  const aberta = typeof abrir === "boolean" ? abrir : caixa.hidden;
  caixa.hidden = !aberta;
  botao.setAttribute("aria-expanded", String(aberta));
}

function reagir(emoji) {
  if (!sessao || !partida || !REACOES.includes(emoji)) return;
  alternarReacoes(false);
  const agora = Date.now();
  if (agora - ultimaReacaoEnviada < 700) return; // sem metralhadora de reações
  ultimaReacaoEnviada = agora;
  const id = agora.toString(36) + Math.random().toString(36).slice(2, 6);
  mostrarReacao(emoji, "Você");
  update(ref(db, `partidas/${sessao.codigo}/jogadores/${minhaUid()}`), {
    reacao: { e: emoji, id, em: serverTimestamp() }
  }).catch(() => {});
}

// A cada retrato da sala: mostra as reações novas dos outros. No primeiro
// retrato (entrou na sala, abriu o app) só anota as que já estavam lá.
function verReacoes() {
  if (!partida || !partida.jogadores) return;
  const eu = minhaUid();
  const primeira = reacoesVistas === null;
  if (primeira) reacoesVistas = {};
  for (const [uid, j] of Object.entries(partida.jogadores)) {
    const r = j && j.reacao;
    if (!r || !r.id || uid === eu || reacoesVistas[uid] === r.id) continue;
    reacoesVistas[uid] = r.id;
    const recente = typeof r.em !== "number" || Math.abs(Date.now() - r.em) < 60000;
    if (!primeira && recente && REACOES.includes(r.e) && document.visibilityState !== "hidden") {
      mostrarReacao(r.e, j.nome || "Alguém");
    }
  }
}

function mostrarReacao(emoji, nome) {
  const area = $("reacoes-voando");
  if (!area) return;
  const el = document.createElement("div");
  el.className = "reacao";
  el.style.setProperty("--x", `${Math.round((Math.random() - 0.5) * 140)}px`);
  el.style.setProperty("--deriva", `${Math.round((Math.random() - 0.5) * 60)}px`);
  const simbolo = document.createElement("span");
  simbolo.className = "reacao-emoji";
  simbolo.textContent = emoji;
  const quem = document.createElement("span");
  quem.className = "reacao-nome";
  quem.textContent = nome;
  el.append(simbolo, quem);
  area.appendChild(el);
  setTimeout(() => el.remove(), 2800);
  tocar("reacao");
  // a versão animada (Noto Emoji, do Google) entra no lugar assim que carregar;
  // sem internet ou com "menos animação" no aparelho, fica o emoji normal
  if (!CODIGO_ANIMADO[emoji] || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const animado = new Image();
  animado.className = "reacao-emoji reacao-animada";
  animado.alt = emoji;
  animado.decoding = "async";
  animado.onload = () => { if (simbolo.isConnected) simbolo.replaceWith(animado); };
  animado.src = `https://fonts.gstatic.com/s/e/notoemoji/latest/${CODIGO_ANIMADO[emoji]}/512.webp`;
}

const CODIGO_ANIMADO = { "👏": "1f44f", "😂": "1f602", "😮": "1f62e", "😭": "1f62d", "💩": "1f4a9", "🍀": "1f340" };

// ---------- ligação com o resto do app ----------

window.familia = {
  abrir, fecharJanela, acaoJanela, sair, confirmarSair, compartilharCodigo,
  aoTerminar, fecharEspera, fecharPodio, jogarDeNovo, limparSalasAntigas, sincronizar, registrarResultado,
  escolherModo, podeJogar, porQueNaoPode, podeDesfazer, mesaMudou, recuperar, trocarNome, avisosMudaram,
  historicoMudou, sincronizarHistorico, registrarNomeSePrecisar, alternarReacoes, reagir, lerRanking,
  soDadosDoApp: () => !!(sessao && partida && !partida.revelada && !partida.encerrada && soDadosDaSala()),
  ativa: () => !!sessao,
  revelada: () => !!(partida && (partida.revelada || partida.encerrada))
};

atualizarBarra();
setTimeout(limparSalasAntigas, 3000); // depois que o app abriu, sem atrapalhar
// histórico na nuvem: confere ao abrir (quem só tem nome ganha o nome de usuário)
setTimeout(() => {
  ultimaSincronizacao = Date.now();
  atualizarNomes();
  if (lerUsuario()) sincronizarHistorico();
  else if (document.getElementById("boas-vindas").hidden) registrarNomeSePrecisar();
}, 2500);
if (sessao) usuario().then(escutar).catch(e => atualizarBarra(mensagemDeErro(e)));
