import sharp from 'sharp'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { AppError } from '../utils/AppError.js'
import { mediaLink } from './privateMedia.js'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_PAGES = 30
const MAX_EDGE = 1800
const MESSAGE = 'WonderTutor - Verification only'
let processing = 0

function markCanvas(ctx, width, height) {
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(-Math.PI / 7)
  ctx.font = `bold ${Math.max(12, Math.round(width * 0.032))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(1, width * 0.001)
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.fillStyle = 'rgba(20,52,105,0.34)'
  const spacing = Math.max(70, height * 0.28)
  for (let y = -height; y <= height; y += spacing) {
    ctx.strokeText(MESSAGE, 0, y)
    ctx.fillText(MESSAGE, 0, y)
  }
  ctx.restore()
}

async function watermarkImage(input, format) {
  const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = input.length >= 3 && input[0] === 255 && input[1] === 216 && input[2] === 255
  if (format === 'png' ? !png : !jpeg) throw new AppError(422, 'The document file type does not match its contents.')
  const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate()
  const metadata = await image.metadata()
  if (!['jpeg', 'png'].includes(metadata.format) || metadata.format !== (format === 'png' ? 'png' : 'jpeg')) throw new AppError(422, 'The document file type does not match its contents.')
  const rotated = await image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true })
  const canvas = createCanvas(rotated.info.width, rotated.info.height)
  markCanvas(canvas.getContext('2d'), canvas.width, canvas.height)
  const result = sharp(rotated.data).composite([{ input: canvas.toBuffer('image/png') }])
  return format === 'png' ? result.png().toBuffer() : result.jpeg({ quality: 90 }).toBuffer()
}

async function watermarkPdf(input) {
  if (input.subarray(0, 5).toString() !== '%PDF-') throw new AppError(422, 'The document file type does not match its contents.')
  globalThis.DOMMatrix ||= DOMMatrix
  globalThis.ImageData ||= ImageData
  globalThis.Path2D ||= Path2D
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(input), isEvalSupported: false, useSystemFonts: true, disableFontFace: true })
  try {
    const source = await task.promise
    if (!source.numPages || source.numPages > MAX_PAGES) throw new AppError(422, `The PDF must contain no more than ${MAX_PAGES} pages.`)
    const output = await PDFDocument.create()
    for (let number = 1; number <= source.numPages; number++) {
      const page = await source.getPage(number)
      const base = page.getViewport({ scale: 1 })
      if (!base.width || !base.height || !Number.isFinite(base.width) || !Number.isFinite(base.height)) throw new AppError(422, 'The PDF page size is invalid.')
      const viewport = page.getViewport({ scale: Math.min(2, MAX_EDGE / Math.max(base.width, base.height)) })
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
      const context = canvas.getContext('2d')
      context.fillStyle = 'white'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      markCanvas(context, canvas.width, canvas.height)
      const image = await output.embedJpg(canvas.toBuffer('image/jpeg', 90))
      const resultPage = output.addPage([base.width, base.height])
      resultPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height })
      page.cleanup()
    }
    return Buffer.from(await output.save())
  } finally {
    await task.destroy()
  }
}

export async function renderWatermarkedDocument(input, format) {
  if (!Buffer.isBuffer(input) || input.length > MAX_BYTES) throw new AppError(422, 'The document must be 10MB or smaller.')
  if (!['jpg', 'jpeg', 'png', 'pdf'].includes(format)) throw new AppError(422, 'This document type is not supported.')
  try {
    return format === 'pdf' ? await watermarkPdf(input) : await watermarkImage(input, format)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(422, 'This document could not be processed. Please upload a readable file.')
  }
}

// Only the server fetches the original; viewers receive a flattened watermarked copy.
export async function watermarkedDocument(url, folder, format) {
  if (processing >= 2) throw new AppError(503, 'Document preview is busy. Please try again.')
  const signed = mediaLink(url, folder)
  if (!signed) throw new AppError(404, 'Document unavailable.')
  processing++
  try {
    const response = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (response.status === 404) throw new AppError(404, 'The uploaded document is no longer available. Please choose a file again.')
    if (!response.ok || !response.body) throw new AppError(502, 'Could not load this document. Please try again.')
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new AppError(422, 'The document must be 10MB or smaller.')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > MAX_BYTES) throw new AppError(422, 'The document must be 10MB or smaller.')
      chunks.push(chunk)
    }
    return await renderWatermarkedDocument(Buffer.concat(chunks), format)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(502, 'Could not load this document. Please try again.')
  } finally {
    processing--
  }
}
