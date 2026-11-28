import { jest } from '@jest/globals'
import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { cleanupAttendanceEvidence, retryAttendanceEvidenceCleanups } from '../services/attendanceEvidenceCleanup.js'
import { MONDAY, makeBooking, makeParent, makeTutor, nextDate, resetDb } from './helpers.js'

const original = { ...env.cloudinary }
beforeAll(async () => { await resetDb(); Object.assign(env.cloudinary, { cloudName: 'evidence-test', apiKey: 'test', apiSecret: 'test' }) })
afterAll(async () => { Object.assign(env.cloudinary, original); await prisma.$disconnect() })
afterEach(() => jest.restoreAllMocks())

async function review() {
  const parent = await makeParent(), tutor = await makeTutor()
  const booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'CONFIRMED' })
  const url = `https://res.cloudinary.com/evidence-test/image/authenticated/v1/wondertutor/attendance/${booking.id}/proof.pdf`
  const complaint = await prisma.complaint.create({ data: { bookingId: booking.id, filedById: tutor.user.id, category: 'Missed check-in', description: 'Test evidence', status: 'DISMISSED', appealUntil: new Date(Date.now() + 60_000), evidenceUrl: url } })
  await prisma.attendanceReviewEntry.create({ data: { complaintId: complaint.id, action: 'NOT_HELD', message: 'Test review', evidenceUrl: url } })
  return { booking, complaint, url }
}

test('proof stays through the appeal window and is removed after it ends', async () => {
  const x = await review()
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect(await cleanupAttendanceEvidence(x.complaint.id)).toBe(false)
  expect(destroy).not.toHaveBeenCalled()
  await retryAttendanceEvidenceCleanups(new Date(x.complaint.appealUntil.getTime() + 1))
  expect(destroy).toHaveBeenCalledTimes(1)
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: x.complaint.id } })).evidenceUrl).toBeNull()
  expect((await prisma.attendanceReviewEntry.findFirstOrThrow({ where: { complaintId: x.complaint.id } })).evidenceUrl).toBeNull()
})

test('a proof also used as a check-in photo is kept while the review reference is removed', async () => {
  const x = await review()
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  await prisma.attendance.create({ data: { bookingId: x.booking.id, checkInPhotoUrl: x.url } })
  await prisma.complaint.update({ where: { id: x.complaint.id }, data: { status: 'RESOLVED' } })
  expect(await cleanupAttendanceEvidence(x.complaint.id)).toBe(true)
  expect(destroy).not.toHaveBeenCalled()
  expect((await prisma.attendance.findUniqueOrThrow({ where: { bookingId: x.booking.id } })).checkInPhotoUrl).toBe(x.url)
})

test('a failed deletion keeps the references for a later retry', async () => {
  const x = await review()
  await prisma.complaint.update({ where: { id: x.complaint.id }, data: { status: 'RESOLVED' } })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ result: 'ok' })
  await expect(cleanupAttendanceEvidence(x.complaint.id)).rejects.toThrow('offline')
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: x.complaint.id } })).evidenceUrl).toBe(x.url)
  expect(await cleanupAttendanceEvidence(x.complaint.id)).toBe(true)
  expect(destroy).toHaveBeenCalledTimes(2)
})

test('failed deletions do not prevent later evidence from being cleaned up', async () => {
  const cases = []
  for (let i = 0; i < 6; i++) {
    const x = await review()
    await prisma.complaint.update({ where: { id: x.complaint.id }, data: { status: 'RESOLVED' } })
    cases.push(x)
  }
  jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ result: 'ok' })
  await expect(retryAttendanceEvidenceCleanups()).rejects.toThrow('requires retry')
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: cases[0].complaint.id } })).evidenceUrl).toBe(cases[0].url)
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: cases[5].complaint.id } })).evidenceUrl).toBeNull()
})
