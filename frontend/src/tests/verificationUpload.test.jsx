import { vi } from 'vitest'
import api from '../api/client'
import { uploadDocument } from '../components/PhotoPicker'

vi.mock('../api/client', () => ({ default: { post: vi.fn() }, errorMessage: e => e.message }))

test('uses the server-issued non-overwriting name for a private verification upload', async () => {
  api.post.mockResolvedValue({ data: { cloudName: 'test', apiKey: 'key', timestamp: 1, folder: 'folder', signature: 'signed', type: 'authenticated', allowed_formats: 'jpg,jpeg,png,pdf', public_id: 'unique-name', overwrite: false } })
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://example.test/document.pdf' }) })
  try {
    await expect(uploadDocument(new File(['data'], 'document.pdf', { type: 'application/pdf' }), true)).resolves.toBe('https://example.test/document.pdf')
    const form = fetchSpy.mock.calls[0][1].body
    expect(form.get('public_id')).toBe('unique-name')
    expect(form.get('overwrite')).toBe('false')
    expect(form.get('type')).toBe('authenticated')
  } finally { fetchSpy.mockRestore() }
})
