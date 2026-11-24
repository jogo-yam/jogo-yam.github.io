// Destaques da partida em sala (no pódio): YAMs, maior jogada, bônus, menor MIN e riscos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, tabelaCompleta } = require("./carregar-app.js");

const { app } = carregarApp();
const destaques = terminaram => JSON.parse(JSON.stringify(app.destaquesDaPartida(terminaram)))
  .map(d => [d.titulo, d.texto]);

test("com uma pessoa só (ou sem tabelas), não há destaques", () => {
  assert.deepEqual(destaques([{ nome: "Ana", valores: tabelaCompleta() }]), []);
  assert.deepEqual(destaques([{ nome: "Ana" }, { nome: "Bia" }]), []);
});

test("conta YAMs, maior jogada, bônus, menor MIN e riscos", () => {
  const ana = { nome: "Ana", eu: true, valores: tabelaCompleta() };          // 4 YAMs de 80, bônus nas 4
  const bia = {
    nome: "Bia", valores: tabelaCompleta({
      "15-0": "0", "15-1": "0", "15-2": "55", "15-3": "0",                       // 1 YAM, 3 riscos
      "13-2": "6",                                                               // MIN de 6
      "0-0": "0", "1-0": "0", "2-0": "0"                                         // coluna 0 sem bônus (54)
    })
  };
  assert.deepEqual(destaques([ana, bia]), [
    ["Mais YAMs", "Você · 4 YAMs"],
    ["Maior jogada", "Você · YAM de 80"],
    ["Mais bônus", "Você · bônus em 4 colunas"],
    ["Menor MIN", "Bia · 6"],
    ["Quem mais riscou", "Bia · 6 casas"]
  ]);
});

test("empate junta os nomes; o que todos fizeram igual (ou ninguém fez) não aparece", () => {
  const semYam = { "15-0": "", "15-1": "", "15-2": "", "15-3": "" };
  const a = { nome: "Ana", valores: tabelaCompleta(semYam) };
  const b = { nome: "Bia", valores: tabelaCompleta(semYam) };
  const c = { nome: "Caio", valores: tabelaCompleta(semYam) };
  const lista = destaques([a, b, c]);
  assert.deepEqual(lista.map(d => d[0]), ["Maior jogada", "Menor MIN"]);
  assert.equal(lista[0][1], "3 empatados · Sequência maior de 60", "na tela: as bolinhas mostram quem é");
  const naImagem = JSON.parse(JSON.stringify(app.destaquesDaPartida([a, b, c], false)));
  assert.equal(naImagem[0].texto, "Ana, Bia e Caio · Sequência maior de 60", "na imagem: os nomes");
});
