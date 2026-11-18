// Keeps the app's own files so it opens fast (and opens at all with bad signal).
// Always asks the network first, so a new version shows up on the next open.
const CACHE = "vaulthub-phone-6";
const FILES = ["./", "index.html", "style.css", "app.js", "call.js", "manifest.webmanifest", "inter.woff2", "spacegrotesk.woff2", "icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;  // Supabase etc. go straight through
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html"))));
});
