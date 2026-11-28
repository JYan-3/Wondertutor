import { prisma } from '../config/prisma.js'
import { canRequestLessonDate, assertRequestLessonDate } from '../services/bookingCutoff.js'
import { addDays, mytParts, mytToDate, todayMyt } from '../utils/time.js'
import { api, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test('the cutoff follows Malaysia midnight, not a 24-hour interval', () => {
  const beforeMidnight = new Date('2026-11-18T15:59:59.999Z')
  const atMidnight = new Date('2026-11-18T16:00:00.000Z')
  expect(canRequestLessonDate('2026-11-19', beforeMidnight)).toBe(true)
  expect(canRequestLessonDate('2026-11-19', atMidnight)).toBe(false)
  expect(canRequestLessonDate('2026-11-20', atMidnight)).toBe(true)
  expect(canRequestLessonDate('2026-11-18', atMidnight)).toBe(false)
  expect(() => assertRequestLessonDate('2026-11-19', atMidnight)).toThrow(/day before/)
})

test('calendar, new requests and multi-date requests enforce the same cutoff', async () => {
  const today = todayMyt(), tomorrow = addDays(today, 1)
  const dow = date => mytParts(mytToDate(date, '12:00')).dow
  const t = await makeTutor({ availability: [today, tomorrow].map(date => ({ dayOfWeek: dow(date), startTime: '07:00', endTime: '22:00', mode: 'ONLINE' })) })
  const parent = await makeParent()
  const calendar = await api(parent.token).get(`/parent/tutors/${t.tutor.id}/slots?from=${today}`)
  expect(calendar.status).toBe(200)
  expect(calendar.days[0].slots.length).toBeGreaterThan(0)
  expect(calendar.days[0].slots.every(slot => slot.status === 'unavailable')).toBe(true)
  expect(calendar.days[1].slots.every(slot => slot.status === 'available')).toBe(true)
  const search = await api(parent.token).get(`/parent/tutors?subject=Mathematics&level=PRIMARY&grade=5&date=${today}&time=21%3A00&mode=ONLINE`)
  expect(search.status).toBe(200)
  expect(search.tutors.some(row => row.id === t.tutor.id)).toBe(false)
  const tomorrowSearch = await api(parent.token).get(`/parent/tutors?subject=Mathematics&level=PRIMARY&grade=5&date=${tomorrow}&time=21%3A00&mode=ONLINE`)
  expect(tomorrowSearch.tutors.some(row => row.id === t.tutor.id)).toBe(true)
  const base = { tutorId: t.tutor.id, childId: parent.child.id, teachingMode: 'ONLINE', proposedPrice: 45 }
  const rejected = await api(parent.token).post('/parent/bookings', { ...base, date: today, startTime: '21:00' })
  expect(rejected.status).toBe(400)
  expect(rejected.message).toMatch(/day before/)
  const bulk = await api(parent.token).post('/parent/bookings', { ...base, slots: [{ date: tomorrow, startTime: '17:00' }, { date: today, startTime: '21:00' }] })
  expect(bulk.status).toBe(400)
  expect(await prisma.booking.count({ where: { tutorId: t.tutor.id } })).toBe(0)
  const accepted = await api(parent.token).post('/parent/bookings', { ...base, date: tomorrow, startTime: '17:00' })
  expect(accepted.status).toBe(201)
})
