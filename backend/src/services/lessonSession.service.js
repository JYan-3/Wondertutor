import { attendanceRefundState } from './attendanceRefund.js'
import { timingSafeEqual } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { distanceKm } from './matching.service.js'
import { mediaLink, privateAsset } from './privateMedia.js'
import { getSettings } from './systemSettings.service.js'
import { hasConfirmedLessonLocation, lessonLocationFields } from './lessonLocation.service.js'
import { sendBookingPush } from './webPush.service.js'

export const MISSED_CHECK_IN = 'Missed check-in'
const CHECK_IN_EARLY_MS = 10 * 60_000
export const CHECK_IN_LATE_MS = 15 * 60_000
const checkInCloses = b => Math.min(b.startAt.getTime() + CHECK_IN_LATE_MS, b.endAt.getTime())

async function booking(db, tutorId, id) {
  const result = await db.booking.findFirst({ where: { id, tutorId }, select: {
    id: true, publicId: true, status: true, subject: true, startAt: true, endAt: true, teachingMode: true,
    latitude: true, longitude: true, location: true, locationConfirmedAt: true, updatedAt: true, child: { select: { name: true } },
    complaints: { where: { category: MISSED_CHECK_IN }, select: { attendanceRefund: { select: { status: true, issuedAt: true, reviewNote: true, payment: { select: { status: true } } } }, id: true, updatedAt: true, attendanceOutcome: true, appealUntil: true, appealUsed: true, penaltyAmount: true, penaltyEffectiveAt: true, tutorReplyPending: true, reviewHistory: { orderBy: { id: 'asc' } }, evidenceUrl: true, attendanceApproved: true, description: true, status: true, adminResponse: true }, take: 1 },
    tutor: { select: { userId: true } }, parent: { select: { userId: true } }, attendance: true, summary: true,
  } })
  if (!result) throw new AppError(404, 'Lesson not found')
  return result
}

export async function sessionView(tutorId, id) {
  const [b, settings] = await Promise.all([booking(prisma, tutorId, id), getSettings()])
  if (!['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status)) throw new AppError(409, 'This lesson is not confirmed.')
  const a = b.attendance
  const review = b.complaints[0]
  const visibleReview = review && Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'evidenceUrl'))
  return { id, publicId: b.publicId, subject: b.subject, student: b.child.name, status: b.status, startAt: b.startAt, endAt: b.endAt,
    mode: b.teachingMode, address: b.location, updatedAt: b.updatedAt, ...lessonLocationFields(b),
    review: review ? { ...visibleReview, hasEvidence: Boolean(review.evidenceUrl), attendanceRefund: review.attendanceRefund && { status: review.attendanceRefund.status, attendanceRefundState: attendanceRefundState(review, review.attendanceRefund) }, reviewHistory: review.reviewHistory.filter(entry => entry.action !== 'PREVIOUS_PARENT_RESPONSE').map(entry => ({ action: entry.action, message: entry.message, createdAt: entry.createdAt })) } : null, radius: settings.GPS_RADIUS_METRES, serverTime: new Date(),
    attendance: a && { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, distance: a.checkInDistance,
      photo: mediaLink(a.checkInPhotoUrl, 'wondertutor/attendance/' + id) },
    report: b.summary && { content: b.summary.content, progressNote: b.summary.progressNote, homework: b.summary.homework, recommendations: b.summary.recommendations },
  }
}

function verifyPhoto(photo, id, allowDocument = false) {
  const asset = privateAsset(photo.url, 'wondertutor/attendance/' + id)
  if (!asset || (!allowDocument && asset.format === 'pdf') || !env.cloudinary.apiSecret) throw new AppError(400, allowDocument ? 'Upload a JPG, PNG or PDF for this lesson.' : 'Upload a check-in photo for this lesson.')
  // Verify the upload receipt before accepting a photo as evidence.
  const expected = cloudinary.utils.api_sign_request({ public_id: asset.id, version: photo.version }, env.cloudinary.apiSecret)
  if (photo.signature.length !== expected.length || !timingSafeEqual(Buffer.from(photo.signature), Buffer.from(expected))) {
    throw new AppError(400, 'The photo upload could not be verified. Take or upload the photo again.')
  }
}

