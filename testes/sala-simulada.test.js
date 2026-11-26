// A sala de ponta a ponta, com três celulares de mentira (app.js + familia.js de
// verdade) e um Firebase na memória: jogar na vez, desistir, pausar e voltar.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Banco, celular, assentar } = require("./sala-simulada.js");

// Ana cria (com vez), Bia e Caio entram, Ana começa.
async function salaComTres(banco) {
  const ana = celular(banco, "uidAna", "Ana");
  const codigo = await ana.familia('criar("Ana", "vez", false)');
  const bia = celular(banco, "uidBia", "Bia");
  const caio = celular(banco, "uidCaio", "Caio");
  await bia.familia(`entrar("${codigo}", "Bia")`);
  await caio.familia(`entrar("${codigo}", "Caio")`);
  await assentar();
  await ana.familia("comecarPartida()");
  await assentar();
  return { codigo, ana, bia, caio };
}

const vezEm = c => c.familia("daVez()");

test("sala simulada: a vez anda na ordem de entrada", async () => {
  const banco = new Banco();
  const { ana, bia, caio } = await salaComTres(banco);
  assert.equal(vezEm(ana), "uidAna");
  ana.marcar("0-0", 3);
  await assentar();
  assert.equal(vezEm(bia), "uidBia", "depois de Ana, Bia");
  bia.marcar("0-0", 2);
  await assentar();
  assert.equal(vezEm(ana), "uidCaio", "depois de Bia, Caio");
  assert.equal(caio.familia("nomeDe(daVez())"), "Caio");
});

