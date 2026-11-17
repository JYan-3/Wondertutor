// The venue picker searches public places separately from the private lesson
// address. No child/account data or typed lesson-address field is sent here.
import { env } from '../config/env.js'
import { resolvePlace, searchPlaces } from './places.service.js'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const LIMIT = 6
const kindZoom = { building: 17, amenity: 17, street: 16, suburb: 14, postcode: 13, city: 12, town: 12, village: 13, state: 9 }

export const venueSearchCapabilities = () => ({ externalSearch: Boolean(env.geoapifyApiKey), provider: env.geoapifyApiKey ? 'geoapify' : 'local', minLength: 3 })

function localResults(query, message) {
  const results = searchPlaces(query, { limit: LIMIT }).flatMap(place => {
    const point = resolvePlace(place.label)
    return point ? [{ label: place.label, kind: place.kind, lat: point.lat, lng: point.lng, zoom: place.kind === 'area' ? 14 : 12 }] : []
  })
  return { results, provider: 'local', message: message || 'Town and postcode results show an approximate area. Place the lesson pin at the actual entrance.' }
}

const cleanResult = row => {
  const lat = row.lat, lng = row.lon
  if (String(row.country_code || '').toLowerCase() !== 'my' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const label = typeof row.formatted === 'string' ? row.formatted.trim().slice(0, 240) : ''
  const kind = typeof row.result_type === 'string' ? row.result_type.slice(0, 32) : 'place'
  return label ? { label, lat, lng, kind, zoom: Object.hasOwn(kindZoom, kind) ? kindZoom[kind] : 16 } : null
}

// One Hostinger Node process: bounded short-lived cache, coalesced duplicate
// requests and a conservative Free-plan allowance. Provider 429s also back off.
export function createVenueSearch({ apiKey = '', fetchImpl = fetch, clock = Date.now } = {}) {
  const cache = new Map(), pending = new Map()
  let calls = [], retryAfter = 0
  return async function search(query) {
    const text = query.trim().replace(/\s+/g, ' '), key = text.toLocaleLowerCase()
    if (!apiKey) return localResults(text)
    const now = clock(), saved = cache.get(key)
    if (saved && saved.expires > now) return saved.value
    if (pending.has(key)) return pending.get(key)
    calls = calls.filter(time => time > now - DAY)
    if (retryAfter > now || calls.length >= 2500 || calls.filter(time => time > now - 1000).length >= 4)
      return localResults(text, 'Street search is busy. You can search a town or postcode, use GPS, or place the pin on the map.')
    calls.push(now)
    const work = Promise.resolve().then(async () => {
      try {
        const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
        url.search = new URLSearchParams({ text, filter: 'countrycode:my', lang: 'en', format: 'json', limit: String(LIMIT), apiKey }).toString()
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } })
        if (!response.ok) {
          if ([401, 403, 429].includes(response.status)) retryAfter = clock() + MINUTE
          throw new Error('Place provider unavailable')
        }
        const body = await response.json()
        if (!Array.isArray(body.results)) throw new Error('Invalid place response')
        const unique = new Map()
        for (const row of body.results) {
          const result = row && cleanResult(row)
          if (result) unique.set(`${result.label}|${result.lat}|${result.lng}`, result)
        }
        const value = { results: [...unique.values()].slice(0, LIMIT), provider: 'geoapify', message: '' }
        cache.delete(key)
        if (cache.size >= 200) cache.delete(cache.keys().next().value)
        cache.set(key, { value, expires: clock() + 10 * MINUTE })
        return value
      } catch {
        // Never expose a provider URL/error: it could contain the API key/query.
        return localResults(text, 'Street search is temporarily unavailable. Try a town or postcode, use GPS, or place the pin on the map.')
      }
    }).finally(() => pending.delete(key))
    pending.set(key, work)
    return work
  }
}

export const searchVenuePlaces = createVenueSearch({ apiKey: env.geoapifyApiKey })
