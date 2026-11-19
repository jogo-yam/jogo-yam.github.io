// Histórico na nuvem: a conta de juntar o histórico deste aparelho com o da
// nuvem (mesclarHistorico). O envio e a leitura no Firebase ficam no familia.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp } = require("./carregar-app.js");

const partida = (id, extra = {}) => ({ id, data: new Date(id).toISOString(), total: 3, valores: { "0-0": "3" }, ...extra });
// o Firebase devolve sem os campos vazios e com a chave sendo o id
// o resultado vem de dentro do app (outro "contexto"): JSON para comparar
const m = (app, ...args) => JSON.parse(JSON.stringify(app.mesclarHistorico(...args)));
const daNuvem = p => { const { id, ...resto } = JSON.parse(JSON.stringify(p)); return resto; };

test("aparelho novo: as partidas da nuvem chegam, nada é enviado", () => {
  const { app } = carregarApp();
  const r = m(app, [], { 1000: daNuvem(partida(1000)), 2000: daNuvem(partida(2000)) }, []);
  assert.deepEqual(r.adicionar.map(p => p.id).sort(), [1000, 2000]);
  assert.deepEqual(Object.keys(r.enviar), []);
});

test("primeira vez com nome de usuário: o histórico daqui sobe para a nuvem", () => {
  const { app } = carregarApp();
  const r = m(app, [partida(1000, { nome: undefined }), partida(2000)], {}, []);
  assert.deepEqual(Object.keys(r.enviar).sort(), ["1000", "2000"]);
  assert.ok(!("nome" in r.enviar["1000"]), "sem campos vazios (o Firebase recusa undefined)");
  assert.ok(!("id" in r.enviar["1000"]) || r.enviar["1000"].id === 1000);
  assert.equal(r.adicionar.length, 0);
});

test("já está igual nos dois lados: não envia nada (nem casas vazias contam)", () => {
  const { app } = carregarApp();
  const aqui = partida(1000, { valores: { "0-0": "3", "0-1": "" } });
  const r = m(app, [aqui], { 1000: daNuvem(partida(1000)) }, []);
  assert.deepEqual(r, { adicionar: [], atualizar: [], remover: [], enviar: {}, excluidas: [] });
});

test("excluir num aparelho tira dos outros", () => {
  const { app } = carregarApp();
  // aqui foi excluída: manda a marca de excluída
  const r1 = m(app, [], { 1000: daNuvem(partida(1000)) }, ["1000"]);
  assert.deepEqual(r1.enviar, { 1000: { excluida: true } });
  assert.equal(r1.adicionar.length, 0, "não volta para o histórico");
  // no outro aparelho: a marca chega e a partida sai
  const r2 = m(app, [partida(1000), partida(2000)], { 1000: { excluida: true }, 2000: daNuvem(partida(2000)) }, []);
  assert.deepEqual(r2.remover, ["1000"]);
  assert.deepEqual(r2.excluidas, ["1000"]);
  assert.deepEqual(r2.enviar, {});
});

test("o resultado da sala chegou depois: junta e manda o que falta", () => {
  const { app } = carregarApp();
  const sala = { posicao: 1, jogadores: 3, vencedores: ["Davi"], meuNome: "Davi" };
  const aqui = partida(1000, { sala });
  const r = m(app, [aqui], { 1000: daNuvem(partida(1000)) }, []);
  assert.deepEqual(r.enviar["1000"].sala, sala);
  assert.equal(r.atualizar.length, 0);
  const r2 = m(app, [partida(1000)], { 1000: daNuvem(aqui) }, []);
  assert.deepEqual(r2.atualizar[0].sala, sala, "e no outro aparelho a sala aparece");
});

test("aplicar: entra no histórico em ordem de data e não apaga o que chegou no meio", () => {
  const { app, rodar, armazenado } = carregarApp({ armazenado: { "yam-historico": JSON.stringify([partida(3000)]) } });
  const r = m(app, [], { 1000: daNuvem(partida(1000)), 2000: daNuvem(partida(2000)) }, []);
  rodar(`historico.unshift(${JSON.stringify(partida(4000))})`); // terminou uma partida enquanto a nuvem respondia
  assert.equal(app.aplicarHistoricoDaNuvem(r), 2);
  assert.deepEqual(JSON.parse(rodar("JSON.stringify(historico.map(p => p.id))")), [4000, 3000, 2000, 1000]);
  assert.deepEqual(JSON.parse(armazenado.get("yam-historico")).map(p => p.id), [4000, 3000, 2000, 1000]);
});
