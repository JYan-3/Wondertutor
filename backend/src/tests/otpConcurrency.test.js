import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { checkOtp, issueOtp } from '../services/otp.service.js'
import { api, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

async function codeFor(email, code = '123456') {
  await prisma.emailOtp.create({ data: { email, codeHash: await bcrypt.hash(code, 4), expiresAt: new Date(Date.now() + 600000) } })
}

test('parallel wrong guesses cannot exceed five attempts for one code', async () => {
  const email = 'parallel-attempts@test.local'
  await codeFor(email)
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => checkOtp(email, '000000')))
  expect(attempts.filter(x => x.reason?.status === 400)).toHaveLength(5)
  expect(attempts.filter(x => x.reason?.status === 429)).toHaveLength(7)
  expect((await prisma.emailOtp.findFirstOrThrow({ where: { email } })).attempts).toBe(5)
  await expect(checkOtp(email, '123456')).rejects.toMatchObject({ status: 429 })
})

test('simultaneous first requests create only one code and enforce the resend wait', async () => {
  const email = 'parallel-issue@test.local'
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => issueOtp(email)))
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(x => x.reason?.status === 429)).toHaveLength(5)
  expect(await prisma.emailOtp.count({ where: { email } })).toBe(1)
})

test('parallel use of the correct code succeeds only once', async () => {
  const email = 'parallel-correct@test.local'
  await codeFor(email)
  const results = await Promise.allSettled([checkOtp(email, '123456'), checkOtp(email, '123456')])
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(x => x.status === 'rejected')).toHaveLength(1)
  expect(await prisma.emailOtp.count({ where: { email } })).toBe(0)
})

test('the last allowed try can verify and expired codes cannot be consumed', async () => {
  const email = 'last-try@test.local'
  await codeFor(email)
  await prisma.emailOtp.updateMany({ where: { email }, data: { attempts: 4 } })
  await expect(checkOtp(email, '123456')).resolves.toBeUndefined()
  await codeFor(email)
  await prisma.emailOtp.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await expect(checkOtp(email, '123456')).rejects.toMatchObject({ status: 400 })
})

test('a tutor cannot use the same email code to start two sessions', async () => {
  const { user } = await makeTutor()
  await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: false } })
  await codeFor(user.email)
  const attempts = await Promise.all([api().post('/auth/verify-otp', { email: user.email, code: '123456' }), api().post('/auth/verify-otp', { email: user.email, code: '123456' })])
  expect(attempts.filter(x => x.status === 200)).toHaveLength(1)
  expect(attempts.filter(x => x.status !== 200)).toHaveLength(1)
})
