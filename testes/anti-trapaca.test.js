// Botão de baixo conforme a situação e as regras anti-trapaça da sala.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, tabelaCompleta } = require("./carregar-app.js");

// sala de mentira: o que o familia.js responderia
const naSala = (rodar, { soDados = false, podeDesfazer = true } = {}) => rodar(`window.familia = {
  ativa: () => true, revelada: () => false, soDadosDoApp: () => ${soDados},
  podeDesfazer: () => ${podeDesfazer}, podeJogar: () => true, sincronizar() {}, mesaMudou() {}
}`);

test("botão de baixo: Novo jogo, Encerrar ou Sair da sala", () => {
  const { app, rodar } = carregarApp();
  rodar("state = {}");
  assert.equal(app.situacaoDoJogo(), "vazia");
  rodar(`state = { "0-0": "3" }`);
  assert.equal(app.situacaoDoJogo(), "andamento", "partida pela metade: Encerrar");
  rodar(`state = ${JSON.stringify(tabelaCompleta())}`);
  assert.equal(app.situacaoDoJogo(), "terminada");
  naSala(rodar);
  assert.equal(app.situacaoDoJogo(), "sala");
});

test("sala com só os dados do app: ninguém digita pontos", () => {
  const { app, rodar } = carregarApp();
  assert.equal(app.podeDigitarNaCasa(""), true, "fora de sala, digita normal");
  naSala(rodar, { soDados: true });
  assert.equal(app.podeDigitarNaCasa(""), false);
});

test("na sala, casa já marcada não muda", () => {
  const { app, rodar } = carregarApp();
  assert.equal(app.podeDigitarNaCasa("12"), true, "fora de sala dá para corrigir");
  naSala(rodar);
  assert.equal(app.podeDigitarNaCasa(""), true, "casa vazia: pode");
  assert.equal(app.podeDigitarNaCasa("12"), false, "casa marcada: não");
});

test("na sala, desfazer só a última jogada e antes de rolar de novo", () => {
  const { app, rodar } = carregarApp();
  naSala(rodar);
  rodar(`state = {}; mesa.jogada = 0; dadosParaNovaVez = false`);
  rodar("mesa.valores = [3, 3, 3, 5, 5]; mesa.jogada = 1");
  app.marcarCasa("10-2", 49);
  assert.equal(app.podeDesfazerNaSala(), true, "acabou de marcar");
  app.marcarCasa("2-2", 9); // outra casa (fora das regras da vez, só para o teste)
  app.desfazer();
  assert.equal(app.state["2-2"], undefined, "desfez a última");
  assert.equal(app.podeDesfazerNaSala(), false, "a de antes não dá mais");
  app.desfazer();
  assert.equal(app.state["10-2"], "49", "continua marcada");
});
