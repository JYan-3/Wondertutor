import { jest } from '@jest/globals'
import { createECDH, randomBytes } from 'node:crypto'

// Exercise the real HTTP handlers, transactions and reminder job with a fake delivery transport.
const transport = jest.fn()
jest.unstable_mockModule('web-push', () => ({ sendNotification: transport }))
const { env, readWebPushConfig } = await import('../config/env.js')
const { prisma } = await import('../config/prisma.js')
const { hashSessionId } = await import('../services/session.service.js')
const { sendBookingPush, registerPush } = await import('../services/webPush.service.js')
const { sendLessonReminders } = await import('../services/lifecycle.service.js')
const { notifyWithEmail } = await import('../services/notification.service.js')
const { outbox } = await import('../services/email.service.js')
const { api, apiBase, authHeaders, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer, testSession } = await import('./helpers.js')

const path = '/notifications/push'
const vapidCurve = createECDH('prime256v1')
vapidCurve.generateKeys()
const config = { subject: 'mailto:push@example.test', publicKey: vapidCurve.getPublicKey('base64url'),
  privateKey: Buffer.from(vapidCurve.getPrivateKey('hex').padStart(64, '0'), 'hex').toString('base64url') }
const notice = { type: 'TUTOR_ACCEPT', title: 'Private title', message: 'Private booking details', link: '/parent/bookings?booking=private-id' }
function subscription(host = 'web.push.apple.com') {
  const curve = createECDH('prime256v1')
  return { endpoint: 'https://' + host + '/push/' + randomBytes(16).toString('hex'), expirationTime: null,
    keys: { auth: randomBytes(16).toString('base64url'), p256dh: curve.generateKeys('base64url') } }
}
async function enable(browser, sub = subscription()) {
  expect(await browser.get(path)).toMatchObject({ available: true, publicKey: config.publicKey })
  expect(await browser.put(path, sub)).toEqual({ status: 200, subscribed: true })
  return sub
}
const login = (browser, user) => browser.post('/auth/login', { email: user.email, password: 'Test1234' })

beforeAll(startServer)
afterAll(stopServer)
beforeEach(async () => {
  await resetDb()
  env.webPush = config
  outbox.length = 0
  transport.mockReset().mockResolvedValue({ statusCode: 201 })
})
afterEach(() => { env.webPush = null; jest.restoreAllMocks() })

test('unconfigured push leaves the app available and the server returns only the VAPID public key when enabled', async () => {
  expect(readWebPushConfig({})).toBeNull()
  expect(readWebPushConfig({ WEB_PUSH_VAPID_SUBJECT: config.subject, WEB_PUSH_VAPID_PRIVATE_KEY: config.privateKey, WEB_PUSH_VAPID_PUBLIC_KEY: config.publicKey })).toEqual(config)
  const who = await makeParent()
  const browser = api(who.token)
  env.webPush = null
  expect(await browser.get(path)).toEqual({ status: 200, available: false, publicKey: null, subscribed: false })
  expect((await browser.put(path, subscription())).status).toBe(503)
  expect((await browser.del(path)).status).toBe(200)
  await notifyWithEmail(who.user, notice)
  expect(transport).not.toHaveBeenCalled()
  expect(outbox).toHaveLength(1)
  env.webPush = config
  const res = await fetch(apiBase() + path, { headers: authHeaders(who.token) })
  expect(await res.json()).toEqual({ available: true, publicKey: config.publicKey, subscribed: false })
  expect(res.headers.getSetCookie().find(h => h.startsWith('wt_push_device='))).toMatch(/HttpOnly/)
  expect(res.headers.get('cache-control')).toContain('no-store')
})

test('settings use the existing parent/tutor auth and CSRF middleware; malformed subscriptions are rejected before storage', async () => {
  const who = await makeParent(), browser = api(who.token)
  expect((await api().get(path)).status).toBe(401)
  expect((await api((await makeAdmin()).token).get(path)).status).toBe(403)
  expect((await fetch(apiBase() + path, { method: 'PUT', headers: { Cookie: authHeaders(who.token).Cookie } })).status).toBe(403)
  await browser.get(path)
  const sub = subscription()
  for (const invalid of [
    { ...sub, endpoint: 'https://example.test/push' }, { ...sub, endpoint: 'http://fcm.googleapis.com/push' },
    { ...sub, keys: { ...sub.keys, auth: 'invalid' } }, { ...sub, expirationTime: 1 },
  ]) expect((await browser.put(path, invalid)).status).toBe(400)
  expect(await prisma.pushSubscription.count()).toBe(0)
})

