// FINN service worker: the shell and the last brief stay readable with no signal.
//   /_next/static/*  content-hashed, so cache-first
//   /data/*.json     network-first, falling back to the last copy seen
//   pages            network-first, falling back to cache
// /api/* is never cached: research is always read fresh.
const CACHE = "finn-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const put = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; };
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(put)));
  } else {
    e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" }).then((hit) => hit || Response.error())));
  }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow(e.notification.data || "/"))));
});
