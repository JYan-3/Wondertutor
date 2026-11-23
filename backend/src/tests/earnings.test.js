import { env } from '../config/env.js'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { api, startServer, stopServer, resetDb, makeParent, makeTutor, makeAdmin, makeBooking, MONDAY, nextDate } from './helpers.js'
import { outbox } from '../services/email.service.js'

let parent, admin
beforeAll(async () => { await resetDb(); await startServer(); parent = await makeParent(); admin = api((await makeAdmin()).token) })
afterAll(stopServer)
const root = '/tutor/earnings'
async function setup() {
  const t = await makeTutor({ commissionRate: 19 })
  const client = api(t.token)
  const bank = { bankName: 'Test Bank', accountName: 'Test Tutor', accountNumber: '001234568901' }
  const change = (currentBankId, details, confirmation = 'Test1234') => client.put(root + '/bank', { currentBankId, details, confirmation })
  expect((await change(null, bank)).status).toBe(200)
  const get = () => client.get(root)
  async function pay(status = 'COMPLETED', paymentStatus = 'PAID') {
    const b = await makeBooking({ tutor: t.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status })
    return prisma.payment.create({ data: { bookingId: b.id, amount: 100, commissionAmount: 12, commissionRate: 12, paidAt: new Date(), status: paymentStatus } })
  }
  const request = (view, amount) => client.post(root + '/withdrawals', { bankId: view.bank.id, version: view.version, amount })
  return { t, client, bank, change, get, pay, request }
}

test('payout account is encrypted in storage and only the last four digits are returned', async () => {
  const { t, bank, get } = await setup()
  const row = await prisma.bankAccount.findFirstOrThrow({ where: { tutorId: t.tutor.id } })
  expect(row.accountNumber).toBe('8901')
  expect(row.accountName).not.toContain(bank.accountName)
  expect(row.accountName).not.toContain(bank.accountNumber)
  expect((await get()).bank).toEqual({ id: row.id, bankName: bank.bankName, accountName: bank.accountName, lastFour: '8901' })
})

test('completed lessons use the historical fee; current rate, refunds and pending reports are separate', async () => {
  const { pay, get } = await setup()
  await pay()
  await pay('CONFIRMED')
  const partial = await pay('COMPLETED', 'PARTIALLY_REFUNDED')
  await prisma.refund.create({ data: { paymentId: partial.id, type: 'ADMIN_REVIEW', amount: 33.33, reason: 'Adjustment', status: 'APPROVED' } })
  await pay('COMPLETED', 'REFUNDED')
  const v = await get()
  expect(Number(v.rate)).toBe(19)
  expect(Number(v.totalEarned)).toBe(146.67)
  expect(Number(v.available)).toBe(146.67)
  expect(Number(v.pending)).toBe(88)
  const row = v.transactions.find(r => r.id === partial.id)
  expect(Number(row.commission)).toBe(8)
  expect(Number(row.originalCommission)).toBe(12)
  expect(Number(row.originalShare)).toBe(88)
  expect(Number(row.platformRefundShare)).toBe(4)
  expect(Number(row.tutorRefundShare)).toBe(29.33)
  expect(Number(row.net)).toBe(58.67)
  expect(v.transactions).toHaveLength(4)
})

test('two simultaneous withdrawals reserve only once, even when both individually fit', async () => {
  const { get, request, pay } = await setup()
  await pay()
  const before = await get()
  const attempts = await Promise.all([request(before, '30.01'), request(before, '30.01')])
  expect(attempts.map(r => r.status).sort()).toEqual([201, 409])
  const held = await get()
  expect(Number(held.held)).toBe(30.01)
  expect(Number(held.available)).toBe(57.99)
  expect((await request(held, '58')).status).toBe(400)
  expect((await request(held, '0.01')).status).toBe(201)
  expect((await request(await get(), '0.001')).status).toBe(400)
})

