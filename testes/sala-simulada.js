// Sala simulada: um "Firebase de mentira" na memória e vários "celulares", cada
// um com o app.js e o familia.js de verdade. Serve para testar a sala inteira
// (entrar, jogar na vez, pausar, voltar, desistir) sem internet e sem o banco real.
//
// O banco segue as regras que importam para a sala: cada um só grava no próprio
// jogador, e (com `regras: true`) jogador sem nome é recusado, como no
// firebase-regras.json. Os relógios dos celulares andam 100 vezes mais rápido
// (os 3 s para passar a vez viram 30 ms).

const { carregarApp, lerArquivo, qualquerCoisa } = require("./carregar-app.js");

const ACELERA = 100;
const copia = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const partes = caminho => String(caminho).split("/").filter(Boolean);

function pegar(arvore, caminho) {
  let no = arvore;
  for (const p of partes(caminho)) {
    if (no === null || typeof no !== "object" || !(p in no)) return null;
    no = no[p];
  }
  return no === undefined ? null : no;
}

// Grava (null apaga) e limpa os galhos que ficaram vazios, como o Firebase.
function pôr(arvore, caminho, valor) {
  const ps = partes(caminho);
  const pilha = [arvore];
  let no = arvore;
  for (const p of ps.slice(0, -1)) {
    if (no[p] === null || typeof no[p] !== "object") no[p] = {};
    no = no[p];
    pilha.push(no);
  }
  const ultimo = ps[ps.length - 1];
  if (valor === null) delete no[ultimo];
  else no[ultimo] = valor;
  for (let i = ps.length - 1; i > 0; i--) {
    if (Object.keys(pilha[i]).length === 0) delete pilha[i - 1][ps[i - 1]];
  }
}

// serverTimestamp vira a hora; null dentro de objeto apaga; objeto vazio vira null
function resolver(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return v;
  if (v[".sv"] === "timestamp") return Date.now();
  const saida = {};
  for (const [k, x] of Object.entries(v)) {
    const r = resolver(x);
    if (r !== null) saida[k] = r;
  }
  return Object.keys(saida).length ? saida : null;
}

class Foto {
  constructor(valor) { this.valor = valor === undefined ? null : valor; }
  val() { return copia(this.valor); }
  exists() { return this.valor !== null; }
  child(caminho) { return new Foto(pegar(this.valor, caminho)); }
}

function erroDePermissao() {
  const e = new Error("PERMISSION_DENIED: Permission denied");
  e.code = "PERMISSION_DENIED";
  return e;
}

class Banco {
  constructor({ regras = true } = {}) {
    this.arvore = {};
    this.regras = regras;
    this.ouvintes = new Set();
    this.aoCair = new Map(); // uid -> Map(caminho -> gravação do onDisconnect)
    this.recusadas = [];
  }

  ler(caminho) { return copia(pegar(this.arvore, caminho)); }

  // Grava várias mudanças de uma vez (como o update), conferindo as regras.
  gravar(uid, mudancas) {
    const nova = copia(this.arvore) || {};
    for (const [caminho, valor] of Object.entries(mudancas)) pôr(nova, caminho, resolver(copia(valor)));
    for (const caminho of Object.keys(mudancas)) {
      const m = partes(caminho);
      if (m[0] === "partidas" && m[2] === "jogadores" && m[3]) {
        if (m[3] !== uid) { this.recusadas.push({ uid, caminho }); throw erroDePermissao(); }
        const jogador = pegar(nova, m.slice(0, 4).join("/"));
        if (this.regras && jogador !== null && !(typeof jogador.nome === "string" && jogador.nome)) {
          this.recusadas.push({ uid, caminho });
          throw erroDePermissao();
        }
      }
    }
    this.arvore = nova;
    const mudou = Object.keys(mudancas);
    for (const o of [...this.ouvintes]) {
      if (mudou.some(c => c.startsWith(o.caminho) || o.caminho.startsWith(c))) {
        const foto = new Foto(this.ler(o.caminho));
        Promise.resolve().then(() => { if (this.ouvintes.has(o)) o.cb(foto); });
      }
    }
  }

  // O celular perdeu a conexão: o servidor faz o que ele deixou combinado.
  derrubar(uid) {
    const combinadas = this.aoCair.get(uid);
    this.aoCair.delete(uid);
    for (const [caminho, valor] of combinadas || []) {
      try { this.gravar(uid, Object.fromEntries(Object.entries(valor).map(([k, v]) => [`${caminho}/${k}`, v]))); }
      catch { /* recusada pelas regras */ }
    }
  }

