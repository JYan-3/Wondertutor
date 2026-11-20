import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'
import worker from '../../public/sw.js?raw'

function startWorker() {
  const handlers = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(null)
  const origin = 'https://wondertutor.example'
  runInNewContext(worker, { URL, self: {
    location: { origin }, registration: { showNotification }, clients: { openWindow },
    addEventListener: (name, handler) => { handlers[name] = handler },
  } })
  return { handlers, showNotification, openWindow, origin }
}

test.each(['/parent/bookings', '/tutor/bookings', '/parent/payments', '/tutor/earnings', '//other.example/redirect'])('push keeps private fields off the lock screen for %s', async url => {
  const { handlers, showNotification, openWindow, origin } = startWorker()
  const waitUntil = vi.fn()
  handlers.push({ data: { json: () => ({ title: 'Private name', body: 'Private lesson address', url }) }, waitUntil })
  await waitUntil.mock.calls[0][0]
  const [title, options] = showNotification.mock.calls[0]
  expect(title).toBe('WonderTutor')
  expect(options.silent).toBe(false)
  expect(JSON.stringify(options)).not.toMatch(/private name|private lesson address/i)
  const close = vi.fn()
  handlers.notificationclick({ notification: { data: options.data, close }, waitUntil })
  expect(close).toHaveBeenCalledOnce()
  expect(openWindow).toHaveBeenCalledWith(origin + (url.startsWith('//') ? '/login' : url))
})

test('even a stale or malformed notification click stays on WonderTutor', () => {
  const { handlers, openWindow, origin } = startWorker()
  handlers.notificationclick({ notification: { data: { path: 'https://elsewhere.example' }, close: vi.fn() }, waitUntil: vi.fn() })
  expect(openWindow).toHaveBeenCalledWith(origin + '/login')
})
