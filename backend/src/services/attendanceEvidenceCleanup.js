import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { privateAsset } from './privateMedia.js'

const finalReview = (review, now) => review.status === 'RESOLVED' || (review.status === 'DISMISSED' && (review.appealUsed || (review.appealUntil && review.appealUntil <= now)))

// Lock the lesson while checking finality and references so an appeal cannot race deletion.
export async function cleanupAttendanceEvidence(id, now = new Date()) {
  const first = await prisma.complaint.findUnique({ where: { id }, select: { bookingId: true, booking: { select: { tutorId: true } } } })
  if (!first?.bookingId || !first.booking) return false
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${first.booking.tutorId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${first.bookingId} FOR UPDATE`
    const review = await tx.complaint.findUnique({ where: { id }, include: { reviewHistory: { select: { evidenceUrl: true } } } })
    if (!review || review.category !== 'Missed check-in' || !finalReview(review, now)) return false
    const urls = [...new Set([review.evidenceUrl, ...review.reviewHistory.map(entry => entry.evidenceUrl)].filter(Boolean))]
    const assets = new Map()
    for (const url of urls) {
      const asset = privateAsset(url, `wondertutor/attendance/${first.bookingId}`)
      if (!asset) throw new Error('Attendance evidence needs manual cleanup')
      assets.set(asset.id, asset)
    }
    for (const asset of assets.values()) {
      const [attendance, otherReview, otherHistory] = await Promise.all([
        tx.attendance.findFirst({ where: { checkInPhotoUrl: { contains: asset.id } }, select: { id: true } }),
        tx.complaint.findFirst({ where: { id: { not: id }, evidenceUrl: { contains: asset.id } }, select: { id: true } }),
        tx.attendanceReviewEntry.findFirst({ where: { complaintId: { not: id }, evidenceUrl: { contains: asset.id } }, select: { id: true } }),
      ])
      if (attendance || otherReview || otherHistory) continue
      const { cloudName, apiKey, apiSecret } = env.cloudinary
      if (!cloudName || !apiKey || !apiSecret) throw new Error('Attendance evidence cleanup is not configured')
      const result = await cloudinary.uploader.destroy(asset.id, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, type: 'authenticated', resource_type: 'image', invalidate: true, timeout: 8000 })
      if (!['ok', 'not found'].includes(result?.result)) throw new Error('Attendance evidence cleanup failed')
    }
    await tx.attendanceReviewEntry.updateMany({ where: { complaintId: id, evidenceUrl: { not: null } }, data: { evidenceUrl: null } })
    await tx.complaint.update({ where: { id }, data: { evidenceUrl: null } })
    return true
  }, { timeout: 30000 })
}

export async function retryAttendanceEvidenceCleanups(now = new Date()) {
  let failed = false
  let afterId = 0
  while (true) {
    const cases = await prisma.complaint.findMany({ where: { id: { gt: afterId }, category: 'Missed check-in', AND: [
      { OR: [{ status: 'RESOLVED' }, { status: 'DISMISSED', appealUsed: true }, { status: 'DISMISSED', appealUntil: { lte: now } }] },
      { OR: [{ evidenceUrl: { not: null } }, { reviewHistory: { some: { evidenceUrl: { not: null } } } }] },
    ] }, select: { id: true }, orderBy: { id: 'asc' }, take: 5 })
    if (!cases.length) break
    for (const row of cases) {
      afterId = row.id
      try { await cleanupAttendanceEvidence(row.id, now) } catch { failed = true }
    }
  }
  if (failed) throw new Error('Attendance evidence cleanup requires retry')
}
