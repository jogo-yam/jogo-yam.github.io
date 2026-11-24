// Ranking geral: qual partida vale como recorde de cada jogador e a ordem.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, lerArquivo } = require("./carregar-app.js");

// tabela inteira com o mesmo valor em cada linha (o maior possível ou o menor)
function tabela(rodar, qual) {
  return JSON.parse(rodar(`JSON.stringify((() => {
    const v = {};
    for (const l of LINHAS_JOGO) {
      const p = valoresPossiveis(l);
      const x = p ? (${qual === "max" ? "Math.max(...p)" : "Math.min(...p)"}) : 0;
      for (const c of [0, 1, 2, 3]) v[l + "-" + c] = String(x);
    }
    return v;
  })())`));
}

test("a maior pontuação possível é a do limite (app e regras do Firebase)", () => {
  const { app, rodar } = carregarApp();
  const max = JSON.parse(rodar("JSON.stringify(calcularTotais(" + JSON.stringify(tabela(rodar, "max")) + "))")).geral;
  assert.equal(app.MAIOR_PONTUACAO, max);
  const regra = JSON.parse(lerArquivo("firebase-regras.json")).rules.ranking.$chave[".validate"];
  assert.match(regra, new RegExp(`val\\(\\) <= ${max}\\b`), "o limite das regras é o mesmo");
});

test("recorde: só partida terminada, a de maior total; empate fica a mais antiga", () => {
  const { app, rodar } = carregarApp();
  const cheia = tabela(rodar, "max");
  const baixa = tabela(rodar, "min");
  const meio = { ...cheia };
  delete meio["15-3"]; // falta uma casa: não terminou
  const melhor = lista => JSON.parse(JSON.stringify(app.melhorPartida(lista)));
  const sala = { sala: { jogadores: 2, posicao: 1 } };
  assert.equal(melhor([]), null);
  assert.equal(melhor([{ id: 1, data: "2026-11-01T10:00:00Z", total: 9999, valores: meio, ...sala }]), null, "não terminada não conta");
  const r = melhor([
    { id: 1, data: "2026-11-02T10:00:00Z", total: 5, valores: baixa, ...sala },
    { id: 2, data: "2026-11-03T10:00:00Z", total: 0, valores: cheia, ...sala }, // o total vem da tabela, não do campo
    { id: 3, data: "2026-11-01T10:00:00Z", total: 0, valores: cheia, emSala: 3 }
  ]);
  assert.equal(r.total, app.MAIOR_PONTUACAO);
  assert.equal(r.data, "2026-11-01T10:00:00Z", "empate: a mais antiga");
});

test("ranking: só partida em sala com mais alguém (sozinho não conta)", () => {
  const { app, rodar } = carregarApp();
  const cheia = tabela(rodar, "max");
  const baixa = tabela(rodar, "min");
  const melhor = lista => JSON.parse(JSON.stringify(app.melhorPartida(lista)));
  assert.equal(melhor([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: cheia }]), null, "sozinho não conta");
  assert.equal(melhor([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: cheia, sala: { jogadores: 1 } }]), null,
    "sala só com a pessoa não conta");
  assert.equal(melhor([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: cheia, emSala: 1 }]), null);
  const r = melhor([
    { id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: cheia }, // sozinho, maior: fica de fora
    { id: 2, data: "2026-11-02T10:00:00Z", total: 0, valores: baixa, emSala: 2 } // saiu antes do pódio: conta
  ]);
  assert.equal(r.data, "2026-11-02T10:00:00Z");
  assert.ok(r.total < app.MAIOR_PONTUACAO);
});

test("ranking do mês: a melhor partida em sala do mês; recorde antigo fica de fora", () => {
  const { app, rodar } = carregarApp();
  const cheia = tabela(rodar, "max");
  const baixa = tabela(rodar, "min");
  assert.equal(app.mesDe("2026-11-15T12:00:00"), "2026-11");
  assert.equal(app.mesDe("bobagem"), "");
  assert.equal(app.nomeDoMes("2026-03"), "março");
  const melhorDoMes = (lista, mes) => JSON.parse(JSON.stringify(app.melhorPartidaDoMes(lista, mes)));
  const lista = [
    { id: 1, data: "2026-10-15T12:00:00", total: 0, valores: cheia, emSala: 2 }, // outubro, maior
    { id: 2, data: "2026-11-10T12:00:00", total: 0, valores: baixa, emSala: 2 },
    { id: 3, data: "2026-11-12T12:00:00", total: 0, valores: cheia } // sozinho: não conta
  ];
  assert.equal(melhorDoMes(lista, "2026-11").data, "2026-11-10T12:00:00");
  assert.equal(melhorDoMes(lista, "2026-12"), null);

  const doMes = JSON.parse(JSON.stringify(app.rankingDoMes([
    { chave: "a", total: 900, mes: "2026-11", totalMes: 300, dataMes: "2026-11-02" },
    { chave: "b", total: 500, mes: "2026-10", totalMes: 500, dataMes: "2026-10-30" }, // mês passado
    { chave: "c", total: 400 }, // não jogou em sala com o app novo neste mês
    { chave: "d", total: 999, mes: "2026-11", totalMes: 99999, dataMes: "2026-11-03" } // impossível
  ], "2026-11")));
  assert.deepEqual(doMes.map(r => [r.chave, r.total, r.data]), [["a", 300, "2026-11-02"]]);
});

test("ordem do ranking: mais pontos primeiro; empate, quem fez antes", () => {
  const { app } = carregarApp();
  const ordem = JSON.parse(JSON.stringify(app.ordenarRanking([
    { chave: "a", total: 300, data: "2026-11-05" },
    { chave: "b", total: 412, data: "2026-11-09" },
    { chave: "c", total: 300, data: "2026-11-01" }
  ]))).map(r => r.chave);
  assert.deepEqual(ordem, ["b", "c", "a"]);
});
