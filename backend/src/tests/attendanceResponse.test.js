import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

async function setup() {
  const tutor = await makeTutor(), parent = await makeParent(), admin = await makeAdmin()
  const startAt = new Date(Date.now() - 2 * 3_600_000)
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'CONFIRMED', extra: { startAt, endAt: new Date(startAt.getTime() + 3_600_000) } })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 10, commissionRate: 10, paidAt: new Date(), status: 'PAID' } })
  return { tutor, parent, admin, booking, payment, session: `/tutor/bookings/${booking.publicId}/session`, parentPath: `/parent/bookings/${booking.publicId}` }
}

async function decision(x, reviewId, status = 'DISMISSED', outcome = 'NOT_HELD') {
  const path = `/admin/complaints/${reviewId}`
  const view = await api(x.admin.token).get(path)
  return api(x.admin.token).patch(path, { status, ...(outcome && { outcome }), reviewedAt: view.investigation.attendanceReview.reviewedAt, adminResponse: 'Reviewed the available evidence.' })
}

test('parent receives 48 hours after tutor review and admin can decide after the deadline', async () => {
  const x = await setup()
  expect((await api(x.tutor.token).post(x.session, { action: 'request-review', reason: 'The check-in failed.' })).status).toBe(200)
  const review = await prisma.complaint.findFirstOrThrow({ where: { bookingId: x.booking.id, category: 'Missed check-in' } })
  expect(review.parentResponseDueAt.getTime() - review.createdAt.getTime()).toBeGreaterThan(47 * 3_600_000)
  expect((await decision(x, review.id)).status).toBe(409)
  await prisma.complaint.update({ where: { id: review.id }, data: { parentResponseDueAt: new Date(Date.now() - 1000) } })
  expect((await decision(x, review.id)).status).toBe(200)
  const saved = await prisma.complaint.findUniqueOrThrow({ where: { id: review.id } })
  expect(Number(saved.penaltyAmount)).toBe(15)
  expect(await prisma.refund.count({ where: { paymentId: x.payment.id, policy: 'ATTENDANCE_NOT_HELD' } })).toBe(1)
  expect((await api(x.parent.token).get(x.parentPath)).booking.attendanceReview.attendanceOutcome).toBe('NOT_HELD')
  expect((await api(x.tutor.token).get(x.session)).review.attendanceOutcome).toBe('NOT_HELD')
})

test('admin can open one review from a parent no-show complaint and both sides have 48 hours', async () => {
  const x = await setup()
  const complaint = await api(x.parent.token).post('/parent/complaints', { bookingId: x.booking.publicId, category: 'No-show or lateness', description: 'The tutor did not attend the lesson.' })
  expect(complaint.status).toBe(201)
  const path = `/admin/complaints/${complaint.complaint.publicId}/attendance-review`
  expect((await api(x.parent.token).post(path)).status).toBe(403)
  const opened = await api(x.admin.token).post(path)
  expect(opened.status).toBe(201)
  expect((await api(x.admin.token).post(path)).status).toBe(409)
  const review = await prisma.complaint.findUniqueOrThrow({ where: { id: opened.id } })
  expect(review.sourceComplaintId).toBe(complaint.complaint.id)
  expect((await api(x.admin.token).get(`/admin/complaints/${opened.id}`)).investigation.sourceComplaint.id).toBe(complaint.complaint.id)
  expect((await api(x.admin.token).get(`/admin/complaints/${complaint.complaint.id}`)).investigation.linkedAttendanceReview).toMatchObject({ id: opened.id, final: false })
  expect((await api(x.tutor.token).get(x.session)).review.reviewHistory.some(entry => entry.action === 'PARENT_COMPLAINT')).toBe(false)
  expect((await api(x.admin.token).get(`/admin/complaints/${opened.id}`)).investigation.attendanceReview.history.some(entry => entry.action === 'PARENT_COMPLAINT')).toBe(true)
  expect(review.parentResponseDueAt.getTime() - review.createdAt.getTime()).toBeGreaterThan(47 * 3_600_000)
  expect(review.tutorResponseDueAt.getTime() - review.createdAt.getTime()).toBeGreaterThan(47 * 3_600_000)
  expect((await decision(x, review.id)).status).toBe(409)
  const parentView = await api(x.parent.token).get(x.parentPath)
  expect((await api(x.parent.token).post(x.parentPath + '/attendance-response', { answer: 'NO', note: 'The tutor did not come.', reviewedAt: parentView.booking.attendanceReview.updatedAt })).status).toBe(200)
  expect((await decision(x, review.id)).status).toBe(409)
  expect((await api(x.tutor.token).post(x.session, { action: 'review-reply', reason: 'Here is my account of the lesson.' })).status).toBe(200)
  expect((await decision(x, review.id, 'RESOLVED', null)).status).toBe(200)
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: review.id } })).attendanceApproved).toBe(true)
  const original = await api(x.admin.token).get(`/admin/complaints/${complaint.complaint.id}`)
  expect(original.complaint.status).toBe('OPEN')
  expect(original.investigation.linkedAttendanceReview).toMatchObject({ id: opened.id, status: 'RESOLVED', final: true })
  expect((await api(x.parent.token).get(`/admin/complaints/${opened.id}`)).status).toBe(403)
})

