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

test("você contra cada um: quem trocou de nome continua sendo a mesma pessoa", () => {
  const { app } = carregarApp();
  const sala = (data, outro) => ({
    id: Date.parse(data), data, total: 300, valores: {},
    sala: { podio: { terminaram: [{ nome: "Davi", total: 300, posicao: 1, eu: true }, outro] } }
  });
  const lista = JSON.parse(JSON.stringify(app.confrontos([
    sala("2026-11-01T10:00:00Z", { nome: "Maria", total: 200, posicao: 2 }),                 // antes da identidade
    sala("2026-11-05T10:00:00Z", { nome: "Maria", total: 250, posicao: 2, id: "jmaria" }),   // já com identidade
    sala("2026-11-09T10:00:00Z", { nome: "Maria Silva", total: 350, posicao: 1, id: "jmaria" }), // trocou de nome
    sala("2026-11-10T10:00:00Z", { nome: "João", total: 100, posicao: 2 })
  ])));
  assert.equal(lista.length, 2, "Maria e Maria Silva são a mesma pessoa");
  const maria = lista.find(c => c.partidas === 3);
  assert.equal(maria.nome, "Maria Silva", "aparece o nome mais recente");
  assert.deepEqual([maria.vitorias, maria.derrotas], [2, 1]);
});

test("nomes de agora: quem trocou de nome aparece com o nome novo no histórico e nas estatísticas", () => {
  const { app, rodar } = carregarApp({ armazenado: { "yam-nome": JSON.stringify("Davi") } });
  rodar(`guardarNomesAtuais(${JSON.stringify({
    jmaria: { nome: "Maria Silva", chave: "maria silva", antigos: { maria: true } },
    jjoao: { nome: "João", chave: "joao" }
  })})`);
  assert.equal(app.nomeAtual("Maria", "jmaria"), "Maria Silva", "pela identidade");
  assert.equal(app.nomeAtual("Maria"), "Maria Silva", "partida antiga, só com o nome antigo");
  assert.equal(app.nomeAtual("Pedro"), "Pedro", "quem não está na lista fica como estava");

  const podio = {
    titulo: "Maria venceu!",
    terminaram: [
      { nome: "Maria", total: 400, posicao: 1, id: "jmaria" },
      { nome: "Davi", total: 300, posicao: 2, eu: true }
    ],
    naoTerminaram: [{ nome: "João", id: "jjoao" }]
  };
  const p = JSON.parse(JSON.stringify(app.podioComNomesAtuais(podio)));
  assert.equal(p.titulo, "Maria Silva venceu!");
  assert.equal(p.terminaram[0].nome, "Maria Silva");
  const sala = { posicao: 2, jogadores: 3, meuNome: "Davi", vencedores: ["Maria"], podio };
  assert.equal(app.textoDaSala(sala), "Maria Silva venceu · você ficou em 2º");
  const semPodio = { posicao: 2, jogadores: 2, meuNome: "Davi", vencedores: ["Maria"] };
  assert.equal(app.textoDaSala(semPodio), "Maria Silva venceu · você ficou em 2º", "partida antiga sem pódio");

  const lista = JSON.parse(JSON.stringify(app.confrontos([{ id: 1, data: "2026-11-01T10:00:00Z", total: 300, valores: {}, sala: { podio } }])));
  assert.equal(lista[0].nome, "Maria Silva");
});

test("nomes juntados: as duas identidades viram uma pessoa só, com o nome de agora", () => {
  const { app, rodar } = carregarApp({ armazenado: { "yam-nome": JSON.stringify("Davi") } });
  const sala = (data, outro) => ({
    id: Date.parse(data), data, total: 300, valores: {},
    sala: { podio: { terminaram: [{ nome: "Davi", total: 300, posicao: 1, eu: true }, outro] } }
  });
  const partidas = [
    sala("2026-11-01T10:00:00Z", { nome: "Maria", total: 200, posicao: 2 }),                // antes da identidade
    sala("2026-11-02T10:00:00Z", { nome: "Maria", total: 250, posicao: 2, id: "jmaria" }),
    sala("2026-11-03T10:00:00Z", { nome: "Giovana", total: 350, posicao: 1, id: "jgiovana" })
  ];
  // só um lado diz que juntou: não vale (ninguém junta a identidade de outra pessoa)
  rodar(`guardarNomesAtuais(${JSON.stringify({
    jmaria: { nome: "Maria", chave: "maria" },
    jgiovana: { nome: "Giovana", chave: "giovana", unidos: { jmaria: true } }
  })})`);
  assert.equal(JSON.parse(JSON.stringify(app.confrontos(partidas))).length, 2);
  assert.equal(app.nomeAtual("Maria", "jmaria"), "Maria");

  rodar(`guardarNomesAtuais(${JSON.stringify({
    jmaria: { nome: "Maria", chave: "maria", unidaA: "jgiovana" },
    jgiovana: { nome: "Giovana", chave: "giovana", antigos: { maria: true }, unidos: { jmaria: true } }
  })})`);
  const lista = JSON.parse(JSON.stringify(app.confrontos(partidas)));
  assert.equal(lista.length, 1, "Maria e Giovana são a mesma pessoa");
  assert.equal(lista[0].nome, "Giovana");
  assert.equal(lista[0].partidas, 3);
  assert.deepEqual([lista[0].vitorias, lista[0].derrotas], [2, 1]);
  assert.equal(app.nomeAtual("Maria", "jmaria"), "Giovana", "pela identidade antiga");
  assert.equal(app.nomeAtual("Maria"), "Giovana", "partida antiga, só com o nome");
});

test("vez: base ou casas negativas (mexendo no banco) não dão a vez para sempre", () => {
  const { app } = require("./carregar-app.js").carregarApp();
  const jogadores = [
    { uid: "a", entrouEm: 1, casas: 5, base: 0 },
    { uid: "b", entrouEm: 2, casas: 4, base: -100 }
  ];
  // b conta como 4 casas (a base negativa vira 0): a vez é de b, mas por estar
  // mesmo atrás; depois de jogar, a vez volta a andar normalmente
  assert.equal(app.vezDaSala(jogadores), "b");
  jogadores[1].casas = 6;
  assert.equal(app.vezDaSala(jogadores), "a");
});
