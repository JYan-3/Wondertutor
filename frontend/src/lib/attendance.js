// Admin evidence approval is attendance confirmation, not a GPS/check-in record.
export function attendanceLabel(lesson) {
  if (lesson.attendanceSource === 'ADMIN_REVIEW') return 'Attendance confirmed by admin'
  if (lesson.attended === null) return 'No attendance record'
  return lesson.attended ? 'Checked in' : 'No check-in'
}
