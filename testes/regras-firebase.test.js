// As regras do Firebase (firebase-regras.json) de verdade, no simulador do
// Firebase. Só roda no GitHub (job "regras" em .github/workflows/testes.yml),
// onde o simulador sobe com:
//   npx firebase-tools emulators:exec --only database --project demo-yam "node --test testes/regras-firebase.test.js"
// Sem o simulador (node --test aqui no PC), os testes são pulados.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = "demo-yam-default-rtdb";
const pular = !HOST && "sem o simulador do Firebase (roda no GitHub)";
const DIA = 24 * 60 * 60 * 1000;

// Login de mentira: o simulador aceita um token sem assinatura.
function tokenDe(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const agora = Math.floor(Date.now() / 1000);
  return [b64({ alg: "none", typ: "JWT" }), b64({
    iss: "https://securetoken.google.com/demo-yam", aud: "demo-yam", iat: agora, exp: agora + 3600, auth_time: agora,
    sub: uid, user_id: uid, firebase: { sign_in_provider: "anonymous", identities: {} }
  }), ""].join(".");
}

async function pedir(quem, metodo, caminho, valor) {
  const r = await fetch(`http://${HOST}/${caminho}.json?ns=${NS}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${quem === "admin" ? "owner" : tokenDe(quem)}` },
    body: valor === undefined ? undefined : JSON.stringify(valor)
  });
  if (metodo === "GET" && r.ok) return r.json();
  return r.ok ? "ok" : r.status === 401 || r.status === 403 ? "negado" : `erro ${r.status}: ${await r.text()}`;
}
const gravar = (quem, caminho, valor) => pedir(quem, "PUT", caminho, valor);
const mudar = (quem, caminho, valor) => pedir(quem, "PATCH", caminho, valor);
const apagar = (quem, caminho) => pedir(quem, "DELETE", caminho);
const ler = (quem, caminho) => pedir(quem, "GET", caminho);

const segredo = () => crypto.randomBytes(32).toString("hex");
let n = 0;
const novoCodigo = () => String(10000 + (++n));

