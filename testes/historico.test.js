// Histórico, partidas em sala e pódio guardado.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, igual, tabelaCompleta } = require("./carregar-app.js");

const partida = (id, mudar = {}) =>
  ({ id, data: "2026-11-16T20:00:00.000Z", total: 4 * 407, valores: tabelaCompleta(), ...mudar });

test("ao abrir, o total de cada partida é refeito a partir da tabela", () => {
  const { app, armazenado } = carregarApp({
    armazenado: { "yam-historico": JSON.stringify([partida(1, { total: 999 })]) }
  });
  assert.equal(app.historico[0].total, 4 * 407);
  assert.equal(JSON.parse(armazenado.get("yam-historico"))[0].total, 4 * 407, "e fica salvo");
});

test("salvar a mesma partida duas vezes não duplica", () => {
  const { app, rodar } = carregarApp();
  rodar(`state = ${JSON.stringify(tabelaCompleta())}`);
  app.salvarPartidaAtual();
  rodar(`state["15-0"] = "55"`);
  app.salvarPartidaAtual();
  assert.equal(app.historico.length, 1);
  assert.equal(app.historico[0].total, 4 * 407 - 25, "atualizou o total");
});

test("resultado da sala fica na partida, com o pódio inteiro", () => {
  const { app, armazenado } = carregarApp({
    armazenado: { "yam-historico": JSON.stringify([partida(1)]), "yam-partida-salva": "1" }
  });
  const podio = {
    titulo: "🏆 Maria venceu!",
    terminaram: [
      { nome: "Maria", total: 1700, posicao: 1, valores: tabelaCompleta() },
      { nome: "Davi", total: 4 * 407, posicao: 2, eu: true, valores: tabelaCompleta() }
    ],
    naoTerminaram: [{ nome: "Pedro" }]
  };
  app.registrarResultadoSala({
    codigo: "12345", total: 4 * 407, posicao: 2, meuNome: "Davi", jogadores: 3, vencedores: ["Maria"], podio
  });
  const sala = JSON.parse(armazenado.get("yam-historico"))[0].sala;
  assert.equal(sala.posicao, 2);
  assert.equal(sala.total, undefined, "o total não se repete");
  igual(sala.podio, podio);
});

test("resultado de outra partida (total diferente) não é guardado", () => {
  const { app } = carregarApp({
    armazenado: { "yam-historico": JSON.stringify([partida(1)]), "yam-partida-salva": "1" }
  });
  app.registrarResultadoSala({ codigo: "12345", total: 100, posicao: 1, meuNome: "Davi", jogadores: 2, vencedores: ["Davi"] });
  assert.equal(app.historico[0].sala, undefined);
});

test("texto da sala no histórico", () => {
  const { app } = carregarApp();
  assert.equal(app.textoDaSala({ posicao: 1, meuNome: "Davi", jogadores: 4, vencedores: ["Davi"] }), "🏆 Você venceu (sala de 4)");
  assert.equal(app.textoDaSala({ posicao: 1, meuNome: "Davi", jogadores: 4, vencedores: ["Davi", "Maria"] }), "🏆 Empate em 1º com Maria");
  assert.equal(app.textoDaSala({ posicao: 2, meuNome: "Davi", jogadores: 4, vencedores: ["Maria"] }), "🏆 Maria venceu · você ficou em 2º");
  assert.equal(app.textoDaSala(undefined), "");
});

test("título do pódio", () => {
  const { app } = carregarApp();
  assert.equal(app.tituloDoPodio([]), "Partida encerrada");
  assert.equal(app.tituloDoPodio(["Maria"]), "🏆 Maria venceu!");
  assert.equal(app.tituloDoPodio(["Maria", "João"]), "🏆 Empate: Maria e João!");
});

test("backup: só aceita partidas no formato do app", () => {
  const { app } = carregarApp();
  assert.ok(app.partidaValida(partida(1)));
  assert.ok(!app.partidaValida({ id: "1", data: "x", total: 1, valores: {} }));
  assert.ok(!app.partidaValida({ id: 1, data: "x", total: 1 }));
  assert.ok(!app.partidaValida(null));
});
