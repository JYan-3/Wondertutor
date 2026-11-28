import { ATTENDANCE_APPEAL_DAYS, attendanceRefundState, openAttendanceRefund } from '../../services/attendanceRefund.js'
import { attendanceResponseDeadline, attendanceWaiting } from '../../services/attendanceResponse.js'
import { Prisma } from '@prisma/client'
import { MISSED_CHECK_IN } from '../../services/lessonSession.service.js'
import { publicReference } from '../../utils/publicIds.js'
import { mediaLink } from '../../services/privateMedia.js'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { ymd } from '../../utils/validators.js'
import { notify } from '../../services/notification.service.js'
import { sendBookingPush } from '../../services/webPush.service.js'
import { complaintInclude, toComplaintDto } from '../parent/complaints.controller.js'
import { mytToDate, addDays } from '../../utils/time.js'

// GET /admin/complaints?status=OPEN
export async function listComplaints(req, res) {
  const { status, page: requestedPage, pageSize } = z.object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).parse({ ...req.query, status: req.query.status || undefined })
  const grouped = await prisma.complaint.groupBy({ by: ['status'], _count: { _all: true } })
  const counts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }
  for (const g of grouped) counts[g.status] = g._count._all
  const total = status ? counts[status] : Object.values(counts).reduce((sum, count) => sum + count, 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const items = await prisma.complaint.findMany({ where: status ? { status } : {}, include: complaintInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })
  res.json({ counts, complaints: items.map(toComplaintDto), pagination: { page, pageSize, total, totalPages } })
}

const updateSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'RESOLVED', 'DISMISSED']),
    outcome: z.enum(['MORE_INFO', 'UNVERIFIED', 'NOT_HELD']).optional(),
    reviewedAt: z.iso.datetime().optional(),
    adminResponse: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.status === 'IN_PROGRESS' || (d.adminResponse && d.adminResponse.length >= 3), {
    message: 'Please write a response before resolving or dismissing',
    path: ['adminResponse'],
  })

// Take the same payment lock as parent refund requests before reading the refund queue.
async function attendanceRefund(tx, complaint) {
  await tx.$queryRaw`SELECT id FROM Payment WHERE bookingId = ${complaint.bookingId} FOR UPDATE`
  const payment = await tx.payment.findUnique({ where: { bookingId: complaint.bookingId }, include: { refunds: { orderBy: { id: 'desc' } } } })
  if (!payment || !['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) return null
  const transferred = r => r.issuedAt || (r.status === 'APPROVED' && !r.reviewNote && payment.status === 'PARTIALLY_REFUNDED')
  const paidBack = payment.refunds.filter(transferred).reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0))
  const remaining = payment.amount.minus(paidBack)
  if (remaining.lte(0)) return null
  const open = payment.refunds.filter(r => !transferred(r) && ['PENDING', 'APPROVED', 'ESCALATED'].includes(r.status))
  if (open.length > 1) throw new AppError(409, 'Resolve the existing refund requests before deciding this attendance review.')
  const existing = open[0]
  let refund
  if (existing) {
    const changed = !existing.amount.eq(remaining) || existing.policy !== 'ATTENDANCE_NOT_HELD'
    if (changed && existing.status === 'APPROVED') await tx.attendanceReviewEntry.create({ data: { complaintId: complaint.id, action: 'REFUND_REVIEW', message: 'Fresh finance decision required. Previous approval: RM ' + existing.amount.toFixed(2) + '. ' + (existing.reviewNote || '') } })
    refund = changed ? await tx.refund.update({ where: { id: existing.id }, data: { amount: remaining, policy: 'ATTENDANCE_NOT_HELD', status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null } }) : existing
  } else refund = await tx.refund.create({ data: {
    paymentId: payment.id, amount: remaining, policy: 'ATTENDANCE_NOT_HELD', type: 'ADMIN_REVIEW', reason: 'Admin confirmed the paid lesson did not take place.',
  } })
  await tx.complaint.update({ where: { id: complaint.id }, data: { attendanceRefundId: refund.id } })
  return refund
}

