// Regras da tabela: valores aceitos em cada linha, contas, bônus e ordem das colunas.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, igual, tabelaCompleta } = require("./carregar-app.js");

const { app, rodar } = carregarApp();
const comTabela = valores => rodar(`state = ${JSON.stringify(valores)}`);
const aceita = (casa, valor) => app.validar(casa, String(valor)) === null;

test("números (1 a 6): de 0 a 5 dados daquele número", () => {
  igual(app.valoresPossiveis(0), [0, 1, 2, 3, 4, 5]);
  igual(app.valoresPossiveis(3), [0, 4, 8, 12, 16, 20]);
  igual(app.valoresPossiveis(5), [0, 6, 12, 18, 24, 30]);
});

test("combinações: valores aceitos", () => {
  igual(app.valoresPossiveis(9), [0, 24, 28, 32, 36, 40, 44]);      // Q: 20 + quatro iguais
  igual(app.valoresPossiveis(11), [0, 50]);                         // S-
  igual(app.valoresPossiveis(12), [0, 60]);                         // S+
  igual(app.valoresPossiveis(15), [0, 55, 60, 65, 70, 75, 80]);     // YAM: 50 + cinco iguais
  const x = app.valoresPossiveis(13);
  assert.equal(x[0], 0);
  assert.equal(x[1], 5);
  assert.equal(x[x.length - 1], 30);
  igual(app.valoresPossiveis(14), JSON.parse(JSON.stringify(x)));   // X MIN e X MAX iguais
});

test("Full: 30 + trinca de um número + par de outro", () => {
  const full = new Set(app.valoresPossiveis(10));
  assert.ok(full.has(49), "3-3-3-5-5 = 49");
  assert.ok(full.has(45), "1-1-1-6-6 = 45");
  assert.ok(!full.has(35), "cinco 1 (35) não é Full");
  assert.ok(!full.has(60), "cinco 6 (60) não é Full");
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      if (a !== b) assert.ok(full.has(30 + 3 * a + 2 * b), `${a}-${a}-${a}-${b}-${b}`);
    }
  }
});

test("total geral de uma tabela completa", () => {
  const { calculados, geral } = app.calcularTotais(tabelaCompleta());
  assert.equal(calculados["6-0"], 63);          // 1º total
  assert.equal(calculados["7-0"], 30);          // bônus
  assert.equal(calculados["8-0"], 93);          // 2º total
  assert.equal(calculados["16-0"], 314);        // combinações
  assert.equal(calculados["17-0"], 407);        // total da coluna
  assert.equal(geral, 4 * 407);
});

test("bônus de +30 só com 60 ou mais no 1º total", () => {
  // 60 exatos: as referências 2, 4, 9, 12, 15 e 18
  const sessenta = { "0-0": "2", "1-0": "4", "2-0": "9", "3-0": "12", "4-0": "15", "5-0": "18" };
  assert.equal(app.calcularTotais(sessenta).calculados["7-0"], 30);
  const cinquentaENove = { ...sessenta, "0-0": "1" };
  assert.equal(app.calcularTotais(cinquentaENove).calculados["7-0"], 0);
  assert.equal(app.calcularTotais(cinquentaENove).calculados["8-0"], 59);
});

test("casa riscada (0) conta zero e aparece como —", () => {
  const riscada = tabelaCompleta({ "15-2": "0" });
  assert.equal(app.calcularTotais(riscada).geral, 4 * 407 - 80);
  assert.equal(app.exibir("0"), "—");
  assert.equal(app.exibir(""), "");
  assert.equal(app.exibir("05"), "5");
});

test("valores impossíveis são recusados", () => {
  comTabela({});
  assert.ok(!aceita("0-2", 7), "sete 1 não existe");
  assert.ok(!aceita("9-2", 30), "Q 30 não existe");
  assert.ok(!aceita("10-2", 35), "Full 35 seria cinco 1");
  assert.ok(!aceita("13-2", 4), "X é no mínimo 5");
  assert.ok(!aceita("15-2", 50), "YAM é no mínimo 55");
  assert.ok(aceita("10-2", 45));
  assert.ok(aceita("15-2", 0), "riscar");
});

test("descida (↓): de cima para baixo; riscar pode em qualquer casa", () => {
  comTabela({});
  assert.ok(aceita("0-0", 3));
  assert.ok(!aceita("1-0", 4), "ainda falta o 1");
  assert.ok(aceita("1-0", 0), "riscar fora da vez pode");
  comTabela({ "0-0": "3" });
  assert.ok(aceita("1-0", 4));
  igual(app.problemaDeOrdem(2, 0).certa, "1-0");
});

test("subida (↑): só depois da descida, de baixo para cima", () => {
  comTabela({});
  assert.ok(!aceita("15-1", 55), "descida ainda não acabou");
  const descidaPronta = {};
  for (const l of app.LINHAS_JOGO) descidaPronta[`${l}-0`] = "0";
  comTabela(descidaPronta);
  assert.ok(aceita("15-1", 55), "começa pelo YAM");
  assert.ok(!aceita("14-1", 20), "X MAX só depois do YAM");
  comTabela({ ...descidaPronta, "15-1": "55" });
  assert.ok(aceita("14-1", 20));
  assert.equal(app.proximaCasa(1), 14);
});

test("colunas D e S: qualquer ordem", () => {
  comTabela({});
  assert.ok(aceita("15-2", 80));
  assert.ok(aceita("9-3", 40));
  assert.ok(aceita("3-2", 12));
});

test("MAX tem que ser maior que o MIN na mesma coluna", () => {
  comTabela({ "13-2": "10" });
  assert.ok(!aceita("14-2", 10), "igual não vale");
  assert.ok(!aceita("14-2", 9));
  assert.ok(aceita("14-2", 11));
  assert.ok(aceita("14-2", 0), "riscar o MAX pode");
  assert.ok(aceita("14-3", 6), "outra coluna não conta");
  comTabela({ "14-2": "12" });
  assert.ok(!aceita("13-2", 12));
  assert.ok(aceita("13-2", 11));
});

test("teclado: espera o número inteiro antes de pular de casa", () => {
  assert.equal(app.numeroCompleto(3, "2"), false, "na linha do 4, o 2 pode virar 20");
  assert.equal(app.numeroCompleto(3, "4"), true);
  assert.equal(app.numeroCompleto(3, "1"), false, "12 ou 16");
  assert.equal(app.numeroCompleto(15, "6"), false, "60 ou 65");
});

test("tabela válida e completa", () => {
  assert.equal(app.tabelaValida(tabelaCompleta()), true);
  assert.equal(app.tabelaValida(tabelaCompleta({ "9-1": "30" })), false);
  assert.equal(app.partidaEstaCompleta(tabelaCompleta()), true);
  assert.equal(app.partidaEstaCompleta(tabelaCompleta({ "12-3": "" })), false);
});

test("nomes das casas nas mensagens", () => {
  assert.equal(app.siglaDaCasa(0), "2 / 1");
  assert.equal(app.siglaDaCasa(9), "Q");
  assert.equal(app.siglaDaCasa(12), "S+");
  assert.equal(app.siglaDaCasa(13), "MIN", "fora da tabela, sem o X");
  assert.equal(app.siglaDaCasa(14), "MAX");
  assert.equal(app.rows[13], "X MIN", "na tabela continua X MIN");
  assert.equal(app.siglaDaCasa(15), "YAM");
});
