// Retire the previous Vite/Workbox worker during the Expo cutover.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('workbox-')).map(key => caches.delete(key)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({type:'window'});
  for (const client of clients) client.navigate(client.url);
})()));
