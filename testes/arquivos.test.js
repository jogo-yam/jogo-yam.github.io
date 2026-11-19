// Confere se as peças do app se encaixam: botões chamam funções que existem,
// os ids usados no código existem na página, e o cache offline tem os arquivos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { carregarApp, lerArquivo, RAIZ } = require("./carregar-app.js");

const html = lerArquivo("index.html");
const appJs = lerArquivo("app.js");
const familiaJs = lerArquivo("familia.js");
const { rodar } = carregarApp();
const existeNoApp = nome => rodar(`typeof ${nome}`) !== "undefined";

// funções que o familia.js põe em window.familia
const exportsFamilia = new Set(
  familiaJs.match(/window\.familia = \{([\s\S]*?)\n\};/)[1].match(/\b[a-zA-Z_]\w*(?=\s*[,:\n]|$)/g)
);

test("todo botão da página chama uma função que existe", () => {
  const chamadas = [...html.matchAll(/\son(?:click|change|submit)="([^"]*)"/g)].map(m => m[1]);
  assert.ok(chamadas.length > 20);
  for (const codigo of chamadas) {
    for (const [, objeto, nome] of codigo.matchAll(/(?:\b(\w+)\.)?\b([a-zA-Z_]\w*)\(/g)) {
      if (objeto === "familia") {
        assert.ok(exportsFamilia.has(nome), `familia.${nome} (em: ${codigo})`);
      } else if (!objeto && !["if", "getElementById", "click"].includes(nome)) {
        assert.equal(rodar(`typeof ${nome}`), "function", `${nome}() (em: ${codigo})`);
      }
    }
  }
});

test("todo id usado no código existe na página", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  // getElementById("x"), e os atalhos $("x") (familia.js) e el("x") (pódio)
  const usados = [appJs, familiaJs]
    .flatMap(codigo => [...codigo.matchAll(/(?:getElementById|\$|\bel)\("([^"]+)"\)/g)])
    .map(m => m[1]);
  assert.ok(usados.length > 50);
  for (const id of new Set(usados)) assert.ok(ids.has(id), `#${id}`);
});

test("o familia.js só usa funções do app que existem", () => {
  // tira textos entre aspas (primeiro, por causa do "https://") e comentários
  const semComentarios = familiaJs.replace(/`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/.*$/gm, "");
  const definidas = new Set([
    ...semComentarios.matchAll(/\b(?:function|const|let|var|class)\s+([a-zA-Z_]\w*)/g),
    ...semComentarios.matchAll(/import\s*\{([^}]*)\}/g),
    ...semComentarios.matchAll(/(?:\(([\w\s,]*)\)|\b(\w+))\s*=>/g) // parâmetros de arrow functions
  ].flatMap(m => (m[1] ?? m[2] ?? "").split(",").map(s => s.trim())).filter(Boolean));
  const palavras = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "new", "import", "fetch"]); // fetch: do navegador
  const chamadas = new Set([...semComentarios.matchAll(/(?<![.\w$])([a-zA-Z_]\w*)\s*\(/g)].map(m => m[1]));
  for (const nome of chamadas) {
    if (palavras.has(nome) || definidas.has(nome)) continue;
    assert.ok(existeNoApp(nome), `${nome}() é chamada no familia.js mas não existe no app.js`);
  }
});

test("o cache offline tem todos os arquivos, e eles existem", () => {
  const sw = lerArquivo("service-worker.js");
  assert.match(sw, /const CACHE_NAME = "yam-cache-v\d+";/);
  const lista = JSON.parse(sw.match(/const FILES_TO_CACHE = (\[[\s\S]*?\]);/)[1]);
  for (const arquivo of lista) {
    if (arquivo === "./") continue;
    assert.ok(fs.existsSync(path.join(RAIZ, arquivo)), `${arquivo} não existe`);
  }
  for (const arquivo of ["./index.html", "./style.css", "./app.js", "./familia.js"]) {
    assert.ok(lista.includes(arquivo), `${arquivo} fora do cache`);
  }
});

test("manifest.json é válido", () => {
  const manifest = JSON.parse(lerArquivo("manifest.json"));
  assert.ok(manifest.name);
  const imagens = [
    ...manifest.icons,
    ...(manifest.screenshots || []),
    ...(manifest.shortcuts || []).flatMap(atalho => atalho.icons || [])
  ];
  for (const imagem of imagens) assert.ok(fs.existsSync(path.join(RAIZ, imagem.src)), imagem.src);
  // atalhos abrem algo que o app entende (?abrir=...)
  for (const atalho of manifest.shortcuts || []) {
    assert.match(appJs, new RegExp(`atalho === "${new URL(atalho.url, "https://x/").searchParams.get("abrir")}"`), atalho.url);
  }
});

test("a versão do app é a mesma do cache offline e dos endereços dos arquivos", () => {
  const sw = lerArquivo("service-worker.js");
  const doCache = Number(sw.match(/yam-cache-v(\d+)/)[1]);
  assert.equal(rodar("VERSAO"), doCache, "mude o VERSAO do app.js junto com o CACHE_NAME");
  for (const arquivo of ["app.js", "familia.js", "style.css"]) {
    assert.ok(html.includes(`"${arquivo}?v=${doCache}"`), `index.html deve carregar ${arquivo}?v=${doCache}`);
  }
});

test("todo ícone usado existe na página", () => {
  const simbolos = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map(m => m[1]));
  const usados = [
    ...[...html.matchAll(/href="#i-([\w-]+)"/g)].map(m => m[1]),
    ...[appJs, familiaJs].flatMap(codigo => [...codigo.matchAll(/rotular\([^,]+,\s*(?:[^"]*?\?\s*)?"([\w-]+)"(?:\s*:\s*"([\w-]+)")?/g)])
      .flatMap(m => [m[1], m[2]]).filter(Boolean),
    ...[appJs, familiaJs].flatMap(codigo => [...codigo.matchAll(/\bicone\("([\w-]+)"/g)]).map(m => m[1]),
    ...[...appJs.matchAll(/\[\s*"([a-z]+)",\s*[`"]/g)].map(m => m[1]).filter(n => ["trofeu", "alvo", "dado", "riscar"].includes(n))
  ];
  assert.ok(usados.length > 20);
  for (const nome of usados) assert.ok(simbolos.has(nome), `ícone i-${nome}`);
});

test("regras do Firebase: JSON válido, nomes únicos e sala só com o próprio nome", () => {
  const regras = JSON.parse(lerArquivo("firebase-regras.json")).rules;
  assert.ok(regras.usuarios.$chave[".write"].includes("segredo"), "pegar um nome só com o mesmo segredo");
  assert.match(regras.partidas.$codigo.nomes.$chave[".write"], /usuarios/, "na sala, só o nome que é seu");
});

test("app.js carrega até o fim e o index.html recarrega se ele não carregar", () => {
  assert.equal(rodar("window.yamCarregado"), true, "alguma coisa travou o app.js no meio");
  const depoisDoApp = html.slice(html.indexOf("app.js?v="));
  assert.ok(/<script>[\s\S]*?window\.yamCarregado[\s\S]*?location\.replace/.test(depoisDoApp),
    "rede de segurança logo depois do app.js");
  const sw = lerArquivo("service-worker.js");
  assert.match(sw, /request\.mode === "navigate" \? caches\.match\("\.\/index\.html"\)/,
    "o index.html só substitui páginas, nunca um .js");
});
