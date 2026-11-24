// Actual booking controllers/services, controlled Prisma results and a fake mail
// transport. No real email, production data or database connection is used.
import { jest } from '@jest/globals'
const sendEmail = jest.fn()
const sendBookingPush = jest.fn()
jest.unstable_mockModule('../services/email.service.js', () => ({ sendEmail, outbox: [] }))
jest.unstable_mockModule('../services/webPush.service.js', () => ({ sendBookingPush }))
const { prisma } = await import('../config/prisma.js')
const { env } = await import('../config/env.js')
const parentActions = await import('../controllers/parent/bookings.controller.js')
const reschedules = await import('../services/reschedule.service.js')
const { tutorAction } = await import('../services/tutorBooking.service.js')
const { decideBooking } = await import('../services/adminOperations.service.js')
const { notifyWithEmail, sendNotificationEmail } = await import('../services/notification.service.js')
const { addDays, formatLessonTime, mytParts, mytToDate } = await import('../utils/time.js')

const parentUser = { id: 11, fullName: 'Example Parent', email: 'parent@example.test', emailReminders: false, deletedAt: null }
const tutorUser = { id: 22, fullName: 'Example Tutor', email: 'tutor@example.test', emailReminders: false, deletedAt: null }
const publicId = '75b978b5-fe71-4707-aeb7-1fb1996231bd'
let booking, request, notices, events, created
const clone = value => structuredClone(value)
const req = body => ({ params: { id: '301' }, parent: { id: 101 }, user: clone(parentUser), body })
const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() })
const latestMail = () => sendEmail.mock.calls.at(-1)?.[0]
const newDate = () => addDays(mytParts(booking.startAt).date, 2)

