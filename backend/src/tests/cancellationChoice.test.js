import { prisma } from '../config/prisma.js'
import { CANCELLATION_CHOICE_HOURS, CANCELLATION_RESPONSE_HOURS, expireCancellationChoices, expireCancellationResponses, remindCancellationResponses } from '../services/cancellationChoice.service.js'
import { runHousekeeping } from '../services/lifecycle.service.js'
import { addDays } from '../utils/time.js'
import { jest } from '@jest/globals'
import { MONDAY, api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

async function paidLesson() {
  const tutor = await makeTutor(), parent = await makeParent(), admin = await makeAdmin()
  const date = nextDate(MONDAY)
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date, status: 'CONFIRMED' })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 50, commissionAmount: 5, commissionRate: 10, paidAt: new Date(), status: 'PAID' } })
  const tutorApi = api(tutor.token), parentApi = api(parent.token), adminApi = api(admin.token)
  const cancelled = await tutorApi.post(`/tutor/bookings/${booking.id}`, { action: 'cancel', version: booking.updatedAt.toISOString(), reason: 'Schedule changed' })
  expect(cancelled.status).toBe(200)
  return { tutor, parent, admin, booking, payment, date, tutorApi, parentApi, adminApi }
}

test('a parent can request a refund once and only their own cancellation can be changed', async () => {
  const t = await paidLesson()
  const choice = (await t.parentApi.get(`/parent/bookings/${t.booking.publicId}`)).booking.cancellationChoice
  expect(choice.status).toBe('OPEN')
  expect(Date.parse(choice.until) - Date.now()).toBeGreaterThan((CANCELLATION_CHOICE_HOURS - 1) * 3_600_000)
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(0)
  const path = `/parent/bookings/${t.booking.publicId}/cancellation-refund`
  expect((await api().post(path)).status).toBe(401)
  expect((await api((await makeParent()).token).post(path)).status).toBe(404)
  expect((await t.parentApi.post(path)).status).toBe(200)
  expect((await t.parentApi.post(path)).status).toBe(409)
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
  expect(await prisma.notification.count({ where: { userId: t.admin.user.id, type: 'REFUND_REQUESTED' } })).toBe(1)
})

test('scheduled housekeeping sends an expired choice to admin review', async () => {
  const t = await paidLesson()
  await prisma.booking.update({ where: { id: t.booking.id }, data: { cancellationChoiceUntil: new Date(Date.now() - 1000) } })
  await runHousekeeping()
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
})

test('a failed session-cleanup job does not stop cancellation expiry and is visible to admin', async () => {
  const t = await paidLesson()
  await prisma.booking.update({ where: { id: t.booking.id }, data: { cancellationChoiceUntil: new Date(Date.now() - 1000) } })
  const failed = jest.spyOn(prisma.authSession, 'deleteMany').mockRejectedValueOnce(new Error('session cleanup unavailable'))
  try {
    await expect(runHousekeeping()).rejects.toThrow('session cleanup unavailable')
    expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
    const dashboard = await t.adminApi.get('/admin/dashboard')
    expect(dashboard.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'session cleanup', lastFailureAt: expect.any(String) }), expect.objectContaining({ name: 'cancellation choices', lastSuccessAt: expect.any(String) })]))
    expect(dashboard.queues.refundReview.count).toBeGreaterThan(0)
  } finally { failed.mockRestore() }
})

test('a new-time request is refused after the choice deadline, even before the next scheduled job', async () => {
  const t = await paidLesson()
  await prisma.booking.update({ where: { id: t.booking.id }, data: { cancellationChoiceUntil: new Date(Date.now() - 1000) } })
  const res = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  expect(res.status).toBe(409)
  expect(await prisma.rescheduleRequest.count({ where: { bookingId: t.booking.id } })).toBe(0)
  await expireCancellationChoices()
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(1)
})

test('an unanswered choice becomes one refund request after 48 hours', async () => {
  const t = await paidLesson()
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  await expireCancellationChoices(new Date(saved.cancellationChoiceUntil.getTime() - 1))
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(0)
  await expireCancellationChoices(new Date(saved.cancellationChoiceUntil.getTime() + 1))
  await expireCancellationChoices(new Date(saved.cancellationChoiceUntil.getTime() + 2))
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(1)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })).cancellationChoiceStatus).toBe('REFUND')
})

