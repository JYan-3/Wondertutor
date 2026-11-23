import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

const signature = (userId, nonce) => createHmac('sha256', env.cloudinary.apiSecret).update(`verification-upload:${userId}:${nonce}`).digest('hex').slice(0, 32)

export function newVerificationUploadName(userId) {
  const nonce = randomBytes(16).toString('hex')
  return `wtv_${nonce}_${signature(userId, nonce)}`
}

export function isVerificationUpload(asset, userId) {
  if (!asset || !env.cloudinary.apiSecret) return false
  const match = /^wtv_([a-f0-9]{32})_([a-f0-9]{32})$/.exec(asset.id.split('/').at(-1))
  if (!match) return false
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(userId, match[1]), 'hex'))
}