test('both response deadlines must expire before admin may decide without replies', async () => {
  const x = await setup()
  const complaint = await api(x.parent.token).post('/parent/complaints', { bookingId: x.booking.publicId, category: 'No-show or lateness', description: 'The tutor did not attend the lesson.' })
  const review = await api(x.admin.token).post(`/admin/complaints/${complaint.complaint.id}/attendance-review`)
  await prisma.complaint.update({ where: { id: review.id }, data: { parentResponseDueAt: new Date(Date.now() - 1000) } })
  expect((await decision(x, review.id)).status).toBe(409)
  await prisma.complaint.update({ where: { id: review.id }, data: { tutorResponseDueAt: new Date(Date.now() - 1000) } })
  expect((await decision(x, review.id)).status).toBe(200)
})

test('a disputed completed lesson can be reviewed and an existing refund is held', async () => {
  const x = await setup()
  await prisma.booking.update({ where: { id: x.booking.id }, data: { status: 'COMPLETED' } })
  const refund = await api(x.parent.token).post(x.parentPath + '/refund-request', { reason: 'The tutor did not attend.', attendanceDispute: true })
  expect(refund.status).toBe(201)
  const complaint = await api(x.parent.token).post('/parent/complaints', { bookingId: x.booking.publicId, category: 'No-show or lateness', description: 'The tutor did not attend the lesson.' })
  const opened = await api(x.admin.token).post(`/admin/complaints/${complaint.complaint.id}/attendance-review`)
  expect(opened.status).toBe(201)
  const review = await prisma.complaint.findUniqueOrThrow({ where: { id: opened.id } })
  expect(review.attendanceRefundId).not.toBeNull()
  expect((await api(x.admin.token).post(`/admin/refunds/${review.attendanceRefundId}/decision`, { action: 'approve', amount: 100, basis: 'Refund policy condition', reason: 'Reviewed the case' })).status).toBe(409)
  expect((await api(x.tutor.token).post(x.session, { action: 'review-reply', reason: 'Here is my account of the lesson.' })).status).toBe(200)
  const parentView = await api(x.parent.token).get(x.parentPath)
  expect((await api(x.parent.token).post(x.parentPath + '/attendance-response', { answer: 'NO', note: 'The lesson did not happen.', reviewedAt: parentView.booking.attendanceReview.updatedAt })).status).toBe(200)
  expect((await decision(x, opened.id)).status).toBe(200)
  expect((await prisma.refund.findUniqueOrThrow({ where: { id: review.attendanceRefundId } })).policy).toBe('ATTENDANCE_NOT_HELD')
  expect((await api(x.tutor.token).post(x.session, { action: 'reconsider', reason: 'New information about the lesson.' })).status).toBe(200)
})

test('a refund requested after a review opens is linked and held', async () => {
  const x = await setup()
  const complaint = await api(x.parent.token).post('/parent/complaints', { bookingId: x.booking.publicId, category: 'No-show or lateness', description: 'The tutor did not attend the lesson.' })
  const opened = await api(x.admin.token).post(`/admin/complaints/${complaint.complaint.id}/attendance-review`)
  expect(opened.status).toBe(201)
  expect((await api(x.parent.token).post(x.parentPath + '/refund-request', { reason: 'The tutor did not attend.' })).status).toBe(201)
  const review = await prisma.complaint.findUniqueOrThrow({ where: { id: opened.id } })
  expect(review.attendanceRefundId).not.toBeNull()
  expect((await api(x.admin.token).post(`/admin/refunds/${review.attendanceRefundId}/decision`, { action: 'approve', amount: 100, basis: 'Refund policy condition', reason: 'Reviewed the case' })).status).toBe(409)
})

test('a tutor review also holds an existing parent refund request', async () => {
  const x = await setup()
  expect((await api(x.parent.token).post(x.parentPath + '/refund-request', { reason: 'The tutor did not attend.' })).status).toBe(201)
  expect((await api(x.tutor.token).post(x.session, { action: 'request-review', reason: 'Please review the lesson.' })).status).toBe(200)
  const review = await prisma.complaint.findFirstOrThrow({ where: { bookingId: x.booking.id, category: 'Missed check-in' } })
  expect(review.attendanceRefundId).not.toBeNull()
  expect((await api(x.admin.token).post(`/admin/refunds/${review.attendanceRefundId}/decision`, { action: 'approve', amount: 100, basis: 'Refund policy condition', reason: 'Reviewed the case' })).status).toBe(409)
})
