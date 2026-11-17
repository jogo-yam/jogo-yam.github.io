// Dados virtuais: o que cada jogada vale e as regras de rolar/segurar.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp } = require("./carregar-app.js");

const { app, rodar } = carregarApp();
const itens = dados => app.oQueValem(dados).split("\n")[0].split(" · ");

test("cinco 6: YAM 80, número e X (não é Quadra nem Full)", () => {
  const texto = app.oQueValem([6, 6, 6, 6, 6]);
  assert.ok(texto.includes("YAM 80"));
  assert.ok(texto.includes("6 → 30"));
  assert.ok(texto.includes("X 30"));
  assert.ok(!itens([6, 6, 6, 6, 6]).some(i => i.startsWith("Q ") || i.startsWith("F ")));
});

test("quatro iguais: Quadra", () => {
  assert.ok(itens([5, 5, 2, 5, 5]).includes("Q 40"));
  assert.ok(!itens([5, 5, 2, 5, 5]).some(i => i.startsWith("YAM")));
});

test("trinca + par: Full", () => {
  assert.ok(itens([3, 5, 3, 5, 3]).includes("F 49"));
});

test("sequências, em qualquer ordem", () => {
  assert.ok(itens([3, 1, 5, 2, 4]).includes("S- 50"));
  assert.ok(itens([6, 2, 4, 3, 5]).includes("S+ 60"));
  assert.ok(!itens([1, 2, 3, 4, 6]).some(i => i.startsWith("S")));
});

// Para TODAS as 7.776 jogadas possíveis: tudo o que a janela dos dados sugere
// precisa ser aceito pela tabela naquela linha.
test("o que os dados sugerem sempre é aceito pela tabela", () => {
  const linhaDa = { YAM: [15], Q: [9], F: [10], "S-": [11], "S+": [12], X: [13, 14] };
  const aceitos = {};
  for (let l = 0; l <= 15; l++) aceitos[l] = new Set(app.valoresPossiveis(l) || []);

  for (let n = 0; n < 6 ** 5; n++) {
    const dados = [0, 1, 2, 3, 4].map(i => 1 + Math.floor(n / 6 ** i) % 6);
    const [combinacoes, numeros] = app.oQueValem(dados).split("\n");
    for (const item of combinacoes.split(" · ")) {
      const [nome, valor] = item.split(" ");
      for (const l of linhaDa[nome]) assert.ok(aceitos[l].has(Number(valor)), `${dados}: ${item}`);
    }
    for (const item of numeros.replace("Números: ", "").split(" · ")) {
      const [face, valor] = item.split(" → ").map(Number);
      assert.ok(aceitos[face - 1].has(valor), `${dados}: ${item}`);
    }
  }
});

test("sorteio: só sai de 1 a 6, e sai de tudo", () => {
  const vezes = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) vezes[app.sortearFace()]++;
  assert.equal(vezes[0], 0);
  for (let f = 1; f <= 6; f++) assert.ok(vezes[f] > 800, `face ${f} saiu ${vezes[f]} vezes`);
});

test("rolar e segurar: até 3 jogadas por vez", async () => {
  const esperarRolagem = () => new Promise(r => setTimeout(r, 700));
  const mesa = () => JSON.parse(rodar("JSON.stringify(mesa)"));

  app.novaVez();
  app.segurarDado(0);
  assert.equal(mesa().segurados[0], false, "antes de rolar não dá para segurar");

  app.rolarDados();
  assert.equal(mesa().jogada, 1);
  await esperarRolagem();
  const primeiro = mesa().valores[0];
  app.segurarDado(0);
  assert.equal(mesa().segurados[0], true);

  app.rolarDados();
  await esperarRolagem();
  assert.equal(mesa().valores[0], primeiro, "o dado segurado não muda");
  app.rolarDados();
  await esperarRolagem();
  assert.equal(mesa().jogada, 3);

  app.rolarDados();
  assert.equal(mesa().jogada, 3, "não passa da 3ª jogada");
  app.segurarDado(1);
  assert.equal(mesa().segurados[1], false, "depois da 3ª não segura mais");

  app.novaVez();
  assert.equal(mesa().jogada, 0);
  assert.deepEqual(mesa().segurados, [false, false, false, false, false]);
});
