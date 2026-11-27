// Primeiro uso (boas-vindas) e preferência de som.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { carregarApp, qualquerCoisa } = require("./carregar-app.js");

test("boas-vindas aparecem só para quem nunca usou o app", () => {
  const mostra = armazenado => carregarApp({ armazenado }).app.deveMostrarBoasVindas();
  assert.equal(mostra({}), true, "celular novo");
  assert.equal(mostra({ "yam-boas-vindas": "1" }), false, "já viu");
  assert.equal(mostra({ "yam-nome": JSON.stringify("Maria") }), false, "já tem nome");
  assert.equal(mostra({ "yam": JSON.stringify({ "0-0": "3" }) }), false, "jogo em andamento");
  assert.equal(mostra({ "yam-historico": JSON.stringify([{ id: 1, data: "2026-11-01T10:00:00Z", total: 0, valores: {} }]) }),
    false, "já tem partidas");
});

test("som: começa ligado e desligar fica guardado", () => {
  const { app, rodar, armazenado } = carregarApp();
  assert.equal(rodar("somLigado"), true);
  app.alternarSom();
  assert.equal(rodar("somLigado"), false);
  assert.equal(armazenado.get("yam-som"), "0");
  assert.equal(carregarApp({ armazenado: { "yam-som": "0" } }).rodar("somLigado"), false);
});

test("o link de convite abre nas boas-vindas", () => {
  const { rodar } = carregarApp();
  assert.match(rodar("LINK_CONVITE"), /#bem-vindo$/);
});

test("como instalar: aparece uma vez só, no primeiro uso, se o app não estiver instalado", () => {
  const { app, armazenado } = carregarApp();
  assert.equal(app.deveMostrarGuiaInstalar(), true, "primeira vez, no navegador");
  assert.equal(armazenado.get("yam-guia-instalar"), "1");
  assert.equal(app.deveMostrarGuiaInstalar(), false, "não aparece de novo");
  assert.equal(carregarApp({ armazenado: { "yam-guia-instalar": "1" } }).app.deveMostrarGuiaInstalar(), false, "já viu");

  const instalado = carregarApp();
  instalado.rodar("navigator.standalone = true");
  assert.equal(instalado.app.deveMostrarGuiaInstalar(), false, "já abriu pelo ícone");
});

// Um "navegador" com áudio de mentira: guarda quem ouve cada evento da página,
// os relógios (para rodar na mão) e cada áudio criado.
function comAudio() {
  const ouvintes = {};
  const pagina = { visibilidade: "visible" };
  const base = qualquerCoisa();
  const document = new Proxy(base, {
    get(t, p) {
      if (p === "addEventListener") return (tipo, f) => { (ouvintes[tipo] ||= []).push(f); };
      if (p === "visibilityState") return pagina.visibilidade;
      return t[p];
    }
  });
  const relogios = [];
  const criados = [];
  class Contexto {
    constructor() {
      Object.assign(this, { state: "running", currentTime: 0, sampleRate: 44100, usos: 0, retomadas: 0 });
      const comoAudio = new Proxy(this, {
        get(t, p) {
          if (typeof p === "string" && p.startsWith("create")) return () => { t.usos++; return qualquerCoisa(); };
          return t[p];
        }
      });
      criados.push(comoAudio);
      return comoAudio;
    }
    resume() { this.retomadas++; return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  const { app, rodar } = carregarApp({ extras: {
    document, AudioContext: Contexto, AudioBuffer: class {},
    setTimeout: (f, ms) => relogios.push({ f, ms }), clearTimeout() {}
  } });
  const disparar = tipo => (ouvintes[tipo] || []).forEach(f => f({ touches: [], changedTouches: [], target: { closest: () => null } }));
  const passar = ms => relogios.splice(0).forEach(r => (r.ms === ms ? r.f() : relogios.push(r)));
  const sair = () => { pagina.visibilidade = "hidden"; disparar("visibilitychange"); };
  const voltar = () => { pagina.visibilidade = "visible"; disparar("visibilitychange"); };
  return { app, rodar, criados, disparar, passar, sair, voltar };
}

test("som: depois de minimizar, o primeiro toque troca o áudio por um novo (o iPhone diz que está tocando, mas está mudo)", () => {
  const { app, rodar, criados, disparar, passar, sair, voltar } = comAudio();
  app.tocar("marcar");
  assert.equal(criados.length, 1);
  disparar("touchend");
  assert.equal(criados.length, 1, "sem minimizar: o mesmo áudio");

  sair();
  voltar();
  assert.equal(criados[0].state, "running", "o iPhone devolve dizendo que está tocando");
  disparar("touchend");
  assert.equal(criados.length, 2, "primeiro toque depois de voltar: áudio novo");
  assert.ok(rodar("audio") === criados[1]);
  assert.ok(criados[1].usos > 0, "com um instante de silêncio para a saída de som começar");
  assert.notEqual(criados[0].state, "closed", "o antigo ainda deixa terminar o som que já começou");
  passar(1500);
  assert.equal(criados[0].state, "closed", "e depois fecha");

  const usos = criados[1].usos;
  app.tocar("marcar");
  assert.ok(criados[1].usos > usos, "o som sai pelo áudio novo");
  disparar("click");
  disparar("touchend");
  assert.equal(criados.length, 2, "os outros toques não trocam de novo");

  criados[1].currentTime = 0.6; // andou: está tocando de verdade
  passar(600);
  disparar("touchend");
  assert.equal(criados.length, 2);
});

test("som: se o áudio novo não andar, o próximo toque tenta outro", () => {
  const { app, criados, disparar, passar, sair, voltar } = comAudio();
  app.tocar("marcar");
  sair();
  voltar();
  disparar("touchend");
  assert.equal(criados.length, 2);
  passar(600); // o relógio do novo não saiu do lugar
  disparar("touchend");
  assert.equal(criados.length, 3, "troca de novo");

  // parado ("suspended" ou "interrupted") sem ter minimizado: o toque retoma
  criados[2].currentTime = 1;
  passar(600);
  criados[2].state = "interrupted";
  disparar("touchend");
  assert.equal(criados.length, 3);
  assert.equal(criados[2].retomadas > 0, true, "retomou dentro do toque");
});

test("som: desligar e ligar de novo em Mais começa com um áudio novo", () => {
  const { app, criados, sair, voltar, disparar } = comAudio();
  app.tocar("marcar");
  app.alternarSom();
  assert.equal(criados[0].state, "closed");
  sair();
  voltar();
  disparar("touchend");
  assert.equal(criados.length, 1, "desligado: nada de áudio");
  app.alternarSom();
  assert.equal(criados.length, 2, "ligou: áudio novo (e a amostra do som)");
  disparar("touchend");
  assert.equal(criados.length, 2);
});
