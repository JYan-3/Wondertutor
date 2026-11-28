import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeBooking, makeParent, makeTutor, MONDAY, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test.each([[26, 'PARENT_EARLY', 100], [23, 'PARENT_LATE', 90]])('parent cancelling %i hours before a paid lesson requests the correct refund', async (hours, policy, expected) => {
  const tutor = await makeTutor(), parent = await makeParent(), admin = await makeAdmin()
  const startAt = new Date(Date.now() + hours * 3_600_000)
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'CONFIRMED', extra: { startAt, endAt: new Date(startAt.getTime() + 3_600_000) } })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 12, commissionRate: 12, paidAt: new Date(), status: 'PAID' } })
  expect((await api(parent.token).post(`/parent/bookings/${booking.publicId}/cancel`)).status).toBe(200)
  const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.id } })
  expect(refund.policy).toBe(policy)
  expect(Number(refund.amount)).toBe(expected)
  const decision = `/admin/refunds/${refund.id}/decision`
  const approve = amount => api(admin.token).post(decision, { action: 'approve', amount, basis: 'Refund policy condition', reason: 'Cancellation policy' })
  expect((await approve(expected - 1)).status).toBe(400)
  expect((await approve(expected)).status).toBe(204)
  expect(Number((await api(tutor.token).get('/tutor/earnings')).available)).toBe(0)
  expect((await api(admin.token).post(decision, { action: 'issued', reference: `policy-test-${refund.id}` })).status).toBe(204)
  const earnings = await api(tutor.token).get('/tutor/earnings')
  expect(Number(earnings.available)).toBe(policy === 'PARENT_LATE' ? 10 : 0)
  expect(Number(earnings.transactions.find(row => row.bookingId === booking.id).cancellationFee)).toBe(policy === 'PARENT_LATE' ? 10 : 0)
  const ledger = (await api(admin.token).get('/admin/transactions')).rows.filter(row => row.bookingId === booking.id && ['Payment', 'Refund'].includes(row.type))
  expect(ledger.reduce((sum, row) => sum + Number(row.tutorNet), 0)).toBe(policy === 'PARENT_LATE' ? 10 : 0)
  expect(ledger.reduce((sum, row) => sum + Number(row.commission), 0)).toBe(0)
})
