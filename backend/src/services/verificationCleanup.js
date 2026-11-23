import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { privateAsset } from './privateMedia.js'
import { isVerificationUpload } from './verificationUpload.js'

async function referenced(tx, asset) {
  const name = asset.id.split('/').at(-1)
  const [documents, portfolio] = await Promise.all([
    tx.qualification.findFirst({ where: { documentUrl: { contains: name } }, select: { id: true } }),
    tx.portfolioItem.findFirst({ where: { fileUrl: { contains: name } }, select: { id: true } }),
  ])
  return Boolean(documents || portfolio)
}

// Persist the cleanup request before contacting Cloudinary so an interrupted request can be retried.
export async function queueRejectedAsset(tx, tutor, url) {
  const folder = `wondertutor/qualifications/${tutor.userId}`
  const asset = privateAsset(url, folder)
  if (!isVerificationUpload(asset, tutor.userId)) return null
  if (await referenced(tx, asset)) {
    await tx.verificationCleanup.deleteMany({ where: { publicId: asset.id } })
    return null
  }
  await tx.verificationCleanup.upsert({ where: { publicId: asset.id }, create: { publicId: asset.id, tutorId: tutor.id, ownerUserId: tutor.userId, documentUrl: url }, update: { documentUrl: url } })
  return asset.id
}

export async function processVerificationCleanup(tutorId, publicId, now = new Date()) {
  return prisma.$transaction(async tx => {
    if (tutorId != null) await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`
    const pending = await tx.verificationCleanup.findUnique({ where: { publicId } })
    if (!pending) return true
    if (pending.tutorId != null && pending.tutorId !== tutorId) return false
    const folder = `wondertutor/qualifications/${pending.ownerUserId}`
    const asset = privateAsset(pending.documentUrl, folder)
    if (!isVerificationUpload(asset, pending.ownerUserId) || asset.id !== publicId) {
      await tx.verificationCleanup.update({ where: { publicId }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 60 * 60_000) } })
      console.error('Verification upload cleanup needs manual review.')
      return false
    }
    if (await referenced(tx, asset)) {
      await tx.verificationCleanup.delete({ where: { publicId } })
      return true
    }
    const { cloudName, apiKey, apiSecret } = env.cloudinary
    let deleted = false
    if (apiKey && apiSecret) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, type: 'authenticated', resource_type: 'image', invalidate: true, timeout: 8000 })
        deleted = ['ok', 'not found'].includes(result?.result)
      } catch { /* Keep the request for a later retry. */ }
    }
    if (deleted) await tx.verificationCleanup.delete({ where: { publicId } })
    else await tx.verificationCleanup.update({ where: { publicId }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 5 * 60_000) } })
    return deleted
  }, { timeout: 20000 })
}

export async function retryVerificationCleanups(now = new Date()) {
  const due = await prisma.verificationCleanup.findMany({ where: { nextAttemptAt: { lte: now } }, select: { tutorId: true, publicId: true }, orderBy: { nextAttemptAt: 'asc' }, take: 3 })
  for (const item of due) {
    try { await processVerificationCleanup(item.tutorId, item.publicId, now) }
    catch { console.error('Verification upload cleanup could not be completed.') }
  }
}