test('an accepted new time restores the same paid booking without a refund', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  expect(asked.status).toBe(201)
  expect(asked.booking.status).toBe('CANCELLED')
  expect(asked.booking.cancellationChoice.status).toBe('RESCHEDULING')
  const accepted = await t.tutorApi.post(`/tutor/bookings/${t.booking.id}`, { action: 'approve-time', requestId: asked.booking.reschedule.id })
  expect(accepted.status).toBe(200)
  expect(accepted.booking.status).toBe('CONFIRMED')
  expect(accepted.booking.cancellationChoice.status).toBe('RESCHEDULED')
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: t.payment.id } })).status).toBe('PAID')
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(0)
})

test('an unanswered replacement time goes to refund review after 24 hours, once', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  expect(asked.status).toBe(201)
  const request = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: asked.booking.reschedule.id } })
  const deadline = new Date(request.createdAt.getTime() + CANCELLATION_RESPONSE_HOURS * 3_600_000)
  expect(Date.parse(asked.booking.reschedule.responseBy)).toBe(deadline.getTime())
  await expireCancellationResponses(new Date(deadline.getTime() - 1))
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(0)
  await expireCancellationResponses(deadline)
  await expireCancellationResponses(deadline)
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
  expect((await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('REJECTED')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })).cancellationChoiceStatus).toBe('REFUND')
  for (const user of [t.parent.user, t.tutor.user, t.admin.user]) expect(await prisma.notification.count({ where: { userId: user.id, type: 'REFUND_REQUESTED' } })).toBe(1)
})

test('a tutor cannot accept after the 24-hour response deadline even before housekeeping runs', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  await prisma.rescheduleRequest.update({ where: { id: asked.booking.reschedule.id }, data: { createdAt: new Date(Date.now() - (CANCELLATION_RESPONSE_HOURS + 1) * 3_600_000) } })
  const result = await t.tutorApi.post(`/tutor/bookings/${t.booking.id}`, { action: 'approve-time', requestId: asked.booking.reschedule.id })
  expect(result.status).toBe(409)
  await expireCancellationResponses()
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
})

test('the tutor receives one reminder in the final six hours before the response deadline', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  const request = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: asked.booking.reschedule.id } })
  const reminderAt = new Date(request.createdAt.getTime() + (CANCELLATION_RESPONSE_HOURS - 6) * 3_600_000)
  await remindCancellationResponses(new Date(reminderAt.getTime() - 1))
  expect(await prisma.notification.count({ where: { userId: t.tutor.user.id, type: 'CANCELLATION_RESPONSE_REMINDER' } })).toBe(0)
  await remindCancellationResponses(reminderAt)
  await remindCancellationResponses(reminderAt)
  expect(await prisma.notification.count({ where: { userId: t.tutor.user.id, type: 'CANCELLATION_RESPONSE_REMINDER' } })).toBe(1)
})

test('the 48-hour timer does not refund while a new-time request is being reviewed', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  expect(asked.status).toBe(201)
  const deadline = new Date(asked.booking.cancellationChoice.until)
  await expireCancellationChoices(new Date(deadline.getTime() + 1000))
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(0)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })).cancellationChoiceStatus).toBe('RESCHEDULING')
})

test('withdrawing a new-time request after the deadline sends the refund for review', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  await prisma.booking.update({ where: { id: t.booking.id }, data: { cancellationChoiceUntil: new Date(Date.now() - 1000) } })
  const withdrawn = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule/${asked.booking.reschedule.id}/withdraw`)
  expect(withdrawn.status).toBe(200)
  expect(withdrawn.booking.cancellationChoice.status).toBe('REFUND')
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
})

test('withdrawing after the 24-hour response window cannot restart the choice', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  await prisma.rescheduleRequest.update({ where: { id: asked.booking.reschedule.id }, data: { createdAt: new Date(Date.now() - (CANCELLATION_RESPONSE_HOURS + 1) * 3_600_000) } })
  const withdrawn = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule/${asked.booking.reschedule.id}/withdraw`)
  expect(withdrawn.status).toBe(409)
  await expireCancellationResponses()
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id, status: 'PENDING' } })).toBe(1)
})

