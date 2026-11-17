import { jest } from '@jest/globals'
import { prisma } from '../config/prisma.js'
import { ringgit } from '../utils/validators.js'
import { createBooking } from '../controllers/parent/bookings.controller.js'

const body = { tutorId: 2, childId: 1, date: '2027-01-13', startTime: '17:00', teachingMode: 'ONLINE', proposedPrice: 50 }
afterEach(() => jest.restoreAllMocks())
afterAll(() => prisma.$disconnect())

test.each([undefined, null, '', '50', true, [], {}, 0, -10, 0.001, 0.000000001, 50.555, 1000.01, NaN, Infinity])('the booking API rejects invalid price %p before any booking work', async proposedPrice => {
  const childRead = jest.spyOn(prisma.child, 'findFirst').mockRejectedValue(new Error('Invalid prices must not reach the database'))
  const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValue(new Error('Invalid prices must not start a transaction'))
  await expect(createBooking({ body: { ...body, proposedPrice }, parent: { id: 91 } }, {})).rejects.toMatchObject({ name: 'ZodError' })
  expect(childRead).not.toHaveBeenCalled()
  expect(transaction).not.toHaveBeenCalled()
})

test.each([0.01, 0.1, 19.9, 50, 50.5, 1000])('valid ringgit amount %p keeps its exact monetary value', amount => {
  expect(ringgit('Proposed price').parse(amount)).toBe(amount)
})
