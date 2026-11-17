// Dados virtuais: o que cada jogada vale, a sugestão de número e as regras de rolar/segurar.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, igual } = require("./carregar-app.js");

const { app, rodar } = carregarApp();
// mesa na jogada pedida (1ª por padrão) e tabela (state) do jeito pedido
const naTabela = (valores = {}, jogada = 1) => rodar(`mesa.jogada = ${jogada}; state = ${JSON.stringify(valores)}`);
// combinações da 1ª linha (a última linha é sempre a soma)
const itens = dados => app.oQueValem(dados).split("\n").slice(0, -1).join(" · ").split(" · ").filter(Boolean);

test("cinco 6: YAM 80 e a soma (não é Quadra nem Full)", () => {
  naTabela();
  igual(app.oQueValem([6, 6, 6, 6, 6]), "YAM 80\nSoma dos dados: 30");
});

test("quatro iguais: Quadra", () => {
  naTabela();
  assert.ok(itens([5, 5, 2, 5, 5]).includes("Q 40"));
  assert.ok(!itens([5, 5, 2, 5, 5]).some(i => i.startsWith("YAM")));
});

test("trinca + par: Full", () => {
  naTabela();
  assert.ok(itens([3, 5, 3, 5, 3]).includes("F 49"));
});

test("sequências, em qualquer ordem", () => {
  naTabela();
  assert.ok(itens([3, 1, 5, 2, 4]).includes("S- 50"));
  assert.ok(itens([6, 2, 4, 3, 5]).includes("S+ 60"));
  assert.ok(!itens([1, 2, 3, 4, 6]).some(i => i.startsWith("S")));
});

// ---------- sem combinação para marcar: sugestão de número ----------

test("sem combinação: sugere o número com menor risco para o bônus", () => {
  naTabela();
  // um 1 fica só 1 abaixo da referência (2); os outros ficam bem mais
  igual(app.oQueValem([1, 2, 3, 4, 6]), "Um 1 → 1, na descida (↓)\nSoma dos dados: 16");
  // três 6 = a referência (18); a descida está no 1, então vai na D
  igual(app.oQueValem([6, 6, 6, 2, 4]), "Três 6 → 18, na coluna D\nSoma dos dados: 24");
});

test("sugestão que garante o bônus avisa", () => {
  naTabela({ "0-2": "3", "1-2": "6", "2-2": "9", "3-2": "12", "4-2": "20" }); // D: 50, falta o 6
  igual(app.oQueValem([6, 6, 6, 1, 3]), "Três 6 → 18, na coluna D (garante o bônus)\nSoma dos dados: 22");
});

test("coluna com bônus garantido recebe o número ruim (nada a perder)", () => {
  // D: 75, bônus garantido, só o 6 livre. Um 1 na descida deixaria a descida
  // 1 abaixo da referência; um 6 na D não arrisca nada.
  naTabela({ "0-2": "5", "1-2": "10", "2-2": "15", "3-2": "20", "4-2": "25" });
  igual(app.oQueValem([6, 1, 2, 3, 4]), "Um 6 → 6, na coluna D\nSoma dos dados: 16");
});

test("combinação sem casa livre não aparece; vira sugestão de número", () => {
  naTabela({ "10-0": "49", "10-1": "49", "10-2": "49", "10-3": "49" }); // Full todo preenchido
  igual(app.oQueValem([3, 3, 3, 5, 5]), "Três 3 → 9, na coluna D\nSoma dos dados: 19");
});

test("a coluna S (Seca) só vale na 1ª jogada", () => {
  const soSobraS = {};
  for (const col of [0, 1, 2]) for (let l = 0; l <= 5; l++) soSobraS[`${l}-${col}`] = "0";
  naTabela(soSobraS, 1);
  igual(app.oQueValem([6, 6, 6, 2, 4]), "Três 6 → 18, na coluna S\nSoma dos dados: 24");
  naTabela(soSobraS, 2);
  igual(app.oQueValem([6, 6, 6, 2, 4]), "Soma dos dados: 24");
});

// Para TODAS as 7.776 jogadas possíveis, com a tabela vazia e no meio de um
// jogo: tudo o que a janela dos dados mostra pode mesmo ser marcado.
test("o que os dados mostram sempre pode ser marcado na tabela", () => {
  const linhaDa = { YAM: 15, Q: 9, F: 10, "S-": 11, "S+": 12 };
  const QUANTOS = { Um: 1, Dois: 2, "Três": 3 };
  const meioDoJogo = { "0-0": "2", "1-0": "4", "2-0": "6", "0-2": "3", "5-2": "12", "10-2": "49", "15-3": "0", "4-3": "20" };
  const sugestaoRe = /^(Um|Dois|Três) (\d) → (\d+), na (.+?)( \(garante o bônus\))?$/;
  for (const tabela of [{}, meioDoJogo]) {
    naTabela(tabela);
    const livres = (linha, valor) => JSON.parse(JSON.stringify(app.colunasLivres(linha, valor)));
    for (let n = 0; n < 6 ** 5; n++) {
      const dados = [0, 1, 2, 3, 4].map(i => 1 + Math.floor(n / 6 ** i) % 6);
      const linhas = app.oQueValem(dados).split("\n");
      const soma = Number(linhas.pop().replace("Soma dos dados: ", ""));
      assert.equal(soma, dados.reduce((a, b) => a + b, 0));
      if (!linhas.length) continue;
      const sugestao = linhas[0].match(sugestaoRe);
      if (sugestao) {
        const face = Number(sugestao[2]);
        const valor = Number(sugestao[3]);
        assert.equal(dados.filter(d => d === face).length, QUANTOS[sugestao[1]], `${dados}: ${linhas[0]}`);
        assert.equal(valor, face * QUANTOS[sugestao[1]]);
        const col = app.NOMES_COLUNAS.indexOf(sugestao[4]);
        assert.ok(livres(face - 1, valor).includes(col), `${dados}: ${linhas[0]}`);
      } else {
        for (const item of linhas[0].split(" · ")) {
          const [nome, valor] = item.split(" ");
          assert.ok(livres(linhaDa[nome], Number(valor)).length > 0, `${dados}: ${item}`);
        }
      }
    }
  }
});

