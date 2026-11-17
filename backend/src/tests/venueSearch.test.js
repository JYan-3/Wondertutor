import { jest } from '@jest/globals'
import { createVenueSearch } from '../services/venueSearch.service.js'
import { capabilities, search as searchController } from '../controllers/parent/venueSearch.controller.js'

const place = { formatted: 'Example Library, Klang, Selangor, Malaysia', country_code: 'my', lat: 3.04, lon: 101.45, result_type: 'amenity' }
const reply = (rows = [place]) => ({ ok: true, json: async () => ({ results: rows }) })
const response = () => ({ set: jest.fn().mockReturnThis(), json: jest.fn() })

test('without a key, local town/postcode search works without an external request', async () => {
  const fetchImpl = jest.fn()
  const result = await createVenueSearch({ fetchImpl })('Klang')
  expect(result.provider).toBe('local')
  expect(result.results.some(row => row.label === 'Klang, Selangor' && Number.isFinite(row.lat))).toBe(true)
  expect(result.message).toContain('approximate area')
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('the external request searches Malaysia only and keeps the key out of its results', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply())
  const result = await createVenueSearch({ apiKey: 'test-key-only', fetchImpl })('  Example   Library  ')
  const [url, options] = fetchImpl.mock.calls[0]
  expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/autocomplete')
  expect(Object.fromEntries(url.searchParams)).toEqual({ text: 'Example Library', filter: 'countrycode:my', lang: 'en', format: 'json', limit: '6', apiKey: 'test-key-only' })
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(result).toMatchObject({ provider: 'geoapify', results: [{ label: place.formatted, lat: 3.04, lng: 101.45, kind: 'amenity', zoom: 17 }] })
  expect(JSON.stringify(result)).not.toContain('test-key-only')
})

test('provider results are bounded, de-duplicated and restricted to valid Malaysian coordinates', async () => {
  const rows = [place, place, { ...place, country_code: 'us' }, { ...place, lat: null }, { ...place, lon: 999 }, null,
    ...Array.from({ length: 8 }, (_, i) => ({ ...place, formatted: `Place ${i}`, result_type: '__proto__' })),
  ]
  const result = await createVenueSearch({ apiKey: 'test-key-only', fetchImpl: async () => reply(rows) })('Library')
  expect(result.results).toHaveLength(6)
  expect(result.results.filter(row => row.label === place.formatted)).toHaveLength(1)
  expect(result.results.every(row => Number.isFinite(row.zoom))).toBe(true)
})

test('repeated and concurrent identical searches use one provider call', async () => {
  let finish
  const fetchImpl = jest.fn(() => new Promise(resolve => { finish = resolve }))
  const search = createVenueSearch({ apiKey: 'test-key-only', fetchImpl })
  const first = search('Example Library'), second = search('example library')
  await Promise.resolve()
  finish(reply())
  expect(await first).toEqual(await second)
  expect(await search('EXAMPLE LIBRARY')).toEqual(await first)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test.each([401, 403, 429, 500])('provider HTTP %s offers local search and never exposes provider details', async status => {
  const result = await createVenueSearch({ apiKey: 'test-key-only', fetchImpl: async () => ({ ok: false, status }) })('Klang')
  expect(result.provider).toBe('local')
  expect(result.results.length).toBeGreaterThan(0)
  expect(result.message).toContain('temporarily unavailable')
  expect(JSON.stringify(result)).not.toMatch(/test-key-only|apiKey=|api\.geoapify/)
})

test.each([async () => { throw new Error('secret provider URL and key') }, async () => ({ ok: true, json: async () => ({ bad: true }) })])('network and malformed responses retain a usable local fallback', async fetchImpl => {
  const result = await createVenueSearch({ apiKey: 'test-key-only', fetchImpl })('Klang')
  expect(result.provider).toBe('local')
  expect(JSON.stringify(result)).not.toMatch(/secret provider|test-key-only/)
})

test('rate limiting and provider quota responses avoid automatic retries', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply())
  let now = 1_000_000
  const search = createVenueSearch({ apiKey: 'test-key-only', fetchImpl, clock: () => now })
  for (let i = 0; i < 4; i++) await search(`Place ${i}`)
  expect((await search('Klang')).provider).toBe('local')
  expect(fetchImpl).toHaveBeenCalledTimes(4)
  now += 1001
  fetchImpl.mockResolvedValue({ ok: false, status: 429 })
  await search('Klang')
  await search('Shah Alam')
  expect(fetchImpl).toHaveBeenCalledTimes(5)
  now += 60_001
  fetchImpl.mockResolvedValue(reply())
  expect((await search('Shah Alam')).provider).toBe('geoapify')
})

test('a conservative rolling daily allowance stops new provider requests until capacity returns', async () => {
  let now = 1_000_000
  const fetchImpl = jest.fn().mockResolvedValue(reply())
  const search = createVenueSearch({ apiKey: 'test-key-only', fetchImpl, clock: () => now })
  for (let i = 0; i < 2500; i++) { await search(`Place ${i}`); now += 1001 }
  expect((await search('Klang')).provider).toBe('local')
  expect(fetchImpl).toHaveBeenCalledTimes(2500)
  now += 24 * 60 * 60 * 1000
  expect((await search('Klang')).provider).toBe('geoapify')
})

test('capabilities never expose the key; map-search replies cannot be cached by intermediaries', async () => {
  const cap = response()
  capabilities({}, cap)
  expect(cap.json).toHaveBeenCalledWith({ provider: 'local', externalSearch: false, minLength: 3 })
  const res = response()
  await searchController({ body: { query: 'Klang' } }, res)
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(res.json.mock.calls[0][0].results.length).toBeGreaterThan(0)
})

test.each([{ query: 'ab' }, { query: 'x'.repeat(121) }, { query: 'Klang', childId: 1 }, { query: 'Klang', address: 'Private family address' }, { query: 'Klang', url: 'https://evil.test' }])('query validation rejects invalid or extra fields: %p', async body => {
  await expect(searchController({ body }, response())).rejects.toMatchObject({ name: 'ZodError' })
})
