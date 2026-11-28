import { prisma } from '../config/prisma.js'
import { sendNotificationEmail } from './notification.service.js'

// A short lease prevents simultaneous workers sending the same queued email.
export async function deliverPaymentEmail(id, now = new Date()) {
  const leaseUntil = new Date(now.getTime() + 60_000)
  const claim = await prisma.paymentEmailDelivery.updateMany({ where: { id, sentAt: null, retryAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseUntil, attempts: { increment: 1 } } })
  if (!claim.count) return false
  const delivery = await prisma.paymentEmailDelivery.findUniqueOrThrow({ where: { id } })
  const sent = await sendNotificationEmail(delivery.userId, delivery)
  await prisma.paymentEmailDelivery.updateMany({ where: { id, sentAt: null, leaseUntil }, data: sent ? { sentAt: new Date(), leaseUntil: null } : { retryAt: new Date(now.getTime() + 5 * 60_000), leaseUntil: null } })
  return sent
}

export async function retryPaymentEmails(now = new Date()) {
  const pending = await prisma.paymentEmailDelivery.findMany({ where: { sentAt: null, retryAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, select: { id: true }, take: 5, orderBy: { id: 'asc' } })
  const results = await Promise.allSettled(pending.map(row => deliverPaymentEmail(row.id, now)))
  if (results.some(result => result.status === 'rejected')) throw new Error('Could not process queued payment emails')
}
