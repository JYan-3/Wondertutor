import { prisma } from '../config/prisma.js'
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'
import { v2 as cloudinary } from 'cloudinary'
import { newVerificationUploadName } from '../services/verificationUpload.js'

// POST /api/uploads/signature
// Cloudinary "signed upload": the browser sends the image directly to Cloudinary using this one-time signature,
// so the API secret stays on the server and image bytes never pass through our backend.
export async function uploadSignature(req, res) {
  const { cloudName, apiKey, apiSecret } = env.cloudinary
  if (!cloudName || !apiKey || !apiSecret) throw new AppError(501, 'Photo upload is not configured yet')

  const timestamp = Math.floor(Date.now() / 1000)
  const purpose = req.body?.purpose
  if (purpose) {
    let folder
    if (purpose === 'withdrawal-receipt') {
      if (req.user.role !== 'ADMIN') throw new AppError(403, 'Admin access required')
      const id = req.body.withdrawalId
      if (!Number.isSafeInteger(id) || id < 1) throw new AppError(400, 'Invalid withdrawal')
      const withdrawal = await prisma.withdrawal.findUnique({ where: { id } })
      if (!withdrawal || withdrawal.status !== 'APPROVED' || withdrawal.paidAt || withdrawal.legacyPaid) throw new AppError(409, 'This withdrawal is not awaiting transfer.')
      if (withdrawal.transferStartedById !== req.user.id) throw new AppError(409, 'Only the admin handling this transfer can upload its receipt.')
      folder = 'wondertutor/withdrawals/' + id
    } else if (purpose === 'child-avatar') {
      if (req.user.role !== 'PARENT') throw new AppError(403, 'Parent access required')
      const parent = await prisma.parentProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } })
      if (!parent) throw new AppError(404, 'Parent profile not found')
      folder = 'wondertutor/children/' + parent.id
    } else if (req.user.role !== 'TUTOR') throw new AppError(403, 'Tutor access required')
    else if (purpose === 'qualification') folder = 'wondertutor/qualifications/' + req.user.id
    else if (purpose === 'attendance' || purpose === 'attendance-proof') {
      const id = req.body.bookingId
      if (!Number.isSafeInteger(id) || id < 1) throw new AppError(400, 'Invalid booking')
      const booking = await prisma.booking.findFirst({ where: { id, tutor: { userId: req.user.id } }, select: { id: true } })
      if (!booking) throw new AppError(404, 'Booking not found')
      folder = 'wondertutor/attendance/' + id
    } else throw new AppError(400, 'Unknown upload purpose')
    const allowed_formats = purpose === 'attendance' || purpose === 'child-avatar' ? 'jpg,jpeg,png' : 'jpg,jpeg,png,pdf'
    if (purpose === 'qualification') {
      const public_id = newVerificationUploadName(req.user.id)
      const params = { allowed_formats, folder, overwrite: false, public_id, timestamp, type: 'authenticated' }
      return res.json({ cloudName, apiKey, ...params, signature: cloudinary.utils.api_sign_request(params, apiSecret) })
    }
    const signature = createHash('sha1').update('allowed_formats=' + allowed_formats + '&folder=' + folder + '&timestamp=' + timestamp + '&type=authenticated' + apiSecret).digest('hex')
    return res.json({ cloudName, apiKey, timestamp, folder, signature, type: 'authenticated', allowed_formats })
  }
  const folder = `wondertutor/${req.user.role.toLowerCase()}s`
  // Cloudinary signs the alphabetically ordered parameters followed by the API secret
  const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex')
  res.json({ cloudName, apiKey, timestamp, folder, signature })
}
