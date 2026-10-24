/* Push only: never caches application pages, credentials or API responses. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification('Agenda Pignus', {
    body: typeof data.body === 'string' ? data.body.slice(0, 180) : 'Tenés novedades en la plataforma.',
    icon: '/pignus-app-icon-192.png', badge: '/favicon.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : 'pignus',
    data: { noticeId: String(data.noticeId || '').slice(0, 250), userId: String(data.userId || '').slice(0, 150), test: data.test === true }
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      existing.postMessage({ type: 'pignus-push-open', ...data })
      await existing.focus()
      return
    }
    const url = new URL('/', self.location.origin)
    url.searchParams.set('pushNotice', data.noticeId || '')
    url.searchParams.set('pushUser', data.userId || '')
    await self.clients.openWindow(url.href)
  })())
})
