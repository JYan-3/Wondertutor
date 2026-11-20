import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { hashSessionId, readPushDevice, rememberPushDevice } from '../services/session.service.js'
import { registerPush } from '../services/webPush.service.js'

export async function pushSettings(req, res) {
  const config = env.webPush
  const device = config ? rememberPushDevice(req, res) : readPushDevice(req)
  const row = device && await prisma.pushSubscription.findFirst({ where: {
    deviceHash: hashSessionId(device), userId: req.user.id, expiresAt: { gt: new Date() },
  }, select: { deviceHash: true } })
  res.json({ available: Boolean(config), publicKey: config?.publicKey ?? null, subscribed: Boolean(row) })
}

export async function enablePush(req, res) {
  await registerPush(readPushDevice(req), req.session, req.body)
  rememberPushDevice(req, res)
  res.json({ subscribed: true })
}

export async function disablePush(req, res) {
  const device = readPushDevice(req)
  if (device) await prisma.pushSubscription.deleteMany({ where: { deviceHash: hashSessionId(device), userId: req.user.id } })
  res.json({ subscribed: false })
}
