import { jest } from '@jest/globals'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { api, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

const savedCloudinary = { ...env.cloudinary }
let tutor, other, parent
const url = (userId, name, format = 'pdf', version = 1) => `https://res.cloudinary.com/delete-test/image/authenticated/v${version}/wondertutor/qualifications/${userId}/${name}.${format}`
const add = (owner, name, extra = {}) => prisma.qualification.create({ data: { tutorId: owner.tutor.id, title: name, documentUrl: url(owner.user.id, name), ...extra } })

beforeAll(async () => {
  Object.assign(env.cloudinary, { cloudName: 'delete-test', apiKey: 'test-key', apiSecret: 'test-secret' })
  await resetDb()
  await startServer()
  tutor = await makeTutor()
  other = await makeTutor()
  parent = await makeParent()
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { Object.assign(env.cloudinary, savedCloudinary); await stopServer() })

test('deletes only the selected private asset and updates the badge', async () => {
  const identity = await add(tutor, 'identity', { kind: 'IDENTITY', status: 'APPROVED' })
  const qualification = await add(tutor, 'degree', { kind: 'QUALIFICATION', status: 'APPROVED' })
  await prisma.tutorProfile.update({ where: { id: tutor.tutor.id }, data: { isVerified: true } })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  const response = await api(tutor.token).del(`/tutor/documents/${identity.id}`)
  expect(response).toMatchObject({ status: 200, isVerified: false, fileRetained: false })
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(destroy).toHaveBeenCalledWith(`wondertutor/qualifications/${tutor.user.id}/identity`, expect.objectContaining({ type: 'authenticated', resource_type: 'image', invalidate: true }))
  expect(await prisma.qualification.findUnique({ where: { id: identity.id } })).toBeNull()
  expect(await prisma.qualification.findUnique({ where: { id: qualification.id } })).not.toBeNull()
})

test('a failed Cloudinary deletion leaves the record and badge unchanged and can be retried', async () => {
  const doc = await add(tutor, 'retry', { kind: 'IDENTITY', status: 'APPROVED' })
  await prisma.tutorProfile.update({ where: { id: tutor.tutor.id }, data: { isVerified: true } })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValueOnce(new Error('private provider failure')).mockResolvedValueOnce({ result: 'not found' })
  const failed = await api(tutor.token).del(`/tutor/documents/${doc.id}`)
  expect(failed.status).toBe(503)
  expect(failed.message).not.toContain('private provider failure')
  expect(await prisma.qualification.findUnique({ where: { id: doc.id } })).not.toBeNull()
  expect((await prisma.tutorProfile.findUnique({ where: { id: tutor.tutor.id } })).isVerified).toBe(true)
  expect((await api(tutor.token).del(`/tutor/documents/${doc.id}`)).status).toBe(200)
  expect((await prisma.tutorProfile.findUnique({ where: { id: tutor.tutor.id } })).isVerified).toBe(false)
  expect(destroy).toHaveBeenCalledTimes(2)
})

test('keeps a shared asset until its last record is removed', async () => {
  const first = await add(tutor, 'shared')
  const second = await add(tutor, 'shared-second', { documentUrl: url(tutor.user.id, 'shared', 'jpg', 2) })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect(await api(tutor.token).del(`/tutor/documents/${first.id}`)).toMatchObject({ status: 200, fileRetained: true })
  expect(destroy).not.toHaveBeenCalled()
  expect(await prisma.qualification.findUnique({ where: { id: second.id } })).not.toBeNull()
  expect(await api(tutor.token).del(`/tutor/documents/${second.id}`)).toMatchObject({ status: 200, fileRetained: false })
  expect(destroy).toHaveBeenCalledTimes(1)
})

test('keeps a file still referenced by a portfolio item', async () => {
  const doc = await add(tutor, 'portfolio-shared')
  const portfolio = await prisma.portfolioItem.create({ data: { tutorId: tutor.tutor.id, title: 'Portfolio copy', fileUrl: doc.documentUrl } })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect(await api(tutor.token).del(`/tutor/documents/${doc.id}`)).toMatchObject({ status: 200, fileRetained: true })
  expect(destroy).not.toHaveBeenCalled()
  expect(await prisma.portfolioItem.findUnique({ where: { id: portfolio.id } })).not.toBeNull()
})

test('concurrent removals of two records sharing one file delete it only once', async () => {
  const first = await add(tutor, 'concurrent')
  const second = await add(tutor, 'another', { documentUrl: url(tutor.user.id, 'concurrent') })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  const results = await Promise.all([api(tutor.token).del(`/tutor/documents/${first.id}`), api(tutor.token).del(`/tutor/documents/${second.id}`)])
  expect(results.map(result => result.status)).toEqual([200, 200])
  expect(results.map(result => result.fileRetained).sort()).toEqual([false, true])
  expect(destroy).toHaveBeenCalledTimes(1)
})

test('a double removal deletes one file once', async () => {
  const doc = await add(tutor, 'double')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  const results = await Promise.all([api(tutor.token).del(`/tutor/documents/${doc.id}`), api(tutor.token).del(`/tutor/documents/${doc.id}`)])
  expect(results.map(result => result.status).sort()).toEqual([200, 404])
  expect(destroy).toHaveBeenCalledTimes(1)
})

test('a missing credential or unexpected provider response keeps the record', async () => {
  const doc = await add(tutor, 'unavailable')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'error' })
  const secret = env.cloudinary.apiSecret
  try {
    env.cloudinary.apiSecret = ''
    expect((await api(tutor.token).del(`/tutor/documents/${doc.id}`)).status).toBe(503)
    expect(destroy).not.toHaveBeenCalled()
  } finally {
    env.cloudinary.apiSecret = secret
  }
  expect((await api(tutor.token).del(`/tutor/documents/${doc.id}`)).status).toBe(503)
  expect(await prisma.qualification.findUnique({ where: { id: doc.id } })).not.toBeNull()
})

test('rejects other users and does not call Cloudinary', async () => {
  const doc = await add(tutor, 'private')
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await api(other.token).del(`/tutor/documents/${doc.id}`)).status).toBe(404)
  expect((await api(parent.token).del(`/tutor/documents/${doc.id}`)).status).toBe(403)
  expect((await api().del(`/tutor/documents/${doc.id}`)).status).toBe(401)
  expect(destroy).not.toHaveBeenCalled()
  expect(await prisma.qualification.findUnique({ where: { id: doc.id } })).not.toBeNull()
})

test('does not delete an unrecognised cloud file and can remove a demo placeholder', async () => {
  const legacy = await add(tutor, 'legacy', { documentUrl: 'https://example.test/private.pdf' })
  const demo = await add(tutor, 'demo', { documentUrl: 'seed://sample-certificate' })
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' })
  expect((await api(tutor.token).del(`/tutor/documents/${legacy.id}`)).status).toBe(409)
  expect(await prisma.qualification.findUnique({ where: { id: legacy.id } })).not.toBeNull()
  expect((await api(tutor.token).del(`/tutor/documents/${demo.id}`)).status).toBe(200)
  expect(destroy).not.toHaveBeenCalled()
})
