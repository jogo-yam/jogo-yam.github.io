// Sala "cada um na sua vez", "você contra cada um" e lembrete de backup.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, igual } = require("./carregar-app.js");

const { app, rodar } = carregarApp();

// jogadores na ordem de entrada: Davi criou, Maria e João entraram depois
const sala = (casas, extra = {}) => [
  { uid: "davi", entrouEm: 1, casas: casas[0], ...extra.davi },
  { uid: "maria", entrouEm: 2, casas: casas[1], ...extra.maria },
  { uid: "joao", entrouEm: 3, casas: casas[2], ...extra.joao }
];

test("a vez segue a ordem de entrada, quem criou começa", () => {
  assert.equal(app.vezDaSala(sala([0, 0, 0])), "davi");
  assert.equal(app.vezDaSala(sala([1, 0, 0])), "maria");
  assert.equal(app.vezDaSala(sala([1, 1, 0])), "joao");
  assert.equal(app.vezDaSala(sala([1, 1, 1])), "davi", "volta para o primeiro");
});

test("pular a vez e quem entra no meio", () => {
  assert.equal(app.vezDaSala(sala([1, 0, 0]), { maria: 1 }), "joao", "Maria foi pulada");
  // João entrou quando Davi e Maria já tinham jogado 5 vezes: começa com base 5
  // e joga no fim da próxima rodada (depois de Davi e Maria)
  assert.equal(app.vezDaSala(sala([5, 5, 0], { joao: { base: 5 } })), "davi");
  assert.equal(app.vezDaSala(sala([6, 5, 0], { joao: { base: 5 } })), "maria");
  assert.equal(app.vezDaSala(sala([6, 6, 0], { joao: { base: 5 } })), "joao");
  assert.equal(app.vezDaSala(sala([6, 6, 1], { joao: { base: 5 } })), "davi");
});

test("quem terminou sai da roda; ninguém na roda, ninguém joga", () => {
  assert.equal(app.vezDaSala(sala([52, 40, 41], { davi: { terminou: true } })), "maria");
  assert.equal(app.vezDaSala(sala([52, 52, 52], { davi: { terminou: true }, maria: { terminou: true }, joao: { terminou: true } })), null);
});

test("casas marcadas contam número e riscado, não os totais", () => {
  assert.equal(app.casasMarcadas({}), 0);
  assert.equal(app.casasMarcadas({ "0-0": "3", "9-1": "0", "6-0": "3", "15-3": "" }), 2);
});

test("o que os outros veem da sua jogada", () => {
  assert.equal(app.textoDaJogada("Maria", "5-0", 18), "Maria marcou 18 no 6 na descida (↓)");
  assert.equal(app.textoDaJogada("Maria", "10-2", 0), "Maria riscou o F na coluna D");
  assert.equal(app.textoDaJogada("João", "15-3", 80), "João marcou 80 no YAM na coluna S");
});

// ---------- você contra cada um ----------

const partidaEmSala = (data, terminaram) => ({ id: Date.parse(data), data, total: 0, valores: {}, sala: { podio: { terminaram } } });

test("você contra cada um: vitórias, derrotas, empates e médias", () => {
  const lista = JSON.parse(JSON.stringify(app.confrontos([
    partidaEmSala("2026-11-01T10:00:00Z", [
      { nome: "Maria", total: 900, posicao: 1 }, { nome: "Davi", total: 800, posicao: 2, eu: true }, { nome: "João", total: 700, posicao: 3 }]),
    partidaEmSala("2026-11-02T10:00:00Z", [
      { nome: "Davi", total: 1000, posicao: 1, eu: true }, { nome: "maria ", total: 950, posicao: 2 }]),
    partidaEmSala("2026-11-03T10:00:00Z", [
      { nome: "Davi", total: 600, posicao: 1, eu: true }, { nome: "Maria", total: 600, posicao: 1 }]),
    { id: 9, data: "2026-11-04T10:00:00Z", total: 500, valores: {} } // partida sozinho: não entra
  ])));
  igual(lista.map(c => [c.nome, c.partidas, c.vitorias, c.derrotas, c.empates]), [
    ["Maria", 3, 1, 1, 1], // "maria " é a mesma pessoa; fica o nome mais recente
    ["João", 1, 1, 0, 0]
  ]);
  assert.equal(lista[0].meus, 2400);
  assert.equal(lista[0].deles, 2450);
});

test("pódio sem você (não terminou) não conta", () => {
  const lista = app.confrontos([partidaEmSala("2026-11-01T10:00:00Z", [{ nome: "Maria", total: 900, posicao: 1 }])]);
  assert.equal(lista.length, 0);
});

// ---------- lembrete de backup ----------

test("lembrete de backup: com 3 partidas e sem backup há mais de 30 dias", () => {
  const agora = Date.parse("2026-11-17T12:00:00Z");
  const tres = JSON.stringify([1, 2, 3].map(id => ({ id, data: "2026-11-01T10:00:00Z", total: 0, valores: {} })));
  const lembra = armazenado => carregarApp({ armazenado }).app.precisaLembrarBackup(agora);
  assert.equal(lembra({ "yam-historico": tres }), true, "nunca fez backup");
  assert.equal(lembra({ "yam-historico": JSON.stringify([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: {} }]) }), false, "só 1 partida");
  assert.equal(lembra({ "yam-historico": tres, "yam-ultimo-backup": JSON.stringify("2026-11-01T10:00:00Z") }), false, "backup recente");
  assert.equal(lembra({ "yam-historico": tres, "yam-ultimo-backup": JSON.stringify("2026-09-01T10:00:00Z") }), true, "backup antigo");
  assert.equal(lembra({ "yam-historico": tres, "yam-lembrete-backup": JSON.stringify("2026-11-10T10:00:00Z") }), false, "lembrou há pouco");
});
