// Only these protected landing pages can be opened by a notification.
const destinations = new Set(['/parent/bookings', '/parent/payments', '/tutor/bookings', '/tutor/earnings'])
const destination = value => destinations.has(value) ? value : '/login'

self.addEventListener('push', event => {
  let path
  try { path = event.data?.json()?.url } catch { /* A generic update still works. */ }
  // The lock screen can be visible to anyone. Keep even malformed payloads private.
  event.waitUntil(self.registration.showNotification('WonderTutor', {
    body: 'You have a new update. Open WonderTutor to see the details.',
    icon: '/icons/wondertutor-192.png',
    silent: false,
    data: { path: destination(path) },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  // A fresh navigation checks the current cookie session, including after an idle sign-out.
  const url = new URL(destination(event.notification.data?.path), self.location.origin)
  event.waitUntil(self.clients.openWindow(url.href))
})
