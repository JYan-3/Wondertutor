// In-app notifications for everything; email also for important booking/payment changes
// and for reminders (which the person can switch off in My Profile).
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { sendEmail } from './email.service.js'
import { sendBookingPush } from './webPush.service.js'

export async function notify(userId, { type, title, message, link }) {
  const notification = await prisma.notification.create({ data: { userId, type, title, message, link } })
  await sendBookingPush(userId, { type, link })
  return notification
}

// Names and messages contain text people typed, so they are escaped before going into the email's HTML
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// The email body: greeting, the message, a button to the page it is about, and an optional small note at the bottom
export function renderEmail({ name, message, link, note }) {
  const url = link ? `${env.clientUrl}${link}` : null
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0b2a6f;line-height:1.5">
<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(message)}</p>
${url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1a6dff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Open in WonderTutor</a></p>` : ''}
<p>— WonderTutor</p>
${note ? `<p style="font-size:12px;color:#5b6b8c">${escapeHtml(note)}</p>` : ''}
</div>`
}

// Also accepts a user id, so booking code never needs to expose email addresses
// in its public DTOs. This is separate for notices already stored in a transaction.
export async function sendNotificationEmail(userOrId, payload, { note } = {}) {
  try {
    const user = typeof userOrId === 'number'
      ? await prisma.user.findUnique({ where: { id: userOrId }, select: { email: true, fullName: true, deletedAt: true } })
      : userOrId
    if (!user?.email || user.deletedAt) return false
    await sendEmail({
      to: user.email,
      subject: `WonderTutor — ${payload.title}`,
      html: renderEmail({ name: user.fullName, message: payload.message, link: payload.link, note }),
    })
    return true
  } catch (err) {
    console.error('Email failed:', err.message)
    return false
  }
}

// Delivery/recipient lookup failures must never undo an already committed action.
// Reminder preferences are checked by the reminder caller; booking changes are
// transactional notices and are sent even when optional reminders are switched off.
export async function notifyWithEmail(userOrId, payload, options = {}) {
  const notification = await notify(typeof userOrId === 'number' ? userOrId : userOrId.id, payload)
  await sendNotificationEmail(userOrId, payload, options)
  return notification
}