test.each(['move', 'keep'])('admin can resolve a declined new time with %s', async action => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  const declined = await t.tutorApi.post(`/tutor/bookings/${t.booking.id}`, { action: 'decline-time', requestId: asked.booking.reschedule.id })
  expect(declined.booking.reschedule.status).toBe('ESCALATED')
  const current = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  const decision = await t.adminApi.post(`/admin/bookings/${t.booking.id}/decision`, { kind: 'Schedule change', caseId: asked.booking.reschedule.id, version: current.updatedAt.toISOString(), action, reason: 'Reviewed with both parties' })
  expect(decision.status).toBe(204)
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  expect(saved.status).toBe(action === 'move' ? 'CONFIRMED' : 'CANCELLED')
  expect(saved.cancellationChoiceStatus).toBe(action === 'move' ? 'RESCHEDULED' : 'REFUND')
  expect(await prisma.refund.count({ where: { paymentId: t.payment.id } })).toBe(action === 'move' ? 0 : 1)
})

test('racing a refund with a new-time request never leaves both active', async () => {
  const t = await paidLesson()
  await Promise.all([
    t.parentApi.post(`/parent/bookings/${t.booking.publicId}/cancellation-refund`),
    t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' }),
  ])
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  const refunds = await prisma.refund.count({ where: { paymentId: t.payment.id, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] } } })
  const activeTimes = await prisma.rescheduleRequest.count({ where: { bookingId: t.booking.id, status: { in: ['PENDING', 'ESCALATED'] } } })
  expect(refunds <= 1).toBe(true)
  expect(refunds && activeTimes).toBe(0)
  expect(['REFUND', 'RESCHEDULING']).toContain(saved.cancellationChoiceStatus)
})

test('a tutor accepting and a parent requesting a refund cannot both take effect', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  expect(asked.status).toBe(201)
  await Promise.all([
    t.parentApi.post(`/parent/bookings/${t.booking.publicId}/cancellation-refund`),
    t.tutorApi.post(`/tutor/bookings/${t.booking.id}`, { action: 'approve-time', requestId: asked.booking.reschedule.id }),
  ])
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  const refunds = await prisma.refund.count({ where: { paymentId: t.payment.id, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] } } })
  expect(saved.status === 'CONFIRMED' && refunds === 0 || saved.status === 'CANCELLED' && refunds === 1).toBe(true)
})

test('an admin approving a new time and a parent requesting a refund cannot both take effect', async () => {
  const t = await paidLesson()
  const asked = await t.parentApi.post(`/parent/bookings/${t.booking.publicId}/reschedule`, { date: addDays(t.date, 7), startTime: '18:00' })
  await t.tutorApi.post(`/tutor/bookings/${t.booking.id}`, { action: 'decline-time', requestId: asked.booking.reschedule.id })
  const current = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  await Promise.all([
    t.parentApi.post(`/parent/bookings/${t.booking.publicId}/cancellation-refund`),
    t.adminApi.post(`/admin/bookings/${t.booking.id}/decision`, { kind: 'Schedule change', caseId: asked.booking.reschedule.id, version: current.updatedAt.toISOString(), action: 'move', reason: 'Reviewed with both parties' }),
  ])
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: t.booking.id } })
  const refunds = await prisma.refund.count({ where: { paymentId: t.payment.id, status: { in: ['PENDING', 'APPROVED', 'ESCALATED'] } } })
  expect(saved.status === 'CONFIRMED' && refunds === 0 || saved.status === 'CANCELLED' && refunds === 1).toBe(true)
})

test.each(['tutor', 'parent'])('%s cancellation closes an earlier escalated time change before refund review or a new choice', async actor => {
  const tutor = await makeTutor(), parent = await makeParent()
  const date = nextDate(MONDAY)
  const b = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date, status: 'CONFIRMED' })
  const p = await prisma.payment.create({ data: { bookingId: b.id, amount: 50, commissionAmount: 5, commissionRate: 10, paidAt: new Date(), status: 'PAID' } })
  const issue = await prisma.rescheduleRequest.create({ data: { bookingId: b.id, requestedById: parent.user.id, newStartAt: b.startAt, newEndAt: b.endAt, status: 'ESCALATED' } })
  const result = actor === 'tutor'
    ? await api(tutor.token).post(`/tutor/bookings/${b.id}`, { action: 'cancel', version: b.updatedAt.toISOString(), reason: 'Schedule changed' })
    : await api(parent.token).post(`/parent/bookings/${b.publicId}/cancel`, { reason: 'Schedule changed' })
  expect(result.status).toBe(200)
  expect((await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('REJECTED')
  expect(await prisma.refund.count({ where: { paymentId: p.id } })).toBe(actor === 'parent' ? 1 : 0)
  if (actor === 'tutor') expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).cancellationChoiceStatus).toBe('OPEN')
})