async function checkIn(db, b, input, now) {
  if (b.attendance?.checkInAt) throw new AppError(409, 'You have already checked in.')
  if (now.getTime() < b.startAt.getTime() - CHECK_IN_EARLY_MS || now.getTime() >= checkInCloses(b)) throw new AppError(409, 'Check in from 10 minutes before until 15 minutes after the lesson starts. If you missed it, request an admin review.')
  let evidence = {}
  if (b.teachingMode === 'PHYSICAL') {
    if (!hasConfirmedLessonLocation(b)) throw new AppError(409, 'The parent must confirm the exact lesson address and map pin in My Bookings before GPS check-in.')
    if (!input.coords || !input.photo) throw new AppError(400, 'Your location and a check-in photo are required.')
    const { lat, lng } = input.coords
    const km = distanceKm(lat, lng, b.latitude, b.longitude)
    if (km == null) throw new AppError(409, 'This lesson address has no saved coordinates. Contact admin.')
    const distance = km * 1000
    const { GPS_RADIUS_METRES: radius } = await getSettings(db)
    if (!(distance <= radius)) throw new AppError(409, 'Check in within ' + radius + ' metres of the lesson address.')
    verifyPhoto(input.photo, b.id)
    evidence = { checkInLat: lat, checkInLng: lng, checkInDistance: distance, checkInPhotoUrl: input.photo.url }
  }
  const data = { checkInAt: now, ...evidence }
  await db.attendance.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, ...data }, update: data })
}

