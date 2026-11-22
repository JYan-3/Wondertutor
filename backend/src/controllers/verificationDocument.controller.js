import { prisma } from '../config/prisma.js'
import { privateAsset } from '../services/privateMedia.js'
import { watermarkedDocument } from '../services/verificationWatermark.js'
import { AppError } from '../utils/AppError.js'

export async function viewVerificationDocument(req, res) {
  const qualification = await prisma.qualification.findFirst({
    where: { id: Number(req.params.id), ...(req.user.role === 'TUTOR' ? { tutorId: req.tutor.id } : {}) },
    include: { tutor: { select: { userId: true } } },
  })
  if (!qualification) throw new AppError(404, 'Document not found.')
  const folder = `wondertutor/qualifications/${qualification.tutor.userId}`
  const asset = privateAsset(qualification.documentUrl, folder)
  if (!asset) throw new AppError(404, 'Document unavailable.')
  const bytes = await watermarkedDocument(qualification.documentUrl, folder, asset.format)
  const type = asset.format === 'pdf' ? 'application/pdf' : asset.format === 'png' ? 'image/png' : 'image/jpeg'
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="verification.${asset.format}"` }).send(bytes)
}
