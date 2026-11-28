// Rescheduling: mutual agreement moves the lesson; no agreement escalates to Admin.
import { prisma } from '../config/prisma.js'
import { requestReschedule, respondReschedule } from '../services/reschedule.service.js'
import { bookingInclude } from '../services/booking.dto.js'
import { jest } from '@jest/globals'
import { addDays, mytToDate } from '../utils/time.js'
import { paymentDeadline } from '../services/paymentWindow.js'
import { MONDAY, api, makeAdmin, makeBooking, makeChild, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'
import { todayMyt } from '../utils/time.js'

let parent, tutor, admin, date
beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  tutor = await makeTutor() // Mondays + Wednesdays 16:00-20:00
  admin = await makeAdmin()
  date = nextDate(MONDAY)
})
afterAll(stopServer)
afterEach(() => jest.useRealTimers())

const confirmed = (start = '17:00', child = parent.child) =>
  makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date, start, status: 'CONFIRMED' })
const full = (b) => prisma.booking.findUnique({ where: { id: b.id }, include: bookingInclude })
const ask = (b, body) => api(parent.token).post(`/parent/bookings/${b.id}/reschedule`, body)
const answer = (b, rid, action) => api(parent.token).post(`/parent/bookings/${b.id}/reschedule/${rid}/${action}`)
const hhmm = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })

// Keep database/network timers real while controlling only the lesson clock.
const freezeAt = (time, day = date) => jest.useFakeTimers({
  now: mytToDate(day, time),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'],
})
async function paymentWindowBooking(status = 'AWAITING_PAYMENT', payBy = mytToDate(date, '18:30')) {
  const p = await makeParent()
  const t = await makeTutor()
  const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '19:00', status, extra: { payBy } })
  return { p, t, b: await full(b) }
}

describe('reschedule payment window', () => {
  test.each(['16:30', '17:00'])('an unpaid lesson cannot request %s when the payment cutoff has already arrived', async startTime => {
    const { p, b } = await paymentWindowBooking()
    freezeAt('16:00')
    await expect(requestReschedule({ booking: b, byUserId: p.user.id, date, startTime })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/more than one hour/) })
    expect(await prisma.rescheduleRequest.count({ where: { bookingId: b.id } })).toBe(0)
    expect((await full(b)).startAt).toEqual(b.startAt)
  })

  test('acceptance rechecks the proposed cutoff and leaves a request pending when it has passed', async () => {
    const { p, t, b } = await paymentWindowBooking()
    freezeAt('16:00', addDays(date, -1))
    const request = await requestReschedule({ booking: b, byUserId: p.user.id, date, startTime: '18:00' })
    jest.setSystemTime(mytToDate(date, '17:00'))
    await expect(respondReschedule({ booking: b, requestId: request.id, byUserId: t.user.id, accept: true })).rejects.toMatchObject({ status: 400 })
    expect((await prisma.rescheduleRequest.findUnique({ where: { id: request.id } })).status).toBe('PENDING')
    expect((await full(b)).startAt).toEqual(b.startAt)
  })

  test('acceptance keeps the saved payment deadline and refuses an expired hold even for a later lesson', async () => {
    const previous = addDays(date, -1)
    const { p, t, b } = await paymentWindowBooking('AWAITING_PAYMENT', mytToDate(previous, '16:30'))
    freezeAt('16:00', previous)
    const request = await requestReschedule({ booking: b, byUserId: p.user.id, date, startTime: '18:00' })
    jest.setSystemTime(mytToDate(previous, '16:30'))
    await expect(respondReschedule({ booking: b, requestId: request.id, byUserId: t.user.id, accept: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/payment window has ended/) })
    expect((await full(b)).startAt).toEqual(b.startAt)
    expect((await prisma.rescheduleRequest.findUnique({ where: { id: request.id } })).status).toBe('PENDING')
  })

  test('an unpaid reschedule with time to pay succeeds without extending the saved hold', async () => {
    const { p, t, b } = await paymentWindowBooking()
    freezeAt('16:00', addDays(date, -1))
    const request = await requestReschedule({ booking: b, byUserId: p.user.id, date, startTime: '18:00' })
    await respondReschedule({ booking: b, requestId: request.id, byUserId: t.user.id, accept: true })
    const moved = await full(b)
    expect(moved).toMatchObject({ status: 'AWAITING_PAYMENT', startAt: mytToDate(date, '18:00'), payBy: b.payBy })
    expect(paymentDeadline(moved)).toEqual(mytToDate(date, '17:00'))
  })

  test('a confirmed lesson cannot be moved on the lesson day', async () => {
    const { p, b } = await paymentWindowBooking('CONFIRMED')
    freezeAt('16:00')
    await expect(requestReschedule({ booking: b, byUserId: p.user.id, date, startTime: '16:30' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/day before/) })
    expect((await full(b)).startAt).toEqual(b.startAt)
  })
})