test('repeated enable and device-only disable do not affect another phone', async () => {
  const who = await makeParent()
  const a = api(who.token), b = api(await testSession(who.user))
  const first = await enable(a, subscription('fcm.googleapis.com'))
  await enable(a, first)
  const second = await enable(b, subscription('updates.push.services.mozilla.com'))
  expect(await prisma.pushSubscription.count()).toBe(2)
  expect(await a.del(path)).toEqual({ status: 200, subscribed: false })
  expect((await a.get(path)).subscribed).toBe(false)
  expect((await b.get(path)).subscribed).toBe(true)
  await sendBookingPush(who.user.id, notice)
  expect(transport.mock.calls.map(([s]) => s.endpoint)).toEqual([second.endpoint])
})

test('reminders reach idle parent and tutor devices once, independently of reminder email, with generic lock-screen content', async () => {
  const p = await makeParent(), t = await makeTutor()
  await enable(api(p.token)); await enable(api(t.token))
  await prisma.user.update({ where: { id: p.user.id }, data: { emailReminders: false } })
  await prisma.authSession.deleteMany()
  const booking = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(1), status: 'CONFIRMED' })
  const now = new Date(booking.startAt.getTime() - 20 * 3_600_000)
  await sendLessonReminders(now)
  await sendLessonReminders(now)
  expect(transport.mock.calls.map(([, raw]) => JSON.parse(raw))).toEqual([
    { title: 'Upcoming lesson', body: 'Open WonderTutor to view the details.', url: '/parent/bookings' },
    { title: 'Upcoming lesson', body: 'Open WonderTutor to view the details.', url: '/tutor/bookings' },
  ])
  expect(outbox).toHaveLength(0)
  expect(await prisma.notification.count({ where: { type: 'LESSON_REMINDER' } })).toBe(2)
})

test('same-account reauthentication preserves opt-in; a different account signing in after idle unlinks only this phone', async () => {
  const p = await makeParent(), next = await makeParent(), first = api(p.token), other = api(await testSession(p.user))
  await enable(first)
  const otherSub = await enable(other)
  const expire = browser => prisma.authSession.update({ where: { id: hashSessionId(browser.session) }, data: { idleExpiresAt: new Date(0) } })
  await expire(first)
  expect((await first.get('/auth/me')).status).toBe(401)
  expect((await login(first, p.user)).status).toBe(200)
  expect((await first.get(path)).subscribed).toBe(true)
  await expire(first)
  expect((await login(first, next.user)).status).toBe(200)
  expect((await first.get(path)).subscribed).toBe(false)
  await sendBookingPush(p.user.id, notice)
  expect(transport.mock.calls.map(([s]) => s.endpoint)).toEqual([otherSub.endpoint])
  await sendBookingPush(next.user.id, notice)
  expect(transport).toHaveBeenCalledTimes(1)
})

test('explicit logout removes the registration and a late request cannot restore it', async () => {
  const p = await makeParent(), browser = api(p.token)
  const sub = await enable(browser)
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: hashSessionId(p.token) } })
  expect((await browser.post('/auth/logout')).status).toBe(200)
  await expect(registerPush(randomBytes(32).toString('base64url'), session, sub)).rejects.toMatchObject({ status: 401 })
  await sendBookingPush(p.user.id, notice)
  expect(await prisma.pushSubscription.count()).toBe(0)
  expect(transport).not.toHaveBeenCalled()
})

test('expired endpoints are removed, transient failures keep the subscription, and email and bell notices survive', async () => {
  const p = await makeParent()
  const sub = await enable(api(p.token))
  await enable(api(await testSession(p.user)))
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {})
  transport.mockImplementation(async ({ endpoint }) => { throw Object.assign(new Error(endpoint), { statusCode: endpoint === sub.endpoint ? 410 : 503 }) })
  await notifyWithEmail(p.user, notice)
  expect(await prisma.pushSubscription.count()).toBe(1)
  expect(await prisma.notification.count({ where: { userId: p.user.id } })).toBe(1)
  expect(outbox).toHaveLength(1)
  expect(JSON.stringify(log.mock.calls)).not.toContain('https:')
  transport.mockClear()
  await sendBookingPush(p.user.id, { ...notice, type: 'EMAIL_CHANGED' })
  await prisma.user.update({ where: { id: p.user.id }, data: { status: 'DEACTIVATED' } })
  await sendBookingPush(p.user.id, notice)
  expect(transport).not.toHaveBeenCalled()
})
