import { z } from 'zod'
import { pendingReviews, reviewWithdrawal, withdrawalDestination, recordWithdrawalTransfer, startWithdrawalTransfer, releaseWithdrawalTransfer, recheckWithdrawal, rejectHeldWithdrawal } from '../../services/earnings.service.js'

export async function list(req, res) {
  res.set('Cache-Control', 'no-store').json({ requests: await pendingReviews(req.user.id) })
}

export async function review(req, res) {
  const expectedStatus = z.enum(['PENDING', 'ESCALATED'])
  const decision = z.discriminatedUnion('status', [
    z.object({ status: z.literal('APPROVED'), expectedStatus }).strict(),
    z.object({ status: z.literal('REJECTED'), expectedStatus, reason: z.string().trim().min(1, 'Explain why the request was rejected').max(191) }).strict(),
  ]).parse(req.body)
  const result = await reviewWithdrawal(Number(req.params.id), req.user.id, decision)
  res.json({ message: 'Withdrawal reviewed.', ...result })
}

export async function destination(req, res) {
  res.set('Cache-Control', 'no-store').json(await withdrawalDestination(Number(req.params.id), req.user.id))
}

export async function startTransfer(req, res) {
  z.object({}).strict().parse(req.body)
  await startWithdrawalTransfer(Number(req.params.id), req.user.id)
  res.json({ message: 'Transfer in progress. Check the bank before sending.' })
}

export async function releaseTransfer(req, res) {
  z.object({ confirmedNoTransfer: z.literal(true) }).strict().parse(req.body)
  await releaseWithdrawalTransfer(Number(req.params.id), req.user.id)
  res.json({ message: 'Transfer released for review.' })
}

export async function recheck(req, res) {
  z.object({ confirmedReview: z.literal(true) }).strict().parse(req.body)
  await recheckWithdrawal(Number(req.params.id), req.user.id)
  res.json({ message: 'Earnings reviewed. The withdrawal is awaiting transfer.' })
}

export async function rejectHeld(req, res) {
  const { reason } = z.object({ reason: z.string().trim().min(1, 'Explain why the request was rejected').max(191) }).strict().parse(req.body)
  res.json({ message: 'Withdrawal rejected.', ...await rejectHeldWithdrawal(Number(req.params.id), req.user.id, reason) })
}

export async function transfer(req, res) {
  const input = z.object({
    reference: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9 /_-]+$/, 'Enter the bank transfer reference').transform(v => v.toUpperCase()),
    receipt: z.object({ url: z.string().url().max(2048), version: z.number().int().positive(), signature: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
    balanceChangedConfirmed: z.literal(true).optional(),
  }).strict().parse(req.body)
  res.json({ message: 'Bank transfer recorded.', ...await recordWithdrawalTransfer(Number(req.params.id), req.user.id, input) })
}