test('bank edits preserve the payout destination; rejection releases the hold and notifies once', async () => {
  const { t, client, bank, change, get, request, pay } = await setup()
  await pay()
  const old = await get()
  const w = await request(old, '88')
  const path = '/admin/withdrawals/' + w.id + '/review'
  const approve = { status: 'APPROVED', expectedStatus: 'PENDING' }
  expect((await client.post(path, approve)).status).toBe(403)
  expect((await change(old.bank.id, bank, 'wrong')).status).toBe(403)
  expect((await change(old.bank.id, { ...bank, accountNumber: '9988776655' })).status).toBe(200)
  const changed = await get()
  expect(changed.bank.lastFour).toBe('6655')
  expect(changed.withdrawals[0].bank.lastFour).toBe('8901')
  expect(JSON.stringify(changed)).not.toContain(bank.accountNumber)
  expect(Number(changed.available)).toBe(0)
  expect((await admin.post(path, approve)).status).toBe(409)
  const reject = { status: 'REJECTED', expectedStatus: 'ESCALATED', reason: 'Please confirm the account holder.' }
  expect((await admin.post(path, { ...reject, reason: ' ' })).status).toBe(400)
  expect((await admin.post(path, reject)).status).toBe(200)
  expect((await admin.post(path, reject)).status).toBe(409)
  const released = await get()
  expect(Number(released.available)).toBe(88)
  expect(released.withdrawals[0].reason).toBe(reject.reason)
  expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'WITHDRAWAL_REJECTED' } })).toBe(1)
  expect(outbox.some(m => m.to === t.user.email && m.html.includes(reject.reason))).toBe(true)
  const newRequest = await request(released, '88')
  const reviewPath = '/admin/withdrawals/' + newRequest.id + '/review'
  const responses = await Promise.all([admin.post(reviewPath, approve), admin.post(reviewPath, approve)])
  expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  expect((await admin.post(reviewPath, approve)).status).toBe(409)
  expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'WITHDRAWAL_APPROVED' } })).toBe(1)
  const approved = await get()
  expect(Number(approved.held)).toBe(88)
  expect(Number(approved.withdrawn)).toBe(0)
  expect(Number(approved.available)).toBe(0)
})

test('only tutors access earnings and withdrawal destinations are scoped to the tutor', async () => {
  const a = await setup(), b = await setup()
  const mine = await a.get(), other = await b.get()
  expect((await api().get(root)).status).toBe(401)
  expect((await api(parent.token).get(root)).status).toBe(403)
  expect((await a.request({ ...mine, bank: other.bank }, '0.01')).status).toBe(409)
  expect((await a.change(other.bank.id, null)).status).toBe(409)
})

test('manual payout needs approval and a verified receipt; concurrent and reused transfers are refused', async () => {
  const saved = { ...env.cloudinary }
  Object.assign(env.cloudinary, { cloudName: 'test-cloud', apiKey: 'test-key', apiSecret: 'test-secret' })
  try {
    const { t, client, get, request, pay, change, bank } = await setup()
    await pay()
    await pay()
    const first = await request(await get(), '88')
    const second = await request(await get(), '88')
    const path = id => '/admin/withdrawals/' + id
    const receipt = id => {
      const public_id = 'wondertutor/withdrawals/' + id + '/receipt'
      return { url: 'https://res.cloudinary.com/test-cloud/image/authenticated/v1/' + public_id + '.pdf',
        version: 1, signature: cloudinary.utils.api_sign_request({ public_id, version: 1 }, env.cloudinary.apiSecret) }
    }
    const input = { reference: 'bank-ref-001', receipt: receipt(first.id) }
    expect((await client.post(path(first.id) + '/transfer', input)).status).toBe(403)
    expect((await api().post(path(first.id) + '/transfer', input)).status).toBe(401)
    expect((await admin.post(path(first.id) + '/transfer', input)).status).toBe(409)
    expect((await admin.get(path(first.id) + '/destination')).status).toBe(409)
    for (const id of [first.id, second.id]) expect((await admin.post(path(id) + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })).status).toBe(200)
    expect(Number((await get()).held)).toBe(176)
    expect((await client.post('/uploads/signature', { purpose: 'withdrawal-receipt', withdrawalId: first.id })).status).toBe(403)
    expect((await admin.post('/uploads/signature', { purpose: 'withdrawal-receipt', withdrawalId: first.id })).status).toBe(409)
    expect((await admin.get(path(first.id) + '/destination')).status).toBe(409)
    expect((await admin.post(path(first.id) + '/start-transfer')).status).toBe(200)
    expect((await admin.post(path(second.id) + '/start-transfer')).status).toBe(200)
    const upload = await admin.post('/uploads/signature', { purpose: 'withdrawal-receipt', withdrawalId: first.id })
    expect(upload.status).toBe(200)
    expect(upload.type).toBe('authenticated')
    expect(upload.folder).toBe('wondertutor/withdrawals/' + first.id)
    expect(Number((await admin.get('/admin/salary/' + t.tutor.id)).approved)).toBe(0)
    expect((await client.get(path(first.id) + '/destination')).status).toBe(403)
    expect((await admin.get(path(first.id) + '/destination')).accountNumber).toBe(bank.accountNumber)
    await change((await get()).bank.id, { ...bank, accountNumber: '9988776655' })
    expect((await admin.get(path(first.id) + '/destination')).accountNumber).toBe(bank.accountNumber)
    expect((await admin.post(path(first.id) + '/transfer', { reference: 'ABC' })).status).toBe(400)
    expect((await admin.post(path(first.id) + '/transfer', { ...input, receipt: receipt(second.id) })).status).toBe(400)
    expect((await admin.post(path(first.id) + '/transfer', { ...input, receipt: { ...input.receipt, signature: '0'.repeat(40) } })).status).toBe(400)
    const outcomes = await Promise.all([admin.post(path(first.id) + '/transfer', input), admin.post(path(first.id) + '/transfer', input)])
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 409])
    expect((await admin.post(path(first.id) + '/transfer', input)).status).toBe(409)
    expect((await admin.post(path(second.id) + '/transfer', { ...input, receipt: receipt(second.id) })).status).toBe(409)
    const view = await get()
    expect(Number(view.withdrawn)).toBe(88)
    expect(Number((await admin.get('/admin/salary/' + t.tutor.id)).approved)).toBe(88)
    expect(Number(view.held)).toBe(88)
    expect(Number(view.available)).toBe(0)
    const paid = view.withdrawals.find(w => w.id === first.id)
    expect(paid.payoutStatus).toBe('PAID')
    expect(paid.transferRef).toBe('BANK-REF-001')
    expect(paid.receiptUrl).toContain('signature=')
    expect((await admin.get(path(first.id) + '/destination')).status).toBe(409)
    expect((await admin.post('/uploads/signature', { purpose: 'withdrawal-receipt', withdrawalId: first.id })).status).toBe(409)
    expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'WITHDRAWAL_PAID' } })).toBe(1)
    expect(outbox.filter(m => m.to === t.user.email && m.subject.includes('Withdrawal paid'))).toHaveLength(1)
    expect((await admin.get('/admin/withdrawals')).requests.find(w => w.id === first.id).payoutStatus).toBe('PAID')
  } finally { Object.assign(env.cloudinary, saved) }
})