export async function updateSession(tutorId, id, input) {
  const notice = await prisma.$transaction(async db => {
    // Serialize attendance and completion so retries cannot create duplicate reports or notifications.
    await db.$queryRaw`SELECT id FROM Booking WHERE id = ${id} AND tutorId = ${tutorId} FOR UPDATE`
    const b = await booking(db, tutorId, id)
    if (b.status !== 'CONFIRMED') throw new AppError(409, 'Only confirmed lessons can be updated.')
    const now = new Date()
    if (input.action === 'review-reply' || input.action === 'reconsider') {
      const review = b.complaints[0]
      const appeal = input.action === 'reconsider'
      if (!review || (appeal ? review.status !== 'DISMISSED' : !review.tutorReplyPending)) throw new AppError(409, 'This review is no longer waiting for that action.')
      if (appeal && (review.appealUsed || !review.appealUntil || now >= review.appealUntil)) throw new AppError(409, 'The 14-day reconsideration period has ended or was already used.')
      if (input.photo) verifyPhoto(input.photo, id, true)
      const newText = input.reason.toLowerCase()
      if (appeal && [review.description, ...review.reviewHistory.map(entry => entry.message)].some(message => message.trim().toLowerCase() === newText)
        && (!input.photo || [review.evidenceUrl, ...review.reviewHistory.map(entry => entry.evidenceUrl)].includes(input.photo.url))) throw new AppError(400, 'Provide new evidence or explain what new information you have.')
      const { count } = await db.complaint.updateMany({ where: { id: review.id, updatedAt: review.updatedAt, status: review.status },
        data: { tutorReplyPending: false, ...(input.photo && { evidenceUrl: input.photo.url }),
          ...(appeal && { status: 'IN_PROGRESS', attendanceOutcome: 'RECONSIDERATION', adminResponse: null, appealUsed: true, penaltyEffectiveAt: null }) } })
      if (!count) throw new AppError(409, 'The review changed. Refresh and try again.')
      if (appeal && !review.reviewHistory.some(entry => entry.action === 'UNVERIFIED' || entry.action === 'NOT_HELD')) {
        await db.attendanceReviewEntry.create({ data: { complaintId: review.id, action: 'UNVERIFIED', message: review.adminResponse || 'Earlier review closed.', evidenceUrl: review.evidenceUrl, createdAt: review.updatedAt } })
      }
      await db.attendanceReviewEntry.create({ data: { complaintId: review.id, action: appeal ? 'RECONSIDERATION' : 'TUTOR_REPLY', message: input.reason, evidenceUrl: input.photo?.url } })
      const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
      const notification = { type: 'ATTENDANCE_REVIEW', title: 'Missed check-in review', message: appeal ? 'The tutor has asked for reconsideration with new evidence.' : 'The tutor replied to the request for more information.' }
      const parentNotice = appeal ? { ...notification, userId: b.parent.userId, link: '/parent/bookings?booking=' + publicReference(b) } : null
      await db.notification.createMany({ data: [
        ...admins.map(admin => ({ ...notification, userId: admin.id, link: '/admin/complaints' })),
        ...(parentNotice ? [parentNotice] : []),
      ] })
      return parentNotice
    }
    if (input.action === 'attach-proof') {
      verifyPhoto(input.photo, id, true)
      const { count } = await db.complaint.updateMany({ where: { bookingId: id, category: MISSED_CHECK_IN, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { evidenceUrl: input.photo.url } })
      if (!count) throw new AppError(409, 'This review is no longer open.')
      return
    }
    if (input.action === 'request-review') {
      if (now.getTime() < checkInCloses(b) || b.attendance?.checkInAt) throw new AppError(409, 'You can request a review after the check-in window closes.')
      if (b.complaints.length) throw new AppError(409, 'A review has already been requested.')
      if (input.photo) verifyPhoto(input.photo, id, true)
      await db.complaint.create({ data: { bookingId: id, filedById: b.tutor.userId, category: MISSED_CHECK_IN, description: input.reason, evidenceUrl: input.photo?.url } })
      const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
      const parentNotice = { userId: b.parent.userId, type: 'ATTENDANCE_REVIEW', title: 'Missed check-in review', message: 'Your tutor asked an admin to review a missed check-in for ' + b.subject + '. Open the booking to tell admin whether the lesson took place.', link: '/parent/bookings?booking=' + publicReference(b) }
      await db.notification.createMany({ data: [
        ...admins.map(admin => ({ userId: admin.id, type: 'COMPLAINT_NEW', title: 'Missed check-in review', message: 'A tutor requested a review of their ' + b.subject + ' lesson.', link: '/admin/complaints' })),
        parentNotice,
      ] })
      return parentNotice
    }
    if (input.action === 'check-in') return checkIn(db, b, input, now)
    if (input.action === 'report' && now < b.endAt) throw new AppError(409, 'The lesson report opens after the scheduled end time.')
    const approvedReport = input.action === 'report' && b.complaints[0]?.attendanceApproved
    if (!approvedReport && !b.attendance?.checkInAt) throw new AppError(409, 'Check in first.')
    if (input.action === 'check-out') {
      if (now < b.endAt) throw new AppError(409, 'Check-out opens at the scheduled end time.')
      if (b.attendance.checkOutAt) throw new AppError(409, 'You have already checked out.')
      await db.attendance.update({ where: { bookingId: id }, data: { checkOutAt: now } })
      return
    }
    if (!approvedReport && !b.attendance?.checkOutAt) throw new AppError(409, 'Check out before submitting the report.')
    if (b.summary) throw new AppError(409, 'This lesson already has a report.')
    await db.sessionSummary.create({ data: { bookingId: id, content: input.content, progressNote: input.progressNote, homework: input.homework || null, recommendations: input.recommendations || null } })
    await db.booking.update({ where: { id }, data: { status: 'COMPLETED' } })
    return db.notification.create({ data: { userId: b.parent.userId, type: 'LESSON_COMPLETED', title: 'Lesson report ready',
      message: 'Your tutor has submitted the ' + b.subject + ' lesson report.', link: '/parent/bookings?booking=' + publicReference(b) },
      select: { userId: true, type: true, link: true } })
  })
  if (notice) await sendBookingPush(notice.userId, { type: notice.type, link: notice.link })
  return sessionView(tutorId, id)
}
