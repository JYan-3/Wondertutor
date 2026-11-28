// Applies verified gateway results to our records. ToyyibPay, legacy Billplz and
// the development simulator share these commission, confirmation and refund rules.
import { Prisma } from '@prisma/client'
import { PAYMENT_DEADLINE_MINUTES } from './paymentWindow.js'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { notify, notifyWithEmail } from './notification.service.js'

const settleInclude = { booking: { include: { tutor: { include: { user: true } }, child: true, parent: { include: { user: true } } } } }

// real = true for a real gateway: the money has already moved, so it must never be thrown away
// (see "paid too late" below). The mock gateway keeps the stricter behaviour: nothing is charged, so we just refuse.
export async function settlePayment(paymentId, { paid, method = 'FPX', real = false }) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: settleInclude })
  if (!payment) throw new AppError(404, 'Payment not found')
  // Gateways retry callbacks and people refresh pages, so a payment that is already settled is not an error
  // Cancellation/expiry closes local checkout as FAILED, but cannot stop a bank
  // transfer already underway. A verified paid gateway result must still be recorded.
  const payableStatuses = real && paid ? ['PENDING', 'FAILED'] : ['PENDING']
  if (!payableStatuses.includes(payment.status)) return { result: 'ALREADY', payment }

  if (!paid) {
    const { count } = await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    return { result: count ? 'FAILED' : 'ALREADY', payment }
  }

  let b = payment.booking
  // Commission: platform base rate unless the Admin set a rate for this tutor. The rate is snapshotted on the
  // Payment so later rate changes never alter past transactions.
  const base = await prisma.systemSetting.findUnique({ where: { key: 'BASE_COMMISSION_RATE' } })
  const rate = b.tutor.commissionRate ?? new Prisma.Decimal(base?.value ?? 0)
  const commissionAmount = new Prisma.Decimal(payment.amount).mul(rate).div(100).toDecimalPlaces(2)

  let late = false
  let closedAlternatives = []
  // Both changes are conditional, so a double click (or the scheduler expiring the booking at the same moment)
  // cannot confirm twice or confirm a booking that was released.
  await prisma.$transaction(async (tx) => {
    // Serialize settlement with other reservations for the same child.
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${b.tutorId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Child WHERE id = ${b.childId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${b.id} FOR UPDATE`
    const latestBooking = await tx.booking.findUniqueOrThrow({ where: { id: b.id }, select: { startAt: true, endAt: true } })
    b = { ...b, ...latestBooking }
    const clash = await tx.booking.findFirst({ where: { id: { not: b.id }, childId: b.childId, status: 'CONFIRMED', startAt: { lt: b.endAt }, endAt: { gt: b.startAt } }, select: { id: true } })
    if (clash && !real) throw new AppError(409, 'This child already has a confirmed lesson at that time. You have not been charged.')
    const done = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: payableStatuses } },
      data: { status: 'PAID', paidAt: new Date(), method, commissionRate: rate, commissionAmount },
    })
    if (!done.count) throw new AppError(409, 'This payment has already been processed')
    const now = new Date()
    const confirmed = clash ? { count: 0 } : await tx.booking.updateMany({ where: { id: payment.bookingId, status: 'AWAITING_PAYMENT',
      startAt: { gt: new Date(now.getTime() + PAYMENT_DEADLINE_MINUTES * 60_000) }, OR: [{ payBy: null }, { payBy: { gt: now } }],
    }, data: { status: 'CONFIRMED' } })
    if (confirmed.count) {
      closedAlternatives = await tx.booking.findMany({ where: { id: { not: b.id }, childId: b.childId, status: { in: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT'] }, startAt: { lt: b.endAt }, endAt: { gt: b.startAt } }, select: { id: true, tutor: { select: { userId: true } } } })
      const ids = closedAlternatives.map(row => row.id)
      if (ids.length) {
        await tx.booking.updateMany({ where: { id: { in: ids }, status: { in: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT'] } }, data: { status: 'CANCELLED', cancelReason: 'Another lesson for this child was confirmed at the same time.' } })
        await tx.payment.updateMany({ where: { bookingId: { in: ids }, status: 'PENDING' }, data: { status: 'FAILED' } })
        await tx.rescheduleRequest.updateMany({ where: { bookingId: { in: ids }, status: { in: ['PENDING', 'ESCALATED'] } }, data: { status: 'REJECTED' } })
        await tx.notification.createMany({ data: closedAlternatives.map(row => ({ userId: row.tutor.userId, type: 'BOOKING_CANCELLED', title: 'Alternative request closed', message: 'Another lesson for this child was confirmed at the same time.', link: '/tutor/bookings' })) })
      }
      return
    }
    if (!real) throw new AppError(400, 'This booking is no longer waiting for payment. You have not been charged.')
    // Paid too late: the parent paid at the gateway after the booking was cancelled or its slot released.
    // The money is real, so keep the record and queue a full refund for the Admin instead of losing it.
    late = true
    await tx.booking.updateMany({ where: { id: b.id, status: 'AWAITING_PAYMENT' }, data: { status: 'CANCELLED', cancelReason: clash ? 'Another lesson for this child was confirmed at the same time.' : 'Payment arrived after the booking deadline.' } })
    await tx.refund.create({
      data: { paymentId: payment.id, amount: payment.amount, type: 'AUTO', reason: clash ? 'Payment was received after another lesson was confirmed for this child, so this lesson was not confirmed.' : 'Paid after the booking was cancelled or released, so the lesson was not confirmed.' },
    })
  })

  const parentUser = b.parent.user
  if (late) {
    await notify(parentUser.id, {
      type: 'REFUND_REQUESTED',
      title: 'Payment received but the lesson was not confirmed',
      message: `We received RM ${Number(payment.amount).toFixed(2)}, but the booking had already been cancelled or released. A full refund has been queued.`,
      link: '/parent/payments',
    })
    return { result: 'LATE', payment }
  }

  const when = b.startAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
  // Payment success + booking confirmed are record-worthy, so they are also emailed
  await notifyWithEmail(parentUser, {
    type: 'PAYMENT_SUCCESS',
    title: 'Payment successful. Booking confirmed',
    message: `We received RM ${Number(payment.amount).toFixed(2)} for ${b.child.name}'s ${b.subject} lesson with ${b.tutor.user.fullName} on ${when}.${closedAlternatives.length ? ' Other requests for the same time were closed.' : ''}`,
    link: '/parent/bookings',
  })
  await notify(b.tutor.userId, {
    type: 'BOOKING_CONFIRMED',
    title: 'Booking confirmed',
    message: `${parentUser.fullName} paid for the ${b.subject} lesson on ${when}.`,
    link: '/tutor/bookings',
  })
  return { result: 'SUCCESS', payment }
}
