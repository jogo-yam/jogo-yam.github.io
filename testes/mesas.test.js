// Mesas (skins): cada cor da lista do app tem as cores no CSS, no claro e no
// escuro, e é aceita pelo script que aplica a mesa antes de desenhar a página.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, lerArquivo } = require("./carregar-app.js");

const css = lerArquivo("style.css");
const html = lerArquivo("index.html");
const { rodar } = carregarApp();

const mesas = JSON.parse(rodar("JSON.stringify(Object.keys(MESAS))"));

test("a verde é a padrão e há outras para escolher", () => {
  assert.equal(mesas[0], "verde");
  assert.ok(mesas.length >= 2);
});

test("cada mesa tem cores no claro e no escuro (tema do celular e escolhido)", () => {
  for (const m of mesas.filter(m => m !== "verde")) {
    for (const sel of [`:root[data-mesa="${m}"] {`, `:root[data-mesa="${m}"]:not([data-theme="light"]) {`,
      `:root[data-mesa="${m}"][data-theme="dark"] {`]) {
      const i = css.indexOf(sel);
      assert.ok(i >= 0, `falta ${sel}`);
      const bloco = css.slice(i, css.indexOf("}", i));
      for (const v of ["--destaque:", "--destaque-borda:", "--destaque-suave:", "--acento:"]) {
        assert.ok(bloco.includes(v), `${sel} sem ${v}`);
      }
    }
  }
});

test("o script do começo da página aceita todas as mesas (e só elas)", () => {
  const lista = html.match(/\^\(([a-z|]+)\)\$/);
  assert.ok(lista, "regex das mesas no index.html");
  assert.deepEqual(lista[1].split("|").sort(), mesas.filter(m => m !== "verde").sort());
});

test("sem textura: o CSS deixa o feltro liso e a página aplica a escolha antes de desenhar", () => {
  assert.ok(css.includes(':root[data-textura="nao"][data-mesa] { --textura-mesa: none; }'));
  assert.ok(html.includes('localStorage.getItem("yam-textura") === "0"'));
});
