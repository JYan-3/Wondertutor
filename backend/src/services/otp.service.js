import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { sendEmail } from './email.service.js'
import { AppError } from '../utils/AppError.js'

const OTP_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SECONDS = 60

const PURPOSE_TEXT = {
  bank: { subject: 'Confirm your WonderTutor bank details', note: 'Use this code only to change your withdrawal account.' },
  verify: { subject: 'Your WonderTutor verification code', note: "If you didn't sign up, ignore this email." },
  reset: { subject: 'Reset your WonderTutor password', note: "If you didn't ask to reset your password, ignore this email. Your password stays the same." },
  change: { subject: 'Confirm your new WonderTutor email', note: "If you didn't ask to use this email for WonderTutor, ignore this message. Nothing changes until the code is entered." },
}

// `email` is the key the code is stored under; `to` is where it is sent (the same, unless the key is private, as for an email change)
export async function issueOtp(email, purpose = 'verify', to = email) {
  const code = crypto.randomInt(100000, 1000000).toString()
  const codeHash = await bcrypt.hash(code, 10)
  let issued
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      issued = await prisma.$transaction(async tx => {
        // Lock the email range so concurrent first requests cannot create two codes.
        const rows = await tx.$queryRaw`SELECT id, createdAt FROM EmailOtp WHERE email = ${email} ORDER BY createdAt DESC, id DESC LIMIT 1 FOR UPDATE`
        const latest = rows[0]
        if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
          throw new AppError(429, `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another code`)
        }
        await tx.emailOtp.deleteMany({ where: { email } })
        return tx.emailOtp.create({ data: { email, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000) } })
      }, { isolationLevel: 'Serializable' })
      break
    } catch (error) {
      if (error.code !== 'P2034' || attempt === 3) throw error
    }
  }

  const text = PURPOSE_TEXT[purpose] || PURPOSE_TEXT.verify
  try {
    await sendEmail({
      to,
      subject: text.subject,
      html: `<p>Your code is <b style="font-size:20px">${code}</b>.</p>
             <p>It expires in ${OTP_TTL_MINUTES} minutes. ${text.note}</p>`,
    })
  } catch (err) {
    // A code nobody received is removed, so the 60-second wait does not block an immediate retry
    console.error('Code email failed:', err.message)
    await prisma.emailOtp.deleteMany({ where: { id: issued.id } })
    throw new AppError(502, 'We could not send the code just now. Please try again in a minute.')
  }
}

export async function checkOtp(email, code) {
  const otp = await prisma.emailOtp.findFirst({ where: { email }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  if (!otp || otp.expiresAt < new Date()) throw new AppError(400, 'Code expired, please request a new one')
  // Reserve an attempt before comparing so parallel requests share the same limit.
  const reserved = await prisma.emailOtp.updateMany({ where: { id: otp.id, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } } })
  if (!reserved.count) {
    const current = await prisma.emailOtp.findUnique({ where: { id: otp.id } })
    if (!current || current.expiresAt <= new Date()) throw new AppError(400, 'Code expired, please request a new one')
    throw new AppError(429, 'Too many attempts, please request a new code')
  }

  const ok = await bcrypt.compare(code, otp.codeHash)
  if (!ok) throw new AppError(400, 'Incorrect code')
  const consumed = await prisma.emailOtp.deleteMany({ where: { id: otp.id, expiresAt: { gt: new Date() } } })
  if (!consumed.count) throw new AppError(400, 'Code expired, please request a new one')
}
