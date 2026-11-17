import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api, { clearCsrfToken } from '../api/client'
import { AuthProvider, useAuth } from '../context/AuthContext'

const originalAdapter = api.defaults.adapter
const minute = 60_000
const roles = ['PARENT', 'TUTOR', 'ADMIN']
const limit = role => (role === 'ADMIN' ? 15 : 30) * minute
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} })
const failed = (config, status = 401, message = 'Session expired') => Promise.reject(new AxiosError(message, undefined, config, undefined, { status, config, data: { message }, headers: {} }))
let server, calls

function metadata() {
  return { key: server.key, idleTimeoutMs: limit(server.user.role), idleExpiresAt: new Date(server.idle).toISOString(), expiresAt: new Date(server.absolute).toISOString(), serverTime: new Date(Date.now() + server.skew).toISOString() }
}
function adapter(config) {
  calls.push(config)
  const now = Date.now() + server.skew
  if (config.url === '/auth/login') {
    server.user = { ...server.user, id: 2, role: 'ADMIN' }
    server.key = 'new-admin-session'
    server.idle = now + limit('ADMIN')
    return Promise.resolve(response(config, { user: server.user, session: metadata(), csrfToken: 'new-admin-proof' }))
  }
  if (config.url === '/auth/logout') { server.active = false; return Promise.resolve(response(config, { csrfToken: 'anonymous' })) }
  if (!server.active || now >= server.idle || now >= server.absolute) return failed(config)
  if (config.url === '/auth/activity') {
    expect(JSON.parse(config.data)).toEqual({})
    expect(config.headers.get('X-CSRF-Token')).toBeTruthy()
    server.idle = Math.min(server.absolute, now + limit(server.user.role))
    return Promise.resolve(response(config, { session: metadata() }))
  }
  return Promise.resolve(response(config, { user: server.user, session: metadata(), csrfToken: 'session-proof' }))
}
function Probe() {
  const auth = useAuth()
  return <>
    <p>{auth.loading ? 'Loading' : auth.user?.role || 'Signed out'}</p>
    <p>{auth.notice}</p>
    <button onClick={() => api.get('/notifications').catch(() => {})}>Background request</button>
    <button onClick={() => auth.login('new-admin@example.test', 'Test1234', false, '', 'ADMIN')}>Switch account</button>
  </>
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function open(role = 'PARENT', options = {}) {
  server = { active: true, user: { id: 1, role, fullName: 'Test User' }, key: 'original-session', skew: 0, absolute: Date.now() + 12 * 60 * minute, idle: Date.now() + limit(role), ...options }
  server.idle = Math.min(server.idle, server.absolute)
  api.defaults.adapter = adapter
  render(<AuthProvider><Probe /></AuthProvider>)
  await flush()
  expect(screen.getByText(role)).toBeInTheDocument()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-17T08:00:00Z'))
  clearCsrfToken(); localStorage.clear(); sessionStorage.clear()
  calls = []
})
afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  clearCsrfToken()
  vi.useRealTimers()
})

test.each(roles)('%s sees a one-minute warning at the role-specific idle limit', async role => {
  await open(role)
  await advance(limit(role) - minute - 1000)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await advance(1000)
  expect(screen.getByRole('dialog', { name: /about to be signed out/i })).toBeInTheDocument()
  expect(screen.getByRole('timer')).toHaveTextContent('60 seconds')
  expect(screen.getByRole('button', { name: 'Stay signed in' })).toHaveFocus()
  await advance(1000)
  expect(screen.getByRole('timer')).toHaveTextContent('59 seconds')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(0)
})

test.each(roles)('%s Stay signed in renews the server deadline and closes the warning', async role => {
  await open(role)
  await advance(limit(role) - minute)
  fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
  await flush()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await advance(limit(role) - minute - 1000)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await advance(1000)
  expect(screen.getByRole('timer')).toHaveTextContent('60 seconds')
})

test.each(roles)('%s is signed out when the countdown ends without confirmation', async role => {
  await open(role)
  await advance(limit(role))
  expect(screen.getByText('Signed out')).toBeInTheDocument()
  expect(screen.getByText(/signed out after inactivity/i)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(0)
})

test('background API polling cannot renew an idle session', async () => {
  await open('ADMIN')
  for (let i = 0; i < 15; i++) {
    await advance(minute)
    if (i < 14) await act(async () => { await api.get('/notifications') })
  }
  expect(screen.getByText('Signed out')).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(0)
})

test('real interaction renews at most once a minute, but moving the mouse during the warning does not dismiss it', async () => {
  await open()
  await advance(2 * minute)
  for (let i = 0; i < 20; i++) fireEvent.pointerMove(window)
  await flush()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(1)
  await advance(limit('PARENT') - minute)
  fireEvent.pointerMove(window)
  fireEvent.keyDown(window, { key: 'Tab' })
  await flush()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(1)
})

test('reload preserves the server remaining time instead of giving another full idle period', async () => {
  await open('TUTOR', { idle: Date.now() + 35_000 })
  expect(screen.getByRole('timer')).toHaveTextContent('35 seconds')
  await advance(35_000)
  expect(screen.getByText('Signed out')).toBeInTheDocument()
})

test('a failed Stay signed in keeps the countdown and allows retry without claiming a renewal', async () => {
  await open('ADMIN')
  await advance(14 * minute)
  const realAdapter = api.defaults.adapter
  api.defaults.adapter = config => config.url === '/auth/activity' ? Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)) : realAdapter(config)
  fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
  await flush()
  expect(screen.getByRole('alert')).toHaveTextContent(/check your connection/i)
  await advance(10_000)
  expect(screen.getByRole('timer')).toHaveTextContent('50 seconds')
  api.defaults.adapter = realAdapter
  fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
  await flush()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the deadline hides private content even if the network is unavailable', async () => {
  await open('ADMIN')
  api.defaults.adapter = config => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
  await advance(15 * minute)
  expect(screen.getByText('Signed out')).toBeInTheDocument()
})

