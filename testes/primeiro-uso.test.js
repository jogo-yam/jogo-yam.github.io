// Primeiro uso (boas-vindas) e preferência de som.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp } = require("./carregar-app.js");

test("boas-vindas aparecem só para quem nunca usou o app", () => {
  const mostra = armazenado => carregarApp({ armazenado }).app.deveMostrarBoasVindas();
  assert.equal(mostra({}), true, "celular novo");
  assert.equal(mostra({ "yam-boas-vindas": "1" }), false, "já viu");
  assert.equal(mostra({ "yam-nome": JSON.stringify("Maria") }), false, "já tem nome");
  assert.equal(mostra({ "yam": JSON.stringify({ "0-0": "3" }) }), false, "jogo em andamento");
  assert.equal(mostra({ "yam-historico": JSON.stringify([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: {} }]) }),
    false, "já tem partidas");
});

test("som: começa ligado e desligar fica guardado", () => {
  const { app, rodar, armazenado } = carregarApp();
  assert.equal(rodar("somLigado"), true);
  app.alternarSom();
  assert.equal(rodar("somLigado"), false);
  assert.equal(armazenado.get("yam-som"), "0");
  assert.equal(carregarApp({ armazenado: { "yam-som": "0" } }).rodar("somLigado"), false);
});

test("o link de convite abre nas boas-vindas", () => {
  const { rodar } = carregarApp();
  assert.match(rodar("LINK_CONVITE"), /#bem-vindo$/);
});

test("como instalar: aparece uma vez só, no primeiro uso, se o app não estiver instalado", () => {
  const { app, armazenado } = carregarApp();
  assert.equal(app.deveMostrarGuiaInstalar(), true, "primeira vez, no navegador");
  assert.equal(armazenado.get("yam-guia-instalar"), "1");
  assert.equal(app.deveMostrarGuiaInstalar(), false, "não aparece de novo");
  assert.equal(carregarApp({ armazenado: { "yam-guia-instalar": "1" } }).app.deveMostrarGuiaInstalar(), false, "já viu");

  const instalado = carregarApp();
  instalado.rodar("navigator.standalone = true");
  assert.equal(instalado.app.deveMostrarGuiaInstalar(), false, "já abriu pelo ícone");
});
