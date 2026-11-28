import { tutorRefunds, tutorPaymentStatus } from './tutorRefundStatus.js'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { assertSlotBookable, assertChildFree } from './booking.service.js'
import { newPayBy, assertCanAccept, paymentDeadline } from './paymentWindow.js'
import { notifyWithEmail } from './notification.service.js'
import { formatLessonTime } from '../utils/time.js'
import { lessonLocationFields } from './lessonLocation.service.js'
import { CANCELLATION_CHOICE_HOURS, cancellationResponseDeadline } from './cancellationChoice.service.js'

const include = {
  payment: { select: { status: true, refunds: tutorRefunds } },
  parent: { select: { userId: true, user: { select: { id: true, fullName: true, email: true, createdAt: true } },
    _count: { select: { bookings: { where: { status: 'COMPLETED' } } } } } },
  tutor: { select: { userId: true } },
  child: { select: { id: true, name: true, grade: true, educationLevel: true } },
  reschedules: { orderBy: { createdAt: 'desc' }, take: 1 },
}

export async function ownBooking(tutorId, id, db = prisma) {
  const b = await db.booking.findFirst({ where: { tutorId, id }, include })
  if (!b) throw new AppError(404, 'Booking not found')
  return b
}

export function tutorBooking(b) {
  const r = b.reschedules[0]
  return {
    id: b.id, publicId: b.publicId, subject: b.subject, parentName: b.parent.user.fullName, child: b.child,
    payment: tutorPaymentStatus(b.payment),
    report: b.status === 'COMPLETED' ? b.summary ?? null : null,
    parentSince: b.parent.user.createdAt, completedLessons: b.parent._count.bookings,
    startAt: b.startAt, endAt: b.endAt, status: b.status, teachingMode: b.teachingMode,
    proposedPrice: Number(b.proposedPrice), counterPrice: b.counterPrice, agreedPrice: b.agreedPrice,
    messageToTutor: b.messageToTutor, location: b.location, meetingLink: b.meetingLink,
    ...lessonLocationFields(b),
    rejectionReason: b.rejectionReason, cancelReason: b.cancelReason, cancellationChoice: b.cancellationChoiceStatus && { status: b.cancellationChoiceStatus, until: b.cancellationChoiceUntil }, payBy: b.status === 'AWAITING_PAYMENT' ? paymentDeadline(b) : b.payBy, updatedAt: b.updatedAt,
    reschedule: r && { id: r.id, status: r.status, startAt: r.newStartAt, reason: r.reason, mine: r.requestedById === b.tutor.userId, responseBy: b.status === 'CANCELLED' && b.cancellationChoiceStatus === 'RESCHEDULING' && r.status === 'PENDING' ? cancellationResponseDeadline(r) : null },
  }
}

export async function listBookings(tutorId) {
  const rows = await prisma.booking.findMany({ where: { tutorId }, include: { ...include, summary: { select: { progressNote: true, homework: true } } }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }] })
  return rows.map(tutorBooking)
}

export async function checkOfferTime(tx, b) {
  try {
    await assertSlotBookable({ ...b, ignoreBookingId: b.id }, tx)
  } catch (err) {
    if (err instanceof AppError) throw new AppError(409, 'You are no longer available at this time.')
    throw err
  }
  await assertChildFree({ ...b, ignoreBookingId: b.id }, tx)
}

export async function escalateBooking(tx, b, userId, reason) {
  const category = ['PENDING', 'COUNTER_OFFERED'].includes(b.status) ? 'Fee negotiation' : 'Booking cancellation'
  if (!['PENDING', 'COUNTER_OFFERED', 'CANCELLED', 'CONFIRMED', 'AWAITING_PAYMENT'].includes(b.status)) throw new AppError(409, 'This booking cannot be escalated.')
  const where = { bookingId: b.id, category, status: { in: ['OPEN', 'IN_PROGRESS'] } }
  if (await tx.complaint.findFirst({ where })) throw new AppError(409, 'Admin is already reviewing this issue.')
  await tx.complaint.create({ data: { bookingId: b.id, filedById: userId, category, description: reason } })
  const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  if (admins.length) await tx.notification.createMany({ data: admins.map(a => ({ userId: a.id, type: 'BOOKING_ESCALATED', title: category + ' needs review', message: reason, link: '/admin/bookings' })) })
}

