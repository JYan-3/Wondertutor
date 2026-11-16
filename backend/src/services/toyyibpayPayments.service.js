import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'
import { normalizePhone, isValidPhone } from '../utils/validators.js'
import { money } from './paymentSummary.service.js'
import { paymentDeadline } from './paymentWindow.js'
import { settlePayment } from './payment.service.js'
import { createBill, checkoutUrl, getBillTransactions, toyyibPayMethod } from './toyyibpay.service.js'

const financialStatuses = ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']
const referencePattern = /^WT-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i
export const paymentReference = payment => `WT-${payment.publicId}`
const descriptionFor = bookingId => `WonderTutor lesson ${bookingId}`
const unresolved = payment => new AppError(409, `The original checkout needs to be checked before another bill can be created. Contact the centre with payment reference ${paymentReference(payment)}.`)

// The API has no documented lookup by external reference alone. Retain an
// ambiguous create attempt, allowing a verified callback/return to recover it.
// Only a documented explicit rejection permits another create request.
export async function beginToyyibPayCheckout({ booking, user, parentId, amount }) {
  const method = toyyibPayMethod()
  const phone = normalizePhone(user.phone || '')
  if (!booking.payment?.gatewayRef && !isValidPhone(phone)) throw new AppError(400, 'Please add a valid phone number in My Profile before paying.')
  const providerPhone = phone?.startsWith('+60') ? `0${phone.slice(3)}` : (phone || '').replace(/^\+/, '')
  const cents = amount.mul(100).toFixed(0)
  if (Number(cents) < 100) throw new AppError(400, 'The amount is too small to pay online.')
  let payment = booking.payment
  if (payment) {
    if (payment.method !== method || !payment.amount.equals(amount)) throw unresolved(payment)
    if (payment.gatewayRef) {
      const checked = await settleFromToyyibPay(payment.gatewayRef, { orderId: paymentReference(payment), parentId, expectedBookingId: booking.id })
      if (['SUCCESS', 'ALREADY', 'LATE'].includes(checked.result)) return { status: 200, body: { reconciled: true } }
      return { status: 200, body: { paymentId: payment.id, paymentPublicId: payment.publicId, gatewayRef: payment.gatewayRef, amount: money(amount), redirectUrl: checkoutUrl(payment.gatewayRef), gateway: 'toyyibpay' } }
    }
    if (payment.status !== 'FAILED') throw unresolved(payment)
    const claimed = await prisma.payment.updateMany({ where: { id: payment.id, method, status: 'FAILED', gatewayRef: null }, data: { status: 'PENDING' } })
    if (!claimed.count) throw unresolved(payment)
  } else {
    try {
      payment = await prisma.payment.create({ data: { bookingId: booking.id, amount, commissionRate: 0, commissionAmount: 0, method } })
    } catch (error) {
      if (error.code === 'P2002') throw new AppError(409, 'Checkout already started. Refresh Payments to reopen the original bill.')
      throw error
    }
  }
  let bill
  try {
    const origin = env.clientUrl.replace(/\/$/, '')
    bill = await createBill({ name: user.fullName, email: user.email, phone: providerPhone, amountCents: cents,
      reference: paymentReference(payment), description: descriptionFor(booking.id), expiresAt: paymentDeadline(booking),
      callbackUrl: `${origin}/api/payments/toyyibpay/callback`, redirectUrl: `${origin}/parent/payments/return`,
    })
  } catch (error) {
    if (error.definitive) {
      await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING', gatewayRef: null }, data: { status: 'FAILED' } })
    }
    console.error('[toyyibpay] create bill:', error.code || 'UNCONFIRMED')
    throw error.definitive
      ? new AppError(502, 'The payment service could not start checkout. Check your profile contact details or contact the centre, then try again.')
      : new AppError(502, `Checkout could not be confirmed. Contact the centre with payment reference ${paymentReference(payment)} so they can check the original bill.`)
  }
  const linked = await prisma.payment.updateMany({ where: { id: payment.id, method, OR: [{ gatewayRef: null }, { gatewayRef: bill.code }] }, data: { gatewayRef: bill.code } })
  if (!linked.count) throw unresolved(payment)
  return { status: 201, body: { paymentId: payment.id, paymentPublicId: payment.publicId, gatewayRef: bill.code, amount: money(amount), redirectUrl: bill.url, gateway: 'toyyibpay' } }
}

// All money decisions come from the authenticated provider lookup. The browser
// return is unsigned; the callback hash does not cover billcode or amount.
export async function settleFromToyyibPay(billCode, { orderId, parentId, expectedBookingId } = {}) {
  const method = toyyibPayMethod()
  const match = typeof orderId === 'string' && orderId.match(referencePattern)
  if (!match) throw new AppError(404, 'WonderTutor payment reference not found')
  const payment = await prisma.payment.findFirst({ where: { publicId: match[1], method, ...(parentId !== undefined && { booking: { parentId } }) } })
  if (!payment) throw new AppError(404, 'Payment not found')
  if ((payment.gatewayRef && payment.gatewayRef !== billCode) || (expectedBookingId !== undefined && payment.bookingId !== expectedBookingId)) {
    throw new AppError(409, 'The bill does not match the original payment')
  }
  if (payment.gatewayRef && financialStatuses.includes(payment.status)) return { result: 'ALREADY', payment }
  const transactions = await getBillTransactions(billCode)
  if (!transactions.length) return { result: 'WAITING', payment }
  if (transactions.some(t => t.billExternalReferenceNo !== paymentReference(payment) || t.billName !== 'WonderTutor Lesson' || t.billDescription !== descriptionFor(payment.bookingId))) {
    throw new AppError(400, 'The provider bill does not match this payment')
  }
  if (transactions.some(t => !['1', '2', '3', '4'].includes(String(t.billpaymentStatus)))) throw new AppError(502, 'The payment service returned an unrecognised status')
  const successful = transactions.filter(t => String(t.billpaymentStatus) === '1')
  for (const t of successful) {
    const raw = String(t.billpaymentAmount)
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !new Prisma.Decimal(raw).equals(payment.amount)) {
      throw new AppError(400, 'The paid amount does not match this payment')
    }
  }
  if (!payment.gatewayRef) {
    const linked = await prisma.payment.updateMany({ where: { id: payment.id, method, OR: [{ gatewayRef: null }, { gatewayRef: billCode }] }, data: { gatewayRef: billCode } })
    if (!linked.count) throw new AppError(409, 'Another bill was linked to the payment')
  }
  if (successful.length) {
    try { return await settlePayment(payment.id, { paid: true, method, real: true }) } catch (error) {
      if (error.status === 409) {
        const fresh = await prisma.payment.findUnique({ where: { id: payment.id } })
        if (fresh && financialStatuses.includes(fresh.status)) return { result: 'ALREADY', payment: fresh }
      }
      throw error
    }
  }
  if (transactions.some(t => ['2', '4'].includes(String(t.billpaymentStatus)))) return { result: 'WAITING', payment }
  await settlePayment(payment.id, { paid: false, method, real: true })
  return { result: 'FAILED', payment }
}
