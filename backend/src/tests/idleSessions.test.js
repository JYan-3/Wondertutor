import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { credentialTag } from '../services/token.service.js'
import { cleanupExpiredSessions, createSession, hashSessionId, idleTimeoutMs, loadSession, recordActivity, sessionCookieName } from '../services/session.service.js'
import { api, apiBase, makeAdmin, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

let accounts
beforeAll(async () => {
  await resetDb(); await startServer()
  accounts = { PARENT: await makeParent(), TUTOR: await makeTutor(), ADMIN: await makeAdmin() }
})
afterAll(stopServer)
const reqFor = raw => ({ headers: { cookie: `${sessionCookieName()}=${raw}` } })
const roles = ['PARENT', 'TUTOR', 'ADMIN']

test.each(roles)('%s password login returns its server idle policy with the existing cookie protections', async role => {
  const account = accounts[role]
  const client = api()
  const res = await client.post('/auth/login', { email: account.user.email, password: 'Test1234', remember: true, ...(role === 'ADMIN' && { portal: role }) })
  expect(res.status).toBe(200)
  expect(res.user.role).toBe(role)
  expect(res.session.idleTimeoutMs).toBe((role === 'ADMIN' ? 15 : 30) * 60_000)
  expect(Date.parse(res.session.idleExpiresAt) - Date.parse(res.session.serverTime)).toBeGreaterThan(idleTimeoutMs(role) - 2000)
  expect(Date.parse(res.session.expiresAt) - Date.parse(res.session.serverTime)).toBeGreaterThan(6.99 * 86400_000)
  expect(res.session.key).toMatch(/^[a-f0-9]{32}$/)
  expect(JSON.stringify(res.session)).not.toContain(client.session)
  expect(JSON.stringify(res.session)).not.toContain(hashSessionId(client.session))
  expect((await client.get('/auth/me')).user.role).toBe(role)
})

test.each(roles)('%s expires at the precise idle boundary even with Remember Me and JavaScript disabled', async role => {
  const now = new Date('2030-01-01T00:00:00.000Z')
  const session = await createSession(accounts[role].user, { now, remember: true })
  const before = new Date(now.getTime() + idleTimeoutMs(role) - 1)
  expect(await loadSession(reqFor(session.raw), { now: before })).not.toBeNull()
  const boundary = new Date(now.getTime() + idleTimeoutMs(role))
  expect(await loadSession(reqFor(session.raw), { now: boundary })).toBeNull()
  expect(await prisma.authSession.findUnique({ where: { id: session.record.id } })).toBeNull()
})

test.each(roles)('%s background reads cannot extend the idle deadline', async role => {
  const session = await createSession(accounts[role].user)
  const client = api(session.raw)
  const deadline = new Date(Date.now() + 45_000)
  await prisma.authSession.update({ where: { id: session.record.id }, data: { idleExpiresAt: deadline } })
  for (let i = 0; i < 3; i++) expect((await client.get('/auth/me')).status).toBe(200)
  const current = await prisma.authSession.findUnique({ where: { id: session.record.id } })
  expect(current.idleExpiresAt).toEqual(deadline)
})

test.each(roles)('%s Stay signed in renews a live session without changing its absolute expiry', async role => {
  const session = await createSession(accounts[role].user, { remember: true })
  await prisma.authSession.update({ where: { id: session.record.id }, data: { idleExpiresAt: new Date(Date.now() + 30_000) } })
  const res = await api(session.raw).post('/auth/activity')
  expect(res.status).toBe(200)
  expect(Date.parse(res.session.idleExpiresAt) - Date.parse(res.session.serverTime)).toBeGreaterThan(idleTimeoutMs(role) - 2000)
  expect(res.session.expiresAt).toBe(session.expiresAt.toISOString())
  const saved = await prisma.authSession.findUnique({ where: { id: session.record.id } })
  expect(saved.idleExpiresAt.toISOString()).toBe(res.session.idleExpiresAt)
})

test.each(roles)('%s expired activity and protected requests cannot revive the old cookie', async role => {
  const session = await createSession(accounts[role].user)
  await prisma.authSession.update({ where: { id: session.record.id }, data: { idleExpiresAt: new Date(Date.now() - 1) } })
  const client = api(session.raw)
  expect((await client.post('/auth/activity')).status).toBe(401)
  expect((await client.get('/auth/me')).status).toBe(401)
  expect(await prisma.authSession.findUnique({ where: { id: session.record.id } })).toBeNull()
})

test('activity requires CSRF, refuses another origin, and rejects forged role or clock inputs', async () => {
  const session = await createSession(accounts.PARENT.user)
  const headers = { Cookie: `${sessionCookieName()}=${session.raw}`, 'Content-Type': 'application/json' }
  expect((await fetch(apiBase() + '/auth/activity', { method: 'POST', headers, body: '{}' })).status).toBe(403)
  expect((await fetch(apiBase() + '/auth/activity', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': session.csrfToken, Origin: 'https://untrusted.example' }, body: '{}' })).status).toBe(403)
  for (const body of [{ role: 'PARENT' }, { idleExpiresAt: '2099-01-01' }, { lastActivityAt: Date.now() }, { timeoutMinutes: 999 }]) {
    expect((await api(session.raw).post('/auth/activity', body)).status).toBe(400)
  }
  const res = await fetch(apiBase() + '/auth/activity', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': session.csrfToken, Origin: new URL(env.clientUrl).origin }, body: '{}' })
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toContain('no-store')
  expect(res.headers.getSetCookie()).toEqual([])
})

test('a renewal cannot recreate a session revoked after authentication', async () => {
  const session = await createSession(accounts.PARENT.user)
  const loaded = await loadSession(reqFor(session.raw))
  await prisma.authSession.delete({ where: { id: session.record.id } })
  await expect(recordActivity(loaded)).rejects.toMatchObject({ status: 401 })
  expect(await prisma.authSession.findUnique({ where: { id: session.record.id } })).toBeNull()
})

test('late activity cannot shorten a newer deadline or extend the absolute lifetime', async () => {
  const base = new Date('2030-01-01T00:00:00.000Z')
  const session = await createSession(accounts.PARENT.user, { now: base })
  const loaded = await loadSession(reqFor(session.raw), { now: base })
  const later = await recordActivity(loaded, { now: new Date(base.getTime() + 90_000) })
  const earlier = await recordActivity(loaded, { now: new Date(base.getTime() + 30_000) })
  expect(earlier.idleExpiresAt).toEqual(later.idleExpiresAt)
  const nearAbsolute = new Date(session.expiresAt.getTime() - 1000)
  await prisma.authSession.update({ where: { id: session.record.id }, data: { idleExpiresAt: session.expiresAt } })
  expect((await recordActivity(loaded, { now: nearAbsolute })).idleExpiresAt).toEqual(session.expiresAt)
  await expect(recordActivity(loaded, { now: session.expiresAt })).rejects.toMatchObject({ status: 401 })
})

test('account deactivation and password changes still prevent renewal', async () => {
  const account = await makeParent()
  const session = await createSession(account.user)
  const loaded = await loadSession(reqFor(session.raw))
  await prisma.user.update({ where: { id: account.user.id }, data: { status: 'DEACTIVATED' } })
  await expect(recordActivity(loaded)).rejects.toMatchObject({ status: 403 })
  await prisma.user.update({ where: { id: account.user.id }, data: { status: 'ACTIVE', passwordHash: 'changed-test-credential' } })
  expect(credentialTag(account.user)).not.toBe(credentialTag(await prisma.user.findUnique({ where: { id: account.user.id } })))
  await expect(recordActivity(loaded)).rejects.toMatchObject({ status: 401 })
})

test('cleanup removes idle-expired rows while keeping an active session', async () => {
  const active = await createSession(accounts.PARENT.user)
  const stale = await createSession(accounts.TUTOR.user)
  await prisma.authSession.update({ where: { id: stale.record.id }, data: { idleExpiresAt: new Date(Date.now() - 1) } })
  await cleanupExpiredSessions()
  expect(await prisma.authSession.findUnique({ where: { id: stale.record.id } })).toBeNull()
  expect(await prisma.authSession.findUnique({ where: { id: active.record.id } })).not.toBeNull()
})
