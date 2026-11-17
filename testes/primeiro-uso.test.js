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
