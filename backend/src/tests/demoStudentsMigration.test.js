import { readFileSync } from 'node:fs'
import { prisma } from '../config/prisma.js'
import { resetDb, makeTutor, makeParent, makeBooking, nextDate, MONDAY } from './helpers.js'
import { earnings } from '../services/earnings.service.js'
import { listBookings } from '../services/tutorBooking.service.js'

const email = 'yapyh-wp23@student.tarc.edu.my'
const sql = readFileSync(new URL('../../prisma/migrations/20261119120000_yanhsi_demo_students/migration.sql', import.meta.url), 'utf8')
const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)
// Keep session variables and temporary tables on one connection, with rollback on failure.
const apply = () => prisma.$transaction(async db => {
  for (const statement of statements) {
    if (['START TRANSACTION', 'COMMIT'].includes(statement)) continue
    await db.$executeRawUnsafe(statement)
  }
}, { timeout: 30000 })
const target = async () => {
  const t = await makeTutor()
  await prisma.user.update({ where: { id: t.user.id }, data: { email } })
  return t
}
const demoBookings = () => prisma.booking.findMany({ where: { publicId: { startsWith: 'd191000' } }, orderBy: { publicId: 'asc' } })
beforeEach(resetDb)
afterAll(() => prisma.$disconnect())

test('a database without the target tutor receives no demo accounts or lessons', async () => {
  const other = await makeTutor()
  await apply()
  expect(await prisma.user.count()).toBe(1)
  expect(await prisma.booking.count()).toBe(0)
  expect(await prisma.tutorProfile.findUnique({ where: { id: other.tutor.id } })).toEqual(other.tutor)
})

test('adds ten visible students and varied lessons without changing existing records or earnings', async () => {
  const t = await target()
  const parent = await makeParent()
  const existing = await makeBooking({ tutor: t.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'COMPLETED' })
  await prisma.payment.create({ data: { bookingId: existing.id, amount: 100, commissionRate: 12, commissionAmount: 12, status: 'PAID' } })
  const before = await earnings(t.tutor.id)
  const profile = await prisma.tutorProfile.findUnique({ where: { id: t.tutor.id } })
  const availability = await prisma.availabilitySlot.findMany({ where: { tutorId: t.tutor.id } })
  await apply()
  const rows = await demoBookings()
  expect(rows).toHaveLength(20)
  expect(new Set(rows.map(b => b.childId)).size).toBe(10)
  expect(rows.filter(b => b.status === 'COMPLETED')).toHaveLength(10)
  expect(new Set(rows.map(b => b.status))).toEqual(new Set(['COMPLETED', 'PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED', 'REJECTED', 'CANCELLED']))
  expect(await prisma.sessionSummary.count()).toBe(10)
  expect(await prisma.attendance.count()).toBe(11)
  const displayed = (await listBookings(t.tutor.id)).filter(b => b.child.name.startsWith('[DEMO]'))
  expect(new Set(displayed.filter(b => ['COMPLETED', 'CONFIRMED', 'DISPUTED'].includes(b.status)).map(b => b.child.id)).size).toBe(10)
  expect(displayed.filter(b => b.status === 'COMPLETED').every(b => b.report?.homework && b.report?.progressNote)).toBe(true)
  expect((await prisma.rescheduleRequest.findMany()).map(r => r.status).sort()).toEqual(['ESCALATED', 'PENDING'])
  const after = await earnings(t.tutor.id)
  expect(after.available.toString()).toBe(before.available.toString())
  expect(after.totalEarned.toString()).toBe(before.totalEarned.toString())
  expect(await prisma.booking.findUnique({ where: { id: existing.id } })).toEqual(existing)
  expect(await prisma.tutorProfile.findUnique({ where: { id: t.tutor.id } })).toEqual(profile)
  expect(await prisma.availabilitySlot.findMany({ where: { tutorId: t.tutor.id } })).toEqual(availability)
  const demo = await prisma.user.findUnique({ where: { email: 'yanhsi-demo-20261119@example.invalid' } })
  expect(demo).toMatchObject({ passwordHash: null, googleId: null, emailReminders: false, isEmailVerified: false })
  await apply()
  expect(await demoBookings()).toEqual(rows)
  expect(await prisma.child.count()).toBe(11)
  expect(await prisma.rescheduleRequest.count()).toBe(2)
})

test('does not attach students to an unrelated account using the reserved demo email', async () => {
  await target()
  const p = await makeParent()
  await prisma.user.update({ where: { id: p.user.id }, data: { email: 'yanhsi-demo-20261119@example.invalid' } })
  await apply()
  expect(await prisma.child.count()).toBe(1)
  expect(await demoBookings()).toEqual([])
})

test('an existing reservation wins over a conflicting demo lesson', async () => {
  const t = await target()
  const p = await makeParent()
  const [{ today }] = await prisma.$queryRawUnsafe('SELECT DATE_FORMAT(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), "%Y-%m-%d") AS today')
  const startAt = new Date(`${today}T08:00:00Z`)
  startAt.setUTCDate(startAt.getUTCDate() + 11)
  const existing = await prisma.booking.create({ data: { parentId: p.parent.id, childId: p.child.id, tutorId: t.tutor.id, subject: 'Mathematics', startAt, endAt: new Date(+startAt + 3600000), proposedPrice: 50, status: 'CONFIRMED' } })
  await apply()
  expect(await prisma.booking.findUnique({ where: { publicId: 'd1910002-0000-4000-8000-000000000004' } })).toBeNull()
  expect(await prisma.booking.findUnique({ where: { id: existing.id } })).toEqual(existing)
  expect(await prisma.child.count()).toBe(11)
})
