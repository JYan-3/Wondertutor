// ToyyibPay protocol adapter. No request or response containing a merchant key
// is logged. Protocol reference: https://toyyibpay.com/apireference/
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

export const toyyibPayConfigured = () => Boolean(env.toyyibpay.secretKey && env.toyyibpay.categoryCode)
export const toyyibPayMethod = () => env.toyyibpay.baseUrl === 'https://dev.toyyibpay.com' ? 'ToyyibPay (sandbox)' : 'ToyyibPay'
const validBillCode = (code) => typeof code === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(code)

export class ToyyibPayError extends Error {
  constructor(code, definitive = false) {
    super('ToyyibPay request could not be confirmed')
    this.status = 502
    this.code = code
    this.definitive = definitive
  }
}

async function call(endpoint, fields) {
  let response
  try {
    response = await fetch(`${env.toyyibpay.baseUrl}/index.php/api/${endpoint}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ userSecretKey: env.toyyibpay.secretKey, ...fields }),
    })
    const text = (await response.text()).trim()
    let body
    try { body = JSON.parse(text) } catch { body = null }
    return { ok: response.ok, text, body }
  } catch {
    // A timeout does not tell us whether the provider created the bill.
    throw new ToyyibPayError('UNCONFIRMED')
  }
}

export function checkoutUrl(billCode) {
  if (!validBillCode(billCode)) throw new ToyyibPayError('INVALID_BILL')
  return `${env.toyyibpay.baseUrl}/${billCode}`
}

export function billExpiryDate(deadline) {
  const d = new Date(new Date(deadline).getTime() + 8 * 3_600_000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export async function createBill({ name, email, phone, amountCents, reference, description, callbackUrl, redirectUrl, expiresAt }) {
  const result = await call('createBill', {
    categoryCode: env.toyyibpay.categoryCode,
    billName: 'WonderTutor Lesson', billDescription: description,
    billPriceSetting: '1', billPayorInfo: '1', billAmount: String(amountCents),
    billReturnUrl: redirectUrl, billCallbackUrl: callbackUrl,
    billExternalReferenceNo: reference, billTo: name, billEmail: email, billPhone: phone,
    billPaymentChannel: '0', billSplitPayment: '0', billExpiryDate: billExpiryDate(expiresAt),
    // Default charges stay with the merchant, so the parent pays the lesson amount.
  })
  // ToyyibPay also uses HTTP 200 + text/html for documented rejection codes.
  const rejected = new Set(['[KEY-DID-NOT-EXIST]', '[CATEGORY-NOT-MATCH]', '[CATEGORY-IS-INACTIVE]',
    '[BILL-INFO-NOT-EXIST]', '[INVALID-EMAIL-FORMAT]', '[FALSE]'])
  if (rejected.has(result.text)) throw new ToyyibPayError('REJECTED', true)
  if (result.body?.status === 'error') throw new ToyyibPayError('REJECTED', true)
  if (!result.ok || !Array.isArray(result.body) || result.body.length !== 1 || !validBillCode(result.body[0]?.BillCode)) {
    throw new ToyyibPayError('UNCONFIRMED')
  }
  const code = result.body[0].BillCode
  return { code, url: checkoutUrl(code) }
}

export async function getBillTransactions(billCode) {
  if (!validBillCode(billCode)) throw new ToyyibPayError('INVALID_BILL')
  const result = await call('getBillTransactions', { billCode })
  if (!result.ok || !Array.isArray(result.body) || result.body.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new ToyyibPayError('UNCONFIRMED')
  }
  return result.body
}

export function signatureFor(params, key = env.toyyibpay.secretKey) {
  return createHash('md5').update(`${key}${params.status}${params.order_id}${params.refno}ok`).digest('hex')
}

export function signatureIsValid(params) {
  if (!env.toyyibpay.secretKey || !params ||
      !['1', '2', '3'].includes(params.status) ||
      typeof params.order_id !== 'string' || params.order_id.length > 100 ||
      typeof params.refno !== 'string' || !params.refno || params.refno.length > 100 ||
      typeof params.hash !== 'string' || !/^[a-f0-9]{32}$/i.test(params.hash)) return false
  return timingSafeEqual(Buffer.from(params.hash, 'hex'), Buffer.from(signatureFor(params), 'hex'))
}
