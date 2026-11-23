import { tutorRefunds, tutorPaymentStatus } from './tutorRefundStatus.js'
import { Prisma } from '@prisma/client'
import { mediaLink, privateAsset } from './privateMedia.js'
import { env } from '../config/env.js'
import { v2 as cloudinary } from 'cloudinary'
import { timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import { protectBank, readBank } from './bankDetails.js'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { baseCommission } from './systemSettings.service.js'
import { renderEmail } from './notification.service.js'
import { sendEmail } from './email.service.js'

const zero = new Prisma.Decimal(0)
const holding = ['PENDING', 'ESCALATED']
export const withdrawalPaid = w => w.status === 'APPROVED' && Boolean(w.paidAt || w.legacyPaid)
const withdrawalState = (w, l) => {
  if (withdrawalPaid(w)) return w.legacyPaid ? 'LEGACY_PAID' : 'PAID'
  if (w.status !== 'APPROVED') return w.status
  const changed = !w.approvalBasis || w.approvalBasis !== l.basis || l.balance.lt(0)
  if (w.transferStartedById) return changed ? 'TRANSFER_REVIEW' : 'TRANSFER_IN_PROGRESS'
  return changed ? 'ON_HOLD' : 'AWAITING_TRANSFER'
}
const transferFields = (w, l) => ({ payoutStatus: withdrawalState(w, l), paidAt: w.paidAt, transferRef: w.transferRef,
  receiptUrl: mediaLink(w.receiptUrl, 'wondertutor/withdrawals/' + w.id) })
const bankView = b => b && ({ id: b.id, bankName: b.bankName, accountName: readBank(b).accountName, lastFour: b.accountNumber.slice(-4) })
const lockTutor = (db, tutorId) => db.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`

async function ledger(db, tutorId) {
  const payments = await db.payment.findMany({
    where: { booking: { tutorId }, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
    include: { booking: { select: { id: true, publicId: true, subject: true, status: true, startAt: true, child: { select: { name: true } } } },
      refunds: tutorRefunds }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
  })
  const withdrawals = await db.withdrawal.findMany({ where: { tutorId }, include: { bankAccount: true }, orderBy: { id: 'desc' } })
  let earned = zero, pending = zero, held = zero, paidOut = zero
  const transactions = payments.map(p => {
    const b = p.booking
    let commission = p.commissionAmount
    let fee = p.amount
    const refunded = p.refunds.filter(r => r.status === 'APPROVED' && (r.issuedAt || (!r.reviewNote && p.status !== 'PAID'))).reduce((sum, r) => sum.plus(r.amount), zero)
    const refundInReview = p.refunds.some(r => ['PENDING', 'ESCALATED'].includes(r.status) || (r.status === 'APPROVED' && r.reviewNote && !r.issuedAt))
    if (p.status === 'PARTIALLY_REFUNDED' && refunded.gt(0) && fee.gt(0)) {
      fee = Prisma.Decimal.max(0, fee.minus(refunded))
      // Round the retained platform share once; the tutor receives the remaining sen.
      commission = p.commissionAmount.mul(fee).div(p.amount).toDecimalPlaces(2)
    }
    if (p.status === 'REFUNDED') {
      fee = zero
      commission = zero
    }
    const originalShare = p.amount.minus(p.commissionAmount)
    const retainedShare = fee.minus(commission)
    let net = retainedShare
    let state = 'Under review'
    if (p.status === 'REFUNDED' || b.status === 'CANCELLED') {
      state = p.status === 'REFUNDED' ? 'Refunded' : 'Cancelled'
      net = zero
    } else if (!refundInReview &&
        ((p.status === 'PAID' && refunded.isZero()) || (p.status === 'PARTIALLY_REFUNDED' && refunded.gt(0)))) {
      if (b.status === 'COMPLETED') { state = 'Earned'; earned = earned.plus(net) }
      if (b.status === 'CONFIRMED') { state = 'Report due'; pending = pending.plus(net) }
    }
    return { id: p.id, bookingId: b.id, bookingRef: b.publicId || b.id, bookingStatus: b.status, payment: tutorPaymentStatus(p), date: p.paidAt || p.createdAt, subject: b.subject, student: b.child.name,
      fee: p.amount, originalCommission: p.commissionAmount, commission, originalShare,
      tutorRefundShare: originalShare.minus(retainedShare), platformRefundShare: p.commissionAmount.minus(commission),
      refunded: p.status === 'REFUNDED' ? p.amount : refunded, rate: p.commissionRate, net, state }
  })
  for (const w of withdrawals) {
    if (holding.includes(w.status) || (w.status === 'APPROVED' && !withdrawalPaid(w))) held = held.plus(w.amount)
    if (withdrawalPaid(w)) paidOut = paidOut.plus(w.amount)
  }
  const balance = earned.minus(held).minus(paidOut)
  // Compare the lesson earnings reviewed at approval with the current ledger.
  const basis = createHash('sha256').update(JSON.stringify(transactions.map(t => [t.id, t.bookingStatus, t.state, String(t.fee), String(t.commission), String(t.net), String(t.refunded)]))).digest('hex')
  // A repeat submission from the same displayed balance must not reserve a second amount.
  const version = createHash('sha256').update([balance, withdrawals[0]?.id || 0, held, paidOut].join('|')).digest('hex')
  return { transactions, withdrawals, earned, pending, held, paidOut, balance, version, basis }
}

export function earnings(tutorId) {
  return prisma.$transaction(async db => {
    const l = await ledger(db, tutorId)
    const bank = await db.bankAccount.findFirst({ where: { tutorId, isDefault: true } })
    const tutor = await db.tutorProfile.findUniqueOrThrow({ where: { id: tutorId }, select: { commissionRate: true } })
    const base = await baseCommission(db)
    return { available: Prisma.Decimal.max(l.balance, 0), totalEarned: l.earned, pending: l.pending, held: l.held, withdrawn: l.paidOut,
      version: l.version, rate: tutor.commissionRate ?? base, baseRate: base, bank: bankView(bank), transactions: l.transactions,
      withdrawals: l.withdrawals.map(w => ({ id: w.id, date: w.createdAt, reviewedAt: w.reviewedAt, amount: w.amount, status: w.status, reason: w.rejectReason, ...transferFields(w, l), bank: bankView(w.bankAccount) })) }
  })
}

export function changeBank(tutorId, expectedBank, details) {
  return prisma.$transaction(async db => {
    await lockTutor(db, tutorId)
    const old = await db.bankAccount.findFirst({ where: { tutorId, isDefault: true } })
    if ((old?.id ?? null) !== expectedBank) throw new AppError(409, 'Bank details changed. Refresh and try again.')
    if (old) {
      // Keep the original destination attached to past and pending requests.
      await db.bankAccount.update({ where: { id: old.id }, data: { isDefault: false } })
      await db.withdrawal.updateMany({ where: { tutorId, status: 'PENDING' }, data: { status: 'ESCALATED' } })
    }
    if (details) await db.bankAccount.create({ data: { tutorId, ...protectBank(details), isDefault: true } })
  })
}

export function requestWithdrawal(tutorId, input) {
  return prisma.$transaction(async db => {
    // Always take the tutor lock before reading the balance, including on admin decisions.
    await lockTutor(db, tutorId)
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankId, tutorId, isDefault: true } })
    if (!bank) throw new AppError(409, 'Choose your current bank account and try again.')
    const l = await ledger(db, tutorId)
    if (input.version !== l.version) throw new AppError(409, 'Your balance changed. Refresh and check your withdrawal history.')
    const amount = new Prisma.Decimal(input.amount)
    if (amount.gt(l.balance)) throw new AppError(400, 'The amount exceeds your available balance.')
    return db.withdrawal.create({ data: { tutorId, bankAccountId: bank.id, amount }, select: { id: true } })
  })
}

export async function pendingReviews(adminId) {
  const rows = await prisma.withdrawal.findMany({ orderBy: { id: 'asc' },
    include: { bankAccount: true, tutor: { select: { user: { select: { fullName: true } } } } } })
  const ledgers = new Map(await Promise.all([...new Set(rows.map(w => w.tutorId))].map(async id => [id, await ledger(prisma, id)])))
  return rows.map(w => {
    const l = ledgers.get(w.tutorId)
    return { id: w.id, tutor: w.tutor.user.fullName, date: w.createdAt, amount: w.amount, status: w.status, reason: w.rejectReason, ...transferFields(w, l), transferStartedAt: w.transferStartedAt, transferOwned: w.transferStartedById === adminId, earned: l.earned, held: l.held, paidOut: l.paidOut, balance: l.balance, bank: bankView(w.bankAccount) }
  })
}

export async function reviewWithdrawal(id, adminId, decision) {
  const w = await prisma.withdrawal.findUnique({ where: { id }, select: { tutorId: true } })
  if (!w) throw new AppError(404, 'Withdrawal not found')
  const result = await prisma.$transaction(async db => {
    await lockTutor(db, w.tutorId)
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { tutor: { include: { user: true } }, bankAccount: true } })
    if (!holding.includes(row.status) || decision.expectedStatus !== row.status) throw new AppError(409, 'This request changed. Refresh before reviewing it.')
    const l = decision.status === 'APPROVED' ? await ledger(db, w.tutorId) : null
    if (l?.balance.lt(0)) throw new AppError(409, 'The earned balance no longer covers the held funds.')
    await db.withdrawal.update({ where: { id }, data: { status: decision.status, rejectReason: decision.reason ?? null, reviewedById: adminId, reviewedAt: new Date(), approvalBasis: l?.basis ?? null } })
    const title = decision.status === 'APPROVED' ? 'Withdrawal approved' : 'Withdrawal rejected'
    const message = 'Your RM ' + row.amount.toFixed(2) + ' request to ' + row.bankAccount.bankName + ' ending ' + row.bankAccount.accountNumber.slice(-4) +
      (decision.status === 'APPROVED' ? ' was approved and is awaiting bank transfer.' : ' was rejected. Reason: ' + decision.reason)
    const link = '/tutor/earnings'
    await db.notification.create({ data: { userId: row.tutor.userId, type: 'WITHDRAWAL_' + decision.status, title, message, link } })
    return { user: row.tutor.user, title, message, link }
  })
  try { await sendEmail({ to: result.user.email, subject: 'WonderTutor — ' + result.title, html: renderEmail({ ...result, name: result.user.fullName }) }) }
  catch { return { emailSent: false } }
  return { emailSent: true }
}

async function withWithdrawalLock(id, fn) {
  const w = await prisma.withdrawal.findUnique({ where: { id }, select: { tutorId: true } })
  if (!w) throw new AppError(404, 'Withdrawal not found')
  return prisma.$transaction(async db => {
    await lockTutor(db, w.tutorId)
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { bankAccount: true } })
    if (row.status !== 'APPROVED' || withdrawalPaid(row)) throw new AppError(409, 'This withdrawal is not awaiting transfer.')
    return fn(db, row, await ledger(db, w.tutorId))
  })
}

export function recheckWithdrawal(id, adminId) {
  return withWithdrawalLock(id, async (db, w, l) => {
    if (w.transferStartedById) throw new AppError(409, 'A transfer is already in progress. Check the bank before making any changes.')
    if (l.balance.lt(0)) throw new AppError(409, 'The earned balance no longer covers the reserved withdrawals.')
    await db.withdrawal.update({ where: { id }, data: { approvalBasis: l.basis, reviewedById: adminId, reviewedAt: new Date() } })
  })
}

export async function rejectHeldWithdrawal(id, adminId, reason) {
  const result = await withWithdrawalLock(id, async (db, w, l) => {
    if (w.transferStartedById || withdrawalState(w, l) !== 'ON_HOLD') throw new AppError(409, 'This withdrawal is no longer on hold. Refresh before reviewing it.')
    const tutor = await db.tutorProfile.findUniqueOrThrow({ where: { id: w.tutorId }, include: { user: true } })
    await db.withdrawal.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason, reviewedById: adminId, reviewedAt: new Date() } })
    const title = 'Withdrawal rejected'
    const message = 'Your withdrawal was rejected after an earnings review. Reason: ' + reason
    const link = '/tutor/earnings'
    await db.notification.create({ data: { userId: tutor.userId, type: 'WITHDRAWAL_REJECTED', title, message, link } })
    return { user: tutor.user, title, message, link }
  })
  try { await sendEmail({ to: result.user.email, subject: 'WonderTutor — ' + result.title, html: renderEmail({ ...result, name: result.user.fullName }) }) }
  catch { return { emailSent: false } }
  return { emailSent: true }
}

export function startWithdrawalTransfer(id, adminId) {
  return withWithdrawalLock(id, async (db, w, l) => {
    if (w.transferStartedById) throw new AppError(409, 'Another transfer is already in progress. Check the bank before trying again.')
    if (withdrawalState(w, l) !== 'AWAITING_TRANSFER') throw new AppError(409, 'Earnings changed since approval. Review the withdrawal before transferring.')
    await db.withdrawal.update({ where: { id }, data: { transferStartedById: adminId, transferStartedAt: new Date() } })
  })
}

export function releaseWithdrawalTransfer(id, adminId) {
  return withWithdrawalLock(id, async (db, w) => {
    if (w.transferStartedById !== adminId) throw new AppError(409, 'Only the admin handling this transfer can release it.')
    await db.withdrawal.update({ where: { id }, data: { transferStartedById: null, transferStartedAt: null } })
  })
}

// Recheck the ledger before revealing bank details for an external transfer.
export function withdrawalDestination(id, adminId) {
  return withWithdrawalLock(id, async (_db, w, l) => {
    if (w.transferStartedById !== adminId) throw new AppError(409, 'Start this transfer before viewing bank details.')
    if (withdrawalState(w, l) !== 'TRANSFER_IN_PROGRESS') throw new AppError(409, 'Earnings changed. Do not transfer; check the bank and review this withdrawal.')
    const bank = readBank(w.bankAccount)
    return { bankName: bank.bankName, accountName: bank.accountName, accountNumber: bank.accountNumber }
  })
}

export async function recordWithdrawalTransfer(id, adminId, input) {
  const w = await prisma.withdrawal.findUnique({ where: { id }, select: { tutorId: true } })
  if (!w) throw new AppError(404, 'Withdrawal not found')
  const asset = privateAsset(input.receipt.url, 'wondertutor/withdrawals/' + id)
  if (!asset || !env.cloudinary.apiSecret) throw new AppError(400, 'Upload a private receipt for this withdrawal.')
  const expected = cloudinary.utils.api_sign_request({ public_id: asset.id, version: input.receipt.version }, env.cloudinary.apiSecret)
  if (expected.length !== input.receipt.signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(input.receipt.signature))) {
    throw new AppError(400, 'The receipt upload could not be verified.')
  }
  const result = await prisma.$transaction(async db => {
    await lockTutor(db, w.tutorId)
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { tutor: { include: { user: true } }, bankAccount: true } })
    if (row.status !== 'APPROVED' || withdrawalPaid(row)) throw new AppError(409, 'This withdrawal is not awaiting transfer or has already been paid.')
    if (row.transferStartedById !== adminId) throw new AppError(409, 'Only the admin handling this transfer can record it.')
    if (withdrawalState(row, await ledger(db, w.tutorId)) === 'TRANSFER_REVIEW' && !input.balanceChangedConfirmed) throw new AppError(409, 'Earnings changed. Confirm the bank transfer actually succeeded before recording it.')
    // The unique reference also prevents one bank transaction being recorded against two requests.
    await db.withdrawal.update({ where: { id }, data: {
      paidAt: new Date(), paidById: adminId, transferRef: input.reference, receiptUrl: input.receipt.url,
    } })
    const title = 'Withdrawal paid'
    const message = 'Your RM ' + row.amount.toFixed(2) + ' withdrawal to ' + row.bankAccount.bankName + ' ending ' +
      row.bankAccount.accountNumber.slice(-4) + ' has been recorded as paid. Transfer reference: ' + input.reference +
      (input.balanceChangedConfirmed ? '. Admin confirmed the transfer after an earnings change.' : '')
    const link = '/tutor/earnings'
    await db.notification.create({ data: { userId: row.tutor.userId, type: 'WITHDRAWAL_PAID', title, message, link } })
    return { user: row.tutor.user, title, message, link }
  })
  try { await sendEmail({ to: result.user.email, subject: 'WonderTutor — ' + result.title, html: renderEmail({ ...result, name: result.user.fullName }) }) }
  catch { return { emailSent: false } }
  return { emailSent: true }
}
