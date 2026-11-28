export const ATTENDANCE_APPEAL_DAYS = 14

// A transfer waits for the appeal window and any reconsideration to finish.
export function attendanceRefundState(review, refund, now = new Date()) {
  if (!review || !refund) return null
  const transferred = refund.issuedAt || (refund.status === 'APPROVED' && !refund.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(refund.payment?.status))
  if (review.status === 'IN_PROGRESS') return transferred ? 'TRANSFERRED' : refund.status === 'REJECTED' ? null : 'ON_HOLD'
  if (review.status === 'DISMISSED' && review.attendanceOutcome === 'NOT_HELD' && !review.appealUsed && review.appealUntil && review.appealUntil > now && !transferred && refund.status !== 'REJECTED') return 'AWAITING_APPEAL'
  return null
}
