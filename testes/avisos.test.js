// Servidor de avisos (worker/avisos.mjs): de quem é a vez, a assinatura VAPID,
// o conteúdo cifrado do push (conferido decifrando do jeito do celular) e o
// pedido "passei a vez".
const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const carregar = () => import(pathToFileURL(path.join(__dirname, "..", "worker", "avisos.mjs")).href);

// um "celular" inscrito: par de chaves ECDH P-256 e segredo de 16 bytes
function celular() {
  const ecdh = nodeCrypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url"), authBytes: auth };
}

// decifra como o navegador faz (RFC 8291 + RFC 8188), sem usar o código do servidor
function decifrar(corpo, cel) {
  const buf = Buffer.from(corpo);
  const sal = buf.subarray(0, 16);
  const idlen = buf[20];
  const publicaDoServidor = buf.subarray(21, 21 + idlen);
  const cifrado = buf.subarray(21 + idlen);
  const segredo = cel.ecdh.computeSecret(publicaDoServidor);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), cel.ecdh.getPublicKey(), publicaDoServidor]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync("sha256", segredo, cel.authBytes, info, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decifrador = nodeCrypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decifrador.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([decifrador.update(cifrado.subarray(0, cifrado.length - 16)), decifrador.final()]);
  assert.equal(claro[claro.length - 1], 2, "delimitador do último pedaço");
  return claro.subarray(0, claro.length - 1).toString("utf8");
}

function chavesVapid() {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const publica = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url");
  return { jwk, publicKey, publica };
}

test("push cifrado: o celular consegue decifrar a mensagem", async () => {
  const { cifrarPush } = await carregar();
  const cel = celular();
  const mensagem = JSON.stringify({ titulo: "Sua vez no YAM!", texto: "Maria marcou 18 no 6 na descida (↓)" });
  const corpo = await cifrarPush(mensagem, cel.p256dh, cel.auth);
  assert.equal(decifrar(corpo, cel), mensagem);
  assert.equal(Buffer.from(corpo).readUInt32BE(16), 4096, "tamanho do pedaço");
});

test("VAPID: JWT assinado com a chave privada e para o servidor de push certo", async () => {
  const { jwtVapid } = await carregar();
  const { jwk, publicKey } = chavesVapid();
  const jwt = await jwtVapid("https://web.push.apple.com/abc123", jwk, Date.parse("2026-11-18T12:00:00Z"));
  const [cab, corpo, assinatura] = jwt.split(".");
  const ok = nodeCrypto.verify("sha256", Buffer.from(`${cab}.${corpo}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(assinatura, "base64url"));
  assert.ok(ok, "assinatura confere");
  const dados = JSON.parse(Buffer.from(corpo, "base64url").toString());
  assert.equal(dados.aud, "https://web.push.apple.com");
  assert.equal(dados.exp, Date.parse("2026-11-18T12:00:00Z") / 1000 + 12 * 3600);
  assert.match(dados.sub, /^https:\/\//);
});

// ---------- o pedido "passei a vez" ----------

const tokenDe = uid => ["x", Buffer.from(JSON.stringify({ user_id: uid })).toString("base64url"), "y"].join(".");

function salaCom(extra = {}) {
  return {
    criador: "davi",
    jogadores: {
      davi: { nome: "Davi", entrouEm: 1, casas: 1, modo: "vez" },
      maria: { nome: "Maria", entrouEm: 2, casas: 0, modo: "vez", ...extra }
    }
  };
}

async function pedir(sala, uid, buscarFirebaseOk = true) {
  const { tratarVez } = await carregar();
  const { jwk, publica } = chavesVapid();
  const enviados = [];
  const buscar = async (url, opcoes) => {
    if (url.includes("firebaseio")) {
      return { ok: buscarFirebaseOk, json: async () => sala };
    }
    enviados.push({ url, opcoes });
    return { ok: true, status: 201 };
  };
  const env = { FIREBASE_DB: "https://teste.firebaseio.com", VAPID_PUBLICA: publica, VAPID_PRIVADA: JSON.stringify(jwk) };
  const r = await tratarVez({ codigo: "12345", token: tokenDe(uid), texto: "Davi marcou 1 no 1" }, env, 1000000, buscar);
  return { r, enviados };
}

test("avisa quem está na vez, com os cabeçalhos do Web Push", async () => {
  const cel = celular();
  const { r, enviados } = await pedir(salaCom({ push: { endpoint: "https://fcm.googleapis.com/wp/abc", p256dh: cel.p256dh, auth: cel.auth } }), "davi");
  assert.equal(r.status, 200, r.motivo);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].url, "https://fcm.googleapis.com/wp/abc");
  const h = enviados[0].opcoes.headers;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const dados = JSON.parse(decifrar(enviados[0].opcoes.body, cel));
  assert.equal(dados.titulo, "Sua vez no YAM!");
  assert.equal(dados.texto, "Davi marcou 1 no 1");
});

test("não avisa: sem pedir avisos, app aberto, fora da sala ou token recusado", async () => {
  const cel = celular();
  const push = { endpoint: "https://fcm.googleapis.com/wp/abc", p256dh: cel.p256dh, auth: cel.auth };
  assert.equal((await pedir(salaCom(), "davi")).enviados.length, 0, "não pediu avisos");
  assert.equal((await pedir(salaCom({ push, visivel: true, vistoEm: 1000000 - 30000 }), "davi")).enviados.length, 0, "app aberto");
  assert.equal((await pedir(salaCom({ push, visivel: true, vistoEm: 1000000 - 10 * 60000 }), "davi")).enviados.length, 1,
    "aberto há muito tempo (o celular pode ter fechado sem avisar): avisa");
  assert.equal((await pedir(salaCom({ push }), "joao")).r.status, 403, "quem chamou não está na sala");
  assert.equal((await pedir(salaCom({ push }), "davi", false)).r.status, 403, "Firebase recusou o token");
  const daVezDeDavi = salaCom({ push, casas: 1 });
  daVezDeDavi.jogadores.davi.casas = 1;
  assert.equal((await pedir(daVezDeDavi, "davi")).enviados.length, 0, "a vez voltou para quem chamou");
});

test("servidor e app: mesma regra da vez e mesma chave pública", async () => {
  const { vezDaSala } = await carregar();
  const { carregarApp, lerArquivo } = require("./carregar-app.js");
  const { app, rodar } = carregarApp();
  for (let n = 0; n < 300; n++) {
    const jogadores = {};
    const qtd = 2 + (n % 4);
    for (let i = 0; i < qtd; i++) {
      jogadores[`u${i}`] = { entrouEm: (i * 7) % qtd, casas: (n * (i + 3)) % 5, base: i === 2 ? n % 3 : 0, terminou: (n + i) % 11 === 0 };
    }
    const sala = { criador: "u0", jogadores };
    if (n % 3 === 0) jogadores.u0.pulos = { u1: n % 2 };
    const lista = Object.entries(jogadores).map(([uid, j]) => ({ uid, ...j }));
    assert.equal(vezDaSala(sala), app.vezDaSala(lista, jogadores.u0.pulos || {}), `caso ${n}`);
  }
  const doApp = rodar("VAPID_PUBLICA");
  const doServidor = lerArquivo("worker/wrangler.toml").match(/VAPID_PUBLICA = "([^"]+)"/)[1];
  assert.equal(doApp, doServidor);
});
