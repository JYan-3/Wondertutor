// Acceptance holds a lesson until the saved pay-by time or one hour before its
// current start, whichever is earlier. Rescheduling can bring that cutoff earlier.
export const paymentDeadline = ({ payBy, startAt }) => new Date(Math.min(
  payBy ? Date.parse(payBy) : Infinity,
  Date.parse(startAt) - 3_600_000,
))
