import { createHash } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { env, readToyyibPayConfig } from '../config/env.js'
import { signatureFor, signatureIsValid, billExpiryDate } from '../services/toyyibpay.service.js'
import { MONDAY, api, apiBase, makeBooking, makeChild, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

const realFetch = global.fetch
const BASE = 'https://toyyibpay.test'
const SECRET = 'synthetic-merchant-key'
let parent, other, tutor, monday
let bills = new Map(), sequence = 0, created = [], lookups = [], createMode = 'normal', lookupMode = 'normal'

beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  other = await makeParent()
  tutor = await makeTutor({ commissionRate: 10 })
  monday = nextDate(MONDAY)
  global.fetch = async (url, options = {}) => {
    if (![BASE, 'https://dev.toyyibpay.com'].some(base => String(url).startsWith(base + '/index.php/api/'))) return realFetch(url, options)
    const form = Object.fromEntries(new URLSearchParams(options.body))
    const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'text/html' } })
    if (String(url).endsWith('/createBill')) {
      created.push(form)
      if (createMode === 'rejected') return new Response('  [CATEGORY-NOT-MATCH]  ')
      if (createMode === 'validation') return response({ status: 'error', msg: SECRET + ' should not be exposed' })
      if (createMode === 'malformed') return new Response('<html>temporary upstream error</html>')
      if (createMode === 'unsafe-code') return response([{ BillCode: 'https://other.example/pay' }])
      const code = `toy${++sequence}`
      bills.set(code, { form, transactions: [] })
      if (createMode === 'timeout-after-create') throw new DOMException('synthetic timeout', 'TimeoutError')
      return response([{ BillCode: code }])
    }
    if (String(url).endsWith('/getBillTransactions')) {
      lookups.push(form)
      if (lookupMode === 'down') return new Response('temporary unavailable', { status: 503 })
      if (lookupMode === 'wrong-owner') return response([])
      return response(bills.get(form.billCode)?.transactions || [])
    }
    throw new Error('Unexpected ToyyibPay endpoint')
  }
})
beforeEach(() => {
  Object.assign(env.toyyibpay, { secretKey: SECRET, categoryCode: 'category1', baseUrl: BASE })
  createMode = 'normal'; lookupMode = 'normal'; created = []; lookups = []
})
afterEach(() => { env.nodeEnv = 'test'; Object.assign(env.billplz, { apiKey: '', collectionId: undefined }) })
afterAll(async () => {
  global.fetch = realFetch
  Object.assign(env.toyyibpay, { secretKey: '', categoryCode: '', baseUrl: 'https://toyyibpay.com' })
  await stopServer()
})

async function booking(price = 60) {
  const child = await makeChild(parent.parent.id)
  return makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date: monday, status: 'AWAITING_PAYMENT', price })
}
async function startPayment(price = 60) {
  const b = await booking(price)
  const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(c.status).toBe(201)
  return { booking: b, checkout: c, bill: bills.get(c.gatewayRef) }
}
function transaction(bill, status = '1', extra = {}) {
  return { billName: bill.form.billName, billDescription: bill.form.billDescription,
    billExternalReferenceNo: bill.form.billExternalReferenceNo,
    billpaymentStatus: status, billpaymentAmount: (Number(bill.form.billAmount) / 100).toFixed(2),
    billpaymentInvoiceNo: 'TP-SYNTHETIC', ...extra }
}
function markPaid(bill) { bill.transactions = [transaction(bill)] }
function returnBody(code) { return { gateway: 'toyyibpay', billcode: code, order_id: bills.get(code).form.billExternalReferenceNo, status_id: '1' } }
function callbackBody(code, extra = {}) {
  const body = { status: '1', refno: 'TP-SYNTHETIC', billcode: code, order_id: bills.get(code).form.billExternalReferenceNo, amount: '60.00', ...extra }
  return { ...body, hash: signatureFor(body) }
}
async function callback(body, headers = {}) {
  return realFetch(`${apiBase()}/payments/toyyibpay/callback`, { method: 'POST', headers, body: new URLSearchParams(body) })
}
const freshPayment = id => prisma.payment.findUnique({ where: { id } })
const freshBooking = id => prisma.booking.findUnique({ where: { id } })

