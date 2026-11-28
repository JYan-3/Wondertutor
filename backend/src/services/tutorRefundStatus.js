import { attendanceRefundState } from './attendanceRefund.js'

export const tutorRefunds = {
  select: { id: true, amount: true, status: true, issuedAt: true, reviewNote: true, policy: true,
    attendanceCases: { select: { status: true, attendanceOutcome: true, appealUntil: true, appealUsed: true } } },
  orderBy: { id: 'asc' },
}

export function tutorPaymentStatus(payment) {
  if (!payment) return null
  return { status: payment.status, refunds: payment.refunds.map(r => {
    const transferred = r.issuedAt || (r.status === 'APPROVED' && !r.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status))
    const hold = r.attendanceCases.map(c => attendanceRefundState(c, { ...r, payment })).find(Boolean)
    return { id: r.id, amount: Number(r.amount), stage: transferred ? 'TRANSFERRED' : hold || r.status }
  }) }
}
