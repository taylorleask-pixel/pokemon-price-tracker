// PokeInfo service worker: always try the network first so prices stay fresh,
// and fall back to the last saved copy when the phone is offline.
const CACHE = "pokeinfo-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;   // GitHub API and card pictures go straight through
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((res) => {   // always ask GitHub for the newest copy
      if (res.ok) {
        const copy = res.clone();
        const key = new URL(req.url); key.search = "";   // data/*.json?v=… saved under one name
        caches.open(CACHE).then((c) => c.put(key.href, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
