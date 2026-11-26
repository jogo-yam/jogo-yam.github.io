// Mesas (skins): cada cor da lista do app tem as cores no CSS, no claro e no
// escuro, e é aceita pelo script que aplica a mesa antes de desenhar a página.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, lerArquivo } = require("./carregar-app.js");

const css = lerArquivo("style.css");
const html = lerArquivo("index.html");
const { rodar } = carregarApp();

const mesas = JSON.parse(rodar("JSON.stringify(Object.keys(MESAS))"));

test("a verde é a padrão e há outras para escolher", () => {
  assert.equal(mesas[0], "verde");
  assert.ok(mesas.length >= 2);
});

test("cada mesa tem cores no claro e no escuro (tema do celular e escolhido)", () => {
  for (const m of mesas.filter(m => m !== "verde")) {
    for (const sel of [`:root[data-mesa="${m}"] {`, `:root[data-mesa="${m}"]:not([data-theme="light"]) {`,
      `:root[data-mesa="${m}"][data-theme="dark"] {`]) {
      const i = css.indexOf(sel);
      assert.ok(i >= 0, `falta ${sel}`);
      const bloco = css.slice(i, css.indexOf("}", i));
      for (const v of ["--destaque:", "--destaque-borda:", "--destaque-suave:", "--acento:"]) {
        assert.ok(bloco.includes(v), `${sel} sem ${v}`);
      }
    }
  }
});

test("o script do começo da página aceita todas as mesas (e só elas)", () => {
  const lista = html.match(/\^\(([a-z|]+)\)\$/);
  assert.ok(lista, "regex das mesas no index.html");
  assert.deepEqual(lista[1].split("|").sort(), mesas.filter(m => m !== "verde").sort());
});

test("sem textura: o CSS deixa o feltro liso e a página aplica a escolha antes de desenhar", () => {
  assert.ok(css.includes(':root[data-textura="nao"][data-mesa] { --textura-mesa: none; }'));
  assert.ok(html.includes('const textura = guardada === "0" ? "nao"'));
});

test("texturas: cada uma tem CSS e o começo da página aceita todas (e só elas)", () => {
  const texturas = JSON.parse(rodar("JSON.stringify(Object.keys(TEXTURAS))"));
  assert.equal(texturas[0], "feltro");
  assert.ok(!texturas.includes("padrao"), "a textura é sempre escolha da pessoa");
  for (const t of texturas) assert.ok(css.includes(`:root[data-textura="${t}"][data-mesa] {`), `falta a textura ${t}`);
  const lista = html.match(/\^\((feltro[a-z|]*)\)\$/);
  assert.ok(lista, "regex das texturas no index.html");
  assert.deepEqual(lista[1].split("|").sort(), texturas.slice().sort());
});

test("textura da nuvem: o nome vale; o ligada/desligada do app antigo manda quando discorda", () => {
  assert.equal(rodar('texturaDaNuvem(true, "couro")'), "couro");
  assert.equal(rodar('texturaDaNuvem(false, "nao")'), "nao");
  assert.equal(rodar('texturaDaNuvem(false, "couro")'), "nao", "o app antigo desligou depois");
  assert.equal(rodar('texturaDaNuvem(true, "nao")'), "feltro", "o app antigo ligou depois");
  assert.equal(rodar('texturaDaNuvem(true)'), "feltro");
  assert.equal(rodar('texturaDaNuvem(true, undefined, "madeira")'), "madeira", "quem nunca escolheu fica com o que via");
  assert.equal(rodar('texturaDaNuvem(true, "padrao", "preto")'), "losangos");
  assert.equal(rodar('texturaDaNuvem(true, "dourado", "azul")'), "losangos");
  assert.equal(rodar('texturaDaNuvem(undefined, "losangos")'), "losangos");
  assert.equal(rodar('texturaDaNuvem(undefined, "bobagem")'), null);
});

test("cores dos dados: marfim é o padrão, cada outra tem cores no CSS e o começo da página aceita", () => {
  const dados = JSON.parse(rodar("JSON.stringify(Object.keys(DADOS))"));
  assert.equal(dados[0], "marfim");
  for (const d of dados.slice(1)) {
    const i = css.indexOf(`:root[data-dados="${d}"] {`);
    assert.ok(i >= 0, `falta a cor dos dados ${d} no CSS`);
    const bloco = css.slice(i, css.indexOf("}", i));
    for (const v of ["--dado:", "--dado-fundo:", "--dado-sombra:", "--dado-pinta:"]) assert.ok(bloco.includes(v), `${d} sem ${v}`);
  }
  const lista = html.match(/\^\((vermelho[a-z|]*)\)\$/);
  assert.ok(lista, "regex dos dados no index.html");
  assert.deepEqual(lista[1].split("|").sort(), dados.slice(1).sort());
});

test("avatar: a mesma pessoa sem mesa conhecida tem sempre a mesma cor; com mesa, a da mesa", () => {
  assert.equal(rodar('mesaDoJogador("Giovana")'), rodar('mesaDoJogador("giovana")'));
  assert.equal(rodar('mesaDoJogador("Giovana", "roxo")'), "roxo");
  // as mesas novas não mudam a cor de quem já aparecia (sem mesa conhecida)
  assert.ok(JSON.parse(rodar("JSON.stringify(MESAS_DO_NOME)")).every(m => rodar(`mesaValida("${m}")`)));
  assert.deepEqual(JSON.parse(rodar("JSON.stringify(MESAS_DO_NOME)")), ["verde", "azul", "vinho", "roxo", "madeira", "preto"]);
  assert.equal(rodar('inicialDe(" vó Lúcia")'), "V");
});

test("dados de quem está jogando: na cor que a pessoa escolheu (desconhecida = marfim)", () => {
  const cores = JSON.parse(rodar(`(() => {
    const caixa = { style: { v: {}, setProperty(k, valor) { this.v[k] = valor; } } };
    const ver = n => { pintarDadosDoOutro(caixa, n); return [caixa.style.v["--dado"], caixa.style.v["--dado-pinta"]]; };
    return JSON.stringify({ roxo: ver("roxo"), antigo: ver(undefined), marfim: ver("marfim") });
  })()`));
  assert.deepEqual(cores.roxo, ["#5b2f9a", "#fffaf0"]);
  assert.deepEqual(cores.antigo, ["var(--marfim)", "var(--pinta)"]);
  assert.deepEqual(cores.marfim, cores.antigo);
});