beforeEach(() => {
  notices = []; events = []; created = 0; request = null
  const start = mytToDate(addDays(mytParts(new Date()).date, 14), '16:00')
  booking = {
    id: 301, publicId, parentId: 101, tutorId: 201, childId: 401, subject: 'Mathematics', status: 'COUNTER_OFFERED',
    startAt: start, endAt: new Date(start.getTime() + 3600000), createdAt: new Date(), updatedAt: new Date(),
    proposedPrice: 50, counterPrice: 60, agreedPrice: null, teachingMode: 'ONLINE',
    location: null, latitude: null, longitude: null, locationConfirmedAt: null,
    parent: { userId: parentUser.id, user: clone(parentUser), _count: { bookings: 0 } },
    tutor: { id: 201, userId: tutorUser.id, user: clone(tutorUser), hourlyRate: 50, ratingAvg: 4.8, ratingCount: 3,
      isVerified: true, yearsExperience: 5, offersOnline: true, offersPhysical: true,
      subjects: [{ subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }], availability: [],
    },
    child: { id: 401, parentId: 101, name: 'Example Child', subjects: ['Mathematics'], educationLevel: 'PRIMARY', grade: 5 },
    payment: null, attendance: null, review: null, summary: null, complaints: [], reschedules: [],
  }
  env.clientUrl = 'https://wondertutor.wonderland-home.com'
  sendEmail.mockReset().mockImplementation(async () => { events.push('email') })
  sendBookingPush.mockReset().mockImplementation(async () => { events.push('push') })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(prisma, '$transaction').mockImplementation(async work => { const result = await work(prisma); events.push('commit'); return result })
  jest.spyOn(prisma, '$queryRaw').mockResolvedValue([])
  jest.spyOn(prisma.user, 'findUnique').mockImplementation(async ({ where }) => clone(where.id === 22 ? tutorUser : parentUser))
  jest.spyOn(prisma.user, 'findMany').mockResolvedValue([])
  jest.spyOn(prisma.booking, 'findFirst').mockImplementation(async ({ where }) => where.id === booking.id ? clone(booking) : null)
  jest.spyOn(prisma.booking, 'findUnique').mockImplementation(async () => clone(booking))
  jest.spyOn(prisma.booking, 'updateMany').mockImplementation(async ({ data }) => { Object.assign(booking, data); return { count: 1 } })
  jest.spyOn(prisma.booking, 'update').mockImplementation(async ({ data }) => { Object.assign(booking, data); return clone(booking) })
  jest.spyOn(prisma.booking, 'create').mockImplementation(async ({ data }) => ({ ...clone(booking), ...data, id: booking.id + created++, publicId: created === 1 ? publicId : '85b978b5-fe71-4707-aeb7-1fb1996231bd' }))
  jest.spyOn(prisma.child, 'findFirst').mockImplementation(async () => clone(booking.child))
  jest.spyOn(prisma.tutorProfile, 'findFirst').mockImplementation(async () => clone(booking.tutor))
  jest.spyOn(prisma.notification, 'create').mockImplementation(async ({ data }) => { const row = { id: notices.length + 1, ...data }; notices.push(row); events.push('notice'); return row })
  jest.spyOn(prisma.notification, 'createMany').mockResolvedValue({ count: 0 })
  jest.spyOn(prisma.rescheduleRequest, 'findFirst').mockImplementation(async () => clone(request))
  jest.spyOn(prisma.rescheduleRequest, 'create').mockImplementation(async ({ data }) => { request = { id: 501, status: 'PENDING', ...data }; return clone(request) })
  jest.spyOn(prisma.rescheduleRequest, 'updateMany').mockImplementation(async ({ data }) => { if (request) Object.assign(request, data); return { count: 1 } })
  jest.spyOn(prisma.availabilityException, 'findMany').mockResolvedValue([])
  jest.spyOn(prisma.availabilityWeek, 'findMany').mockResolvedValue([])
  jest.spyOn(prisma.availabilitySlot, 'findMany').mockResolvedValue(Array.from({ length: 7 }, (_, dayOfWeek) => ({ tutorId: 201, dayOfWeek, startTime: '07:00', endTime: '22:00', mode: 'BOTH' })))
  jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue(null)
  jest.spyOn(prisma.payment, 'updateMany').mockResolvedValue({ count: 0 })
  jest.spyOn(prisma.complaint, 'findFirst').mockResolvedValue(null)
  jest.spyOn(prisma.complaint, 'create').mockResolvedValue({ id: 601 })
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => prisma.$disconnect())

function expectTutorMail(title) {
  expect(sendEmail).toHaveBeenCalledTimes(1)
  expect(latestMail()).toMatchObject({ to: tutorUser.email, subject: `WonderTutor — ${title}` })
  expect(latestMail().html).toContain(`/tutor/bookings?booking=${publicId}`)
  expect(notices.filter(row => row.userId === tutorUser.id)).toHaveLength(1)
}

test.each(['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED'])('parent cancellation of a %s booking emails the tutor after commit', async status => {
  booking.status = status
  await parentActions.cancelBooking(req({ reason: 'School activity' }), response())
  expect(booking.status).toBe('CANCELLED')
  expectTutorMail('Booking cancelled')
  expect(latestMail().html).toContain('School activity')
  expect(latestMail().html).toContain('Mathematics')
  expect(latestMail().html).toContain('(MYT)')
  expect(events.indexOf('commit')).toBeLessThan(events.indexOf('email'))
})

test('a changed hourly offer emails the tutor the new and previous rates', async () => {
  await parentActions.negotiate(req({ action: 'counter', price: 55.5 }), response())
  expect(booking).toMatchObject({ status: 'PENDING', proposedPrice: 55.5, counterPrice: null })
  expectTutorMail('Parent proposed a new rate')
  expect(latestMail().html).toContain('RM55.50 per hour')
  expect(latestMail().html).toContain('Previous offer: RM60.00')
})

test.each(['acceptCounter', 'declineCounter'])('%s emails the tutor exactly once', async action => {
  await parentActions[action](req({ version: booking.updatedAt.toISOString() }), response())
  expectTutorMail(action === 'acceptCounter' ? 'Counter offer accepted' : 'Counter offer declined')
  if (action === 'acceptCounter') expect(latestMail().html).toContain('not confirmed yet')
})

test('one multi-slot request sends one tutor email containing both dates and the rate', async () => {
  const first = mytParts(booking.startAt).date, second = addDays(first, 2)
  await parentActions.createBooking(req({ tutorId: 201, childId: 401, teachingMode: 'ONLINE', proposedPrice: 55.5, slots: [{ date: first, startTime: '16:00' }, { date: second, startTime: '17:00' }] }), response())
  expectTutorMail('New booking request')
  expect(latestMail().html).toContain('2 Mathematics lesson(s)')
  expect(latestMail().html).toContain('RM55.50 per hour')
  expect(latestMail().html).toContain(formatLessonTime(mytToDate(first, '16:00'), mytToDate(first, '17:00')))
  expect(latestMail().html).toContain(formatLessonTime(mytToDate(second, '17:00'), mytToDate(second, '18:00')))
  expect(notices.filter(row => row.userId === parentUser.id)).toHaveLength(1)
})

test.each([parentUser.id, tutorUser.id])('a reschedule request from user %p emails the other party without moving the lesson', async byUserId => {
  booking.status = 'CONFIRMED'
  const originalStart = booking.startAt.getTime()
  await reschedules.requestReschedule({ booking: clone(booking), byUserId, date: newDate(), startTime: '18:00', reason: 'School activity' })
  const other = byUserId === parentUser.id ? tutorUser : parentUser
  expect(latestMail()).toMatchObject({ to: other.email, subject: 'WonderTutor — Reschedule requested' })
  expect(latestMail().html).toContain('School activity')
  expect(latestMail().html).toContain('until the request is accepted')
  expect(latestMail().html).toContain(`/${other.id === tutorUser.id ? 'tutor' : 'parent'}/bookings?booking=${publicId}`)
  expect(booking.startAt.getTime()).toBe(originalStart)
  expect(notices).toHaveLength(1)
})

function pendingTimeChange(requestedById) {
  booking.status = 'CONFIRMED'
  request = { id: 501, bookingId: booking.id, requestedById, status: 'PENDING', newStartAt: mytToDate(newDate(), '18:00'), newEndAt: mytToDate(newDate(), '19:00') }
}

test.each([true, false])('a parent response accept=%p to a tutor reschedule emails the tutor', async accept => {
  pendingTimeChange(tutorUser.id)
  await reschedules.respondReschedule({ booking: clone(booking), requestId: 501, byUserId: parentUser.id, accept })
  expectTutorMail(accept ? 'Reschedule accepted' : 'Reschedule declined')
  expect(request.status).toBe(accept ? 'APPROVED' : 'ESCALATED')
})

test.each([parentUser.id, tutorUser.id])('withdrawing a request by user %p emails the other party once', async byUserId => {
  pendingTimeChange(byUserId)
  await reschedules.withdrawReschedule({ booking: clone(booking), requestId: 501, byUserId })
  expect(latestMail().to).toBe(byUserId === parentUser.id ? tutorUser.email : parentUser.email)
  expect(latestMail().subject).toBe('WonderTutor — Reschedule withdrawn')
  expect(notices).toHaveLength(1)
})

test('venue confirmation sends one push and email after commit without disclosing the address', async () => {
  booking.teachingMode = 'PHYSICAL'
  await parentActions.updateLessonLocation(req({ address: '12 Private Family Street', latitude: 3.1234567, longitude: 101.654321, confirmed: true, version: booking.updatedAt.toISOString() }), response())
  expectTutorMail('Lesson location confirmed')
  expect(latestMail().html).not.toMatch(/12 Private Family Street|3\.1234567|101\.654321/)
  expect(sendBookingPush.mock.calls).toEqual([[tutorUser.id, { type: 'BOOKING_UPDATED', link: '/tutor/bookings?booking=' + publicId }]])
  expect(events.slice(0, 2)).toEqual(['notice', 'commit'])
  expect(events.slice(2).sort()).toEqual(['email', 'push'])
})

test('resubmitting an unchanged venue sends neither another notice nor another email', async () => {
  Object.assign(booking, { status: 'PENDING', teachingMode: 'PHYSICAL', location: '12 Private Family Street', latitude: 3.1, longitude: 101.6, locationConfirmedAt: new Date() })
  await parentActions.updateLessonLocation(req({ address: booking.location, latitude: booking.latitude, longitude: booking.longitude, confirmed: true, version: booking.updatedAt.toISOString() }), response())
  expect(notices).toHaveLength(0)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(sendBookingPush).not.toHaveBeenCalled()
})

test.each([true, false])('admin booking decisions send each party one push only on a successful commit (commit=%p)', async commit => {
  jest.spyOn(prisma.booking, 'findUniqueOrThrow').mockResolvedValue(clone(booking))
  prisma.complaint.findFirst.mockResolvedValue({ id: 601, status: 'OPEN', updatedAt: new Date() })
  jest.spyOn(prisma.complaint, 'updateMany').mockResolvedValue({ count: 1 })
  prisma.notification.createMany.mockImplementation(async ({ data }) => {
    notices.push(...data)
    events.push('notices')
    return { count: data.length }
  })
  if (!commit) prisma.$transaction.mockImplementationOnce(async work => {
    await work(prisma)
    throw new Error('Commit failed')
  })
  const result = decideBooking(booking.id, 99, {
    kind: 'Fee negotiation', caseId: 601, action: 'keep', version: booking.updatedAt.toISOString(), reason: 'Private decision notes',
  })
  if (!commit) {
    await expect(result).rejects.toThrow('Commit failed')
    expect(sendBookingPush).not.toHaveBeenCalled()
    return
  }
  await result
  expect(events).toEqual(['notices', 'commit', 'push', 'push'])
  expect(notices).toHaveLength(2)
  expect(sendBookingPush.mock.calls).toEqual([
    [parentUser.id, { type: 'BOOKING_DECISION', link: '/parent/bookings?booking=' + publicId }],
    [tutorUser.id, { type: 'BOOKING_DECISION', link: '/tutor/bookings?booking=' + booking.id }],
  ])
})

test.each(['counter', 'decline', 'accept', 'cancel'])('tutor action %s emails the parent, keeping both modules aligned', async action => {
  booking.status = action === 'cancel' ? 'CONFIRMED' : 'PENDING'
  await tutorAction(201, booking.id, { action, price: 65.5, reason: 'Unavailable that day', version: booking.updatedAt.toISOString() })
  expect(sendEmail).toHaveBeenCalledTimes(1)
  expect(latestMail().to).toBe(parentUser.email)
  expect(latestMail().html).toContain(`/parent/bookings?booking=${publicId}`)
  expect(latestMail().html).toContain('(MYT)')
  if (action === 'counter') expect(latestMail().html).toContain('RM65.50')
})

test('a failed booking update sends no misleading notification or email', async () => {
  prisma.booking.updateMany.mockResolvedValue({ count: 0 })
  await expect(parentActions.cancelBooking(req({}), response())).rejects.toMatchObject({ status: 409 })
  expect(sendEmail).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

test('a rejected price edit sends no email and does not change the offer', async () => {
  await expect(parentActions.negotiate(req({ action: 'counter', price: 0 }), response())).rejects.toMatchObject({ name: 'ZodError' })
  expect(booking.counterPrice).toBe(60)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

test('an unavailable proposed time sends no reschedule email', async () => {
  booking.status = 'CONFIRMED'
  prisma.booking.findFirst.mockResolvedValue({ id: 999 })
  await expect(reschedules.requestReschedule({ booking: clone(booking), byUserId: parentUser.id, date: newDate(), startTime: '18:00' })).rejects.toMatchObject({ status: 409 })
  expect(request).toBeNull()
  expect(sendEmail).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

test('a stale reschedule answer sends no confirmation email', async () => {
  pendingTimeChange(tutorUser.id)
  prisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 0 })
  await expect(reschedules.respondReschedule({ booking: clone(booking), requestId: 501, byUserId: parentUser.id, accept: true })).rejects.toMatchObject({ status: 409 })
  expect(sendEmail).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

test.each(['AWAITING_PAYMENT', 'CONFIRMED'])('online class link updates only notify parents for a %s lesson when appropriate', async status => {
  booking.status = status
  await tutorAction(201, booking.id, { action: 'link', url: 'https://meet.google.com/example', version: booking.updatedAt.toISOString() })
  expect(sendEmail).toHaveBeenCalledTimes(status === 'CONFIRMED' ? 1 : 0)
  expect(notices).toHaveLength(status === 'CONFIRMED' ? 1 : 0)
  if (status === 'CONFIRMED') expect(latestMail().html).not.toContain('https://meet.google.com/example')
})

test('SMTP failure keeps the successful cancellation and its in-app notice, without resending on a repeat action', async () => {
  sendEmail.mockRejectedValue(new Error('SMTP connection refused'))
  await parentActions.cancelBooking(req({}), response())
  expect(booking.status).toBe('CANCELLED')
  expect(notices).toHaveLength(1)
  await expect(parentActions.cancelBooking(req({}), response())).rejects.toMatchObject({ status: 400 })
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

test('a recipient lookup failure does not fail an already successful cancellation', async () => {
  prisma.user.findUnique.mockRejectedValue(new Error('Recipient lookup unavailable'))
  await parentActions.cancelBooking(req({}), response())
  expect(booking.status).toBe('CANCELLED')
  expect(notices).toHaveLength(1)
  expect(sendEmail).not.toHaveBeenCalled()
})

test('critical emails ignore the optional reminder switch and escape user-supplied HTML', async () => {
  await notifyWithEmail({ ...tutorUser, fullName: '<script>bad</script>' }, { type: 'BOOKING_UPDATED', title: 'Booking updated', message: '<img src=x onerror=bad()>', link: '/tutor/bookings' })
  expect(latestMail().html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(latestMail().html).toContain('&lt;img src=x onerror=bad()&gt;')
  expect(latestMail().html).not.toContain('<script>')
  expect(notices).toHaveLength(1)
})

test('deleted accounts receive no email and email-only delivery never duplicates an in-app notice', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...tutorUser, deletedAt: new Date() })
  expect(await sendNotificationEmail(tutorUser.id, { title: 'Booking updated', message: 'Updated', link: '/tutor/bookings' })).toBe(false)
  expect(sendEmail).not.toHaveBeenCalled()
  expect(notices).toHaveLength(0)
})

test('lesson labels explicitly convert UTC to Malaysia time and include the year', () => {
  const text = formatLessonTime(new Date('2026-11-17T00:00:00Z'), new Date('2026-11-17T01:00:00Z'))
  expect(text).toMatch(/17 Nov 2026/)
  expect(text).toMatch(/8:00/)
  expect(text).toMatch(/9:00/)
  expect(text).toContain('(MYT)')
})