test('a change after approval holds the withdrawal until earnings are reviewed', async () => {
  const { t, get, request, pay } = await setup()
  const payment = await pay()
  const w = await request(await get(), '88')
  const path = '/admin/withdrawals/' + w.id
  expect((await admin.post(path + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })).status).toBe(200)
  const refund = await prisma.refund.create({ data: { paymentId: payment.id, type: 'ADMIN_REVIEW', amount: 20, reason: 'Refund review' } })
  expect((await get()).withdrawals[0].payoutStatus).toBe('ON_HOLD')
  expect((await admin.get('/admin/withdrawals')).requests.find(row => row.id === w.id).payoutStatus).toBe('ON_HOLD')
  expect((await admin.post(path + '/start-transfer')).status).toBe(409)
  expect((await admin.get(path + '/destination')).status).toBe(409)
  expect((await admin.post(path + '/recheck', { confirmedReview: true })).status).toBe(409)
  await prisma.refund.update({ where: { id: refund.id }, data: { status: 'REJECTED' } })
  await pay()
  expect((await get()).withdrawals[0].payoutStatus).toBe('ON_HOLD')
  expect((await admin.post(path + '/recheck', { confirmedReview: true })).status).toBe(200)
  expect((await get()).withdrawals[0].payoutStatus).toBe('AWAITING_TRANSFER')
  expect((await prisma.withdrawal.findUnique({ where: { id: w.id } })).tutorId).toBe(t.tutor.id)
})

