import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '../api/client'
import { NotificationBell } from '../layouts/AppLayout'
import { reconcileBrowserPush } from '../lib/phoneNotifications'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
const route = '/notifications/push'
const config = { available: true, publicKey: 'AQID', subscribed: false }
let registration, browserSubscription, requestPermission

function serve(settings = config) {
  api.get.mockImplementation(async url => ({ data: url === route ? settings : { unread: 0, notifications: [] } }))
}

function open(role = 'PARENT') {
  const page = render(<MemoryRouter><NotificationBell role={role} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  return page
}

beforeEach(() => {
  vi.resetAllMocks()
  serve()
  requestPermission = vi.fn(async () => { Notification.permission = 'granted'; return 'granted' })
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('isSecureContext', true)
  browserSubscription = {
    endpoint: 'https://push.example.test/opaque',
    toJSON: () => ({ endpoint: 'https://push.example.test/opaque', keys: { p256dh: 'key', auth: 'proof' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  registration = {
    active: {},
    pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue(browserSubscription) },
    getNotifications: vi.fn().mockResolvedValue([]),
  }
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome',
    locks: { request: vi.fn((_name, action) => action()) },
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      register: vi.fn().mockResolvedValue(registration),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

test('session restoration checks only browsers with a subscription and preserves a same-account opt-in', async () => {
  const parent = { id: 4, role: 'PARENT' }
  const signal = new AbortController().signal
  await reconcileBrowserPush(parent, signal)
  expect(api.get).not.toHaveBeenCalled()
  serve({ ...config, subscribed: true })
  registration.pushManager.getSubscription.mockResolvedValue(browserSubscription)
  await reconcileBrowserPush(parent, signal)
  expect(api.get).toHaveBeenCalledWith(route, { signal })
  expect(browserSubscription.unsubscribe).not.toHaveBeenCalled()
})

test.each(['PARENT', 'TUTOR', 'ADMIN'])('a switch to a different %s account clears the old endpoint and displayed alerts', async role => {
  const close = vi.fn()
  const user = { id: 9, role }
  registration.pushManager.getSubscription.mockResolvedValue(browserSubscription)
  registration.getNotifications.mockResolvedValue([{ close }])
  if (role === 'ADMIN') api.get.mockResolvedValue({ data: { user } })
  await reconcileBrowserPush(user, new AbortController().signal)
  expect(api.get.mock.calls[0][0]).toBe(role === 'ADMIN' ? '/auth/me' : route)
  expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

test('a late status check cannot remove the endpoint or alerts of a new opt-in', async () => {
  const newer = { endpoint: 'https://push.example.test/new', unsubscribe: vi.fn() }
  const close = vi.fn()
  registration.pushManager.getSubscription.mockResolvedValueOnce(browserSubscription).mockResolvedValue(newer)
  registration.getNotifications.mockResolvedValue([{ close }])
  await reconcileBrowserPush({ id: 9, role: 'TUTOR' }, new AbortController().signal)
  expect(browserSubscription.unsubscribe).not.toHaveBeenCalled()
  expect(newer.unsubscribe).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

test('another tab waits for an in-flight registration before deciding whether to clean it up', async () => {
  let queue = Promise.resolve(), finishPut, local = null, subscribed = false
  navigator.locks.request.mockImplementation((_name, action) => {
    const next = queue.then(action)
    queue = next.catch(() => {})
    return next
  })
  registration.pushManager.getSubscription.mockImplementation(async () => local)
  registration.pushManager.subscribe.mockImplementation(async () => { local = browserSubscription; return local })
  api.put.mockImplementation(() => new Promise(resolve => { finishPut = () => { subscribed = true; resolve() } }))
  api.get.mockImplementation(async url => ({ data: url === route ? { ...config, subscribed } : { unread: 0, notifications: [] } }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
  await waitFor(() => expect(finishPut).toBeTypeOf('function'))
  const check = reconcileBrowserPush({ id: 4, role: 'PARENT' }, new AbortController().signal)
  await waitFor(() => expect(navigator.locks.request).toHaveBeenCalledTimes(2))
  expect(api.get.mock.calls.filter(([url]) => url === route)).toHaveLength(1)
  await act(async () => { finishPut(); await check })
  expect(browserSubscription.unsubscribe).not.toHaveBeenCalled()
  expect(api.get.mock.calls.filter(([url]) => url === route)).toHaveLength(2)
})

test('an expired sign-in or interrupted status check leaves the device opt-in intact', async () => {
  registration.pushManager.getSubscription.mockResolvedValue(browserSubscription)
  api.get.mockRejectedValueOnce(new Error('Session expired'))
  const controller = new AbortController()
  await reconcileBrowserPush({ id: 4, role: 'PARENT' }, controller.signal)
  api.get.mockImplementationOnce(async () => { controller.abort(); return { data: { subscribed: false } } })
  await reconcileBrowserPush({ id: 4, role: 'PARENT' }, controller.signal)
  expect(browserSubscription.unsubscribe).not.toHaveBeenCalled()
})

test.each(['PARENT', 'TUTOR'])('%s chooses phone notifications explicitly and can turn them off', async role => {
  open(role)
  const enable = await screen.findByRole('button', { name: 'Turn on' })
  expect(requestPermission).not.toHaveBeenCalled()
  expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
  fireEvent.click(enable)
  expect(requestPermission).toHaveBeenCalledOnce()
  await screen.findByText(/on for this device/i)
  expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: Uint8Array.of(1, 2, 3) })
  expect(api.put).toHaveBeenCalledWith(route, browserSubscription.toJSON(), expect.objectContaining({ signal: expect.anything() }))
  const close = vi.fn()
  registration.pushManager.getSubscription.mockResolvedValue(browserSubscription)
  registration.getNotifications.mockResolvedValue([{ close }])
  fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
  await screen.findByRole('button', { name: 'Turn on' })
  expect(api.delete).toHaveBeenCalledWith(route, expect.anything())
  expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

test('iPhone browser explains how to install the app and never asks for permission', async () => {
  navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
  open()
  await screen.findByText(/Share → Add to Home Screen/)
  expect(requestPermission).not.toHaveBeenCalled()
  expect(api.get.mock.calls.some(([url]) => url === route)).toBe(false)
})

test('admins keep the in-app inbox without a phone notification control', async () => {
  open('ADMIN')
  await screen.findByText("You're all caught up.")
  expect(screen.queryByRole('region', { name: 'Phone notifications' })).toBeNull()
  expect(api.get.mock.calls.some(([url]) => url === route)).toBe(false)
})

test('unavailable service, blocked browser permission, and dismissed prompts show actionable states', async () => {
  serve({ available: false, publicKey: null, subscribed: false })
  let page = open()
  await screen.findByText(/currently unavailable/)
  expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  page.unmount()
  serve()
  Notification.permission = 'denied'
  page = open()
  await screen.findByText(/notifications are blocked/i)
  expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  page.unmount()
  Notification.permission = 'default'
  requestPermission.mockResolvedValue('default')
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
  await screen.findByText(/permission was dismissed/i)
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
})

test('an account with a leftover browser subscription must explicitly opt in for a fresh one', async () => {
  const oldSubscription = { unsubscribe: vi.fn().mockResolvedValue(true) }
  Notification.permission = 'granted'
  registration.pushManager.getSubscription.mockResolvedValue(oldSubscription)
  open()
  const enable = await screen.findByRole('button', { name: 'Turn on' })
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(enable)
  await screen.findByText(/on for this device/i)
  expect(requestPermission).not.toHaveBeenCalled()
  expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce()
  expect(api.put).toHaveBeenCalledWith(route, browserSubscription.toJSON(), expect.anything())
})

test('a failed server registration can be retried and never claims that alerts are on', async () => {
  api.put.mockRejectedValueOnce(new Error('offline'))
  open()
  const enable = await screen.findByRole('button', { name: 'Turn on' })
  fireEvent.click(enable)
  await screen.findByText(/couldn’t update your phone notifications/i)
  expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull()
  fireEvent.click(enable)
  await screen.findByText(/on for this device/i)
})

test('permission granted after the original account view closed cannot subscribe a new account', async () => {
  let grant
  requestPermission.mockImplementation(() => new Promise(resolve => { grant = resolve }))
  const page = open()
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
  page.unmount()
  await act(async () => grant('granted'))
  expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
})

test('a changed application key can be reconnected without dropping the server opt-out control', async () => {
  const oldSubscription = { options: { applicationServerKey: Uint8Array.of(4, 5).buffer }, unsubscribe: vi.fn().mockResolvedValue(true) }
  Notification.permission = 'granted'
  serve({ ...config, subscribed: true })
  registration.pushManager.getSubscription.mockResolvedValue(oldSubscription)
  open()
  const reconnect = await screen.findByRole('button', { name: 'Reconnect' })
  expect(screen.getByRole('button', { name: 'Turn off' })).toBeEnabled()
  fireEvent.click(reconnect)
  await screen.findByText(/on for this device/i)
  expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce()
  expect(api.put).toHaveBeenCalledWith(route, browserSubscription.toJSON(), expect.anything())
})

test('a failed opt-out remains available to retry and preserves the browser subscription', async () => {
  serve({ ...config, subscribed: true })
  Notification.permission = 'granted'
  registration.pushManager.getSubscription.mockResolvedValue(browserSubscription)
  api.delete.mockRejectedValueOnce(new Error('offline'))
  open()
  const disable = await screen.findByRole('button', { name: 'Turn off' })
  fireEvent.click(disable)
  await screen.findByRole('alert')
  expect(disable).toBeEnabled()
  expect(browserSubscription.unsubscribe).not.toHaveBeenCalled()
  fireEvent.click(disable)
  await waitFor(() => expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce())
})
