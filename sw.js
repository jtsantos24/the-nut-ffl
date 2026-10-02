// Cache only the offline screen and local artwork. League data and betting stay live.
const CACHE = "nut-ffl-assets-v1";
const PRELOAD = ["./offline.html", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRELOAD)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;
  if(request.mode === "navigate"){
    event.respondWith(fetch(request).catch(() => caches.match("./offline.html")));
    return;
  }
  if(!/\.(?:webp|png|jpg|jpeg|svg)$/i.test(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if(response.ok){ const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
