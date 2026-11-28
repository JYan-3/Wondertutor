export const ATTENDANCE_APPEAL_DAYS = 14

// Finance takes the same payment lock before deciding an existing refund.
export async function openAttendanceRefund(db, bookingId) {
  await db.$queryRaw`SELECT id FROM Payment WHERE bookingId = ${bookingId} FOR UPDATE`
  const refunds = await db.refund.findMany({ where: { payment: { bookingId }, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] }, issuedAt: null }, include: { payment: { select: { status: true } } } })
  return refunds.filter(r => !(r.status === 'APPROVED' && !r.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(r.payment.status)))
}

// A transfer waits for the appeal window and any reconsideration to finish.
export function attendanceRefundState(review, refund, now = new Date()) {
  if (!review || !refund) return null
  const transferred = refund.issuedAt || (refund.status === 'APPROVED' && !refund.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(refund.payment?.status))
  if (['OPEN', 'IN_PROGRESS'].includes(review.status)) return transferred ? 'TRANSFERRED' : refund.status === 'REJECTED' ? null : 'ON_HOLD'
  if (review.status === 'DISMISSED' && review.attendanceOutcome === 'NOT_HELD' && !review.appealUsed && review.appealUntil && review.appealUntil > now && !transferred && refund.status !== 'REJECTED') return 'AWAITING_APPEAL'
  return null
}
