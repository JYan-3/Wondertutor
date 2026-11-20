import api from '../api/client'

const pushRoute = '/notifications/push'
const changeDevice = action => navigator.locks ? navigator.locks.request('wt-phone-notifications', action) : action()

export function browserPushSupport() {
  if (!window.isSecureContext) return 'insecure'
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed = navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches
  if (appleMobile && !installed) return 'install'
  if (!navigator.serviceWorker || !window.PushManager || !window.Notification) return 'unsupported'
  return 'supported'
}

function keyBytes(key) {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

function matchesKey(subscription, bytes) {
  const current = subscription?.options?.applicationServerKey
  if (!current) return Boolean(subscription)
  const stored = new Uint8Array(current)
  return stored.length === bytes.length && bytes.every((value, i) => value === stored[i])
}

export async function readPhoneNotifications(signal) {
  const { data } = await api.get(pushRoute, { signal })
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  const publicKey = data.available && data.publicKey ? keyBytes(data.publicKey) : null
  return {
    publicKey, registered: data.subscribed,
    enabled: data.subscribed && Notification.permission === 'granted' &&
      Boolean(subscription) && (!publicKey || matchesKey(subscription, publicKey)),
  }
}

async function activeRegistration() {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  if (!registration.active) {
    // Surface installation failures too. serviceWorker.ready alone never rejects.
    const worker = registration.installing || registration.waiting
    if (!worker) throw new Error('The notification service could not start.')
    await new Promise((resolve, reject) => {
      const check = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', check)
          if (worker.state === 'activated') resolve()
          else reject(new Error('The notification service could not start.'))
        }
      }
      worker.addEventListener('statechange', check)
      check()
    })
  }
  return registration
}

export async function enablePhoneNotifications(settings, signal) {
  // Ask directly from the click handler. Safari requires a user gesture.
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (permission !== 'granted') return permission
  signal.throwIfAborted()
  await changeDevice(() => subscribeDevice(settings, signal))
  return 'granted'
}

async function subscribeDevice(settings, signal) {
  signal.throwIfAborted()
  const registration = await activeRegistration()
  let subscription = await registration.pushManager.getSubscription()
  signal.throwIfAborted()
  // A leftover subscription can belong to an earlier account or VAPID key.
  if (subscription && (!settings.registered || !matchesKey(subscription, settings.publicKey))) {
    await subscription.unsubscribe()
    subscription = null
  }
  signal.throwIfAborted()
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: settings.publicKey })
  signal.throwIfAborted()
  await api.put(pushRoute, subscription.toJSON(), { signal })
}

export async function captureBrowserPush({ includeDelivered = false } = {}) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (!registration || (!subscription && !includeDelivered)) return null
    const notifications = await registration.getNotifications?.().catch(() => []) || []
    return { registration, subscription, notifications }
  } catch { return null }
}

async function clearCaptured(snapshot, signal) {
  if (!snapshot) return
  const { registration, subscription, notifications } = snapshot
  const current = await registration.pushManager.getSubscription()
  if (current?.endpoint !== subscription?.endpoint || signal?.aborted) return
  notifications.forEach(notification => notification.close())
  await subscription?.unsubscribe()
}

// Capture before logout starts, so a delayed response cannot revoke a newer login's subscription.
export async function clearBrowserPush(snapshot) {
  try { await changeDevice(() => clearCaptured(snapshot)) } catch { /* Server revocation still takes effect. */ }
}

export async function reconcileBrowserPush(user, signal) {
  try {
    const snapshot = await captureBrowserPush()
    if (!snapshot?.subscription || signal.aborted) return
    // Coordinate with other tabs that may be creating an endpoint before their PUT finishes.
    // Browsers without Web Locks rely on the server's account-switch revocation.
    if (!navigator.locks) return
    await changeDevice(async () => {
      if (signal.aborted) return
      if (user.role === 'ADMIN') {
        // Admins have no push settings. Confirm which cookie is active before local cleanup.
        const { data } = await api.get('/auth/me', { signal })
        if (data.user?.role !== 'ADMIN' || data.user.id !== user.id) return
      } else {
        const { data } = await api.get(pushRoute, { signal })
        if (data.subscribed !== false) return
      }
      await clearCaptured(snapshot, signal)
    })
  } catch { /* A failed or expired session check is not an opt-out. */ }
}

export async function disablePhoneNotifications(signal) {
  await changeDevice(async () => {
    const snapshot = await captureBrowserPush({ includeDelivered: true })
    await api.delete(pushRoute, { signal })
    try { await clearCaptured(snapshot) } catch { /* The server has detached this device. */ }
  })
}