test('only one admin can handle a transfer, including when earnings change afterward', async () => {
  const saved = { ...env.cloudinary }
  Object.assign(env.cloudinary, { cloudName: 'test-cloud', apiKey: 'test-key', apiSecret: 'test-secret' })
  try {
    const { get, request, pay } = await setup()
    const payment = await pay()
    const w = await request(await get(), '88')
    const path = '/admin/withdrawals/' + w.id
    const other = api((await makeAdmin()).token)
    await admin.post(path + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
    const starts = await Promise.all([admin.post(path + '/start-transfer'), other.post(path + '/start-transfer')])
    expect(starts.map(r => r.status).sort()).toEqual([200, 409])
    const owner = starts[0].status === 200 ? admin : other
    const nonOwner = starts[0].status === 200 ? other : admin
    expect((await nonOwner.get(path + '/destination')).status).toBe(409)
    expect((await nonOwner.post(path + '/release-transfer', { confirmedNoTransfer: true })).status).toBe(409)
    expect((await owner.get(path + '/destination')).status).toBe(200)
    await prisma.refund.create({ data: { paymentId: payment.id, type: 'ADMIN_REVIEW', amount: 20, reason: 'Refund review' } })
    expect((await get()).withdrawals[0].payoutStatus).toBe('TRANSFER_REVIEW')
    expect((await owner.get(path + '/destination')).status).toBe(409)
    const public_id = 'wondertutor/withdrawals/' + w.id + '/receipt'
    const receipt = { url: 'https://res.cloudinary.com/test-cloud/image/authenticated/v1/' + public_id + '.pdf', version: 1, signature: cloudinary.utils.api_sign_request({ public_id, version: 1 }, env.cloudinary.apiSecret) }
    const input = { reference: 'CONFIRMED-TRANSFER-1', receipt }
    expect((await owner.post(path + '/transfer', input)).status).toBe(409)
    expect((await nonOwner.post(path + '/transfer', { ...input, balanceChangedConfirmed: true })).status).toBe(409)
    expect((await owner.post(path + '/transfer', { ...input, balanceChangedConfirmed: true })).status).toBe(200)
    expect((await get()).withdrawals[0].payoutStatus).toBe('PAID')
    expect((await owner.post(path + '/transfer', { ...input, balanceChangedConfirmed: true })).status).toBe(409)
  } finally { Object.assign(env.cloudinary, saved) }
})

test('a started transfer can be released only after confirming nothing was sent', async () => {
  const { get, request, pay } = await setup()
  await pay()
  const w = await request(await get(), '88')
  const path = '/admin/withdrawals/' + w.id
  await admin.post(path + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
  expect((await admin.post(path + '/start-transfer')).status).toBe(200)
  expect((await admin.post(path + '/release-transfer', {})).status).toBe(400)
  expect((await admin.post(path + '/release-transfer', { confirmedNoTransfer: true })).status).toBe(200)
  expect((await get()).withdrawals[0].payoutStatus).toBe('AWAITING_TRANSFER')
})

test('admin can reject an uncovered held request and the tutor sees the reason', async () => {
  const { t, get, request, pay } = await setup()
  const payment = await pay()
  const w = await request(await get(), '88')
  const path = '/admin/withdrawals/' + w.id
  await admin.post(path + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
  await prisma.refund.create({ data: { paymentId: payment.id, type: 'ADMIN_REVIEW', amount: 20, reason: 'Refund review' } })
  expect((await admin.post(path + '/reject-held', { reason: 'Earnings are under refund review.' })).status).toBe(200)
  expect((await admin.post(path + '/reject-held', { reason: 'Duplicate' })).status).toBe(409)
  const view = await get()
  expect(view.withdrawals[0]).toMatchObject({ payoutStatus: 'REJECTED', reason: 'Earnings are under refund review.' })
  expect(Number(view.held)).toBe(0)
  expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'WITHDRAWAL_REJECTED' } })).toBe(1)
})

test('a parent refund racing with the transfer puts the withdrawal under review', async () => {
  const { get, request, pay } = await setup()
  const payment = await pay()
  const w = await request(await get(), '88')
  const path = '/admin/withdrawals/' + w.id
  await admin.post(path + '/review', { status: 'APPROVED', expectedStatus: 'PENDING' })
  const [refund, start] = await Promise.all([
    api(parent.token).post('/parent/bookings/' + payment.bookingId + '/refund-request', { reason: 'Please review the lesson payment.' }),
    admin.post(path + '/start-transfer'),
  ])
  expect(refund.status).toBe(201)
  expect([200, 409]).toContain(start.status)
  expect(['ON_HOLD', 'TRANSFER_REVIEW']).toContain((await get()).withdrawals[0].payoutStatus)
  expect((await admin.get(path + '/destination')).status).toBe(409)
})

test('historical approvals retain their balance and are labelled as legacy records', async () => {
  const { get, request, pay } = await setup()
  await pay()
  const w = await request(await get(), '88')
  await prisma.withdrawal.update({ where: { id: w.id }, data: { status: 'APPROVED', legacyPaid: true } })
  const view = await get()
  expect(Number(view.withdrawn)).toBe(88)
  expect(Number(view.held)).toBe(0)
  expect(view.withdrawals[0].payoutStatus).toBe('LEGACY_PAID')
})

test('an unpaid approval from before the safety update is held for a fresh review', async () => {
  const { get, request, pay } = await setup()
  await pay()
  const w = await request(await get(), '88')
  await prisma.withdrawal.update({ where: { id: w.id }, data: { status: 'APPROVED' } })
  expect((await get()).withdrawals[0].payoutStatus).toBe('ON_HOLD')
  const path = '/admin/withdrawals/' + w.id
  expect((await admin.post(path + '/start-transfer')).status).toBe(409)
  expect((await admin.post(path + '/recheck', { confirmedReview: true })).status).toBe(200)
  expect((await get()).withdrawals[0].payoutStatus).toBe('AWAITING_TRANSFER')
})
