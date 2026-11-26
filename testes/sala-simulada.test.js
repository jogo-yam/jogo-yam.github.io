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

const { tabelaCompleta } = require("./carregar-app.js");
const completar = c => c.rodar(`state = ${JSON.stringify(tabelaCompleta())}; avisarSala();`);

test("sala simulada: pulo desfeito volta a vez; depois de alguém jogar, não dá mais", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  ana.marcar("0-0", 3);
  await assentar();
  await ana.familia('pularVez("uidBia", true)');
  await assentar();
  assert.equal(vezEm(ana), "uidCaio");
  assert.equal(caio.familia("JSON.stringify(noFinal())"), '{"uidBia":1}', "Bia aparece com +1 no final");
  const aviso = ana.legendas.find(([t]) => t === "Você pulou a vez de Bia");
  assert.ok(aviso && aviso.acao && aviso.acao.texto === "Desfazer", "o aviso do pulo tem Desfazer");
  await aviso.acao.fazer();
  await assentar();
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidAna/pulos/uidBia`), 0);
  assert.equal(vezEm(caio), "uidBia", "a vez voltou para Bia");
  assert.equal(caio.familia("JSON.stringify(noFinal())"), "{}");

  // pula de novo, Caio joga, e aí o Desfazer não vale mais
  await ana.familia('pularVez("uidBia", true)');
  await assentar();
  const outro = ana.legendas.filter(([t]) => t === "Você pulou a vez de Bia").pop();
  caio.marcar("0-0", 1);
  await assentar();
  await outro.acao.fazer();
  await assentar();
  assert.ok(ana.perguntas.includes("Não dá mais para desfazer"));
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidAna/pulos/uidBia`), 1, "o pulo continua");
});

test("sala simulada: a regra nova recusa números estranhos na vez (casas negativas)", async () => {
  const banco = new Banco();
  const { codigo } = await salaComTres(banco);
  assert.throws(() => banco.gravar("uidBia", { [`partidas/${codigo}/jogadores/uidBia/casas`]: -100 }), /PERMISSION_DENIED/);
  assert.throws(() => banco.gravar("uidAna", { [`partidas/${codigo}/jogadores/uidAna/pulos/uidBia`]: 1.5 }), /PERMISSION_DENIED/);
  banco.gravar("uidBia", { [`partidas/${codigo}/jogadores/uidBia/casas`]: 3 }); // normal: aceita
});

test("sala simulada: seguir sem quem pausou e terminar com pódio", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  ana.marcar("0-0", 3);
  await assentar();
  bia.responder(true); // Sair → Pausar
  await bia.familia("confirmarSair()");
  await assentar();
  assert.equal(ana.familia("pausada()"), true);
  await ana.familia("continuarSemQuemFalta()"); // Ana (criou) segue sem Bia
  await assentar();
  assert.equal(ana.familia("pausada()"), false, "a partida segue");
  assert.equal(vezEm(ana), "uidCaio", "a vez pula Bia");
  // Ana e Caio terminam: o pódio sai sem esperar Bia
  completar(ana);
  completar(caio);
  await assentar(250);
  assert.equal(banco.ler(`partidas/${codigo}/revelada`), true, "todos (menos quem foi dispensado) terminaram");
  assert.equal(ana.familia("podioMostrado"), true);
  // Bia tenta voltar: fica sabendo que seguiram sem ela
  await bia.familia(`voltarParaSala("${codigo}")`);
  assert.ok(bia.legendas.some(([t]) => t === "A partida continuou sem você"));
});

test("sala simulada: revanche depois do pódio (um chama, o outro entra)", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  for (const c of [ana, bia, caio]) completar(c);
  await assentar(250);
  assert.equal(banco.ler(`partidas/${codigo}/revelada`), true);
  await ana.familia("jogarDeNovo()");
  await assentar();
  const nova = ana.familia("sessao && sessao.codigo");
  assert.ok(nova && nova !== codigo, "Ana criou outra sala");
  assert.equal(banco.ler(`partidas/${codigo}/jogadores/uidAna/revanche`), nova, "e avisou na sala antiga");
  assert.equal(bia.familia("JSON.stringify(revancheDeOutro())"), JSON.stringify({ codigo: nova, nome: "Ana" }));
  await bia.familia("jogarDeNovo()");
  await assentar();
  assert.equal(bia.familia("sessao.codigo"), nova, "Bia entrou na revanche");
  assert.deepEqual(Object.keys(banco.ler(`partidas/${nova}/jogadores`)).sort(), ["uidAna", "uidBia"]);
  assert.equal(banco.ler(`partidas/${nova}/iniciada`), false, "a revanche começa na sala de espera");
  assert.equal(bia.rodar("casasMarcadas()"), 0, "com a tabela zerada");
});

