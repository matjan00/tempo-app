// Offline cache. Bump VERSION (scripts/release.cjs does it) so phones replace their saved copy.
const VERSION = 'tempo-v28';
// FILES-START
// HASH: 507799d793cb
const FILES = ["./","css/app.css","css/day.css","css/habits.css","css/notes.css","css/plain.css","css/settings.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","js/app.js","js/components.js","js/day.js","js/focus.js","js/habits.js","js/icons.js","js/install.js","js/notes.js","js/parse.js","js/plan.js","js/push-config.js","js/push.js","js/settings.js","js/store.js","js/sync.js","js/tasks.js","js/theme.js","js/timer.js","js/today.js","js/ui.js","js/util.js","js/version.js","manifest.webmanifest"];
// FILES-END

self.addEventListener('install', (e) => {
  // All-or-nothing: if any file fails to download the install fails and the old cache keeps serving.
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.all(
        FILES.map((f) =>
          fetch(new Request(f, { cache: 'reload' })).then((r) => {
            if (!r.ok) throw new Error('precache failed: ' + f + ' ' + r.status);
            return c.put(f, r);
          })
        )
      )
    ).then(() => self.skipWaiting())
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
  if (d.kind === 'block') {
    // end of a plan block: answer right from the notification
    e.waitUntil(
      self.registration.showNotification(d.title || 'Done?', {
        body: d.body || '',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: d.tag || 'tempo-block',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { date: d.date, block: d.block },
        actions: [
          { action: 'done', title: 'Done' },
          { action: 'missed', title: 'Missed' },
        ],
      })
    );
    return;
  }
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

// The browser rotated or dropped the push subscription. Try to resubscribe with the same server key and
// ask any open window to re-register it (the app re-sends the new subscription on its next schedule call).
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const key = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
        if (key) await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch {}
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      cs.forEach((c) => c.postMessage({ type: 'push-subscription-changed' }));
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const blk = e.notification.data;
  if (blk && blk.date && blk.block) {
    // Done / Missed / tap on a block alert: hand it to an open window, or open the app with it in the address
    const act = e.action === 'done' || e.action === 'missed' ? e.action : 'open';
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
        const c = cs.find((w) => w.visibilityState === 'visible') || cs[0];
        if (c) {
          c.postMessage({ type: 'block-action', date: blk.date, block: blk.block, act });
          return c.focus();
        }
        return self.clients.openWindow('./?blk=' + encodeURIComponent(blk.date + '~' + blk.block) + '&do=' + act);
      })
    );
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((w) => w.visibilityState === 'visible') || cs[0];
      return c ? c.focus() : self.clients.openWindow('./');
    })
  );
});