describe('parent asks to reschedule', () => {
  test('a replacement lesson cannot be requested for the current Malaysia calendar day', async () => {
    const t = await makeTutor(), p = await makeParent()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '16:00', status: 'CONFIRMED' })
    const result = await api(p.token).post(`/parent/bookings/${b.id}/reschedule`, { date: todayMyt(), startTime: '23:00' })
    expect(result.status).toBe(400)
    expect(result.message).toMatch(/day before/i)
    expect(await prisma.rescheduleRequest.count({ where: { bookingId: b.id } })).toBe(0)
  })
  test('an unanswered request cannot move a lesson after it has started', async () => {
    const t = await makeTutor()
    const p = await makeParent()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: '2020-01-06', start: '16:00', status: 'CONFIRMED' })
    const r = await prisma.rescheduleRequest.create({ data: { bookingId: b.id, requestedById: t.user.id, newStartAt: new Date(Date.now() + 86400000), newEndAt: new Date(Date.now() + 90000000) } })
    const response = await api(p.token).post(`/parent/bookings/${b.id}/reschedule/${r.id}/accept`)
    expect(response.status).toBe(400)
    expect(response.message).toMatch(/already started/)
    expect((await prisma.rescheduleRequest.findUnique({ where: { id: r.id } })).status).toBe('PENDING')
  })

  test('two lessons cannot be rescheduled into the same tutor slot concurrently', async () => {
    const t = await makeTutor()
    const families = await Promise.all([makeParent(), makeParent()])
    const bookings = await Promise.all(families.map((p, i) => makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: `${16 + i}:00`, status: 'CONFIRMED' })))
    const snapshots = await Promise.all(bookings.map(full))
    const requests = await Promise.all(snapshots.map((b, i) => requestReschedule({ booking: b, byUserId: families[i].user.id, date, startTime: '19:00' })))
    const answers = await Promise.allSettled(requests.map((r, i) => respondReschedule({ booking: snapshots[i], requestId: r.id, byUserId: t.user.id, accept: true })))
    expect(answers.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(answers.find((r) => r.status === 'rejected').reason.status).toBe(409)
    const current = await prisma.booking.findMany({ where: { tutorId: t.tutor.id } })
    expect(current.filter((b) => hhmm(b.startAt) === '19:00')).toHaveLength(1)
    expect(await prisma.rescheduleRequest.count({ where: { bookingId: { in: bookings.map((b) => b.id) }, status: 'PENDING' } })).toBe(1)
  })

  test('simultaneous requests create only one pending reschedule', async () => {
    const t = await makeTutor()
    const p = await makeParent()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '16:00', status: 'CONFIRMED' })
    const replies = await Promise.all([17, 18].map((hour) => api(p.token).post(`/parent/bookings/${b.id}/reschedule`, { date, startTime: `${hour}:00` })))
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await prisma.rescheduleRequest.count({ where: { bookingId: b.id, status: 'PENDING' } })).toBe(1)
  })

  test.each(['PARENT', 'TUTOR'])('%s cannot replace a time change while administrator review is pending', async role => {
    const t = await makeTutor()
    const p = await makeParent()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '16:00', status: 'CONFIRMED' })
    const initial = await api(p.token).post(`/parent/bookings/${b.publicId}/reschedule`, {
      date: nextDate(3), startTime: '17:00', reason: 'School activity',
    })
    expect(initial.status).toBe(201)
    const requestId = initial.booking.reschedule.id
    const declined = await api(t.token).post(`/tutor/bookings/${b.publicId}`, { action: 'decline-time', requestId })
    expect(declined.status).toBe(200)
    expect(declined.booking.reschedule.status).toBe('ESCALATED')
    const noticesBefore = await prisma.notification.count()

    const next = { date: nextDate(3), startTime: '18:00', reason: 'A different proposed time' }
    const response = role === 'PARENT'
      ? await api(p.token).post(`/parent/bookings/${b.publicId}/reschedule`, next)
      : await api(t.token).post(`/tutor/bookings/${b.publicId}`, { action: 'reschedule', ...next })

    expect(response.status).toBe(409)
    expect(response.message).toMatch(/administrator is reviewing/i)
    const requests = await prisma.rescheduleRequest.findMany({ where: { bookingId: b.id } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ id: requestId, status: 'ESCALATED' })
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).toMatchObject({ status: 'CONFIRMED', startAt: b.startAt, endAt: b.endAt })
    expect(await prisma.notification.count()).toBe(noticesBefore)
  })

  test('a stale acceptance cannot move a booking cancelled after it was loaded', async () => {
    const t = await makeTutor()
    const p = await makeParent()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '16:00', status: 'CONFIRMED' })
    const snapshot = await full(b)
    const request = await requestReschedule({ booking: snapshot, byUserId: p.user.id, date, startTime: '18:00' })
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } })
    await expect(respondReschedule({ booking: snapshot, requestId: request.id, byUserId: t.user.id, accept: true })).rejects.toMatchObject({ status: 409 })
    expect(hhmm((await full(b)).startAt)).toBe('16:00')
    expect((await prisma.rescheduleRequest.findUnique({ where: { id: request.id } })).status).toBe('PENDING')
  })
  let b, rid
  test('asking creates a pending request and tells the tutor', async () => {
    b = await confirmed('17:00')
    const res = await ask(b, { date, startTime: '19:00', reason: 'School event' })
    expect(res.status).toBe(201)
    expect(res.booking.reschedule).toMatchObject({ status: 'PENDING', requestedBy: 'PARENT', reason: 'School event' })
    expect(hhmm(res.booking.startAt)).toBe('17:00') // nothing moves until the tutor agrees
    rid = res.booking.reschedule.id
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'RESCHEDULE_REQUESTED' } })).toBe(1)
  })

  test('only one open request at a time, and the parent cannot approve their own request', async () => {
    expect((await ask(b, { date, startTime: '18:00' })).status).toBe(409)
    expect((await answer(b, rid, 'accept')).status).toBe(403)
  })

  test('when the tutor agrees, the lesson moves to the new time and the parent is told', async () => {
    await respondReschedule({ booking: await full(b), requestId: rid, byUserId: tutor.user.id, accept: true })
    const moved = await prisma.booking.findUnique({ where: { id: b.id } })
    expect(hhmm(moved.startAt)).toBe('19:00')
    expect(hhmm(moved.endAt)).toBe('20:00') // same lesson length
    expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'RESCHEDULE_APPROVED' } })).toBe(1)
  })

  test('a lesson can be moved into a time that overlaps its own old time', async () => {
    const own = await confirmed('16:00', await makeChild(parent.parent.id, { name: 'Mia' }))
    expect((await ask(own, { date, startTime: '16:30' })).status).toBe(201)
  })

  test('the new time must be inside the tutor availability and free', async () => {
    const other = await confirmed('18:00', await makeChild(parent.parent.id, { name: 'Ken' }))
    expect((await ask(other, { date, startTime: '21:00' })).status).toBe(400) // tutor not available
    expect((await ask(other, { date, startTime: '19:00' })).status).toBe(409) // taken by the lesson moved above
  })

  test('the parent can withdraw their own request', async () => {
    const c = await confirmed('17:00', await makeChild(parent.parent.id, { name: 'Zoe' }))
    const r = await ask(c, { date: nextDate(3), startTime: '17:00' })
    const w = await answer(c, r.booking.reschedule.id, 'withdraw')
    expect(w.status).toBe(200)
    expect(w.booking.reschedule.status).toBe('REJECTED')
  })

  test('requests that are not yet agreed (PENDING) cannot be rescheduled; cancel and rebook instead', async () => {
    const p = await makeBooking({ parent: parent.parent, child: await makeChild(parent.parent.id, { name: 'Leo' }), tutor: tutor.tutor, date, start: '16:00', status: 'PENDING' })
    expect((await ask(p, { date, startTime: '17:00' })).status).toBe(400)
  })
})

