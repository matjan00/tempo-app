// Offline cache. Bump VERSION (scripts/release.cjs does it) so phones replace their saved copy.
const VERSION = 'tempo-v7';
// FILES-START
const FILES = ["./","css/app.css","css/ink.css","css/notes.css","css/settings.css","css/stats.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","js/app.js","js/components.js","js/focus.js","js/icons.js","js/install.js","js/notes.js","js/parse.js","js/push-config.js","js/push.js","js/settings.js","js/stats.js","js/store.js","js/tasks.js","js/theme.js","js/timer.js","js/today.js","js/ui.js","js/util.js","js/version.js","manifest.webmanifest"];
// FILES-END

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(FILES.map((f) => fetch(new Request(f, { cache: 'reload' })).then((r) => r.ok && c.put(f, r))))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => {
      const visible = cs.some((c) => c.visibilityState === 'visible');
      return self.registration.showNotification(d.title || 'to-do', {
        body: d.body || '',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: d.tag || 'tempo-timer',
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 600],
        silent: visible, // the app itself is already chiming
      });
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./')))
  );
});