before(async () => {
  if (pular) return;
  const regras = fs.readFileSync(path.join(__dirname, "..", "firebase-regras.json"), "utf8");
  const r = await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`, {
    method: "PUT", headers: { Authorization: "Bearer owner" }, body: regras
  });
  assert.ok(r.ok, `carregar as regras: ${r.status} ${await r.text()}`);
});

// Sala com quem criou (Ana, nome de usuário "ana") e Bia dentro.
async function salaDaAna(extra = {}) {
  const codigo = novoCodigo();
  await gravar("admin", `usuarios/ana`, { dono: "uidAna", segredo: "a".repeat(64), nome: "Ana" });
  await gravar("admin", `partidas/${codigo}`, {
    criador: "uidAna", criadaEm: Date.now(), iniciada: true,
    nomes: { ana: "uidAna", bia: "uidBia" },
    jogadores: {
      uidAna: { nome: "Ana", chave: "ana", casas: 1, base: 0, entrouEm: 1 },
      uidBia: { nome: "Bia", chave: "bia", casas: 0, base: 0, entrouEm: 2 }
    },
    ...extra
  });
  return codigo;
}

test("regras: nome de usuário novo, recuperado só com o mesmo segredo", { skip: pular }, async () => {
  const s = segredo();
  assert.equal(await gravar("u1", "usuarios/carla", { dono: "u1", segredo: s, nome: "Carla" }), "ok");
  assert.equal(await gravar("u2", "usuarios/carla", { dono: "u2", segredo: segredo(), nome: "Carla" }), "negado", "sem o segredo");
  assert.equal(await gravar("u2", "usuarios/carla", { dono: "u2", segredo: s, nome: "Carla" }), "ok", "com o código");
  assert.equal(await gravar("u3", "usuarios/carla", { dono: "u2", segredo: s, nome: "Carla" }), "negado", "dono tem de ser quem grava");
  assert.equal(await gravar("u4", "usuarios/dora", { dono: "u4", segredo: "curto", nome: "Dora" }), "negado", "segredo de 64");
  assert.equal(await apagar("u1", "usuarios/carla"), "negado", "quem não é mais dono não apaga");
  assert.equal(await apagar("u2", "usuarios/carla"), "ok");
});

test("regras: cada um só grava no próprio jogador, sempre com nome e números inteiros", { skip: pular }, async () => {
  const codigo = await salaDaAna();
  const eu = `partidas/${codigo}/jogadores/uidBia`;
  assert.equal(await mudar("uidBia", eu, { casas: 2 }), "ok");
  assert.equal(await mudar("uidAna", eu, { casas: 3 }), "negado", "no jogador dos outros, não");
  assert.equal(await mudar("uidBia", eu, { casas: -1 }), "negado");
  assert.equal(await mudar("uidBia", eu, { casas: 53 }), "negado");
  assert.equal(await mudar("uidBia", eu, { base: 1.5 }), "negado");
  assert.equal(await mudar("uidBia", eu, { pulos: { uidAna: -2 } }), "negado");
  assert.equal(await gravar("uidBia", eu, { casas: 1 }), "negado", "sem nome é fantasma");
  assert.equal(await apagar("uidBia", eu), "ok", "sair da sala");
});

test("regras: o nome na sala é de quem é dono do nome de usuário (e passa para o outro aparelho)", { skip: pular }, async () => {
  const codigo = await salaDaAna();
  const nome = `partidas/${codigo}/nomes/ana`;
  assert.equal(await gravar("uidX", nome, "uidX"), "negado", "outro aparelho sem o nome de usuário");
  assert.equal(await gravar("uidX", `partidas/${codigo}/nomes/xis`, "uidX"), "negado", "entrar sem nome de usuário");
  await gravar("admin", "usuarios/ana/dono", "uidAnaTablet"); // Ana recuperou o nome no tablet
  assert.equal(await gravar("uidAnaTablet", nome, "uidAnaTablet"), "ok", "o tablet assume o nome");
  assert.equal(await gravar("uidAna", nome, "uidAna"), "negado", "o celular antigo não toma de volta");
  assert.equal(await gravar("uidAnaTablet", nome, "uidX"), "negado", "nem grava o nome para outra pessoa");
  assert.equal(await apagar("uidX", nome), "negado");
  assert.equal(await apagar("uidAnaTablet", nome), "ok");
});

test("regras: quem criou a sala passa para o outro aparelho só pelo dono do nome de usuário", { skip: pular }, async () => {
  const codigo = await salaDaAna();
  const criador = `partidas/${codigo}/criador`;
  assert.equal(await gravar("uidBia", criador, "uidBia"), "negado", "outra pessoa não vira quem criou");
  assert.equal(await mudar("uidBia", `partidas/${codigo}`, { encerrada: true }), "negado", "nem encerra");
  assert.equal(await gravar("uidAnaTablet", criador, "uidAnaTablet"), "negado", "antes de recuperar o nome de usuário");
  await gravar("admin", "usuarios/ana/dono", "uidAnaTablet");
  assert.equal(await gravar("uidAnaTablet", criador, "uidBia"), "negado", "só para si mesmo");
  assert.equal(await gravar("uidAnaTablet", criador, "uidAnaTablet"), "ok", "o tablet da Ana vira quem criou");
  assert.equal(await gravar("uidAna", criador, "uidAna"), "negado", "o celular antigo não volta a ser");
  assert.equal(await gravar("uidAnaTablet", `partidas/${codigo}/iniciada`, false), "ok", "e o tablet manda na sala");
  assert.equal(await gravar("uidAnaTablet", `partidas/${codigo}/encerrada`, true), "ok");
  assert.equal(await apagar("uidAnaTablet", criador), "negado", "ninguém apaga quem criou");
  // sala nova: o primeiro a gravar é quem criou
  const nova = novoCodigo();
  assert.equal(await gravar("uidZ", `partidas/${nova}/criador`, "uidZ"), "ok");
  assert.equal(await gravar("uidZ", `partidas/${nova}/criadaEm`, { ".sv": "timestamp" }), "ok");
  assert.equal(await gravar("uidW", `partidas/${nova}/criadaEm`, 1), "negado", "a data não muda");
});

test("regras: a sala inteira só pode ser apagada depois de 3 dias", { skip: pular }, async () => {
  const nova = await salaDaAna();
  assert.equal(await apagar("uidAna", `partidas/${nova}`), "negado");
  const velha = await salaDaAna({ criadaEm: Date.now() - 3 * DIA - 60000 });
  assert.equal(await apagar("uidQualquer", `partidas/${velha}`), "ok", "qualquer um apaga a vencida");
});

test("regras: lista de salas abertas (só quem criou põe; sai quando a sala vence ou some)", { skip: pular }, async () => {
  const codigo = await salaDaAna();
  assert.equal(await gravar("uidBia", `abertas/${codigo}`, true), "negado", "quem não criou não põe");
  assert.equal(await gravar("uidAna", `abertas/${codigo}`, "x"), "negado", "só true");
  assert.equal(await gravar("uidAna", `abertas/${codigo}`, true), "ok");
  assert.equal(await gravar("uidAna", "abertas/123", true), "negado", "código de 5 números");
  assert.deepEqual(Object.keys(await ler("uidQualquer", "abertas")).includes(codigo), true, "qualquer um com login lê a lista");
  assert.equal(await apagar("uidBia", `abertas/${codigo}`), "negado", "sala aberta fica na lista");
  await gravar("admin", `partidas/${codigo}/criadaEm`, Date.now() - 3 * DIA - 60000);
  assert.equal(await apagar("uidQualquer", `abertas/${codigo}`), "ok", "vencida: sai da lista");
  const outra = await salaDaAna();
  assert.equal(await gravar("uidAna", `abertas/${outra}`, true), "ok");
  await apagar("admin", `partidas/${outra}`);
  assert.equal(await apagar("uidQualquer", `abertas/${outra}`), "ok", "sala que sumiu: sai da lista");
});

test("regras: ranking só do dono do nome de usuário, com total possível", { skip: pular }, async () => {
  await gravar("admin", "usuarios/eva", { dono: "uidEva", segredo: "e".repeat(64), nome: "Eva" });
  const linha = total => ({ nome: "Eva", total, data: "2026-11-26" });
  assert.equal(await gravar("uidEva", "ranking/eva", linha(300)), "ok");
  assert.equal(await gravar("uidX", "ranking/eva", linha(300)), "negado");
  assert.equal(await gravar("uidEva", "ranking/eva", linha(5000)), "negado", "acima do máximo");
});

test("regras: histórico na nuvem só em cofre de 64 letras", { skip: pular }, async () => {
  const cofre = "f".repeat(64);
  assert.equal(await gravar("u1", `historicos/${cofre}/123`, { id: 123, data: "2026-11-26", total: 200 }), "ok");
  assert.equal(await gravar("u1", "historicos/curto/123", { id: 123, data: "2026-11-26", total: 200 }), "negado");
  assert.equal(await gravar("u1", `historicos/${cofre}/abc`, { id: 1, data: "x", total: 1 }), "negado", "id só números");
});

test("regras: sem login, nada", { skip: pular }, async () => {
  const r = await fetch(`http://${HOST}/abertas.json?ns=${NS}`);
  assert.equal(r.ok, false);
});
