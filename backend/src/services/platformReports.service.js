import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { mytParts } from '../utils/time.js'
import { mytDayRange } from './paymentSummary.service.js'
import { earnings, withdrawalPaid } from './earnings.service.js'
import { AppError } from '../utils/AppError.js'

const D = n => new Prisma.Decimal(n ?? 0)
const name = { select: { user: { select: { fullName: true } } } }
const inRange = (d, r) => (!r.start || d >= r.start) && (!r.end || d < r.end)
const whereDate = r => ({ ...(r.start && { gte: r.start }), ...(r.end && { lt: r.end }) })

export async function transactions(range, { db = prisma, selected } = {}) {
  const period = mytDayRange(range.from, range.to)
  const selectedPayments = selected?.filter(row => row.kind !== 'Withdrawal').map(row => row.paymentId)
  const selectedWithdrawals = selected?.filter(row => row.kind === 'Withdrawal').map(row => row.id)
  const [payments, withdrawals] = await Promise.all([
    db.payment.findMany({ where: selected ? { id: { in: selectedPayments } } : !period.start && !period.end ? {} : { OR: [{ paidAt: whereDate(period) }, { paidAt: null, createdAt: whereDate(period) },
      { refunds: { some: { OR: [{ createdAt: whereDate(period) }, { reviewedAt: whereDate(period) }, { issuedAt: whereDate(period) }] } } }] },
      include: { booking: { include: { tutor: name, parent: name } }, refunds: { orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] } } }),
    db.withdrawal.findMany({ where: selected ? { id: { in: selectedWithdrawals } } : !period.start && !period.end ? {} : { OR: [{ paidAt: whereDate(period) }, { reviewedAt: whereDate(period) }, { reviewedAt: null, createdAt: whereDate(period) }] }, include: { tutor: name } }),
  ])
  const rows = []
  for (const p of payments) {
    const b = p.booking
    const common = { tutorId: b.tutorId, tutor: b.tutor.user.fullName, parent: b.parent.user.fullName, bookingId: b.id, rate: p.commissionRate }
    const paid = ['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(p.status)
    rows.push({ ...common, type: 'Payment', id: p.id, date: p.paidAt || p.createdAt, status: p.status, amount: p.amount,
      commission: paid ? p.commissionAmount : D(0), tutorNet: paid ? p.amount.minus(p.commissionAmount) : D(0), settled: paid })
    let refunded = D(0), reversedCommission = D(0)
    for (const r of p.refunds) {
      // Cumulative rounding reverses exactly the original commission on a full refund.
      const settled = Boolean(r.issuedAt || (r.status === 'APPROVED' && !r.reviewNote && ['REFUNDED','PARTIALLY_REFUNDED'].includes(p.status)))
      let commission = D(0)
      if (settled) {
        refunded = refunded.plus(r.amount)
        const retained = r.policy === 'PARENT_LATE' ? D(0) : p.amount.gt(0) ? p.commissionAmount.mul(p.amount.minus(refunded)).div(p.amount).toDecimalPlaces(2) : D(0)
        const cumulative = p.commissionAmount.minus(retained)
        commission = cumulative.minus(reversedCommission)
        reversedCommission = cumulative
      }
      rows.push({ ...common, type: 'Refund', id: r.id, date: r.issuedAt || r.reviewedAt || r.createdAt, status: settled ? 'ISSUED' : r.status,
        amount: r.amount.negated(), commission: commission.negated(), tutorNet: settled ? commission.minus(r.amount) : D(0), settled })
    }
  }
  for (const w of withdrawals) rows.push({ tutorId: w.tutorId, tutor: w.tutor.user.fullName, type: 'Withdrawal', id: w.id, date: w.paidAt || w.reviewedAt || w.createdAt,
    status: w.status, amount: w.amount.negated(), commission: D(0), tutorNet: w.amount.negated(), settled: withdrawalPaid(w) })
  const allowed = selected && new Set(selected.map(row => `${row.kind}:${row.id}`))
  return rows.filter(row => inRange(row.date, period) && (!allowed || allowed.has(`${row.type}:${row.id}`))).sort((a,b) => b.date - a.date || b.id - a.id || a.type.localeCompare(b.type))
}