test('another tab may extend the server session; the old tab re-checks before expiring it', async () => {
  await open('ADMIN')
  await advance(14 * minute)
  server.idle = Date.now() + limit('ADMIN')
  window.dispatchEvent(new StorageEvent('storage', { key: 'wt-session-activity-v1', newValue: JSON.stringify({ type: 'activity', key: server.key }) }))
  await flush()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await advance(minute)
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/activity')).toHaveLength(0)
})

test('a missed cross-tab message is recovered by a server check at the local deadline', async () => {
  await open('ADMIN')
  await advance(14 * minute)
  server.idle = Date.now() + limit('ADMIN')
  await advance(minute)
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/logout')).toHaveLength(0)
})

test('an old expiry response cannot end a newer login', async () => {
  await open('PARENT')
  let finishOldCheck
  api.defaults.adapter = config => config.url === '/auth/me'
    ? new Promise((_, reject) => { finishOldCheck = () => reject(new AxiosError('Expired', undefined, config, undefined, { config, status: 401, data: { message: 'Expired' } })) })
    : adapter(config)
  await advance(30 * minute)
  expect(finishOldCheck).toBeTypeOf('function')
  fireEvent.click(screen.getByRole('button', { name: 'Switch account' }))
  await flush()
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
  await act(async () => finishOldCheck())
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
})

test('a resumed tab cannot silently adopt another account or log out its new cookie', async () => {
  await open('PARENT')
  server.key = 'different-session'
  server.user = { id: 2, role: 'ADMIN' }
  server.idle = Date.now() + 60 * minute
  await advance(30 * minute)
  expect(screen.getByText('Signed out')).toBeInTheDocument()
  expect(screen.getByText(/sign-in changed/i)).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/logout')).toHaveLength(0)
  expect(server.active).toBe(true)
})

test('server timing works with an eight-hour difference from the browser clock', async () => {
  const skew = -8 * 60 * minute
  await open('ADMIN', { skew, idle: Date.now() + skew + 15 * minute, absolute: Date.now() + skew + 12 * 60 * minute })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await advance(14 * minute)
  expect(screen.getByRole('timer')).toHaveTextContent('60 seconds')
})

test('Log out now uses server-side logout and closes the warning', async () => {
  await open('TUTOR')
  await advance(29 * minute)
  fireEvent.click(screen.getByRole('button', { name: 'Log out now' }))
  await flush()
  expect(screen.getByText('Signed out')).toBeInTheDocument()
  expect(calls.filter(c => c.url === '/auth/logout')).toHaveLength(1)
  expect(server.active).toBe(false)
  expect(localStorage.length + sessionStorage.length).toBe(0)
})

test('an activity request completing after a newer server check still adopts the latest deadline', async () => {
  await open('PARENT')
  let finishActivity
  api.defaults.adapter = config => config.url === '/auth/activity'
    ? new Promise(resolve => { finishActivity = () => resolve(adapter(config)) })
    : adapter(config)
  await advance(2 * minute)
  fireEvent.pointerDown(window)
  await flush()
  expect(finishActivity).toBeTypeOf('function')
  window.dispatchEvent(new StorageEvent('storage', { key: 'wt-session-activity-v1', newValue: JSON.stringify({ type: 'activity', key: server.key }) }))
  await flush()
  await advance(minute)
  await act(async () => finishActivity())
  await advance(26 * minute)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('PARENT')).toBeInTheDocument()
})

test('a late server-check response cannot replace a newer renewal with an older deadline', async () => {
  await open('PARENT')
  let finishCheck
  api.defaults.adapter = config => {
    if (config.url !== '/auth/me') return adapter(config)
    const oldResponse = response(config, { user: server.user, session: metadata(), csrfToken: 'session-proof' })
    return new Promise(resolve => { finishCheck = () => resolve(oldResponse) })
  }
  await advance(2 * minute)
  window.dispatchEvent(new StorageEvent('storage', { key: 'wt-session-activity-v1', newValue: JSON.stringify({ type: 'activity', key: server.key }) }))
  await flush()
  fireEvent.pointerDown(window)
  await flush()
  await act(async () => finishCheck())
  await advance(27 * minute)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('Stay signed in cannot bypass the absolute lifetime', async () => {
  await open('PARENT', { absolute: Date.now() + 90_000 })
  await advance(30_000)
  fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
  await flush()
  expect(screen.getByRole('alert')).toHaveTextContent('maximum duration')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await advance(minute)
  expect(screen.getByText('Signed out')).toBeInTheDocument()
})
