import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'

export const CANCELLATION_CHOICE_HOURS = 48
export const CANCELLATION_RESPONSE_HOURS = 24
export const cancellationResponseDeadline = request => new Date(request.createdAt.getTime() + CANCELLATION_RESPONSE_HOURS * 3_600_000)

export async function createCancellationRefund(tx, b) {
  if (!b.payment || b.payment.status !== 'PAID') throw new AppError(409, 'The payment has changed. Contact admin for help.')
  await tx.$queryRaw`SELECT id FROM Payment WHERE id = ${b.payment.id} FOR UPDATE`
  const existing = await tx.refund.findFirst({ where: { paymentId: b.payment.id, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] } } })
  if (!existing) await tx.refund.create({ data: { paymentId: b.payment.id, amount: b.payment.amount, type: 'AUTO', reason: b.cancelReason || 'Tutor cancelled the lesson' } })
  await tx.rescheduleRequest.updateMany({ where: { bookingId: b.id, status: { in: ['PENDING', 'ESCALATED'] } }, data: { status: 'REJECTED' } })
  await tx.booking.update({ where: { id: b.id }, data: { cancellationChoiceStatus: 'REFUND' } })
}

// The tutor and booking locks serialize refund choices with reschedule decisions.
export async function queueCancellationRefund(bookingId, { parentId, expired = false, responseExpired = false, now = new Date() } = {}) {
  const ids = await prisma.booking.findUnique({ where: { id: bookingId }, select: { tutorId: true } })
  if (!ids) throw new AppError(404, 'Booking not found')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${ids.tutorId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${bookingId} FOR UPDATE`
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { payment: true, parent: true, tutor: true } })
    if (!b || (parentId && b.parentId !== parentId)) throw new AppError(404, 'Booking not found')
    if (b.status !== 'CANCELLED' || !['OPEN', 'RESCHEDULING'].includes(b.cancellationChoiceStatus)) {
      if (expired || responseExpired) return false
      throw new AppError(409, 'This cancellation choice has already changed. Refresh the booking.')
    }
    if (expired && (b.cancellationChoiceStatus !== 'OPEN' || b.cancellationChoiceUntil > now)) return false
    if (responseExpired) {
      if (b.cancellationChoiceStatus !== 'RESCHEDULING') return false
      const request = await tx.rescheduleRequest.findFirst({ where: { bookingId, status: 'PENDING', requestedById: b.parent.userId }, orderBy: { createdAt: 'desc' } })
      if (!request || cancellationResponseDeadline(request) > now) return false
    }
    await createCancellationRefund(tx, b)
    const text = responseExpired ? 'The tutor did not respond within 24 hours. Your refund is now waiting for admin review.' : expired ? 'The choice period ended. Your refund is now waiting for admin review.' : 'Your refund request is now waiting for admin review.'
    await tx.notification.createMany({ data: [
      { userId: b.parent.userId, type: 'REFUND_REQUESTED', title: 'Refund sent for review', message: text, link: '/parent/bookings?booking=' + publicReference(b) },
      { userId: b.tutor.userId, type: 'REFUND_REQUESTED', title: 'Cancelled lesson: refund requested', message: 'The parent’s refund is waiting for admin review.', link: '/tutor/bookings?booking=' + publicReference(b) },
    ] })
    const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
    if (admins.length) await tx.notification.createMany({ data: admins.map(admin => ({ userId: admin.id, type: 'REFUND_REQUESTED', title: 'Cancelled lesson refund needs review', message: 'A tutor-cancelled lesson has a refund waiting for review.', link: '/admin/finance' })) })
    return true
  })
}

export async function expireCancellationResponses(now = new Date()) {
  const before = new Date(now.getTime() - CANCELLATION_RESPONSE_HOURS * 3_600_000)
  const due = await prisma.booking.findMany({
    where: { status: 'CANCELLED', cancellationChoiceStatus: 'RESCHEDULING', reschedules: { some: { status: 'PENDING', createdAt: { lte: before } } } },
    select: { id: true },
  })
  let queued = 0
  for (const b of due) if (await queueCancellationRefund(b.id, { responseExpired: true, now })) queued++
  return { queued }
}

export async function remindCancellationResponses(now = new Date()) {
  const start = new Date(now.getTime() - CANCELLATION_RESPONSE_HOURS * 3_600_000)
  const end = new Date(now.getTime() - (CANCELLATION_RESPONSE_HOURS - 6) * 3_600_000)
  const due = await prisma.rescheduleRequest.findMany({ where: { status: 'PENDING', createdAt: { gt: start, lte: end }, booking: { status: 'CANCELLED', cancellationChoiceStatus: 'RESCHEDULING' } }, include: { booking: { include: { parent: true, tutor: true } } } })
  let sent = 0
  for (const request of due) {
    const b = request.booking
    if (request.requestedById !== b.parent.userId) continue
    const link = `/tutor/bookings?booking=${publicReference(b)}&reschedule=${request.id}`
    const added = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${b.tutorId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${b.id} FOR UPDATE`
      const current = await tx.booking.findUnique({ where: { id: b.id }, select: { status: true, cancellationChoiceStatus: true } })
      const pending = await tx.rescheduleRequest.findUnique({ where: { id: request.id } })
      if (current?.status !== 'CANCELLED' || current.cancellationChoiceStatus !== 'RESCHEDULING' || pending?.status !== 'PENDING' || cancellationResponseDeadline(pending) <= now) return false
      if (await tx.notification.findFirst({ where: { userId: b.tutor.userId, type: 'CANCELLATION_RESPONSE_REMINDER', link } })) return false
      await tx.notification.create({ data: { userId: b.tutor.userId, type: 'CANCELLATION_RESPONSE_REMINDER', title: 'Reply to the new lesson time', message: 'Please reply within 24 hours of the parent’s request. Otherwise, the refund goes to admin review.', link } })
      return true
    })
    if (added) sent++
  }
  return { sent }
}

export async function expireCancellationChoices(now = new Date()) {
  const due = await prisma.booking.findMany({ where: { status: 'CANCELLED', cancellationChoiceStatus: 'OPEN', cancellationChoiceUntil: { lte: now } }, select: { id: true } })
  let queued = 0
  for (const b of due) if (await queueCancellationRefund(b.id, { expired: true, now })) queued++
  return { queued }
}
