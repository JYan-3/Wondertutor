import { jest } from '@jest/globals'

const sendEmail = jest.fn()
jest.unstable_mockModule('../services/email.service.js', () => ({ sendEmail, outbox: [] }))
const { prisma } = await import('../config/prisma.js')
const { settlePayment } = await import('../services/payment.service.js')
const { retryPaymentEmails } = await import('../services/paymentEmailDelivery.js')
const { MONDAY, makeBooking, makeParent, makeTutor, nextDate, resetDb, stopServer, startServer } = await import('./helpers.js')

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test('payment notices are saved once and a failed email is retried', async () => {
  const tutor = await makeTutor(), parent = await makeParent()
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'AWAITING_PAYMENT' })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 10, commissionRate: 10, status: 'PENDING' } })
  let tutorFailed = false
  sendEmail.mockImplementation(async ({ to }) => {
    if (to === tutor.user.email && !tutorFailed) { tutorFailed = true; throw new Error('mail temporarily unavailable') }
  })
  expect((await settlePayment(payment.id, { paid: true, real: true })).result).toBe('SUCCESS')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED')
  expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'PAYMENT_SUCCESS' } })).toBe(1)
  expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'BOOKING_CONFIRMED' } })).toBe(1)
  const parentDelivery = await prisma.paymentEmailDelivery.findUniqueOrThrow({ where: { paymentId_userId: { paymentId: payment.id, userId: parent.user.id } } })
  expect(parentDelivery.sentAt).not.toBeNull()
  let delivery = await prisma.paymentEmailDelivery.findUniqueOrThrow({ where: { paymentId_userId: { paymentId: payment.id, userId: tutor.user.id } } })
  expect(delivery.sentAt).toBeNull()
  expect(delivery.attempts).toBe(1)
  expect((await settlePayment(payment.id, { paid: true, real: true })).result).toBe('ALREADY')
  await retryPaymentEmails(new Date(delivery.retryAt.getTime() + 1000))
  delivery = await prisma.paymentEmailDelivery.findUniqueOrThrow({ where: { paymentId_userId: { paymentId: payment.id, userId: tutor.user.id } } })
  expect(delivery.sentAt).not.toBeNull()
  expect(sendEmail).toHaveBeenCalledTimes(3)
  await retryPaymentEmails(new Date(Date.now() + 600_000))
  expect(sendEmail).toHaveBeenCalledTimes(3)
  expect(sendEmail.mock.calls.filter(([mail]) => mail.to === parent.user.email)).toHaveLength(1)
  expect(sendEmail.mock.calls.filter(([mail]) => mail.to === tutor.user.email)).toHaveLength(2)
})

test('a notification storage failure rolls back settlement so the gateway can retry', async () => {
  const tutor = await makeTutor(), parent = await makeParent()
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'AWAITING_PAYMENT' })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 10, commissionRate: 10, status: 'PENDING' } })
  const transaction = prisma.$transaction.bind(prisma)
  const failure = jest.spyOn(prisma, '$transaction').mockImplementationOnce(work => transaction(tx => work(new Proxy(tx, { get(target, key) {
    if (key === 'notification') return { ...target.notification, createMany: async () => { throw new Error('notification storage unavailable') } }
    return Reflect.get(target, key)
  } }))))
  try { await expect(settlePayment(payment.id, { paid: true, real: true })).rejects.toThrow('notification storage unavailable') } finally { failure.mockRestore() }
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('AWAITING_PAYMENT')
  expect((await settlePayment(payment.id, { paid: true, real: true })).result).toBe('SUCCESS')
  expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'PAYMENT_SUCCESS' } })).toBe(1)
  expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'BOOKING_CONFIRMED' } })).toBe(1)
})
