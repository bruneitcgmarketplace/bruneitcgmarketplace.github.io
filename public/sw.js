// Minimal offline shell: same-origin GETs are network-first with cache fallback. Supabase calls are never cached.
const CACHE = 'bntcg-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

// Phone notifications (Web Push). The database trigger -> bntcg-push Worker sends {title, body, multi, url, tag}.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const tag = d.tag || 'bntcg';
    const old = await self.registration.getNotifications({ tag });
    const n = old.length ? ((old[0].data && old[0].data.n) || 1) + 1 : 1;   // same buyer/seller again: one notification with a count
    const body = n > 1 && d.multi ? d.multi.replace('{n}', n) : (d.body || '');
    const icon = self.registration.scope + 'icon-192.png';
    await self.registration.showNotification(d.title || 'Brunei One Piece TCG', { body, tag, renotify: true, icon, badge: icon, data: { url: d.url || '#/', n } });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '#/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); if ('navigate' in c) return c.navigate(url).catch(() => {}); return; }
    return self.clients.openWindow(url);
  }));
});
