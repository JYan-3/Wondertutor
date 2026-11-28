export const ATTENDANCE_RESPONSE_HOURS = 48
export const attendanceResponseDeadline = (now = new Date()) => new Date(now.getTime() + ATTENDANCE_RESPONSE_HOURS * 3_600_000)

// A missing reply stops blocking a decision only after its own deadline.
export function attendanceWaiting(review, now = new Date()) {
  return {
    parent: !review.parentAnswer && (!review.parentResponseDueAt || review.parentResponseDueAt > now),
    tutor: review.tutorReplyPending && (!review.tutorResponseDueAt || review.tutorResponseDueAt > now),
  }
}
