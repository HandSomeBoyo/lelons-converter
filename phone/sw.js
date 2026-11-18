// Keeps the app's own files so it opens fast (and opens at all with bad signal).
// Always asks the network first, so a new version shows up on the next open.
const CACHE = "vaulthub-phone-7";
const FILES = ["./", "index.html", "style.css", "app.js", "call.js", "live.js", "manifest.webmanifest", "inter.woff2", "spacegrotesk.woff2", "icon-180.png"];

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

// ---- notifications (sent by the "push" Edge Function, see supabase/functions/push)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "VaultHub", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "VaultHub", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "icon-192.png", badge: "icon-192.png",
    data: { url: d.url || "" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      c.postMessage({ open: url });
      return c.focus();
    }
    return self.clients.openWindow("./" + url);
  }));
});
