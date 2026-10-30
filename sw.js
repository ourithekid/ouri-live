// Minimal service worker so the site can be installed as an app. It only keeps a copy of the home page for
// offline use; live data (/api/*) and everything else always comes straight from the network.
const C = "ouri-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(C).then(ch => ch.put("/", c)).catch(() => {}); return res; })
      .catch(() => caches.match("/").then(m => m || new Response("You are offline. Reconnect to watch Ouri live.", { status: 503, headers: { "content-type": "text/plain" } }))));
  }
});
