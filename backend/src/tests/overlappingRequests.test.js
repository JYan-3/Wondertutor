import { prisma } from '../config/prisma.js'
import { settlePayment } from '../services/payment.service.js'
import { MONDAY, api, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test('one verified payment confirms the lesson and closes alternative requests; a late real payment is refunded', async () => {
  const parent = await makeParent(), tutors = await Promise.all([makeTutor(), makeTutor()])
  const body = { childId: parent.child.id, date: nextDate(MONDAY), startTime: '17:00', teachingMode: 'ONLINE', proposedPrice: 45 }
  const requests = await Promise.all(tutors.map(t => api(parent.token).post('/parent/bookings', { ...body, tutorId: t.tutor.id })))
  expect(requests.map(r => r.status)).toEqual([201, 201])
  for (let i = 0; i < tutors.length; i++) {
    const booking = requests[i].booking
    expect((await api(tutors[i].token).post(`/tutor/bookings/${booking.id}`, { action: 'accept', version: booking.updatedAt })).status).toBe(200)
  }
  const checkouts = await Promise.all(requests.map(r => api(parent.token).post('/parent/payments/checkout', { bookingId: r.booking.id })))
  expect(checkouts.map(c => c.status)).toEqual([201, 201])
  const results = await Promise.all(checkouts.map(c => settlePayment(c.paymentId, { paid: true, real: true })))
  expect(results.map(r => r.result).sort()).toEqual(['LATE', 'SUCCESS'])
  const rows = await prisma.booking.findMany({ where: { id: { in: requests.map(r => r.booking.id) } } })
  expect(rows.filter(r => r.status === 'CONFIRMED')).toHaveLength(1)
  expect(rows.filter(r => r.status === 'CANCELLED')).toHaveLength(1)
  const lateIndex = results.findIndex(r => r.result === 'LATE')
  expect(await prisma.refund.count({ where: { paymentId: checkouts[lateIndex].paymentId, status: 'PENDING' } })).toBe(1)
  expect((await settlePayment(checkouts[lateIndex].paymentId, { paid: true, real: true })).result).toBe('ALREADY')
  expect(await prisma.refund.count({ where: { paymentId: checkouts[lateIndex].paymentId } })).toBe(1)
})
