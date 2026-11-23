import { jest } from '@jest/globals'
import sharp from 'sharp'
import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { retryVerificationCleanups } from '../services/verificationCleanup.js'
import { runHousekeeping } from '../services/lifecycle.service.js'
import { api, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

const savedCloudinary = { ...env.cloudinary }
const originalFetch = globalThis.fetch
let tutor, other, parent
beforeAll(async () => {
  Object.assign(env.cloudinary, { cloudName: 'cleanup-test', apiKey: 'test-key', apiSecret: 'test-secret' })
  await resetDb()
  await startServer()
  tutor = await makeTutor()
  other = await makeTutor()
  parent = await makeParent()
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { Object.assign(env.cloudinary, savedCloudinary); await stopServer() })

async function upload(owner = tutor, format = 'pdf') {
  const sign = await api(owner.token).post('/uploads/signature', { purpose: 'qualification' })
  expect(sign.status).toBe(200)
  expect(sign.overwrite).toBe(false)
  const { allowed_formats, folder, public_id, timestamp, type, overwrite } = sign
  expect(sign.signature).toBe(cloudinary.utils.api_sign_request({ allowed_formats, folder, public_id, timestamp, type, overwrite }, env.cloudinary.apiSecret))
  return { publicId: `${folder}/${public_id}`, url: `https://res.cloudinary.com/cleanup-test/image/authenticated/v1/${folder}/${public_id}.${format}` }
}

function cloud(body, status = 200) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith('https://api.cloudinary.com/') ? Promise.resolve(new Response(body, { status })) : originalFetch(url, options))
}
const submit = (owner, documentUrl, overrides = {}) => api(owner.token).post('/tutor/documents', { kind: 'IDENTITY', title: 'Identity document', documentUrl, ...overrides })

test('deletes only a newly issued rejected upload', async () => {
  const candidate = await upload()
  const existing = await prisma.qualification.create({ data: { tutorId: tutor.tutor.id, title: 'Existing document', documentUrl: `https://res.cloudinary.com/cleanup-test/image/authenticated/v1/wondertutor/qualifications/${tutor.user.id}/existing.pdf` } })
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(tutor, candidate.url)).status).toBe(422)
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(destroy).toHaveBeenCalledWith(candidate.publicId, expect.objectContaining({ type: 'authenticated', resource_type: 'image', invalidate: true }))
  expect(await prisma.qualification.findUnique({ where: { id: existing.id } })).not.toBeNull()
})

test.each(['qualification', 'portfolio'])('never deletes an upload referenced by an existing %s', async kind => {
  const candidate = await upload()
  if (kind === 'qualification') await prisma.qualification.create({ data: { tutorId: tutor.tutor.id, title: 'Shared', documentUrl: candidate.url } })
  else await prisma.portfolioItem.create({ data: { tutorId: tutor.tutor.id, title: 'Shared', fileUrl: candidate.url } })
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(tutor, candidate.url)).status).toBe(kind === 'qualification' ? 409 : 422)
  expect(destroy).not.toHaveBeenCalled()
})

test('untracked and forged file names are never automatically deleted', async () => {
  const url = name => `https://res.cloudinary.com/cleanup-test/image/authenticated/v1/wondertutor/qualifications/${tutor.user.id}/${name}.pdf`
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(tutor, url('legacy'))).status).toBe(422)
  expect((await submit(tutor, url('wtv_' + 'a'.repeat(32) + '_' + 'b'.repeat(32)))).status).toBe(422)
  expect(destroy).not.toHaveBeenCalled()
})

test('does not delete when the file cannot be fetched or belongs to another tutor', async () => {
  const candidate = await upload()
  cloud('', 503)
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(tutor, candidate.url)).status).toBe(502)
  expect((await submit(other, candidate.url)).status).toBe(400)
  expect((await submit(parent, candidate.url)).status).toBe(403)
  expect(destroy).not.toHaveBeenCalled()
})

test('a provider deletion failure is reported and the same upload can be retried', async () => {
  const candidate = await upload()
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('provider detail')).mockResolvedValueOnce({ result: 'ok' })
  const failed = await submit(tutor, candidate.url)
  expect(failed.status).toBe(503)
  expect(failed.message).toMatch(/retry the same upload/i)
  expect(failed.message).not.toContain('provider detail')
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(1)
  expect((await submit(tutor, candidate.url)).status).toBe(422)
  expect(destroy).toHaveBeenCalledTimes(2)
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(0)
})

test('a failed deletion is retried later even if the tutor leaves', async () => {
  const candidate = await upload()
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ result: 'ok' })
  expect((await submit(tutor, candidate.url)).status).toBe(503)
  await prisma.verificationCleanup.update({ where: { publicId: candidate.publicId }, data: { nextAttemptAt: new Date(0) } })
  await retryVerificationCleanups()
  expect(destroy).toHaveBeenCalledTimes(2)
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(0)
})