// PATCH /admin/complaints/:id: OPEN -> IN_PROGRESS -> RESOLVED / DISMISSED. The parent is notified.
export async function updateComplaint(req, res) {
  const data = updateSchema.parse(req.body)
  const existing = await prisma.complaint.findUnique({ where: { id: Number(req.params.id) } })
  if (!existing) throw new AppError(404, 'Complaint not found')
  if (['RESOLVED', 'DISMISSED'].includes(existing.status)) throw new AppError(400, 'This complaint is already closed')

  const decidingAttendance = existing.category === MISSED_CHECK_IN && data.status !== 'IN_PROGRESS'
  const asking = data.outcome === 'MORE_INFO'
  if (data.outcome && (existing.category !== MISSED_CHECK_IN || data.status !== (asking ? 'IN_PROGRESS' : 'DISMISSED'))) throw new AppError(400, 'Choose a matching attendance decision.')
  if (asking && !data.adminResponse?.trim()) throw new AppError(400, 'Enter the question for the tutor and parent.')
  const waiting = attendanceWaiting(existing)
  if (decidingAttendance && waiting.tutor) throw new AppError(409, 'Waiting for the tutor to reply or the 48-hour response period to end.')
  if (decidingAttendance && waiting.parent) throw new AppError(409, 'Waiting for the parent to respond or the 48-hour response period to end.')
  if ((decidingAttendance || asking) && data.reviewedAt !== existing.updatedAt.toISOString()) throw new AppError(409, 'Reopen the review to see the latest evidence and parent response.')
  const outcome = data.outcome ?? (data.status === 'DISMISSED' ? 'UNVERIFIED' : data.status === 'RESOLVED' ? 'CONFIRMED' : null)
  const { updated, notices } = await prisma.$transaction(async (tx) => {
    let notices = []
    const decidedAt = new Date()
    const appealUntil = data.status === 'DISMISSED' && !existing.appealUsed ? new Date(decidedAt.getTime() + ATTENDANCE_APPEAL_DAYS * 86_400_000) : null
    if (existing.category === MISSED_CHECK_IN && existing.bookingId) {
      await tx.$queryRaw`SELECT t.id FROM TutorProfile t JOIN Booking b ON b.tutorId = t.id WHERE b.id = ${existing.bookingId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${existing.bookingId} FOR UPDATE`
      if (outcome === 'NOT_HELD') {
        const lesson = await tx.booking.findUniqueOrThrow({ where: { id: existing.bookingId }, select: { endAt: true } })
        if (lesson.endAt > decidedAt) throw new AppError(409, 'Wait until the scheduled lesson ends before deciding it did not take place.')
      }
    }
    const { count } = await tx.complaint.updateMany({
      where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
      data: { ...((asking || decidingAttendance) && { attendanceOutcome: outcome }),
        ...(decidingAttendance && { appealUntil }),
        ...(asking && { tutorReplyPending: true, tutorResponseDueAt: attendanceResponseDeadline(decidedAt), parentAnswer: null, parentNote: null, parentResponseDueAt: attendanceResponseDeadline(decidedAt) }), ...(decidingAttendance && { attendanceApproved: data.status === 'RESOLVED', tutorReplyPending: false }), status: data.status, adminResponse: data.adminResponse ?? existing.adminResponse, handledById: req.user.id },
    })
    if (!count) throw new AppError(409, 'This complaint has just been updated. Please refresh and try again.')
    if (existing.category === MISSED_CHECK_IN && existing.bookingId) {
      if (decidingAttendance && existing.attendanceRefundId && outcome !== 'NOT_HELD') {
        const prior = await tx.refund.findUniqueOrThrow({ where: { id: existing.attendanceRefundId }, include: { payment: { select: { status: true } } } })
        if (prior.status === 'APPROVED' && attendanceRefundState(existing, prior) === 'ON_HOLD') {
          await tx.refund.update({ where: { id: prior.id }, data: { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null, ...(prior.policy === 'ATTENDANCE_NOT_HELD' && { policy: null }) } })
          await tx.attendanceReviewEntry.create({ data: { complaintId: existing.id, action: 'REFUND_REVIEW', message: 'Fresh finance decision required. Previous approval: RM ' + prior.amount.toFixed(2) + '. ' + (prior.reviewNote || '') } })
        } else if (prior.policy === 'ATTENDANCE_NOT_HELD' && ['PENDING', 'ESCALATED'].includes(prior.status)) await tx.refund.update({ where: { id: prior.id }, data: { policy: null } })
      }
      const refund = outcome === 'NOT_HELD' ? await attendanceRefund(tx, existing) : null
      if (decidingAttendance) {
        const paid = outcome === 'NOT_HELD' ? await tx.payment.findUnique({ where: { bookingId: existing.bookingId } }) : null
        const penaltyAmount = paid && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(paid.status) ? paid.amount.mul('0.15').toDecimalPlaces(2) : null
        await tx.complaint.update({ where: { id: existing.id }, data: { penaltyAmount, penaltyEffectiveAt: penaltyAmount ? appealUntil || decidedAt : null } })
      }
      if (asking || decidingAttendance) {
        await tx.attendanceReviewEntry.create({ data: { complaintId: existing.id, action: outcome,
          message: data.adminResponse, evidenceUrl: existing.evidenceUrl } })
        if (asking && existing.parentAnswer) await tx.attendanceReviewEntry.create({ data: {
          complaintId: existing.id, action: 'PREVIOUS_PARENT_RESPONSE', message: [existing.parentAnswer, existing.parentNote].filter(Boolean).join(' — '),
        } })
      }
      const lesson = await tx.booking.findUniqueOrThrow({ where: { id: existing.bookingId }, select: { id: true, publicId: true, subject: true, parent: { select: { userId: true } } } })
      const ref = publicReference(lesson)
      const decisionLabel = {
        MORE_INFO: 'Admin asked for more information', UNVERIFIED: 'Attendance could not be verified',
        NOT_HELD: 'Lesson did not take place', CONFIRMED: 'Attendance confirmed by admin',
      }[outcome] || 'Review in progress'
      const update = { type: 'ATTENDANCE_REVIEW', title: 'Missed check-in review', message: lesson.subject + ' · ' + decisionLabel + (data.adminResponse ? '. ' + data.adminResponse : '') + (refund ? '. Refund review: ' + refund.status.toLowerCase() + '.' : '') }
      notices = [
        { ...update, userId: existing.filedById, link: '/tutor/bookings/' + ref + '/session' },
        { ...update, userId: lesson.parent.userId, link: '/parent/bookings?booking=' + ref },
      ]
      await tx.notification.createMany({ data: notices })
    }
    const updated = await tx.complaint.findUnique({ where: { id: existing.id }, include: complaintInclude })
    return { updated, notices }
  })
  await Promise.all(notices.map(({ userId, type, link }) => sendBookingPush(userId, { type, link })))
  const label = { IN_PROGRESS: 'is being reviewed', RESOLVED: 'has been resolved', DISMISSED: 'was reviewed and closed' }[data.status]
  if (existing.category !== MISSED_CHECK_IN) await notify(existing.filedById, {
    type: 'COMPLAINT_UPDATE',
    title: 'Complaint update',
    message: `Your complaint (${existing.category}) ${label}.`,
    link: '/parent/complaints',
  })
  res.json({ complaint: toComplaintDto(updated) })
}