// Page the combined event list before fetching its financial details.
export async function transactionPage(range, { page, pageSize, q, all }) {
  const period = mytDayRange(range.from, range.to)
  const events = Prisma.sql`(
    SELECT 'Payment' AS kind, p.id AS id, p.id AS paymentId, COALESCE(p.paidAt, p.createdAt) AS eventDate, b.id AS bookingId, tu.fullName AS tutor, pu.fullName AS parent, p.status AS eventStatus
    FROM Payment p JOIN Booking b ON b.id = p.bookingId JOIN TutorProfile t ON t.id = b.tutorId JOIN User tu ON tu.id = t.userId JOIN ParentProfile pp ON pp.id = b.parentId JOIN User pu ON pu.id = pp.userId
    UNION ALL
    SELECT 'Refund', r.id, p.id, COALESCE(r.issuedAt, r.reviewedAt, r.createdAt), b.id, tu.fullName, pu.fullName,
      CASE WHEN r.issuedAt IS NOT NULL OR (r.status = 'APPROVED' AND (r.reviewNote IS NULL OR r.reviewNote = '') AND p.status IN ('REFUNDED', 'PARTIALLY_REFUNDED')) THEN 'ISSUED' ELSE r.status END
    FROM Refund r JOIN Payment p ON p.id = r.paymentId JOIN Booking b ON b.id = p.bookingId JOIN TutorProfile t ON t.id = b.tutorId JOIN User tu ON tu.id = t.userId JOIN ParentProfile pp ON pp.id = b.parentId JOIN User pu ON pu.id = pp.userId
    UNION ALL
    SELECT 'Withdrawal', w.id, NULL, COALESCE(w.paidAt, w.reviewedAt, w.createdAt), NULL, tu.fullName, NULL, w.status
    FROM Withdrawal w JOIN TutorProfile t ON t.id = w.tutorId JOIN User tu ON tu.id = t.userId
  ) e`
  const conditions = Prisma.sql`WHERE 1 = 1 ${period.start ? Prisma.sql`AND e.eventDate >= ${period.start}` : Prisma.empty} ${period.end ? Prisma.sql`AND e.eventDate < ${period.end}` : Prisma.empty}
    ${q ? Prisma.sql`AND LOCATE(${q.toLowerCase()}, LOWER(CONCAT_WS(' ', e.kind, e.id, e.bookingId, e.tutor, e.parent, e.eventStatus))) > 0` : Prisma.empty}`
  return prisma.$transaction(async db => {
    const [{ total: count }] = await db.$queryRaw`SELECT COUNT(*) AS total FROM ${events} ${conditions}`
    const total = Number(count), totalPages = Math.max(1, Math.ceil(total / pageSize)), current = Math.min(page, totalPages)
    const selected = await db.$queryRaw`SELECT e.kind, e.id, e.paymentId FROM ${events} ${conditions} ORDER BY e.eventDate DESC, e.id DESC, e.kind ASC ${all ? Prisma.empty : Prisma.sql`LIMIT ${pageSize} OFFSET ${(current - 1) * pageSize}`}`
    const rows = await transactions(range, { db, selected })
    return { rows, pagination: { page: current, pageSize, total, totalPages } }
  }, { timeout: 30000 })
}

export async function platformReports(range) {
  const period = mytDayRange(range.from, range.to)
  const [rows, bookings, tutors, penalties] = await Promise.all([transactions(range),
    prisma.booking.findMany({ where: { startAt: whereDate(period) }, select: { tutorId: true, status: true,
      review: { select: { rating: true, isHidden: true } }, attendance: { select: { checkInAt: true } } } }),
    prisma.tutorProfile.findMany({ select: { id: true, user: { select: { fullName: true } } } }),
    prisma.complaint.aggregate({ where: { category: 'Missed check-in', status: 'DISMISSED', attendanceOutcome: 'NOT_HELD', penaltyEffectiveAt: { ...whereDate(period), lte: new Date() } }, _sum: { penaltyAmount: true }, _count: { _all: true } }),
  ])
  const months = new Map(), statuses = {}, performance = new Map()
  for (const t of tutors) performance.set(t.id, { tutor: t.user.fullName, bookings: 0, completed: 0, cancelled: 0, reviewed: 0, ratingSum: 0, tutorNet: D(0) })
  for (const b of bookings) {
    statuses[b.status] = (statuses[b.status] || 0) + 1
    const t = performance.get(b.tutorId)
    t.bookings++
    if (b.status === 'COMPLETED') t.completed++
    if (b.status === 'CANCELLED') t.cancelled++
    if (b.review && !b.review.isHidden) { t.reviewed++; t.ratingSum += b.review.rating }
  }
  let gross = D(0), refunded = D(0), commission = D(0)
  for (const row of rows) {
    if (!row.settled || row.type === 'Withdrawal') continue
    const month = mytParts(row.date).date.slice(0, 7)
    const m = months.get(month) || { month, commission: D(0), tutorNet: D(0) }
    m.commission = m.commission.plus(row.commission)
    m.tutorNet = m.tutorNet.plus(row.tutorNet)
    months.set(month, m)
    if (row.type === 'Payment') gross = gross.plus(row.amount)
    else refunded = refunded.minus(row.amount)
    commission = commission.plus(row.commission)
    const t = performance.get(row.tutorId)
    t.tutorNet = t.tutorNet.plus(row.tutorNet)
  }
  return { gross, refunded, commission, netCollected: gross.minus(refunded), penaltiesAssessed: penalties._sum.penaltyAmount ?? D(0), penaltyCount: penalties._count._all, transactionCount: rows.length, bookings: bookings.length,
    statuses, months: [...months.values()].sort((a,b) => a.month.localeCompare(b.month)),
    performance: [...performance.values()].map(t => ({ ...t, rating: t.reviewed ? t.ratingSum / t.reviewed : null })) }
}

export async function salarySummary(tutorId, range) {
  const tutor = await prisma.tutorProfile.findUnique({ where: { id: tutorId }, select: { user: { select: { fullName: true } } } })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  const view = await earnings(tutorId)
  const period = mytDayRange(range.from, range.to)
  const sessions = view.transactions.filter(x => ['Earned', 'Cancellation fee earned'].includes(x.state) && inRange(x.date, period))
  const penalties = view.penalties.filter(x => inRange(x.penaltyEffectiveAt, period))
  const withdrawals = view.withdrawals.filter(x => ['PAID', 'LEGACY_PAID'].includes(x.payoutStatus) && inRange(x.paidAt || x.reviewedAt || x.date, period))
  const sum = (list, key) => list.reduce((total, x) => total.plus(x[key]), D(0))
  return { tutor: tutor.user.fullName, sessions, gross: sum(sessions, 'fee'), refunded: sum(sessions, 'refunded'),
    commission: sum(sessions, 'commission'), net: sum(sessions, 'net'), penalties: sum(penalties, 'penaltyAmount'), netAfterPenalties: sum(sessions, 'net').minus(sum(penalties, 'penaltyAmount')), approved: sum(withdrawals, 'amount'), available: view.available }
}