test('cleanup still runs when another housekeeping task fails', async () => {
  const candidate = await upload()
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ result: 'ok' })
  expect((await submit(tutor, candidate.url)).status).toBe(503)
  await prisma.verificationCleanup.update({ where: { publicId: candidate.publicId }, data: { nextAttemptAt: new Date(0) } })
  jest.spyOn(prisma.pushSubscription, 'deleteMany').mockRejectedValueOnce(new Error('unrelated task failed'))
  await expect(runHousekeeping()).rejects.toThrow('unrelated task failed')
  expect(destroy).toHaveBeenCalledTimes(2)
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(0)
})

test('a scheduled retry preserves a file that became referenced after rejection', async () => {
  const candidate = await upload()
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline'))
  expect((await submit(tutor, candidate.url)).status).toBe(503)
  const doc = await prisma.qualification.create({ data: { tutorId: tutor.tutor.id, title: 'Retained', documentUrl: candidate.url } })
  await prisma.verificationCleanup.update({ where: { publicId: candidate.publicId }, data: { nextAttemptAt: new Date(0) } })
  await retryVerificationCleanups()
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(await prisma.qualification.findUnique({ where: { id: doc.id } })).not.toBeNull()
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(0)
})

test('a pending cleanup remains retryable after the tutor profile is deleted', async () => {
  const departing = await makeTutor()
  const candidate = await upload(departing)
  cloud('not a PDF')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ result: 'ok' })
  expect((await submit(departing, candidate.url)).status).toBe(503)
  await prisma.tutorProfile.delete({ where: { id: departing.tutor.id } })
  const pending = await prisma.verificationCleanup.findUniqueOrThrow({ where: { publicId: candidate.publicId } })
  expect(pending.tutorId).toBeNull()
  await prisma.verificationCleanup.update({ where: { publicId: candidate.publicId }, data: { nextAttemptAt: new Date(0) } })
  await retryVerificationCleanups()
  expect(destroy).toHaveBeenCalledTimes(2)
  expect(await prisma.verificationCleanup.count({ where: { publicId: candidate.publicId } })).toBe(0)
})

test('invalid document details clean up only the new upload', async () => {
  const candidate = await upload()
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(tutor, candidate.url, { title: '' })).status).toBe(400)
  expect(destroy).toHaveBeenCalledWith(candidate.publicId, expect.anything())
})

test('a saved upload is idempotent and cannot be deleted by a rejected retry', async () => {
  const candidate = await upload(tutor, 'png')
  const input = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()
  cloud(input)
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  const saved = await submit(tutor, candidate.url)
  expect(saved.status).toBe(201)
  expect((await submit(tutor, candidate.url)).id).toBe(saved.id)
  expect((await submit(tutor, candidate.url, { title: '' })).status).toBe(400)
  expect(destroy).not.toHaveBeenCalled()
  expect(await prisma.qualification.findUnique({ where: { id: saved.id } })).not.toBeNull()
})

test('a rejected retry cannot remove an upload being saved at the same time', async () => {
  const candidate = await upload(tutor, 'png')
  const input = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()
  let resume, started
  const waiting = new Promise(resolve => { resume = resolve })
  const fetching = new Promise(resolve => { started = resolve })
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (!String(url).startsWith('https://api.cloudinary.com/')) return originalFetch(url, options)
    started()
    await waiting
    return new Response(input, { status: 200 })
  })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  const saving = submit(tutor, candidate.url)
  await fetching
  const rejected = submit(tutor, candidate.url, { title: '' })
  resume()
  const [saved, invalid] = await Promise.all([saving, rejected])
  expect(saved.status).toBe(201)
  expect(invalid.status).toBe(400)
  expect(destroy).not.toHaveBeenCalled()
  expect(await prisma.qualification.findUnique({ where: { id: saved.id } })).not.toBeNull()
})

test('a rejected extra upload is removed when the tutor has reached the document limit', async () => {
  const limitOwner = await makeTutor()
  await prisma.qualification.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ tutorId: limitOwner.tutor.id, title: `Existing ${i}`, documentUrl: `seed://existing-${i}` })) })
  const candidate = await upload(limitOwner)
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await submit(limitOwner, candidate.url)).status).toBe(400)
  expect(destroy).toHaveBeenCalledWith(candidate.publicId, expect.anything())
  expect(await prisma.qualification.count({ where: { tutorId: limitOwner.tutor.id } })).toBe(10)
})

test('pending verification files cannot be attached to another tutor’s portfolio or profile', async () => {
  const candidate = await upload(tutor, 'png')
  const encoded = candidate.url.replace('/wtv_', '/%77tv_')
  expect((await api(other.token).post('/tutor/portfolio', { title: 'Other portfolio', fileUrl: encoded })).status).toBe(400)
  expect((await api(other.token).put('/tutor/profile', { profilePhotoUrl: encoded })).status).toBe(400)
})