// ---------- marcar pelos dados ----------

test("quanto a jogada vale em cada linha", () => {
  const vale = (linha, dados) => app.valorDaJogada(linha, dados);
  assert.equal(vale(2, [3, 3, 3, 5, 5]), 9);
  assert.equal(vale(0, [3, 3, 3, 5, 5]), null, "sem 1, não vale na linha do 1");
  assert.equal(vale(10, [3, 3, 3, 5, 5]), 49);
  assert.equal(vale(9, [5, 5, 5, 5, 2]), 40);
  assert.equal(vale(9, [5, 5, 5, 5, 5]), null, "cinco iguais não é Quadra");
  assert.equal(vale(10, [5, 5, 5, 5, 5]), null, "nem Full");
  assert.equal(vale(15, [5, 5, 5, 5, 5]), 75);
  assert.equal(vale(11, [4, 2, 5, 1, 3]), 50);
  assert.equal(vale(12, [4, 2, 5, 6, 3]), 60);
  assert.equal(vale(13, [1, 1, 2, 2, 6]), 12);
  assert.equal(vale(14, [1, 1, 2, 2, 6]), 12);
});

test("casas destacadas: só as livres, na ordem, e a S só na 1ª jogada", () => {
  naTabela({}, 1);
  const casas = JSON.parse(JSON.stringify(app.casasParaMarcar([3, 3, 3, 5, 5])));
  assert.equal(casas["10-2"], 49, "Full na D");
  assert.equal(casas["10-3"], 49, "Full na S (1ª jogada)");
  assert.equal(casas["2-2"], 9);
  assert.equal(casas["13-2"], 19);
  assert.equal(casas["10-0"], undefined, "descida ainda está no 1");
  assert.equal(casas["10-1"], undefined, "subida só depois da descida");
  assert.equal(casas["0-2"], undefined, "sem 1 nos dados");
  naTabela({ "10-2": "45" }, 2);
  const depois = JSON.parse(JSON.stringify(app.casasParaMarcar([3, 3, 3, 5, 5])));
  assert.equal(depois["10-2"], undefined, "casa já preenchida");
  assert.equal(depois["10-3"], undefined, "S só na 1ª jogada");
});

test("tocar na casa marca o valor, e dá para desfazer", () => {
  naTabela({}, 1);
  rodar("mesa.valores = [3, 3, 3, 5, 5]; limparJogadas()");
  app.marcarPelosDados();
  assert.ok(rodar("casasMarcaveis !== null"), "entrou no modo de marcar");
  app.marcarCasa("10-2", 49);
  assert.equal(app.state["10-2"], "49");
  assert.ok(rodar("casasMarcaveis === null"), "saiu do modo de marcar");
  assert.equal(rodar("dadosParaNovaVez"), true, "a próxima vez dos dados começa do zero");
  app.desfazer();
  assert.equal(app.state["10-2"], undefined);
});

test("riscar pelos dados: destaca as casas vazias e risca com um toque", () => {
  naTabela({ "0-0": "2", "10-2": "49" }, 2);
  rodar("mesa.valores = [3, 3, 3, 5, 5]; limparJogadas()");
  app.marcarPelosDados(true);
  const casas = JSON.parse(JSON.stringify(rodar("casasMarcaveis")));
  assert.equal(Object.keys(casas).length, 13 * 4 - 2, "todas as casas vazias");
  assert.equal(casas["0-0"], undefined, "a preenchida fica de fora");
  assert.equal(casas["15-1"], 0, "riscar pode fora da ordem da subida");
  assert.equal(casas["9-3"], 0, "e na S depois da 1ª jogada");
  app.marcarCasa("15-1", 0);
  assert.equal(app.state["15-1"], "0");
  assert.equal(app.calcularTotais(app.state).calculados["16-1"], 0);
  app.desfazer();
  assert.equal(app.state["15-1"], undefined);
});

test("jogada que não cabe em lugar nenhum já abre riscando", () => {
  // só sobra o YAM da coluna D, e os dados não fazem YAM
  const quase = {};
  for (const l of app.LINHAS_JOGO) for (const c of [0, 1, 2, 3]) quase[`${l}-${c}`] = "0";
  delete quase["15-2"];
  naTabela(quase, 3);
  rodar("mesa.valores = [1, 2, 3, 4, 6]");
  app.marcarPelosDados();
  igual(rodar("casasMarcaveis"), { "15-2": 0 });
  assert.equal(rodar("riscandoPelosDados"), true);
  app.sairDoModoMarcar();
});

test("sorteio: só sai de 1 a 6, e sai de tudo", () => {
  const vezes = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) vezes[app.sortearFace()]++;
  assert.equal(vezes[0], 0);
  for (let f = 1; f <= 6; f++) assert.ok(vezes[f] > 800, `face ${f} saiu ${vezes[f]} vezes`);
});

test("rolar e segurar: até 3 jogadas por vez", async () => {
  naTabela();
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