describe('tutor asks to reschedule', () => {
  test('the parent declining escalates to Admin and the lesson keeps its time', async () => {
    const previousAdminNotices = await prisma.notification.count({ where: { userId: admin.user.id, type: 'RESCHEDULE_ESCALATED' } })
    const child = await makeChild(parent.parent.id, { name: 'Ivy' })
    const b = await makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date: nextDate(3), start: '16:00', status: 'CONFIRMED' })
    const req = await requestReschedule({ booking: await full(b), byUserId: tutor.user.id, date: nextDate(3), startTime: '18:00', reason: 'Clinic appointment' })

    const view = await api(parent.token).get(`/parent/bookings/${b.id}`)
    expect(view.booking.reschedule).toMatchObject({ status: 'PENDING', requestedBy: 'TUTOR' })

    const declined = await answer(b, req.id, 'decline')
    expect(declined.status).toBe(200)
    expect(declined.booking.reschedule.status).toBe('ESCALATED')
    expect(hhmm(declined.booking.startAt)).toBe('16:00')
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'RESCHEDULE_ESCALATED' } })).toBe(previousAdminNotices + 1)
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'RESCHEDULE_ESCALATED' } })).toBe(1)
  })

  test('another parent cannot touch the booking', async () => {
    const stranger = await makeParent()
    const b = await confirmed('19:00', await makeChild(parent.parent.id, { name: 'Max' }))
    expect((await api(stranger.token).post(`/parent/bookings/${b.id}/reschedule`, { date, startTime: '16:00' })).status).toBe(404)
  })
})
