// Ao publicar mudanças, aumente a versão para limpar o cache antigo.
const CACHE_NAME = "yam-cache-v67";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./familia.js",
  "./manifest.json",
  "./icone-dado-192.png",
  "./icone-dado-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./icone-dado-32.png",
  "./fontes/nunito.woff2"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE.map(file => new Request(file, { cache: "reload" }))))
  );
  // Ativa a nova versão sem esperar todas as abas fecharem.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Aviso da vez (sala "cada um na sua vez"), mandado pelo servidor de avisos.
self.addEventListener("push", event => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(dados.titulo || "Sua vez no YAM!", {
    body: dados.texto ? `${dados.texto}\nAgora é a sua vez.` : "Toque para jogar.",
    icon: "icone-dado-192.png",
    tag: `vez-${dados.codigo || ""}`, // um aviso por sala: o novo substitui o antigo
    renotify: true,
    data: { url: "./" }
  }));
});

// Tocar no aviso abre o app (ou traz para a frente, se já estava aberto).
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(janelas => {
      const aberta = janelas.find(j => "focus" in j);
      return aberta ? aberta.focus() : self.clients.openWindow("./");
    })
  );
});

// Rede primeiro: com internet, sempre pega a versão mais nova e atualiza o cache.
// Sem internet, usa o que estiver salvo.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  // só cuida dos arquivos do próprio app (Firebase e afins vão direto para a rede)
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-cache" }) // sempre confere com o servidor se há versão nova
      .then(response => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true })
          // sem internet e sem cópia: página -> o app guardado; arquivo -> erro
          // (nunca entregar o index.html no lugar de um .js ou .css)
          .then(cached => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      )
  );
});