test('live and sandbox configuration keep the merchant key server-side and reject unrelated destinations', () => {
  expect(readToyyibPayConfig({}).baseUrl).toBe('https://toyyibpay.com')
  expect(readToyyibPayConfig({ TOYYIBPAY_SECRET_KEY: 'private', TOYYIBPAY_CATEGORY_CODE: 'cat', TOYYIBPAY_BASE_URL: 'https://dev.toyyibpay.com/' }).baseUrl).toBe('https://dev.toyyibpay.com')
  expect(() => readToyyibPayConfig({ TOYYIBPAY_SECRET_KEY: 'private' })).toThrow(/both/)
  for (const base of ['http://toyyibpay.com', 'https://toyyibpay.com.evil.example', 'https://other.example', 'https://toyyibpay.com/index.php/api', 'https://user@toyyibpay.com']) {
    expect(() => readToyyibPayConfig({ TOYYIBPAY_BASE_URL: base })).toThrow(/BASE_URL/)
  }
})
test('callback verification follows the provider hash and rejects changed or malformed signed fields', () => {
  const fields = { status: '1', order_id: 'WT-test', refno: 'TP123' }
  const expected = createHash('md5').update('synthetic-merchant-key1WT-testTP123ok').digest('hex')
  expect(signatureFor(fields)).toBe(expected)
  expect(signatureIsValid({ ...fields, hash: expected })).toBe(true)
  expect(signatureIsValid({ ...fields, hash: expected.toUpperCase() })).toBe(true)
  expect(signatureIsValid({ ...fields, status: '3', hash: expected })).toBe(false)
  expect(signatureIsValid({ ...fields, hash: '界'.repeat(32) })).toBe(false)
  expect(signatureIsValid({ ...fields, hash: 'x'.repeat(32) })).toBe(false)
  expect(signatureIsValid({ ...fields, hash: undefined })).toBe(false)
})
test('expiry is formatted in Malaysia time, independent of the machine timezone', () => {
  expect(billExpiryDate(new Date('2026-11-17T01:23:45Z'))).toBe('17-11-2026 09:23:45')
})
test('checkout uses a fixed amount in sen, stored reference, payer details, callback and lesson cutoff', async () => {
  const { booking: b, checkout: c, bill } = await startPayment(62.50)
  expect(c.redirectUrl).toBe(`${BASE}/${c.gatewayRef}`)
  expect(c.gateway).toBe('toyyibpay')
  expect(JSON.stringify(c)).not.toContain(SECRET)
  expect(bill.form).toMatchObject({ userSecretKey: SECRET, categoryCode: 'category1', billAmount: '6250', billPriceSetting: '1', billPayorInfo: '1', billPhone: '0123456789', billPaymentChannel: '0', billSplitPayment: '0' })
  expect(bill.form.billExternalReferenceNo).toBe(`WT-${c.paymentPublicId}`)
  expect(bill.form.billReturnUrl).toBe(`${env.clientUrl}/parent/payments/return`)
  expect(bill.form.billCallbackUrl).toBe(`${env.clientUrl}/api/payments/toyyibpay/callback`)
  expect(bill.form.billExpiryDate).toBe(billExpiryDate(new Date(b.startAt.getTime() - 3_600_000)))
})
test('a shorter saved pay-by deadline also controls the provider bill expiry', async () => {
  const b = await booking()
  const payBy = new Date(Date.now() + 2 * 3_600_000)
  await prisma.booking.update({ where: { id: b.id }, data: { payBy } })
  const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(c.status).toBe(201)
  expect(created[0].billExpiryDate).toBe(billExpiryDate(payBy))
})
test('missing payer phone is explained before a provider call or payment is created', async () => {
  await prisma.user.update({ where: { id: parent.user.id }, data: { phone: null } })
  try {
    const b = await booking()
    const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    expect(c.status).toBe(400)
    expect(c.message).toMatch(/My Profile/)
    expect(created).toHaveLength(0)
    expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(0)
  } finally { await prisma.user.update({ where: { id: parent.user.id }, data: { phone: '+60123456789' } }) }
})
test('expired and other-family bookings cannot start checkout', async () => {
  const b = await booking()
  expect((await api(other.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(404)
  await prisma.booking.update({ where: { id: b.id }, data: { payBy: new Date(Date.now() - 60_000) } })
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(400)
  expect(created).toHaveLength(0)
})
test('double-clicking checkout creates one local payment and one provider bill', async () => {
  const b = await booking()
  const responses = await Promise.all([1,2,3].map(() => api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })))
  expect(responses.filter(r => r.status === 201)).toHaveLength(1)
  expect(responses.every(r => [200,201,409].includes(r.status))).toBe(true)
  expect(created).toHaveLength(1)
  expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(1)
})
test('unpaid or failed checkout reopens its original bill instead of creating another', async () => {
  const { booking: b, checkout: c, bill } = await startPayment()
  const reopened = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(reopened.redirectUrl).toBe(c.redirectUrl)
  bill.transactions = [transaction(bill, '3')]
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).outcome).toBe('FAILED')
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).redirectUrl).toBe(c.redirectUrl)
  expect(created).toHaveLength(1)
})
test.each(['rejected','validation'])('documented %s responses with HTTP 200 permit a corrected retry without exposing the key', async mode => {
  createMode = mode
  const b = await booking()
  const rejected = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(rejected.status).toBe(502)
  expect(JSON.stringify(rejected)).not.toContain(SECRET)
  const p = await prisma.payment.findUnique({ where: { bookingId: b.id } })
  expect(p.status).toBe('FAILED')
  expect(p.gatewayRef).toBeNull()
  createMode = 'normal'
  const retry = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(retry.status).toBe(201)
  expect(retry.paymentId).toBe(p.id)
})
test.each(['malformed','unsafe-code','timeout-after-create'])('an ambiguous %s create is retained and cannot create a duplicate bill', async mode => {
  createMode = mode
  const b = await booking()
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(502)
  const p = await prisma.payment.findUnique({ where: { bookingId: b.id } })
  expect(p.status).toBe('PENDING')
  expect(p.gatewayRef).toBeNull()
  createMode = 'normal'
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(409)
  expect(created).toHaveLength(1)
})
test('a valid callback recovers a lost create response from its verified external reference', async () => {
  createMode = 'timeout-after-create'
  const b = await booking()
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })).status).toBe(502)
  const [code,bill] = [...bills.entries()].at(-1)
  markPaid(bill)
  expect((await callback(callbackBody(code))).status).toBe(200)
  const p = await prisma.payment.findUnique({ where: { bookingId: b.id } })
  expect(p.gatewayRef).toBe(code)
  expect(p.status).toBe('PAID')
  expect((await freshBooking(b.id)).status).toBe('CONFIRMED')
})
test('unsigned browser success is only a hint; provider lookup determines success and commission', async () => {
  const { booking: b, checkout: c, bill } = await startPayment(62.50)
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).outcome).toBe('WAITING')
  expect((await freshBooking(b.id)).status).toBe('AWAITING_PAYMENT')
  markPaid(bill)
  const verified = await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))
  expect(verified.outcome).toBe('SUCCESS')
  const p = await freshPayment(c.paymentId)
  expect(Number(p.commissionAmount)).toBe(6.25)
  expect(p.method).toBe('ToyyibPay')
  expect((await api(parent.token).get(`/parent/payments/${c.paymentPublicId}/receipt`)).receipt.method).toBe('ToyyibPay')
  expect(lookups.at(-1)).toMatchObject({ userSecretKey: SECRET, billCode: c.gatewayRef })
})
test('another parent and unauthenticated callers cannot verify someone else’s return', async () => {
  const { checkout: c, bill } = await startPayment()
  markPaid(bill)
  expect((await api(other.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(404)
  expect((await api().post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(401)
  expect(lookups).toHaveLength(0)
})
test.each(['0.01','60.01','6e1','-60.00'])('a paid amount of %s is rejected', async value => {
  const { checkout: c, bill } = await startPayment()
  bill.transactions = [transaction(bill, '1', { billpaymentAmount: value })]
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(400)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
})
test.each(['2','4'])('pending provider status %s wins over failed attempts and is retryable', async status => {
  const { checkout: c, bill } = await startPayment()
  bill.transactions = [transaction(bill, '3'), transaction(bill, status)]
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).outcome).toBe('WAITING')
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
})
test('provider lookup failures do not report a failed or successful payment', async () => {
  const { checkout: c } = await startPayment()
  lookupMode = 'down'
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(502)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
})
test.each(['billExternalReferenceNo','billName','billDescription'])('a foreign %s does not attach or confirm the bill', async field => {
  const { checkout: c, bill } = await startPayment()
  bill.transactions = [transaction(bill, '1', { [field]: 'unrelated bill' })]
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(400)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
})
test('a changed billcode cannot use the valid hash of another bill', async () => {
  const first = await startPayment(), second = await startPayment()
  markPaid(second.bill)
  const signed = callbackBody(first.checkout.gatewayRef)
  expect((await callback({ ...signed, billcode: second.checkout.gatewayRef })).status).toBe(400)
  expect((await freshPayment(first.checkout.paymentId)).status).toBe('PENDING')
})
test('bad signatures are refused before calling the provider', async () => {
  const { checkout: c, bill } = await startPayment()
  markPaid(bill)
  const signed = callbackBody(c.gatewayRef)
  expect((await callback({ ...signed, hash: '0'.repeat(32) })).status).toBe(400)
  expect((await callback({ ...signed, status: '3' })).status).toBe(400)
  expect(lookups).toHaveLength(0)
})
test('the exact callback is CSRF-exempt but checkout and browser returns remain protected', async () => {
  const { checkout: c, bill } = await startPayment()
  markPaid(bill)
  expect((await callback(callbackBody(c.gatewayRef), { Origin: 'https://toyyibpay.com' })).status).toBe(200)
  const response = await realFetch(`${apiBase()}/parent/payments/return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(returnBody(c.gatewayRef)) })
  expect(response.status).toBe(403)
})
test('a success callback is retried when the provider lookup is not yet consistent', async () => {
  const { checkout: c, bill } = await startPayment()
  expect((await callback(callbackBody(c.gatewayRef))).status).toBe(503)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
  markPaid(bill)
  expect((await callback(callbackBody(c.gatewayRef))).status).toBe(200)
})
test('simultaneous callback retries produce one confirmation and one notification', async () => {
  const { checkout: c, bill } = await startPayment()
  markPaid(bill)
  const before = await prisma.notification.count({ where: { userId: parent.user.id, type: 'PAYMENT_SUCCESS' } })
  const responses = await Promise.all([1,2,3].map(() => callback(callbackBody(c.gatewayRef))))
  expect(responses.map(r=>r.status)).toEqual([200,200,200])
  expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'PAYMENT_SUCCESS' } })).toBe(before + 1)
})
test('payment after cancellation is recorded once with one queued full refund', async () => {
  const { booking: b, checkout: c, bill } = await startPayment()
  expect((await api(parent.token).post(`/parent/bookings/${b.publicId}/cancel`, { reason: 'Plans changed' })).status).toBe(200)
  expect((await freshPayment(c.paymentId)).status).toBe('FAILED')
  markPaid(bill)
  const responses = await Promise.all([1,2].map(() => callback(callbackBody(c.gatewayRef))))
  expect(responses.every(r=>r.status===200)).toBe(true)
  expect((await freshBooking(b.id)).status).toBe('CANCELLED')
  expect((await freshPayment(c.paymentId)).status).toBe('PAID')
  expect(await prisma.refund.count({ where: { paymentId: c.paymentId, type: 'AUTO' } })).toBe(1)
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).outcome).toBe('LATE')
})
test.each(['REFUNDED','PARTIALLY_REFUNDED'])('revisiting a %s payment retains the real refund outcome', async status => {
  const { checkout: c, bill } = await startPayment()
  markPaid(bill)
  expect((await callback(callbackBody(c.gatewayRef))).status).toBe(200)
  await prisma.payment.update({ where: { id: c.paymentId }, data: { status } })
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).outcome).toBe(status)
})
test('ToyyibPay takes precedence when old Billplz credentials are retained', async () => {
  Object.assign(env.billplz, { apiKey: 'legacy', collectionId: 'legacy' })
  expect((await api(parent.token).get('/parent/payments')).gateway).toBe('toyyibpay')
})
test('the development payment simulator is unavailable when ToyyibPay is configured', async () => {
  const { checkout: c } = await startPayment()
  expect((await api(parent.token).post(`/parent/payments/${c.paymentPublicId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })).status).toBe(404)
})


test('switching from sandbox to live cannot reuse or settle an old sandbox bill', async () => {
  env.toyyibpay.baseUrl = 'https://dev.toyyibpay.com'
  const { booking: b, checkout: c, bill } = await startPayment()
  expect((await freshPayment(c.paymentId)).method).toBe('ToyyibPay (sandbox)')
  markPaid(bill)
  env.toyyibpay.baseUrl = BASE
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(404)
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(409)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
  expect(created).toHaveLength(1)
})
test('production without a configured gateway exposes no payment simulator', async () => {
  Object.assign(env.toyyibpay, { secretKey: '', categoryCode: '' })
  env.nodeEnv = 'production'
  expect((await api(parent.token).get('/parent/payments')).gateway).toBe('unavailable')
  const b = await booking()
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(503)
  expect(created).toHaveLength(0)
})
test('an unrelated merchant-app callback is acknowledged without touching a WonderTutor payment', async () => {
  const body = { status: '1', refno: 'OTHER-TRANSACTION', billcode: 'other1', order_id: 'wordpress-order-1' }
  expect((await callback({ ...body, hash: signatureFor(body) })).status).toBe(200)
  expect(lookups).toHaveLength(0)
})
test('checkout reconciles a completed bank payment before redirecting again', async () => {
  const { booking: b, bill } = await startPayment()
  markPaid(bill)
  const result = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
  expect(result.reconciled).toBe(true)
  expect(result.redirectUrl).toBeUndefined()
  expect((await freshBooking(b.id)).status).toBe('CONFIRMED')
  expect(created).toHaveLength(1)
})
test('an old unresolved Billplz payment is never replaced with a ToyyibPay bill', async () => {
  const b = await booking()
  await prisma.payment.create({ data: { bookingId: b.id, amount: 60, commissionRate: 0, commissionAmount: 0, method: 'Billplz' } })
  expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })).status).toBe(409)
  expect(created).toHaveLength(0)
})
test('an undocumented provider status remains unconfirmed', async () => {
  const { checkout: c, bill } = await startPayment()
  bill.transactions = [transaction(bill, 'unexpected')]
  expect((await api(parent.token).post('/parent/payments/return', returnBody(c.gatewayRef))).status).toBe(502)
  expect((await freshPayment(c.paymentId)).status).toBe('PENDING')
})


test('an existing bank payment can still be reconciled after the profile phone changes', async () => {
  const { booking: b, bill } = await startPayment()
  markPaid(bill)
  await prisma.user.update({ where: { id: parent.user.id }, data: { phone: null } })
  try {
    const checked = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.publicId })
    expect(checked.reconciled).toBe(true)
    expect((await freshBooking(b.id)).status).toBe('CONFIRMED')
    expect(created).toHaveLength(1)
  } finally { await prisma.user.update({ where: { id: parent.user.id }, data: { phone: '+60123456789' } }) }
})


test.each(['ToyyibPay', 'Billplz'])('removing credentials never makes an existing %s bill payable through the simulator', async method => {
  const b = await booking()
  const payment = await prisma.payment.create({ data: { bookingId: b.id, amount: 60, commissionRate: 0, commissionAmount: 0, method, gatewayRef: 'original-external-bill' } })
  Object.assign(env.toyyibpay, { secretKey: '', categoryCode: '' })
  const forged = await api(parent.token).post(`/parent/payments/${payment.publicId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
  expect(forged.status).toBe(404)
  expect((await freshPayment(payment.id)).status).toBe('PENDING')
  expect((await freshBooking(b.id)).status).toBe('AWAITING_PAYMENT')
})
