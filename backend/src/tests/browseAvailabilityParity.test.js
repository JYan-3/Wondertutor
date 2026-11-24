import { api, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test('browse availability uses the same full-interval and teaching-mode rules as booking', async () => {
  const parent = await makeParent()
  const compatible = await makeTutor({ availability: [
    { dayOfWeek: 1, startTime: '17:00', endTime: '18:00', mode: 'BOTH' },
    { dayOfWeek: 1, startTime: '18:00', endTime: '19:00', mode: 'ONLINE' },
  ] })
  const changingMode = await makeTutor({ availability: [
    { dayOfWeek: 1, startTime: '17:00', endTime: '18:00', mode: 'PHYSICAL' },
    { dayOfWeek: 1, startTime: '18:00', endTime: '19:00', mode: 'ONLINE' },
  ] })
  const gap = await makeTutor({ availability: [
    { dayOfWeek: 1, startTime: '17:00', endTime: '17:45', mode: 'BOTH' },
    { dayOfWeek: 1, startTime: '18:00', endTime: '19:00', mode: 'ONLINE' },
  ] })
  const search = '/parent/tutors?' + new URLSearchParams({
    subject: 'Mathematics', level: 'PRIMARY', grade: '5', date: nextDate(1), time: '17:30',
  })
  for (const mode of ['', '&mode=ONLINE']) {
    const result = await api(parent.token).get(search + mode)
    expect(result.status).toBe(200)
    expect(result.tutors.map(tutor => tutor.id)).toEqual([compatible.tutor.id])
    expect(result.tutors.map(tutor => tutor.id)).not.toContain(changingMode.tutor.id)
    expect(result.tutors.map(tutor => tutor.id)).not.toContain(gap.tutor.id)
  }
  const physical = await api(parent.token).get(search + '&mode=PHYSICAL')
  expect(physical.tutors).toHaveLength(0)
})
