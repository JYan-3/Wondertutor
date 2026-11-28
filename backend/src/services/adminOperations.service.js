import { attendanceRefundState } from './attendanceRefund.js'
import { createCancellationRefund } from './cancellationChoice.service.js'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { baseCommission } from './systemSettings.service.js'
import { assertSlotBookable, assertChildFree } from './booking.service.js'
import { assertCanAccept, newPayBy, paymentDeadline } from './paymentWindow.js'
import { renderEmail } from './notification.service.js'
import { sendBookingPush } from './webPush.service.js'
import { sendEmail } from './email.service.js'
import { assertRequestLessonDate } from './bookingCutoff.js'
import { mytParts } from '../utils/time.js'

const lockTutor = (tx, id) => tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${id} FOR UPDATE`
const stale = () => new AppError(409, 'This record has changed. Refresh and review the current details.')
const zero = new Prisma.Decimal(0)
const person = { select: { user: { select: { id: true, fullName: true, email: true } } } }
const parties = { parent: person, tutor: person }
async function mail(user, payload) {
  try { await sendEmail({ to: user.email, subject: 'WonderTutor — ' + payload.title, html: renderEmail({ ...payload, name: user.fullName }) }) }
  catch { console.error('Decision email could not be delivered') }
}

export async function listRates() {
  const [base, tutors] = await Promise.all([baseCommission(prisma), prisma.tutorProfile.findMany({
    select: { id: true, user: { select: { fullName: true } }, hourlyRate: true, commissionRate: true,
      rateHistory: { orderBy: { id: 'desc' } } }, orderBy: { user: { fullName: 'asc' } },
  })])
  return { base, tutors: tutors.map(t => ({ id: t.id, name: t.user.fullName, hourly: t.hourlyRate,
    commission: t.commissionRate ?? base, history: t.rateHistory })) }
}

export async function setRate(tutorId, admin, input) {
  const result = await prisma.$transaction(async tx => {
    await lockTutor(tx, tutorId)
    const tutor = await tx.tutorProfile.findUnique({ where: { id: tutorId }, include: { user: true } })
    if (!tutor) throw new AppError(404, 'Tutor not found')
    const commission = input.kind === 'COMMISSION'
    const field = commission ? 'commissionRate' : 'hourlyRate'
    const previous = new Prisma.Decimal(tutor[field] ?? await baseCommission(tx))
    if (!previous.eq(input.previous)) throw stale()
    if (previous.eq(input.rate)) throw new AppError(400, 'Enter a different rate.')
    await tx.tutorProfile.update({ where: { id: tutorId }, data: { [field]: input.rate } })
    await tx.tutorRateChange.create({ data: { tutorId, ...input, previous, changedBy: admin.fullName, adminId: admin.id } })
    const payload = { title: commission ? 'Commission rate changed' : 'Hourly salary rate changed',
      message: (commission ? input.rate + '%' : 'RM ' + input.rate + ' per hour') + ' takes effect now. ' + input.reason,
      link: commission ? '/tutor/earnings' : '/tutor/setup', type: 'RATE_UPDATED' }
    await tx.notification.create({ data: { userId: tutor.userId, ...payload } })
    return { user: tutor.user, payload }
  })
  await mail(result.user, result.payload)
}

const relatedCases = ['Fee negotiation', 'Booking cancellation']
export async function bookingOverview({ where = {}, skip, take } = {}) {
  const rows = await prisma.booking.findMany({ where, ...(skip != null && { skip }), ...(take != null && { take }), include: { ...parties, child: { select: { name: true } },
    reschedules: { where: { status: 'ESCALATED' } },
    complaints: { where: { category: { in: relatedCases }, status: { in: ['OPEN','IN_PROGRESS'] } } },
    attendance: { select: { checkInAt: true, checkOutAt: true, checkInDistance: true } },
  }, orderBy: [{ startAt: 'desc' }, { id: 'desc' }] })
  return rows.map(b => ({ id: b.id, parent: b.parent.user.fullName, tutor: b.tutor.user.fullName, student: b.child.name, subject: b.subject,
    startAt: b.startAt, endAt: b.endAt, status: b.status, cancellationChoiceStatus: b.cancellationChoiceStatus, mode: b.teachingMode, offered: b.proposedPrice, counter: b.counterPrice, agreed: b.agreedPrice,
    attendance: b.attendance, version: b.updatedAt, cases: [
      ...b.reschedules.map(x => ({ id: x.id, kind: 'Schedule change', reason: x.reason, proposed: x.newStartAt })),
      ...b.complaints.map(x => ({ id: x.id, kind: x.category, reason: x.description })),
    ] }))
}

export async function bookingPage({ view, q, status, page, pageSize, all = false }) {
  const query = q?.trim()
  const where = {
    ...(status && { status }),
    ...(view === 'escalations' && { OR: [{ reschedules: { some: { status: 'ESCALATED' } } }, { complaints: { some: { category: { in: relatedCases }, status: { in: ['OPEN', 'IN_PROGRESS'] } } } }] }),
    ...(query && { AND: [{ OR: [
      ...(/^\d+$/.test(query) && Number(query) <= 2147483647 ? [{ id: Number(query) }] : []),
      { subject: { contains: query } }, { child: { name: { contains: query } } },
      { parent: { user: { fullName: { contains: query } } } }, { tutor: { user: { fullName: { contains: query } } } },
    ] }] }),
  }
  const total = await prisma.booking.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, totalPages)
  const rows = await bookingOverview({ where, ...(all ? {} : { skip: (current - 1) * pageSize, take: pageSize }) })
  return { rows, pagination: { total, page: current, pageSize, totalPages } }
}

export async function decideBooking(id, adminId, input) {
  const ids = await prisma.booking.findUnique({ where: { id }, select: { tutorId: true, childId: true } })
  if (!ids) throw new AppError(404, 'Booking not found')
  const notices = await prisma.$transaction(async tx => {
    await lockTutor(tx, ids.tutorId)
    await tx.$queryRaw`SELECT id FROM Child WHERE id = ${ids.childId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${id} FOR UPDATE`
    const b = await tx.booking.findUniqueOrThrow({ where: { id }, include: { ...parties, payment: true } })
    if (b.updatedAt.toISOString() !== input.version) throw stale()
    const schedule = input.kind === 'Schedule change'
    const cancelledChoice = schedule && b.status === 'CANCELLED' && b.cancellationChoiceStatus === 'RESCHEDULING'
    const issue = schedule ? await tx.rescheduleRequest.findFirst({ where: { id: input.caseId, bookingId: id, status: 'ESCALATED' } }) :
      await tx.complaint.findFirst({ where: { id: input.caseId, bookingId: id, category: input.kind, status: { in: ['OPEN','IN_PROGRESS'] } } })
    if (!issue) throw stale()
    let outcome = 'Keep current booking'
    if (input.action === 'move' || input.action === 'set-fee') {
      const move = input.action === 'move'
      if (move ? !schedule || (!cancelledChoice && !['CONFIRMED','AWAITING_PAYMENT'].includes(b.status)) : input.kind !== 'Fee negotiation' || !['PENDING','COUNTER_OFFERED'].includes(b.status)) throw stale()
      if ((!cancelledChoice && b.startAt <= new Date()) || (b.status === 'AWAITING_PAYMENT' && paymentDeadline(b) <= new Date())) throw new AppError(409, 'This lesson or payment hold has expired.')
      if (cancelledChoice && (!b.payment || b.payment.status !== 'PAID' || await tx.refund.count({ where: { paymentId: b.payment.id, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] } } }))) throw new AppError(409, 'This payment is already being reviewed for a refund.')
      const slot = { tutorId: b.tutorId, childId: b.childId, ignoreBookingId: id, teachingMode: b.teachingMode,
        startAt: move ? issue.newStartAt : b.startAt, endAt: move ? issue.newEndAt : b.endAt }
      if (move) assertRequestLessonDate(mytParts(slot.startAt).date)
      await assertSlotBookable(slot, tx)
      await assertChildFree(slot, tx)
      if (!move || b.status === 'AWAITING_PAYMENT') assertCanAccept(slot.startAt)
      await tx.booking.update({ where: { id }, data: move ? { startAt: slot.startAt, endAt: slot.endAt, ...(cancelledChoice && { status: 'CONFIRMED', cancellationChoiceStatus: 'RESCHEDULED', cancelReason: null, cancelledById: null }) } :
        { agreedPrice: input.price, status: 'AWAITING_PAYMENT', payBy: newPayBy(b.startAt) } })
      outcome = move ? 'Schedule change approved' : 'Final fee: RM ' + input.price + ' per hour. Payment required'
    } else if (input.action === 'cancel') {
      if (!['PENDING','COUNTER_OFFERED','AWAITING_PAYMENT','CONFIRMED'].includes(b.status) || b.startAt <= new Date()) throw stale()
      await tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: adminId, cancelReason: input.reason } })
      await tx.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } })
      if (['PAID', 'PARTIALLY_REFUNDED'].includes(b.payment?.status)) {
        const refunds = await tx.refund.findMany({ where: { paymentId: b.payment.id } })
        const reserved = refunds.filter(r => r.status === 'APPROVED').reduce((sum, r) => sum.plus(r.amount), zero)
        const remaining = b.payment.amount.minus(reserved)
        if (remaining.gt(0) && !refunds.some(r => ['PENDING', 'ESCALATED'].includes(r.status))) {
          await tx.refund.create({ data: { paymentId: b.payment.id, amount: remaining, type: 'ADMIN_REVIEW', reason: input.reason } })
        }
      }
      await tx.rescheduleRequest.updateMany({ where: { bookingId: id, status: { in: ['PENDING', 'ESCALATED'] } }, data: { status: 'REJECTED' } })
      outcome = 'Booking cancelled'
    } else if (cancelledChoice && input.action === 'keep') {
      await createCancellationRefund(tx, b)
      outcome = 'New time declined; refund sent for review'
    }
    const message = outcome + '. ' + input.reason
    if (schedule) await tx.rescheduleRequest.update({ where: { id: issue.id }, data: { status: input.action === 'move' ? 'APPROVED' : 'REJECTED' } })
    else {
      const closed = await tx.complaint.updateMany({ where: { id: issue.id, status: issue.status, updatedAt: issue.updatedAt },
        data: { status: 'RESOLVED', handledById: adminId, adminResponse: message } })
      if (!closed.count) throw stale()
    }
    const decision = { type: 'BOOKING_DECISION', title: 'Admin decision on ' + b.subject, message }
    const notices = [
      { ...decision, userId: b.parent.user.id, link: '/parent/bookings?booking=' + publicReference(b) },
      { ...decision, userId: b.tutor.user.id, link: '/tutor/bookings?booking=' + id },
    ]
    await tx.notification.createMany({ data: notices })
    return notices
  })
  await Promise.all(notices.map(({ userId, type, link }) => sendBookingPush(userId, { type, link })))
}

export async function refundQueue(pagination) {
  const where = { OR: [{ status: { in: ['PENDING', 'ESCALATED'] } }, { status: 'APPROVED', issuedAt: null, OR: [{ reviewNote: { not: '' } }, { payment: { status: 'PAID' } }] }] }
  const total = pagination ? await prisma.refund.count({ where }) : null
  const totalPages = pagination ? Math.max(1, Math.ceil(total / pagination.pageSize)) : null
  const page = pagination ? Math.min(pagination.page, totalPages) : null
  const rows = await prisma.refund.findMany({ where,
    include: { attendanceCases: { select: { status: true, attendanceOutcome: true, appealUntil: true, appealUsed: true }, take: 1 }, payment: { include: { booking: { include: parties } } } }, orderBy: { id: 'asc' }, ...(pagination && { skip: (page - 1) * pagination.pageSize, take: pagination.pageSize }) })
  const result = rows.map(r => ({ id: r.id, bookingId: r.payment.bookingId, parent: r.payment.booking.parent.user.fullName,
    attendanceRefundState: attendanceRefundState(r.attendanceCases[0], r), attendanceOutcome: r.attendanceCases[0]?.attendanceOutcome, reason: r.reason, type: r.type, policy: r.policy, status: r.status, amount: r.amount, paid: r.payment.amount, decision: r.reviewNote }))
  return pagination ? { rows: result, pagination: { page, pageSize: pagination.pageSize, total, totalPages } } : result
}

export async function decideRefund(id, adminId, input) {
  const ref = await prisma.refund.findUnique({ where: { id }, select: { paymentId: true, payment: { select: { bookingId: true, booking: { select: { tutorId: true } } } } } })
  if (!ref) throw new AppError(404, 'Refund not found')
  const result = await prisma.$transaction(async tx => {
    await lockTutor(tx, ref.payment.booking.tutorId)
    // Reconsideration and the final attendance decision lock this booking before updating the case.
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${ref.payment.bookingId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Payment WHERE id = ${ref.paymentId} FOR UPDATE`
    const r = await tx.refund.findUniqueOrThrow({ where: { id }, include: { attendanceCases: { select: { status: true, attendanceOutcome: true, appealUntil: true, appealUsed: true } }, payment: { include: { booking: { include: parties }, refunds: true } } } })
    const p = r.payment, b = p.booking
    if (r.attendanceCases.some(c => attendanceRefundState(c, r) === 'ON_HOLD')) throw new AppError(409, 'Refund on hold while admin reviews the attendance evidence.')
    if (input.action === 'reject' && r.attendanceCases.some(c => c.status === 'DISMISSED' && c.attendanceOutcome === 'NOT_HELD')) throw new AppError(409, 'The remaining payment must be refunded when the lesson did not take place.')
    const issue = input.action === 'issued'
    if (issue && r.attendanceCases.some(c => attendanceRefundState(c, r) === 'AWAITING_APPEAL')) throw new AppError(409, 'The refund transfer must wait until the tutor’s 14-day reconsideration period ends.')
    const transferred = x => x.issuedAt || (x.status === 'APPROVED' && !x.reviewNote && ['REFUNDED','PARTIALLY_REFUNDED'].includes(p.status))
    if (transferred(r) || (issue ? r.status !== 'APPROVED' : !['PENDING', 'ESCALATED'].includes(r.status))) throw stale()
    const approved = p.refunds.filter(x => x.id !== id && x.status === 'APPROVED').reduce((n,x) => n.plus(x.amount), zero)
    const amount = input.action === 'approve' ? new Prisma.Decimal(input.amount) : r.amount
    if (input.action === 'approve' && ['PARENT_EARLY', 'PARENT_LATE', 'ATTENDANCE_NOT_HELD'].includes(r.policy) && !amount.eq(r.amount)) throw new AppError(400, 'Approve the refund amount shown for this policy.')
    if (input.action !== 'reject' && (!['PAID','PARTIALLY_REFUNDED'].includes(p.status) || amount.gt(r.amount) || amount.plus(approved).gt(p.amount))) throw new AppError(409, 'Amount exceeds the refundable payment.')
    if (issue) {
      const issued = p.refunds.filter(transferred).reduce((n,x) => n.plus(x.amount), amount)
      try {
        await tx.refund.update({ where: { id }, data: { issuedAt: new Date(), transferRef: input.reference } })
      } catch (err) {
        if (err.code === 'P2002') throw new AppError(409, 'This transfer reference has already been recorded.')
        throw err
      }
      await tx.payment.update({ where: { id: p.id }, data: { status: issued.eq(p.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
    } else {
      await tx.refund.update({ where: { id }, data: { status: input.action === 'approve' ? 'APPROVED' : 'REJECTED',
        amount, reviewedAt: new Date(), reviewedById: adminId, reviewNote: input.reason } })
    }
    if (b.status === 'DISPUTED' && (issue || input.action === 'reject')) await tx.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } })
    const title = issue ? 'Refund transfer recorded' : input.action === 'approve' ? 'Refund approved' : 'Refund rejected'
    const message = b.subject + ' · RM ' + amount.toFixed(2) + '. ' + (issue ? 'Transfer reference: ' + input.reference : input.reason)
    const payload = { type: 'REFUND_DECISION', title, message, link: '/parent/payments' }
    const notices = [
      { ...payload, userId: b.parent.user.id },
      { ...payload, userId: b.tutor.user.id, link: '/tutor/earnings' },
    ]
    await tx.notification.createMany({ data: notices })
    return { user: b.parent.user, payload, notices }
  })
  await Promise.all([
    mail(result.user, result.payload),
    ...result.notices.map(({ userId, type, link }) => sendBookingPush(userId, { type, link })),
  ])
}
