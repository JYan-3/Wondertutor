import { createHash, ECDH } from 'node:crypto'
import { sendNotification } from 'web-push'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { PUSH_DEVICE_LIFETIME_MS } from './session.service.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const invalid = () => new AppError(400, 'This browser supplied an invalid push subscription.')

// Web Push endpoints are browser-supplied network destinations. Restrict delivery
// to browser vendors' HTTPS services. web-push uses https.request without redirects.
function supportedEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 3072 || /[\s\\]/.test(endpoint)) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false
    const host = url.hostname
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')
  } catch { return false }
}

function keyBytes(value, length) {
  if (typeof value !== 'string' || value.length !== Math.ceil(length * 4 / 3)) throw invalid()
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw invalid()
  return bytes
}

function subscriptionData(subscription, now) {
  const { endpoint, keys, expirationTime } = subscription || {}
  if (!supportedEndpoint(endpoint)) throw invalid()
  const key = keyBytes(keys?.p256dh, 65)
  if (key[0] !== 4) throw invalid()
  try { ECDH.convertKey(key, 'prime256v1') } catch { throw invalid() }
  keyBytes(keys?.auth, 16)
  if (expirationTime != null && (!Number.isSafeInteger(expirationTime) || expirationTime <= now)) throw invalid()
  const expiresAt = new Date(Math.min(now + PUSH_DEVICE_LIFETIME_MS, expirationTime ?? Infinity))
  return { endpoint, endpointHash: hash(endpoint), auth: keys.auth, p256dh: keys.p256dh, expiresAt }
}

export async function registerPush(device, session, subscription) {
  if (!env.webPush) throw new AppError(503, 'Phone alerts are unavailable right now.')
  if (!device) throw new AppError(409, 'Please reopen the alert settings and try again.')
  const data = subscriptionData(subscription, Date.now())
  const deviceHash = hash(device)
  await prisma.$transaction(async tx => {
    // Serialize with logout/account rotation. A permission prompt can finish after the
    // initiating session has been revoked or the account has been deactivated.
    const now = new Date()
    const sessions = await tx.$queryRaw`SELECT s.id FROM AuthSession s JOIN User u ON u.id = s.userId
      WHERE s.id = ${session.id} AND s.userId = ${session.userId} AND s.expiresAt > ${now}
      AND s.idleExpiresAt > ${now} AND u.status = 'ACTIVE' AND u.deletedAt IS NULL FOR UPDATE`
    if (!sessions.length) throw new AppError(401, 'Session expired, please log in again')
    const existing = await tx.pushSubscription.findUnique({ where: { endpointHash: data.endpointHash } })
    if (existing && existing.deviceHash !== deviceHash) {
      // Recover a reset device cookie only with the full browser-issued subscription.
      if (existing.auth !== data.auth || existing.p256dh !== data.p256dh) throw invalid()
      await tx.pushSubscription.delete({ where: { deviceHash: existing.deviceHash } })
    }
    const registration = { ...data, userId: session.userId }
    await tx.pushSubscription.upsert({ where: { deviceHash }, create: { deviceHash, ...registration }, update: registration })
  }).catch(err => {
    if (err instanceof AppError) throw err
    if (['P2002', 'P2034'].includes(err.code)) throw new AppError(409, 'The device settings changed. Please reopen them and try again.')
    // Prisma diagnostics can include the submitted endpoint and encryption keys.
    console.warn('[web-push] Device registration is temporarily unavailable.')
    throw new AppError(503, 'Unable to save phone alerts right now. Please try again.')
  })
}

const bookingUpdates = new Set([
  'BOOKING_REQUEST', 'BOOKING_UPDATED', 'BOOKING_CANCELLED', 'BOOKING_CONFIRMED', 'BOOKING_EXPIRED',
  'BOOKING_DISPUTED', 'BOOKING_DECISION', 'COUNTER_ACCEPTED', 'COUNTER_DECLINED', 'TUTOR_ACCEPT',
  'TUTOR_DECLINE', 'TUTOR_COUNTER', 'TUTOR_CANCEL', 'TUTOR_ESCALATE', 'TUTOR_LINK',
  'RESCHEDULE_REQUESTED', 'RESCHEDULE_APPROVED', 'RESCHEDULE_ESCALATED', 'RESCHEDULE_WITHDRAWN',
  'PAYMENT_SUCCESS', 'REFUND_REQUESTED', 'REFUND_DECISION', 'ATTENDANCE_REVIEW', 'LESSON_COMPLETED',
])

function pushPayload({ type, link }) {
  // Lock screens and notification history can be visible on a shared phone. Never
  // include a stored title/message, child, school, booking ID, address or class URL.
  const page = link?.split('?')[0]
  let url
  if (['/parent/payments', '/parent/bookings', '/tutor/bookings', '/tutor/earnings'].includes(page)) url = page
  else if (page?.startsWith('/tutor/bookings/')) url = '/tutor/bookings'
  if (!url) return null
  const title = type === 'LESSON_REMINDER' ? 'Upcoming lesson' : type === 'PAYMENT_REMINDER' ? 'Payment reminder' :
    bookingUpdates.has(type) ? 'Booking update' : null
  if (!title) return null
  return { title, body: 'Open WonderTutor to view the details.', url }
}

// Only called after the corresponding in-app notice has committed. Transport errors
// (including expired browser endpoints) never fail the booking or email operation.
export async function sendBookingPush(userId, notice) {
  if (!env.webPush) return
  const payload = pushPayload(notice)
  if (!payload) return
  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: {
      userId, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE', deletedAt: null },
    } })
    await Promise.all(subscriptions.map(async row => {
      if (!supportedEndpoint(row.endpoint)) return
      try {
        await sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload), { vapidDetails: env.webPush, timeout: 3500, TTL: 15 * 60, urgency: 'normal' })
      } catch (err) {
        if ([404, 410].includes(err.statusCode)) {
          // A renewal on this device may have replaced an endpoint while delivery was in flight.
          await prisma.pushSubscription.deleteMany({ where: { deviceHash: row.deviceHash, userId, endpointHash: row.endpointHash } })
        } else {
          console.warn('[web-push] A notification could not be delivered.')
        }
      }
    }))
  } catch {
    console.warn('[web-push] Device notification delivery is temporarily unavailable.')
  }
}
