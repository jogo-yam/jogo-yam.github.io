// Partidas pela metade: guardam a sala de onde eram e dá para continuar depois.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, tabelaCompleta } = require("./carregar-app.js");

const metade = () => {
  const t = tabelaCompleta();
  for (const k of Object.keys(t)) if (Number(k.split("-")[1]) >= 2) delete t[k]; // só duas colunas
  return t;
};

test("a partida em sala que vai pela metade para o histórico guarda o código da sala", () => {
  const { app, rodar } = carregarApp();
  rodar(`state = ${JSON.stringify(metade())}`);
  app.marcarSalaDaTabela("12345");
  app.salvarPartidaAtual();
  assert.equal(app.historico[0].codigoSala, "12345");
  assert.equal(app.partidaParaTerminar(), null, "é a tabela de agora: não aparece como pendente");
  app.comecarNovaPartida();
  assert.equal(app.salaDaTabela(), null, "a tabela nova não é de sala nenhuma");
  assert.equal(app.partidaParaTerminar().codigoSala, "12345");
});

test("terminada, a partida deixa de ter sala pendente", () => {
  const { app, rodar } = carregarApp();
  rodar(`state = ${JSON.stringify(metade())}`);
  app.marcarSalaDaTabela("12345");
  app.salvarPartidaAtual();
  rodar(`state = ${JSON.stringify(tabelaCompleta())}`);
  app.salvarPartidaAtual();
  assert.equal(app.historico.length, 1);
  assert.equal(app.historico[0].codigoSala, undefined);
});

test("continuar traz a tabela de volta e termina na mesma partida do histórico", async () => {
  const { app, rodar } = carregarApp();
  rodar(`state = ${JSON.stringify(metade())}`);
  app.salvarPartidaAtual();
  const id = app.historico[0].id;
  app.comecarNovaPartida();
  rodar("window.scrollTo = () => {}");
  await app.continuarPartida(id);
  assert.equal(app.casasMarcadas(), 26, "as casas voltaram (13 linhas x 2 colunas)");
  assert.equal(rodar("partidaSalvaId"), id);
  rodar(`state = ${JSON.stringify(tabelaCompleta())}`);
  app.salvarPartidaAtual();
  assert.equal(app.historico.length, 1, "não duplicou");
  assert.equal(app.historico[0].total, 4 * 407);
});

test("prazo da sala: em dias e, no último dia, em horas", () => {
  const { app } = carregarApp();
  const agora = Date.UTC(2026, 10, 24, 12);
  const hora = 60 * 60 * 1000, dia = 24 * hora;
  assert.equal(app.textoDoPrazo(agora + 3 * dia, agora), "faltam 3 dias");
  assert.equal(app.textoDoPrazo(agora + 2 * dia + 5 * hora, agora), "faltam 2 dias");
  assert.equal(app.textoDoPrazo(agora + dia + hora, agora), "falta 1 dia");
  assert.equal(app.textoDoPrazo(agora + 23 * hora + 59 * 60000, agora), "faltam 23 horas");
  assert.equal(app.textoDoPrazo(agora + hora + 1, agora), "falta 1 hora");
  assert.equal(app.textoDoPrazo(agora + 20 * 60000, agora), "falta menos de 1 hora");
  assert.equal(app.textoDoPrazo(agora - 1, agora), null, "já fechou");
  assert.equal(app.textoDoPrazo(undefined, agora), null);
});

test("dá para deixar várias partidas em pausa: todas aparecem, menos a tabela de agora", () => {
  const { app, rodar } = carregarApp();
  rodar(`state = ${JSON.stringify(metade())}`);
  app.marcarSalaDaTabela("11111");
  app.salvarPartidaAtual();
  app.comecarNovaPartida();
  rodar(`state = { "0-0": "3" }`);
  app.salvarPartidaAtual();
  assert.equal(app.partidasEmPausa().length, 1, "a tabela de agora não conta");
  app.comecarNovaPartida();
  const pausadas = app.partidasEmPausa();
  assert.equal(pausadas.length, 2);
  assert.ok(pausadas.some(p => p.codigoSala === "11111"), "a da sala continua em pausa");
  rodar(`state = ${JSON.stringify(tabelaCompleta())}`);
  app.salvarPartidaAtual();
  app.comecarNovaPartida();
  assert.equal(app.partidasEmPausa().length, 2, "terminada não fica em pausa");
});
