import { jest } from '@jest/globals'
import sharp from 'sharp'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { renderWatermarkedDocument } from '../services/verificationWatermark.js'
import { api, apiBase, authHeaders, makeAdmin, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

const savedCloudinary = { ...env.cloudinary }
let originalFetch, owner, other, parent, admin

beforeAll(async () => {
  Object.assign(env.cloudinary, { cloudName: 'watermark-test', apiKey: 'test-key', apiSecret: 'test-secret' })
  await resetDb()
  await startServer()
  owner = await makeTutor()
  other = await makeTutor()
  parent = await makeParent()
  admin = await makeAdmin()
  originalFetch = globalThis.fetch
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { Object.assign(env.cloudinary, savedCloudinary); await stopServer() })

async function document(format) {
  return prisma.qualification.create({ data: { tutorId: owner.tutor.id, kind: 'IDENTITY', title: `Test ${format}`, documentUrl: `https://res.cloudinary.com/watermark-test/image/authenticated/v1/wondertutor/qualifications/${owner.user.id}/document.${format}` } })
}

async function image(format) {
  const source = sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } })
  return format === 'png' ? source.png().toBuffer() : source.jpeg().toBuffer()
}

async function samplePdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const text of ['First private page', 'Second private page']) pdf.addPage([400, 300]).drawText(text, { x: 30, y: 200, font, size: 20 })
  return Buffer.from(await pdf.save())
}

test.each(['jpg', 'jpeg', 'png'])('applies a visible mark to a %s image', async format => {
  const input = await image(format)
  const result = await renderWatermarkedDocument(input, format)
  const stats = await sharp(result).stats()
  expect(stats.channels[0].min).toBeLessThan(220)
  expect((await sharp(result).metadata()).format).toBe(format === 'png' ? 'png' : 'jpeg')
})

test('rasterizes and marks every page of a PDF', async () => {
  const result = await renderWatermarkedDocument(await samplePdf(), 'pdf')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(result), isEvalSupported: false })
  const pdf = await task.promise
  expect(pdf.numPages).toBe(2)
  for (let i = 1; i <= 2; i++) expect((await (await pdf.getPage(i)).getTextContent()).items).toHaveLength(0)
  await task.destroy()
})

test('the watermark is visible on every blank PDF page', async () => {
  const source = await PDFDocument.create()
  source.addPage([400, 300])
  source.addPage([400, 300])
  const result = await renderWatermarkedDocument(Buffer.from(await source.save()), 'pdf')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(result), isEvalSupported: false })
  const pdf = await task.promise
  for (let i = 1; i <= 2; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const canvas = createCanvas(viewport.width, viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    expect((await sharp(canvas.toBuffer('image/png')).stats()).channels[0].min).toBeLessThan(220)
  }
  await task.destroy()
})

test('rejects invalid, mismatched and oversized files', async () => {
  await expect(renderWatermarkedDocument(Buffer.from('not a PDF'), 'pdf')).rejects.toMatchObject({ status: 422 })
  await expect(renderWatermarkedDocument(await image('png'), 'jpg')).rejects.toMatchObject({ status: 422 })
  await expect(renderWatermarkedDocument(Buffer.from('<svg/>'), 'png')).rejects.toMatchObject({ status: 422 })
  await expect(renderWatermarkedDocument(Buffer.from('test'), 'gif')).rejects.toMatchObject({ status: 422 })
  await expect(renderWatermarkedDocument(Buffer.alloc(10 * 1024 * 1024 + 1), 'png')).rejects.toMatchObject({ status: 422 })
})

test('rejects PDFs above the page limit', async () => {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 31; i++) pdf.addPage([100, 100])
  await expect(renderWatermarkedDocument(Buffer.from(await pdf.save()), 'pdf')).rejects.toMatchObject({ status: 422 })
})

test('only the owner and admin receive a watermarked private copy', async () => {
  const doc = await document('png')
  const input = await image('png')
  const cloud = jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith('https://api.cloudinary.com/') ? Promise.resolve(new Response(input, { status: 200, headers: { 'Content-Type': 'image/png' } })) : originalFetch(url, options))
  const path = `/tutor/documents/${doc.id}/file`
  expect((await api().get(path)).status).toBe(401)
  expect((await api(parent.token).get(path)).status).toBe(403)
  expect((await api(other.token).get(path)).status).toBe(404)
  expect(cloud.mock.calls.filter(([url]) => String(url).startsWith('https://api.cloudinary.com/'))).toHaveLength(0)
  for (const [token, link] of [[owner.token, path], [admin.token, `/admin/qualifications/${doc.id}/file`]]) {
    const response = await originalFetch(apiBase() + link, { headers: authHeaders(token) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/no-store/)
    expect(response.headers.get('content-type')).toMatch(/^image\/png/)
    const result = Buffer.from(await response.arrayBuffer())
    expect((await sharp(result).stats()).channels[0].min).toBeLessThan(220)
  }
  const tutorProfile = await api(owner.token).get('/tutor/profile')
  expect(tutorProfile.documents.find(item => item.id === doc.id).documentUrl).toBe(path)
  const adminUser = await api(admin.token).get(`/admin/users/${owner.user.id}`)
  expect(adminUser.user.qualifications.find(item => item.id === doc.id).documentUrl).toBe(`/admin/qualifications/${doc.id}/file`)
  expect(JSON.stringify(adminUser.user)).not.toContain('api.cloudinary.com')
})

test.each(['jpg', 'pdf'])('serves a watermarked %s to the tutor and admin', async format => {
  const doc = await document(format)
  const input = format === 'pdf' ? await samplePdf() : await image(format)
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith('https://api.cloudinary.com/') ? Promise.resolve(new Response(input, { status: 200 })) : originalFetch(url, options))
  for (const [token, path] of [[owner.token, `/tutor/documents/${doc.id}/file`], [admin.token, `/admin/qualifications/${doc.id}/file`]]) {
    const response = await originalFetch(apiBase() + path, { headers: authHeaders(token) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(format === 'pdf' ? /^application\/pdf/ : /^image\/jpeg/)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (format === 'pdf') expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
    else expect((await sharp(bytes).stats()).channels[0].min).toBeLessThan(220)
  }
})

test('does not return the original when processing fails', async () => {
  const doc = await document('pdf')
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith('https://api.cloudinary.com/') ? Promise.resolve(new Response('invalid private data', { status: 200 })) : originalFetch(url, options))
  const response = await originalFetch(`${apiBase()}/admin/qualifications/${doc.id}/file`, { headers: authHeaders(admin.token) })
  expect(response.status).toBe(422)
  expect(await response.text()).not.toContain('invalid private data')
})