export async function tutorAction(tutorId, id, input) {
  const { action, reason } = input
  const first = await ownBooking(tutorId, id)
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`
    // Take both reservation locks before the first consistent read in this transaction.
    if (action === 'accept' || action === 'counter') await tx.$queryRaw`SELECT id FROM Child WHERE id = ${first.childId} FOR UPDATE`
    const b = await ownBooking(tutorId, id, tx)
    if (b.updatedAt.toISOString() !== input.version) throw new AppError(409, 'This booking changed. Refresh before responding.')
    if (action === 'escalate') {
      await escalateBooking(tx, b, b.tutor.userId, reason)
      return { b, title: 'Tutor requested admin review', message: reason }
    }
    let data, title, message
    if (['accept', 'counter', 'decline'].includes(action)) {
      if (b.status !== 'PENDING') throw new AppError(409, 'This request has already been answered.')
      if (action !== 'decline') {
        await checkOfferTime(tx, b)
        assertCanAccept(b.startAt)
      }
      if (action === 'accept') {
        data = { status: 'AWAITING_PAYMENT', agreedPrice: b.proposedPrice, payBy: newPayBy(b.startAt) }
        title = 'Tutor accepted your request'
        message = 'Pay to confirm your ' + b.subject + ' lesson.'
      } else if (action === 'counter') {
        if (input.price === Number(b.proposedPrice)) throw new AppError(400, 'Choose a different hourly rate or accept the offer.')
        data = { status: 'COUNTER_OFFERED', counterPrice: input.price }
        title = 'Tutor proposed a different rate'
        message = `Your tutor offered RM${input.price.toFixed(2)} per hour for ${b.subject} (your proposed rate: RM${Number(b.proposedPrice).toFixed(2)} per hour).`
      } else {
        data = { status: 'REJECTED', rejectionReason: reason }
        title = 'Tutor declined your request'
        message = reason
      }
    } else if (action === 'link') {
      if (b.teachingMode !== 'ONLINE' || !['AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) || b.endAt <= new Date()) throw new AppError(409, 'Only active online lessons can have a class link.')
      data = { meetingLink: input.url }
      title = 'Online class link updated'
      message = 'Your class link is available in the confirmed lesson details.'
    } else {
      if (!['AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) || b.startAt <= new Date()) throw new AppError(409, 'This lesson can no longer be cancelled.')
      if (b.payment?.status === 'PARTIALLY_REFUNDED' || b.payment?.refunds.some(r => ['PENDING', 'APPROVED', 'ESCALATED'].includes(r.status))) throw new AppError(409, 'A refund already exists for this payment. Ask admin to review the cancellation.')
      data = { status: 'CANCELLED', cancelReason: reason, cancelledById: b.tutor.userId }
      if (b.payment?.status === 'PAID') {
        data.cancellationChoiceStatus = 'OPEN'
        data.cancellationChoiceUntil = new Date(Date.now() + CANCELLATION_CHOICE_HOURS * 3_600_000)
      }
      title = 'Tutor cancelled your lesson'
      message = b.payment?.status === 'PAID' ? `${reason} Choose a new time or request a refund within ${CANCELLATION_CHOICE_HOURS} hours. If you do not choose, the refund goes to admin review.` : reason
    }
    const changed = await tx.booking.updateMany({ where: { id, tutorId, updatedAt: b.updatedAt, status: b.status }, data })
    if (!changed.count) throw new AppError(409, 'This booking changed. Refresh before responding.')
    if (action === 'cancel') {
      await tx.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } })
      await tx.rescheduleRequest.updateMany({ where: { bookingId: id, status: { in: ['PENDING', 'ESCALATED'] } }, data: { status: 'REJECTED' } })
    }
    return { b, title, message }
  })
  const { b, title, message } = result
  const payload = { title, message: `${message || 'Open the booking for details.'} Lesson: ${b.subject} on ${formatLessonTime(b.startAt, b.endAt)}.`, type: 'TUTOR_' + action.toUpperCase(), link: '/parent/bookings?booking=' + publicReference(b) }
  if (action !== 'link' || b.status === 'CONFIRMED') await notifyWithEmail(b.parent.user, payload)
}