  // As funções do Firebase que o familia.js usa, para o celular `uid`.
  firebaseDe(uid) {
    const banco = this;
    const usuario = { uid, getIdToken: async () => `token-${uid}` };
    const auth = { currentUser: usuario };
    const caminhoDe = r => partes(r.caminho).join("/");
    const comoUpdate = (r, valores) => {
      const mudancas = {};
      for (const [k, v] of Object.entries(valores)) mudancas[`${caminhoDe(r)}/${k}`] = v;
      return mudancas;
    };
    const fb = {
      initializeApp: () => ({}),
      getAuth: () => auth,
      signInAnonymously: async () => ({ user: usuario }),
      onAuthStateChanged: (_, cb) => { Promise.resolve().then(() => cb(usuario)); return () => {}; },
      getDatabase: () => ({}),
      ref: (_, caminho = "") => ({ caminho: String(caminho) }),
      serverTimestamp: () => ({ ".sv": "timestamp" }),
      get: async r => new Foto(banco.ler(caminhoDe(r))),
      set: async (r, v) => banco.gravar(uid, { [caminhoDe(r)]: v }),
      update: async (r, v) => banco.gravar(uid, comoUpdate(r, v)),
      remove: async r => banco.gravar(uid, { [caminhoDe(r)]: null }),
      runTransaction: async (r, fn) => {
        const novo = fn(banco.ler(caminhoDe(r)));
        if (novo === undefined) return { committed: false, snapshot: new Foto(banco.ler(caminhoDe(r))) };
        banco.gravar(uid, { [caminhoDe(r)]: novo });
        return { committed: true, snapshot: new Foto(banco.ler(caminhoDe(r))) };
      },
      onValue: (r, cb) => {
        if (caminhoDe(r) === ".info/connected") {
          Promise.resolve().then(() => cb(new Foto(true)));
          return () => {};
        }
        const o = { caminho: caminhoDe(r), cb };
        banco.ouvintes.add(o);
        Promise.resolve().then(() => { if (banco.ouvintes.has(o)) cb(new Foto(banco.ler(o.caminho))); });
        return () => banco.ouvintes.delete(o);
      },
      onDisconnect: r => ({
        update: async v => {
          if (!banco.aoCair.has(uid)) banco.aoCair.set(uid, new Map());
          banco.aoCair.get(uid).set(caminhoDe(r), v);
        },
        cancel: async () => { if (banco.aoCair.has(uid)) banco.aoCair.get(uid).delete(caminhoDe(r)); }
      })
    };
    return fb;
  }
}

// O familia.js é um módulo (com escopo próprio); aqui ele roda dentro de uma
// função, sem os imports (as funções do Firebase vêm do banco de mentira).
function fonteDoFamilia() {
  const fonte = lerArquivo("familia.js").replace(/^import\s*\{[^}]*\}\s*from\s*"[^"]+";\s*$/gm, "");
  if (/^import /m.test(fonte)) throw new Error("sobrou import no familia.js");
  const nomes = ["initializeApp", "getAuth", "signInAnonymously", "onAuthStateChanged", "getDatabase", "ref", "get", "set",
    "update", "remove", "onValue", "onDisconnect", "runTransaction", "serverTimestamp"];
  // (o app.js tem funções com alguns desses nomes: por isso vêm como parâmetros)
  return `(function (fb) {"use strict";\nconst { ${nomes.join(", ")} } = fb;\n${fonte}\n;globalThis.__noFamilia = codigo => eval(codigo);\n})(globalThis.__firebase);`;
}

// A tela de mentira, com o que a sala precisa de verdade: o app na tela
// (visibilityState) e os data-* da página (cor da mesa, dos dados, textura).
function documentoDeMentira() {
  const dataset = {};
  const raiz = new Proxy(qualquerCoisa(), { get: (t, p) => (p === "dataset" ? dataset : t[p]) });
  return new Proxy(qualquerCoisa(), {
    get: (t, p) => (p === "documentElement" ? raiz : p === "visibilityState" ? "visible"
      // nenhuma janela aberta por cima (o app confere antes de perguntar algo)
      : p === "querySelector" ? s => (/:not\(\[hidden\]\)/.test(s) ? null : qualquerCoisa())
      : t[p])
  });
}

// Um celular: app.js + familia.js, com o próprio localStorage e as respostas
// que a pessoa daria nas perguntas (fila; sem resposta = "sim").
function celular(banco, uid, nome) {
  const fb = banco.firebaseDe(uid);
  const enviados = []; // pedidos ao servidor de avisos
  const perguntas = [];
  const respostas = [];
  const timer = f => (fn, ms, ...a) => { const t = f(fn, Math.min(Number(ms) || 0, 10 * 60 * 1000) / ACELERA, ...a); if (t && t.unref) t.unref(); return t; };
  const { rodar, app } = carregarApp({
    armazenado: { "yam-nome": nome },
    extras: {
      __firebase: fb,
      document: documentoDeMentira(),
      scrollTo() {},
      setTimeout: timer(setTimeout), setInterval: timer(setInterval),
      fetch: async (url, opcoes = {}) => { enviados.push({ url, corpo: JSON.parse(opcoes.body || "null") }); return { ok: true, status: 200 }; }
    }
  });
  rodar(`nomeJogador = ${JSON.stringify(nome)}`);
  rodar(fonteDoFamilia());
  // as janelas de pergunta: responde sozinho e anota o que foi perguntado
  rodar("globalThis.__perguntar = null");
  const ctx = rodar("this");
  ctx.__perguntar = async opcoes => { perguntas.push(opcoes.titulo); return respostas.length ? respostas.shift() : true; };
  rodar("perguntar = o => globalThis.__perguntar(o)");
  const familia = codigo => rodar(`globalThis.__noFamilia(${JSON.stringify(codigo)})`);
  return {
    uid, nome, app, rodar, familia, enviados, perguntas,
    responder: (...r) => respostas.push(...r),
    // marca uma casa (como digitar na tabela e confirmar)
    marcar: (casa, valor) => rodar(`state[${JSON.stringify(casa)}] = ${JSON.stringify(String(valor))}; avisarSala();`)
  };
}

// Espera os relógios acelerados e as respostas do banco assentarem.
const assentar = (ms = 120) => new Promise(r => setTimeout(r, ms));

module.exports = { Banco, celular, assentar, ACELERA };