// A pessoa com nome de usuário: o celular dela é o dono do nome (como ao registrar).
function comNomeDeUsuario(banco, c) {
  const chave = c.nome.toLowerCase();
  banco.gravar(c.uid, { [`usuarios/${chave}`]: { dono: c.uid, nome: c.nome } });
  c.rodar(`localStorage.setItem("yam-usuario", JSON.stringify({ nome: "${c.nome}", chave: "${chave}", codigo: "1234-5678" }))`);
}

test("sala simulada: Bia pausa no celular e continua a partida no tablet, no mesmo lugar", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  comNomeDeUsuario(banco, bia);
  ana.marcar("0-0", 3);
  await assentar();
  bia.marcar("0-0", 2);
  await assentar();
  bia.responder(true); // Sair → Pausar
  await bia.familia("confirmarSair()");
  await assentar();
  const pausada = bia.rodar(`historico.find(p => p.codigoSala === "${codigo}")`);
  assert.equal(ana.familia("pausada()"), true);

  // o tablet: recuperou o nome com o código (vira o dono) e o histórico veio da nuvem
  const tablet = celular(banco, "uidBiaTablet", "Bia");
  tablet.rodar(`localStorage.setItem("yam-historico", ${JSON.stringify(bia.armazenado.get("yam-historico"))}); historico = ler("yam-historico", [])`);
  comNomeDeUsuario(banco, tablet);
  await tablet.rodar(`continuarPartida(${pausada.id})`);
  await tablet.familia(`entrar("${codigo}", "Bia")`);
  await assentar();

  assert.equal(banco.ler(`partidas/${codigo}/nomes/bia`), "uidBiaTablet", "o nome na sala passou para o tablet");
  assert.equal(ana.familia("jogadoresDe(partida).map(j => j.nome).sort().join()"), "Ana,Bia,Caio", "Bia aparece uma vez só");
  assert.equal(ana.familia("pausada()"), false, "Bia voltou: a partida segue");
  assert.equal(tablet.rodar("casasMarcadas()"), 1, "com a tabela dela");
  assert.equal(vezEm(ana), "uidCaio", "a vez continua de onde estava");
  caio.marcar("0-0", 1);
  await assentar();
  ana.marcar("1-0", 6);
  await assentar();
  assert.equal(vezEm(ana), "uidBiaTablet", "e chega em Bia, agora no tablet, na ordem de sempre");

  // o celular antigo não consegue mais entrar no lugar dela (o nome de usuário é do tablet)
  await assert.rejects(bia.familia(`entrar("${codigo}", "Bia")`), /Já tem alguém chamado "Bia"/);
});

test("sala simulada: continuando em outro aparelho sem pausar, o aparelho antigo sai sozinho", async () => {
  const banco = new Banco();
  const { codigo, ana, caio } = await salaComTres(banco);
  comNomeDeUsuario(banco, caio);
  const notebook = celular(banco, "uidCaioNote", "Caio");
  comNomeDeUsuario(banco, notebook);
  await notebook.familia(`entrar("${codigo}", "Caio")`);
  await assentar();
  assert.ok(caio.legendas.some(([t]) => t === "Partida continuada em outro aparelho"), "o celular antigo avisa");
  assert.equal(caio.familia("sessao"), null, "e sai da sala");
  assert.equal(ana.familia("jogadoresDe(partida).length"), 3);
  assert.equal(notebook.familia("sessao.codigo"), codigo);
});

