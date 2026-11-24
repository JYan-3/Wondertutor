import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test.each(['accept-counter', 'decline-counter'])('a stale %s cannot act on a later offer after another round of negotiation', async action => {
  const parent = await makeParent(), tutor = await makeTutor()
  const booking = await makeBooking({
    parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(1),
    status: 'COUNTER_OFFERED', extra: { counterPrice: 55 },
  })
  const shownVersion = booking.updatedAt.toISOString()
  const proposal = await api(parent.token).post(`/parent/bookings/${booking.id}/negotiate`, { action: 'counter', price: 50 })
  expect(proposal.status).toBe(200)
  const pending = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  const counter = await api(tutor.token).post(`/tutor/bookings/${booking.id}`, {
    action: 'counter', price: 65, version: pending.updatedAt.toISOString(),
  })
  expect(counter.status).toBe(200)
  const endpoint = `/parent/bookings/${booking.publicId}/${action}`
  const stale = await api(parent.token).post(endpoint, { version: shownVersion })
  expect(stale.status).toBe(409)
  expect(stale.message).toMatch(/refresh.*price/i)
  const current = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(current.status).toBe('COUNTER_OFFERED')
  expect(Number(current.counterPrice)).toBe(65)
  expect(current.agreedPrice).toBeNull()
  const refreshed = await api(parent.token).post(endpoint, { version: current.updatedAt.toISOString() })
  expect(refreshed.status).toBe(200)
  expect(refreshed.booking.status).toBe(action === 'accept-counter' ? 'AWAITING_PAYMENT' : 'CANCELLED')
  if (action === 'accept-counter') expect(refreshed.booking.agreedPrice).toBe(65)
})

test('a missing offer version asks an older client to refresh without committing a price', async () => {
  const parent = await makeParent(), tutor = await makeTutor()
  const booking = await makeBooking({
    parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(1),
    status: 'COUNTER_OFFERED', extra: { counterPrice: 55 },
  })
  const response = await api(parent.token).post(`/parent/bookings/${booking.publicId}/accept-counter`)
  expect(response.status).toBe(409)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('COUNTER_OFFERED')
})