for (const regras of [true, false]) {
  test(`sala simulada: quem desiste e deixa um "fantasma" não trava a vez (${regras ? "com" : "sem"} a regra nova)`, async () => {
    const banco = new Banco({ regras });
    const { codigo, ana, bia, caio } = await salaComTres(banco);
    ana.marcar("0-0", 3);
    await assentar();
    // Caio desiste (Sair → Desistir → confirma)
    caio.responder("outro", true);
    assert.equal(await caio.familia("sairPerguntando()"), true);
    await assentar();
    assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidCaio`), null, "saiu da sala");
    // depois, o celular dele grava atrasado só o "app fechou"
    try { banco.gravar("uidCaio", { [`partidas/${codigo}/jogadores/uidCaio/aberto`]: false }); } catch { /* recusado */ }
    await assentar();
    const fantasma = banco.ler(`partidas/${codigo}/jogadores/uidCaio`);
    if (regras) assert.equal(fantasma, null, "a regra nova recusa jogador sem nome");
    else assert.deepEqual(fantasma, { aberto: false }, "sem a regra, o fantasma aparece no banco");
    // de todo jeito, ele não conta: a vez segue entre Ana e Bia
    assert.equal(ana.familia("jogadoresDe(partida).length"), 2);
    assert.equal(vezEm(ana), "uidBia");
    bia.marcar("0-0", 2);
    await assentar();
    assert.equal(vezEm(ana), "uidAna", "volta para Ana, não para o fantasma");
    assert.equal(ana.familia("nomeDe(daVez())"), "Ana");
  });
}

test("sala simulada: pausar pelo botão de baixo, voltar e chamar quem ainda está fora", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  ana.marcar("0-0", 3);
  await assentar();
  bia.marcar("0-0", 2);
  await assentar();

  // Bia toca em "Sair da sala" (o botão de baixo) e escolhe Pausar
  bia.responder(true);
  await bia.rodar("novoJogo()");
  await assentar();
  assert.ok(bia.perguntas.includes("Sair da partida?"), "perguntou se é pausa ou desistência");
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidBia/fora`), true, "continua na sala, como fora");
  const pausada = bia.rodar(`historico.find(p => p.codigoSala === "${codigo}")`);
  assert.ok(pausada, "a tabela dela ficou em pausa no histórico, com a sala");
  assert.equal(bia.rodar("casasMarcadas()"), 0, "e a tabela zerou para outra partida");
  assert.equal(ana.familia("pausada()"), true, "para os outros, a partida está pausada");

  // Caio também pausa (pelo Sair de cima)
  caio.responder(true);
  await caio.familia("confirmarSair()");
  await assentar();

  // Bia volta: a tabela da sala volta e ela entra de novo
  await bia.rodar(`continuarPartida(${pausada.id})`);
  await bia.familia(`entrar("${codigo}", "Bia")`);
  await assentar();
  assert.equal(bia.rodar("casasMarcadas()"), 1, "a tabela da sala voltou como estava");
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidBia/fora`), null);
  const chamado = bia.enviados.find(e => e.url.endsWith("/pausa"));
  assert.ok(chamado, "pediu ao servidor para chamar quem ainda está fora");
  assert.equal(chamado.corpo.motivo, "voltou");
  assert.equal(ana.familia("pausada()"), true, "Caio ainda está fora");

  // Caio volta: a partida segue, na vez dele
  await caio.familia(`entrar("${codigo}", "Caio")`);
  await assentar();
  assert.equal(ana.familia("pausada()"), false);
  assert.equal(vezEm(ana), "uidCaio");
});

test("sala simulada: os dados de quem está jogando vão com a cor que a pessoa escolheu", async () => {
  const banco = new Banco();
  const { codigo, ana } = await salaComTres(banco);
  ana.rodar('escolherDados("roxo")');
  await assentar();
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidAna/corDados`), "roxo");
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidBia/corDados`), "marfim", "quem não escolheu: marfim");
});

test("sala simulada: quem teve a vez pulada com o app fechado fica sabendo ao voltar", async () => {
  const banco = new Banco();
  const { codigo, ana, bia } = await salaComTres(banco);
  ana.marcar("0-0", 3);
  await assentar();
  assert.equal(vezEm(ana), "uidBia");
  bia.fechar();
  await ana.familia('pularVez("uidBia", true)');
  await assentar();
  assert.equal(vezEm(ana), "uidCaio", "a vez passou para Caio");
  assert.ok(!bia.legendas.some(([titulo]) => titulo === "Sua vez foi pulada"), "com o app fechado, Bia não viu o aviso");
  // Bia abre o app de novo (mesmo celular, com o que estava guardado)
  const biaDeNovo = celular(banco, "uidBia", "Bia", { guardado: bia.armazenado });
  await assentar();
  const aviso = biaDeNovo.legendas.find(([titulo]) => titulo === "Sua vez foi pulada");
  assert.ok(aviso, "ao voltar, vê que a vez foi pulada");
  assert.match(aviso[1], /Enquanto você estava fora, Ana passou a sua vez\. Você joga essa vez no final da partida\./);
  // abrir de novo não repete o aviso
  biaDeNovo.fechar();
  const biaOutraVez = celular(banco, "uidBia", "Bia", { guardado: biaDeNovo.armazenado });
  await assentar();
  assert.ok(!biaOutraVez.legendas.some(([titulo]) => titulo === "Sua vez foi pulada"));
});

test("sala simulada: vez parada 5 min com a pessoa fora do app, quem criou é perguntado se pula", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  ana.marcar("0-0", 3);
  await assentar();
  assert.equal(vezEm(ana), "uidBia");
  // Bia fecha o app (o Firebase grava aberto: false) e some
  banco.gravar("uidBia", { [`partidas/${codigo}/jogadores/uidBia/aberto`]: false });
  await assentar(700); // a conferência (a cada 30 s) já rodou: parada há pouco, não pergunta
  assert.ok(!ana.perguntas.includes("Pular a vez de Bia?"));
  // passam 5 min (os relógios dos timers andam rápido, mas a hora não: volta o começo da espera)
  ana.familia("vezParada.desde -= 5 * 60 * 1000");
  caio.familia("vezParada.desde -= 5 * 60 * 1000");
  await assentar(700); // Ana é perguntada (e responde Pular)
  assert.ok(!caio.perguntas.includes("Pular a vez de Bia?"), "só quem criou a sala pode pular");
  assert.equal(ana.perguntas.filter(t => t === "Pular a vez de Bia?").length, 1, "pergunta uma vez só");
  await assentar();
  assert.equal(vezEm(caio), "uidCaio", "a vez passou para Caio");
});
