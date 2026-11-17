import { useEffect, useRef, useState } from 'react'
import api, { errorMessage } from '../api/client'
import { Modal } from './ui/Common'

const WARNING_MS = 60_000
const ACTIVITY_INTERVAL = 60_000
const CHANNEL = 'wt-session-activity-v1'
const IDLE_NOTICE = 'You were signed out after inactivity. Please log in again.'

// Server dates determine the remaining lifetime. A different device clock must
// not give a session extra time; monotonic time also handles a clock moved back.
function timingFor(session) {
  const duration = Math.min(Date.parse(session.idleExpiresAt), Date.parse(session.expiresAt)) - Date.parse(session.serverTime)
  return { duration, receivedAt: Date.now(), monotonicAt: performance.now() }
}
const remainingMs = timing => timing ? timing.duration - Math.max(Date.now() - timing.receivedAt, performance.now() - timing.monotonicAt) : Infinity

export default function SessionIdleGuard({ session, onTiming, onExpired, onLogout }) {
  const timing = useRef(null)
  const latestSession = useRef(null)
  const warning = useRef(false)
  const actions = useRef({})
  const [seconds, setSeconds] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    latestSession.current = session
    timing.current = session ? timingFor(session) : null
    warning.current = remainingMs(timing.current) <= WARNING_MS
    if (!warning.current) { setSeconds(null); setError('') }
  }, [session])

  useEffect(() => {
    if (!session?.key) return
    const key = session.key
    let stopped = false, renewing = false, checking = false
    let lastAttempt = performance.now()
    let revision = 0
    const expiryNotice = () => Date.parse(latestSession.current?.expiresAt) <= Date.parse(latestSession.current?.idleExpiresAt) ? 'Your session has expired. Please log in again.' : IDLE_NOTICE
    const controller = new AbortController()
    let channel
    try { if (window.BroadcastChannel) channel = new window.BroadcastChannel(CHANNEL) } catch { /* Storage events are the fallback. */ }

    function adopt(next) {
      if (stopped) return false
      if (!next || next.key !== key) {
        onExpired(key, 'Your sign-in changed. Please log in again.')
        return false
      }
      if (!Number.isFinite(timingFor(next).duration)) return false
      const latest = latestSession.current
      if (latest && (Date.parse(next.serverTime) < Date.parse(latest.serverTime) || Date.parse(next.idleExpiresAt) < Date.parse(latest.idleExpiresAt))) return false
      revision += 1
      latestSession.current = next
      timing.current = timingFor(next)
      onTiming(next, key)
      check()
      return true
    }

    async function verify() {
      if (stopped || checking) return
      checking = true
      const atRevision = revision
      try {
        const { data } = await api.get('/auth/me', { signal: controller.signal, timeout: 8000 })
        adopt(data.session)
      } catch (err) {
        if (stopped || atRevision !== revision) return
        if (err.response?.status === 403 && /deactivated/i.test(errorMessage(err))) onExpired(key, errorMessage(err))
        else if (err.response?.status === 401 || remainingMs(timing.current) <= 0) onExpired(key, expiryNotice())
      } finally { checking = false }
    }

    function announce() {
      const message = { type: 'activity', key }
      try {
        if (channel) channel.postMessage(message)
        else {
          // No credentials or personal data are persisted. Other tabs re-check
          // the server instead of trusting a browser-supplied expiry timestamp.
          localStorage.setItem(CHANNEL, JSON.stringify({ ...message, nonce: Math.random() }))
          localStorage.removeItem(CHANNEL)
        }
      } catch { /* A blocked storage API does not affect server enforcement. */ }
    }

    async function renew(explicit = false) {
      if (stopped || renewing || (!explicit && (warning.current || document.visibilityState === 'hidden'))) return
      renewing = true
      lastAttempt = performance.now()
      if (explicit) { setBusy(true); setError('') }
      const atRevision = revision
      try {
        const { data } = await api.post('/auth/activity', {}, { signal: controller.signal, timeout: 8000 })
        if (adopt(data.session)) {
          announce()
          if (explicit && remainingMs(timing.current) <= WARNING_MS) setError('This sign-in has reached its maximum duration. Please log in again when it ends.')
        }
      } catch (err) {
        if (stopped || atRevision !== revision) return
        if (err.response?.status === 401) onExpired(key, expiryNotice())
        else if (err.response?.status === 403 && (err.response.data?.code === 'CSRF_INVALID' || /deactivated/i.test(errorMessage(err)))) onExpired(key, errorMessage(err))
        else if (explicit) setError('Unable to stay signed in. Check your connection and try again before the countdown ends.')
      } finally { renewing = false; if (!stopped) setBusy(false) }
    }

    function activity() {
      check()
      if (performance.now() - lastAttempt >= ACTIVITY_INTERVAL) void renew()
    }
    function check() {
      if (stopped) return
      const left = remainingMs(timing.current)
      warning.current = left <= WARNING_MS
      setSeconds(warning.current ? Math.max(0, Math.ceil(left / 1000)) : null)
      if (left <= 0) void verify()
    }
    function receive(message) {
      if (message?.type === 'activity' && message.key === key) void verify()
    }
    function storage(event) {
      if (event.key !== CHANNEL || !event.newValue) return
      try { receive(JSON.parse(event.newValue)) } catch { /* Ignore unrelated/malformed messages. */ }
    }
    function visible() { if (document.visibilityState !== 'hidden') void verify() }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
    for (const name of events) window.addEventListener(name, activity, { passive: true, capture: true })
    window.addEventListener('storage', storage)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', visible)
    document.addEventListener('visibilitychange', visible)
    if (channel) channel.onmessage = event => receive(event.data)
    actions.current = { stay: () => renew(true), logout: async () => {
      if (renewing) return
      setBusy(true); setError('')
      try { await onLogout() } catch (err) { if (!stopped) { setError(errorMessage(err)); setBusy(false) } }
    } }
    const timer = window.setInterval(check, 1000)
    check()
    return () => {
      stopped = true
      controller.abort()
      window.clearInterval(timer)
      for (const name of events) window.removeEventListener(name, activity, true)
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', visible)
      document.removeEventListener('visibilitychange', visible)
      channel?.close()
    }
  }, [session?.key, onTiming, onExpired, onLogout])

  return <Modal open={Boolean(session?.key && seconds !== null)} dismissible={false} layerClassName="z-[2000]" title="You're about to be signed out" width="max-w-md">
    <p className="text-sm leading-relaxed text-slate-600">For your privacy, your session is about to end. Choose Stay signed in to continue your work.</p>
    <p role="timer" aria-live="off" className="my-4 rounded-xl bg-amber-50 px-4 py-3 font-semibold text-navy">
      {seconds > 0 ? `Signing out in ${seconds} second${seconds === 1 ? '' : 's'}.` : 'Checking your session…'}
    </p>
    {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
    <div className="flex flex-col gap-2 sm:flex-row">
      <button type="button" className="btn-primary min-h-11 justify-center sm:flex-1" disabled={busy || seconds === 0} onClick={() => actions.current.stay?.()}>{busy ? 'Please wait…' : 'Stay signed in'}</button>
      <button type="button" className="btn-outline min-h-11 justify-center sm:flex-1" disabled={busy || seconds === 0} onClick={() => actions.current.logout?.()}>Log out now</button>
    </div>
  </Modal>
}