test("sala simulada: quem criou continua no tablet e segue no comando (pular, seguir sem, encerrar)", async () => {
  const banco = new Banco();
  const { codigo, ana, bia, caio } = await salaComTres(banco);
  assert.equal(banco.ler(`abertas/${codigo}`), true, "a sala entrou na lista de salas abertas");
  ana.marcar("0-0", 3);
  await assentar();
  await ana.familia('pularVez("uidBia", true)'); // Bia joga essa vez no final
  await assentar();
  comNomeDeUsuario(banco, ana);
  const tablet = celular(banco, "uidAnaTablet", "Ana");
  comNomeDeUsuario(banco, tablet);
  await tablet.familia(`entrar("${codigo}", "Ana")`);
  await assentar();
  assert.equal(banco.ler(`partidas/${codigo}/criador`), "uidAnaTablet", "o tablet virou quem criou");
  assert.equal(ana.familia("sessao"), null, "o celular antigo saiu");
  assert.equal(caio.familia("JSON.stringify(noFinal())"), '{"uidBia":1}', "o pulo da Bia continua valendo");
  assert.equal(vezEm(caio), "uidCaio");
  assert.equal(vezEm(tablet), "uidCaio");
  // no tablet, Ana pula a vez do Caio (só quem criou pode)
  await tablet.familia('pularVez("uidCaio", true)');
  await assentar();
  assert.equal(vezEm(bia), "uidAnaTablet", "a vez passou para Ana, no tablet");
  // alguém que não é a Ana não consegue virar quem criou
  const intruso = celular(banco, "uidX", "Xis");
  await assert.rejects(intruso.familia(`(async () => { await usuario(); await set(ref(db, "partidas/${codigo}/criador"), "uidX"); })()`));
  assert.equal(banco.ler(`partidas/${codigo}/criador`), "uidAnaTablet");
});

test("sala simulada: sala de antes da lista de abertas entra nela quando quem criou abre o app", async () => {
  const banco = new Banco();
  const { codigo, ana, bia } = await salaComTres(banco);
  banco.arvore.abertas = {}; // (como uma sala da versão 136)
  bia.fechar();
  ana.fechar();
  ana.armazenado.delete("yam-salas-na-lista"); // (a versão 136 não tinha essa marca)
  const biaDeNovo = celular(banco, "uidBia", "Bia", { guardado: bia.armazenado });
  await assentar(250);
  assert.equal(banco.ler(`abertas/${codigo}`), null, "quem só entrou não põe");
  const anaDeNovo = celular(banco, "uidAna", "Ana", { guardado: ana.armazenado });
  await assentar(250);
  assert.equal(banco.ler(`abertas/${codigo}`), true, "quem criou põe");
  assert.equal(await anaDeNovo.familia("porSalasAntigasNaLista()"), 0, "uma vez só");
  assert.ok(biaDeNovo);
});

test("sala simulada: quem só entrou (não criou) também apaga a sala vencida ao abrir o app", async () => {
  const banco = new Banco();
  const dia = 24 * 60 * 60 * 1000;
  const { codigo, bia } = await salaComTres(banco);
  assert.ok(bia.familia("salasCriadas().some(s => s.codigo === " + JSON.stringify(codigo) + ")"), "Bia guardou a sala em que entrou");
  // passaram 4 dias: Ana (quem criou) nunca mais abriu; Bia abre o app
  bia.familia(`localStorage.setItem(CHAVE_CRIADAS, JSON.stringify([{ codigo: "${codigo}", em: ${Date.now() - 4 * dia} }]))`);
  bia.fechar();
  banco.gravar("uidAna", { [`partidas/${codigo}/criadaEm`]: Date.now() - 4 * dia }); // (a sala é de 4 dias atrás)
  const outra = await celular(banco, "uidX", "Xis").familia('criar("Xis", "livre", false)'); // sala nova, de outra pessoa
  const biaDeNovo = celular(banco, "uidBia", "Bia", { guardado: bia.armazenado });
  biaDeNovo.familia("guardarSessao(null)"); // (tinha saído da sala)
  await assentar(250); // a limpeza roda uns segundos depois de abrir
  assert.equal(banco.ler(`partidas/${codigo}`), null, "a sala vencida foi apagada");
  assert.equal(banco.ler(`abertas/${codigo}`), null, "e saiu da lista de salas abertas");
  assert.ok(banco.ler(`partidas/${outra}`), "a sala nova continua");
});
