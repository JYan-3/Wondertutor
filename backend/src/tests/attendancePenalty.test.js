import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

async function reviewedLesson(existingRefund) {
  const tutor = await makeTutor(), parent = await makeParent(), admin = await makeAdmin()
  const startAt = new Date(Date.now() - 2 * 3_600_000)
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'CONFIRMED', extra: { startAt, endAt: new Date(startAt.getTime() + 3_600_000) } })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 12, commissionRate: 12, paidAt: new Date(), status: existingRefund?.issuedAt ? 'PARTIALLY_REFUNDED' : 'PAID' } })
  if (existingRefund) await prisma.refund.create({ data: { paymentId: payment.id, amount: 20, type: 'ADMIN_REVIEW', reason: 'Earlier refund', ...existingRefund } })
  const session = `/tutor/bookings/${booking.id}/session`, parentPath = `/parent/bookings/${booking.publicId}`
  expect((await api(tutor.token).post(session, { action: 'request-review', reason: 'Please check attendance.' })).status).toBe(200)
  const parentView = await api(parent.token).get(parentPath)
  expect((await api(parent.token).post(parentPath + '/attendance-response', { answer: 'NO', reviewedAt: parentView.booking.attendanceReview.updatedAt })).status).toBe(200)
  const review = (await api(admin.token).get('/admin/complaints')).complaints.find(c => c.booking?.id === booking.id)
  const adminPath = `/admin/complaints/${review.id}`
  const decide = async (status, outcome) => {
    const current = await api(admin.token).get(adminPath)
    return api(admin.token).patch(adminPath, { status, ...(outcome && { outcome }), reviewedAt: current.investigation.attendanceReview.reviewedAt, adminResponse: 'Reviewed the attendance evidence.' })
  }
  expect((await decide('DISMISSED', 'NOT_HELD')).status).toBe(200)
  const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id: review.id } })
  return { tutor, parent, admin, booking, session, parentPath, complaint, decide }
}

test('a refund transfer and 15% penalty wait for the 14-day reconsideration period', async () => {
  const x = await reviewedLesson()
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: x.complaint.attendanceRefundId } })
  const finance = `/admin/refunds/${refund.id}/decision`
  expect(Number(x.complaint.penaltyAmount)).toBe(15)
  expect((await api(x.tutor.token).get('/tutor/earnings')).penalties).toEqual([])
  expect((await api(x.admin.token).post(finance, { action: 'reject', reason: 'Reviewed the case' })).status).toBe(409)
  expect((await api(x.admin.token).post(finance, { action: 'approve', amount: 100, basis: 'Refund policy condition', reason: 'Reviewed the case' })).status).toBe(204)
  expect((await api(x.admin.token).post(finance, { action: 'issued', reference: `appeal-${refund.id}` })).status).toBe(409)
  await prisma.complaint.update({ where: { id: x.complaint.id }, data: { appealUntil: new Date(Date.now() - 1000), penaltyEffectiveAt: new Date(Date.now() - 1000) } })
  expect((await api(x.tutor.token).post(x.session, { action: 'reconsider', reason: 'A new attendance record.' })).status).toBe(409)
  const earnings = await api(x.tutor.token).get('/tutor/earnings')
  expect(Number(earnings.penaltyTotal)).toBe(15)
  expect(Number(earnings.amountOwed)).toBe(15)
  expect((await api(x.admin.token).post(finance, { action: 'issued', reference: `appeal-${refund.id}` })).status).toBe(204)
})

test('reconsideration pauses the penalty, and a decision confirming the lesson clears it', async () => {
  const x = await reviewedLesson()
  expect((await api(x.tutor.token).post(x.session, { action: 'reconsider', reason: 'New dated information.' })).status).toBe(200)
  const during = await prisma.complaint.findUniqueOrThrow({ where: { id: x.complaint.id } })
  expect(during.penaltyEffectiveAt).toBeNull()
  expect((await x.decide('RESOLVED')).status).toBe(200)
  const final = await prisma.complaint.findUniqueOrThrow({ where: { id: x.complaint.id } })
  expect(final.penaltyAmount).toBeNull()
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: x.complaint.attendanceRefundId } })
  expect(refund.policy).toBeNull()
  expect(Number((await api(x.tutor.token).get('/tutor/earnings')).penaltyTotal)).toBe(0)
})

test('a prior partial refund request is replaced with the full remaining refund', async () => {
  const x = await reviewedLesson({ status: 'APPROVED', reviewNote: 'Earlier approval' })
  const refunds = await prisma.refund.findMany({ where: { payment: { bookingId: x.booking.id } } })
  expect(refunds).toHaveLength(1)
  expect(refunds[0]).toEqual(expect.objectContaining({ id: x.complaint.attendanceRefundId, status: 'PENDING', policy: 'ATTENDANCE_NOT_HELD' }))
  expect(Number(refunds[0].amount)).toBe(100)
  expect((await api(x.admin.token).post(`/admin/refunds/${refunds[0].id}/decision`, { action: 'approve', amount: 20, basis: 'Refund policy condition', reason: 'Reviewed the case' })).status).toBe(400)
})

test('a partial refund already transferred is deducted from the remaining full refund', async () => {
  const x = await reviewedLesson({ status: 'APPROVED', issuedAt: new Date(), transferRef: 'previous-partial-refund' })
  const refunds = await prisma.refund.findMany({ where: { payment: { bookingId: x.booking.id } }, orderBy: { id: 'asc' } })
  expect(refunds).toHaveLength(2)
  expect(Number(refunds[1].amount)).toBe(80)
  expect(refunds[1].policy).toBe('ATTENDANCE_NOT_HELD')
})