// POST /admin/complaints/:id/attendance-review
export async function startAttendanceReview(req, res) {
  const source = await prisma.complaint.findUnique({ where: { id: Number(req.params.id) } })
  if (!source || source.category !== 'No-show or lateness' || !source.bookingId || !['OPEN', 'IN_PROGRESS'].includes(source.status)) throw new AppError(409, 'Choose an open no-show complaint linked to a lesson.')
  const lesson = await prisma.booking.findUnique({ where: { id: source.bookingId }, select: { tutorId: true } })
  if (!lesson) throw new AppError(404, 'Lesson not found.')
  const review = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${lesson.tutorId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${source.bookingId} FOR UPDATE`
    const b = await tx.booking.findUnique({ where: { id: source.bookingId }, include: { tutor: true, parent: true } })
    const current = await tx.complaint.findUnique({ where: { id: source.id } })
    if (!b || b.parent.userId !== source.filedById || !['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status) || b.endAt > new Date() || !['OPEN', 'IN_PROGRESS'].includes(current?.status)) throw new AppError(409, 'An attendance review can be opened after the lesson ends.')
    if (await tx.complaint.findFirst({ where: { bookingId: b.id, category: MISSED_CHECK_IN } })) throw new AppError(409, 'An attendance review already exists for this lesson.')
    const open = await openAttendanceRefund(tx, b.id)
    if (open.length > 1) throw new AppError(409, 'Resolve the existing refund requests before opening an attendance review.')
    const due = attendanceResponseDeadline()
    const result = await tx.complaint.create({ data: { bookingId: b.id, filedById: b.tutor.userId, category: MISSED_CHECK_IN, description: 'Attendance review opened from the parent’s no-show complaint.', attendanceOutcome: 'MORE_INFO', adminResponse: 'The parent reported that the lesson did not take place. Please explain what happened and provide any evidence.', tutorReplyPending: true, tutorResponseDueAt: due, parentResponseDueAt: due, attendanceRefundId: open[0]?.id, status: 'IN_PROGRESS', handledById: req.user.id } })
    await tx.attendanceReviewEntry.create({ data: { complaintId: result.id, action: 'PARENT_COMPLAINT', message: source.description } })
    await tx.notification.createMany({ data: [
      { userId: b.tutor.userId, type: 'ATTENDANCE_REVIEW', title: 'Attendance review opened', message: 'Admin opened an attendance review. Please respond within 48 hours and provide any evidence.', link: '/tutor/bookings/' + publicReference(b) + '/session' },
      { userId: b.parent.userId, type: 'ATTENDANCE_REVIEW', title: 'Attendance review opened', message: 'Admin opened an attendance review for your complaint. Please respond within 48 hours.', link: '/parent/bookings?booking=' + publicReference(b) },
    ] })
    return result
  })
  res.status(201).json({ id: review.id, publicId: review.publicId })
}

// ───────────── Reports ─────────────
const day = ymd('Use a real date like 2026-10-01')
const periodSchema = z
  .object({ from: day.optional(), to: day.optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional() })
  .refine((p) => !p.from || !p.to || p.from <= p.to, { message: 'The start date must be on or before the end date', path: ['to'] })

// Complaints filed inside [from, to] (Malaysia dates, both days included). No dates = everything.
function periodWhere({ from, to, status }) {
  const createdAt = {}
  if (from) createdAt.gte = mytToDate(from, '00:00')
  if (to) createdAt.lt = mytToDate(addDays(to, 1), '00:00')
  return { ...(from || to ? { createdAt } : {}), ...(status && { status }) }
}

export const OVERDUE_DAYS = 7

// GET /admin/complaints/report?from=&to= : the numbers an admin needs to see how complaints are being handled
export async function complaintsReport(req, res) {
  const q = periodSchema.parse(req.query)
  const where = periodWhere(q)
  const rows = await prisma.complaint.findMany({ where, include: { againstUser: { select: { id: true, fullName: true, role: true } } } })

  const byStatus = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }
  const byCategory = {}
  const against = {}
  let closedHours = 0
  let closed = 0
  const overdueBefore = Date.now() - OVERDUE_DAYS * 86_400_000
  let overdue = 0
  for (const c of rows) {
    byStatus[c.status]++
    byCategory[c.category] = (byCategory[c.category] || 0) + 1
    if (['RESOLVED', 'DISMISSED'].includes(c.status)) {
      closed++
      closedHours += (c.updatedAt - c.createdAt) / 3_600_000 // a closed complaint is not edited again, so updatedAt is when it was closed
    } else if (c.createdAt.getTime() < overdueBefore) overdue++
    if (c.againstUser) {
      const k = c.againstUser.id
      against[k] = against[k] || { userId: k, name: c.againstUser.fullName, role: c.againstUser.role, count: 0 }
      against[k].count++
    }
  }
  res.json({
    period: { from: q.from || null, to: q.to || null },
    total: rows.length,
    byStatus,
    byCategory: Object.entries(byCategory).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    // Open or in progress for more than a week: these need attention first
    overdue,
    overdueDays: OVERDUE_DAYS,
    averageResolutionHours: closed ? Math.round((closedHours / closed) * 10) / 10 : null,
    resolutionRate: rows.length ? Math.round((closed / rows.length) * 100) : null,
    mostComplainedAbout: Object.values(against).sort((a, b) => b.count - a.count).slice(0, 5),
  })
}

// CSV cells: quote everything, double any quotes, and stop spreadsheet formulas (a cell starting with = + - @)
// from running when the file is opened in Excel
function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
const myt = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }) : '')

// GET /admin/complaints/export?from=&to=&status= : download as a CSV file for record keeping
export async function exportComplaints(req, res) {
  const q = periodSchema.parse(req.query)
  const rows = await prisma.complaint.findMany({ where: periodWhere(q), include: complaintInclude, orderBy: { createdAt: 'asc' } })
  const header = ['ID', 'Filed on', 'Status', 'Category', 'Filed by', 'Filed by email', 'Against', 'Booking', 'Description', 'Admin response', 'Last updated']
  const lines = [header.map(csvCell).join(',')]
  for (const c of rows) {
    lines.push([
      c.id, myt(c.createdAt), c.status, c.category, c.filedBy?.fullName, c.filedBy?.email, c.againstUser?.fullName,
      c.booking ? `#${c.booking.id} ${c.booking.subject}` : '', c.description, c.adminResponse, myt(c.updatedAt),
    ].map(csvCell).join(','))
  }
  const name = `complaints${q.from ? `-from-${q.from}` : ''}${q.to ? `-to-${q.to}` : ''}.csv`
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${name}"`)
  res.send('\uFEFF' + lines.join('\r\n')) // BOM so Excel reads names with accents correctly
}

