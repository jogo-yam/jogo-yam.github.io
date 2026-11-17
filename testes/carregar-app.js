// Carrega o app.js num "navegador de mentira" (sem tela), para testar as regras
// e as contas do app sem abrir o navegador. Não precisa instalar nada: só o Node.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const RAIZ = path.join(__dirname, "..");
const lerArquivo = nome => fs.readFileSync(path.join(RAIZ, nome), "utf8");

// Um objeto que aceita qualquer coisa (propriedades, chamadas, new...) e não faz
// nada: faz o papel da tela (document, botões, tabela) enquanto o app carrega.
function qualquerCoisa() {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined; // não é uma Promise
      if (prop === "length") return 0;
      return qualquerCoisa();
    },
    set: () => true,
    apply: () => qualquerCoisa(),
    construct: () => qualquerCoisa()
  });
}

// `armazenado`: o que já está guardado no celular (localStorage), ex.:
// { "yam-historico": JSON.stringify([...]) }.
function carregarApp({ armazenado = {} } = {}) {
  const dados = new Map(Object.entries(armazenado));
  const localStorage = {
    getItem: k => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: k => { dados.delete(k); },
    clear: () => dados.clear()
  };
  const janela = {
    document: qualquerCoisa(),
    localStorage,
    location: { href: "https://jogo-yam.github.io/", hash: "", pathname: "/" },
    history: { replaceState() {} },
    navigator: {},
    crypto: globalThis.crypto,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Blob, File, TextEncoder, console
  };
  janela.window = janela;
  janela.self = janela;

  const ctx = vm.createContext(janela);
  vm.runInContext(lerArquivo("app.js"), ctx, { filename: "app.js" });

  // rodar("codigo"): executa dentro do app (enxerga as variáveis dele, como `state`)
  const rodar = codigo => vm.runInContext(codigo, ctx);
  // app.nome: qualquer função ou variável do app
  const app = new Proxy({}, { get: (_, nome) => rodar(String(nome)) });
  return { app, rodar, armazenado: dados };
}

// Compara valores que vieram de dentro do app (outro "mundo" do JavaScript).
const igual = (recebido, esperado, msg) =>
  assert.deepStrictEqual(JSON.parse(JSON.stringify(recebido)), esperado, msg);

// Uma tabela completa e válida, com 3 pontos a mais por coluna em cada linha
// numérica (bônus garantido) e combinações fixas. `mudar` troca casas.
function tabelaCompleta(mudar = {}) {
  const v = {};
  for (let col = 0; col < 4; col++) {
    for (let l = 0; l <= 5; l++) v[`${l}-${col}`] = String((l + 1) * 3); // 3+6+9+12+15+18 = 63
    Object.assign(v, {
      [`9-${col}`]: "40", [`10-${col}`]: "49", [`11-${col}`]: "50", [`12-${col}`]: "60",
      [`13-${col}`]: "8", [`14-${col}`]: "27", [`15-${col}`]: "80"
    });
  }
  return { ...v, ...mudar };
}

module.exports = { carregarApp, igual, tabelaCompleta, lerArquivo, RAIZ };