// GET /admin/complaints/:id: the complaint plus what the Admin needs to investigate it (FR 9.2, 9.5):
// the booking, its payment and refunds, attendance, the tutor's session summary, and the history of the account complained about.
export async function getComplaint(req, res) {
  const c = await prisma.complaint.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      ...complaintInclude,
      quiz: { include: { versions: { orderBy: { number: 'desc' }, take: 1 } } },
      reviewHistory: { orderBy: { id: 'asc' } },
      booking: { include: { child: { select: { name: true } }, payment: { include: { refunds: true } }, attendance: true, summary: true } },
    },
  })
  if (!c) throw new AppError(404, 'Complaint not found')

  const b = c.booking
  const linkedRefund = b?.payment?.refunds.find(r => r.id === c.attendanceRefundId)
  const [others, warnings] = c.againstUserId
    ? await Promise.all([
        prisma.complaint.findMany({
          where: { againstUserId: c.againstUserId, id: { not: c.id } },
          select: { id: true, publicId: true, category: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.accountWarning.findMany({ where: { userId: c.againstUserId }, select: { id: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      ])
    : [[], []]

  res.json({
    complaint: toComplaintDto(c),
    investigation: {
      quiz: c.quiz ? { id: c.quiz.id, title: c.quiz.title, isHidden: c.quiz.isHidden, moderationReason: c.quiz.moderationReason, questions: (c.quiz.versions[0]?.content.questions || []).map(q => ({ text: q.text, type: q.type, imageUrl: q.imageUrl || null, options: q.options || [] })) } : null,
      attendanceReview: c.category === MISSED_CHECK_IN ? {
        attendanceRefundState: attendanceRefundState(c, linkedRefund && { ...linkedRefund, payment: b.payment }),
        outcome: c.attendanceOutcome, tutorReplyPending: c.tutorReplyPending, tutorResponseDueAt: c.tutorResponseDueAt, parentResponseDueAt: c.parentResponseDueAt, waiting: attendanceWaiting(c), appealUntil: c.appealUntil, appealUsed: c.appealUsed, penaltyAmount: c.penaltyAmount, penaltyEffectiveAt: c.penaltyEffectiveAt,
        history: c.reviewHistory.map(entry => ({ ...entry, evidenceUrl: mediaLink(entry.evidenceUrl, 'wondertutor/attendance/' + c.bookingId) })),
        proof: mediaLink(c.evidenceUrl, 'wondertutor/attendance/' + c.bookingId),
        parentAnswer: c.parentAnswer, parentNote: c.parentNote, approved: c.attendanceApproved, reviewedAt: c.updatedAt,
      } : null,
      booking: b && {
        id: b.id, publicId: b.publicId, subject: b.subject, child: b.child.name, status: b.status, startAt: b.startAt, endAt: b.endAt,
        teachingMode: b.teachingMode, agreedPrice: b.agreedPrice == null ? null : Number(b.agreedPrice), cancelReason: b.cancelReason,
      },
      payment: b?.payment && {
        id: b.payment.id, publicId: b.payment.publicId,
        status: b.payment.status, amount: Number(b.payment.amount), method: b.payment.method, paidAt: b.payment.paidAt,
        refunds: b.payment.refunds.map((r) => ({ id: r.id, amount: Number(r.amount), type: r.type, status: r.status, reason: r.reason })),
      },
      attendance: b?.attendance && {
        checkInAt: b.attendance.checkInAt, checkOutAt: b.attendance.checkOutAt, distanceMetres: b.attendance.checkInDistance, photoUrl: mediaLink(b.attendance.checkInPhotoUrl, 'wondertutor/attendance/' + b.id),
      },
      sessionSummary: b?.summary ? { content: b.summary.content, progressNote: b.summary.progressNote } : null,
      // Repeated violations: every other complaint against the same account, and the warnings it already has
      otherComplaints: others,
      warnings,
    },
  })
}
