import { useEffect, useId, useRef, useState } from 'react'
import api, { errorMessage } from '../api/client'
import Icon from './ui/Icon'

const KIND = { building: 'Building', amenity: 'Place', street: 'Street', area: 'Neighbourhood', town: 'Town', city: 'City', suburb: 'Neighbourhood', postcode: 'Postcode', village: 'Village', state: 'State' }

export default function VenuePlaceSearch({ disabled, onChoose }) {
  const id = useId(), listId = `${id}-results`
  const [capabilities, setCapabilities] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [searched, setSearched] = useState('')
  const [provider, setProvider] = useState('local')
  const [refresh, setRefresh] = useState(0)
  const version = useRef(0), picked = useRef(''), instant = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    api.get('/parent/venue-search', { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setCapabilities(response.data) })
      .catch(() => { if (!controller.signal.aborted) setCapabilities({ externalSearch: true }) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const mine = ++version.current, text = query.trim()
    if (disabled || !capabilities || text.length < 3 || query === picked.current) return
    const controller = new AbortController()
    const delay = instant.current ? 0 : 450
    instant.current = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      api.post('/parent/venue-search', { query: text }, { signal: controller.signal })
        .then(response => {
          if (mine !== version.current || controller.signal.aborted) return
          setResults(response.data.results || [])
          setProvider(response.data.provider || 'local')
          setMessage(response.data.message || '')
          setSearched(text)
          setActive(-1)
          setOpen(true)
        })
        .catch(err => { if (mine === version.current && !controller.signal.aborted) { setResults([]); setError(errorMessage(err)) } })
        .finally(() => { if (mine === version.current && !controller.signal.aborted) setLoading(false) })
    }, delay)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, disabled, capabilities, refresh])

  const choose = place => {
    if (disabled) return
    ++version.current
    picked.current = place.label
    setQuery(place.label)
    setResults([])
    setOpen(false)
    setLoading(false)
    onChoose(place)
  }
  const searchNow = () => {
    picked.current = ''
    instant.current = true
    setOpen(true)
    setRefresh(value => value + 1)
  }
  const close = () => { ++version.current; setOpen(false); setLoading(false) }
  const showList = !disabled && open && query.trim().length >= 3
  return <div className="rounded-xl border border-accent/40 bg-accent-50/60 p-3 sm:p-4">
    <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-navy">{capabilities?.externalSearch ? 'Find a building, street or postcode' : 'Find a town or postcode'}</label>
    <div className="flex min-w-0 gap-2">
      <div className="relative min-w-0 flex-1">
        <Icon name="search" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-500" />
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`}
          autoComplete="off" maxLength={120} disabled={disabled || !capabilities} value={query} placeholder={capabilities?.externalSearch ? 'Building, road or postcode in Malaysia' : 'Town or postcode in Malaysia'}
          className="input min-h-11 pl-9 pr-2" onFocus={() => { if (query !== picked.current) setOpen(true) }}
          onBlur={close} onChange={event => {
            picked.current = ''; ++version.current; setQuery(event.target.value); setOpen(true); setResults([]); setActive(-1); setLoading(false); setMessage(''); setError(''); setSearched('')
          }} onKeyDown={event => {
            if (event.key === 'Escape') { close(); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true)
              if (!results.length) return
              setActive(index => event.key === 'ArrowDown' ? Math.min(results.length - 1, index + 1) : Math.max(0, index - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (showList && active >= 0 && results[active]) choose(results[active])
              else if (query.trim().length >= 3) searchNow()
            }
          }} />
        {showList && <ul id={listId} role="listbox" aria-label="Map search results" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-brand-100 bg-white p-1 shadow-lg">
          {(loading || (!searched && !error)) && <li role="presentation" className="p-3 text-sm text-slate-500">Searching…</li>}
          {!loading && searched && !error && results.length === 0 && <li role="presentation" className="p-3 text-sm text-slate-600">No matching places. Try a building name, nearby town or postcode.</li>}
          {results.map((place, index) => <li key={`${place.label}|${place.lat}|${place.lng}`} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
            className={`cursor-pointer rounded-lg px-3 py-2.5 text-sm text-navy ${index === active ? 'bg-accent-50' : 'hover:bg-brand-50'}`}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(place)}>
            <span className="block break-words font-semibold">{place.label}</span><span className="text-xs text-slate-500">{KIND[place.kind] || 'Place'}</span>
          </li>)}
        </ul>}
      </div>
      <button type="button" className="btn-accent min-h-11 shrink-0 px-3" disabled={disabled || !capabilities || loading || query.trim().length < 3} onClick={searchNow}>Search</button>
    </div>
    <p id={`${id}-help`} className="mt-2 text-xs text-slate-600">Search locates the area; tap the map to place the actual entrance pin. Keep your private unit/house details in the lesson-address field.</p>
    {capabilities?.externalSearch && <p className="mt-1 text-xs text-slate-500">Only text typed in this search box is sent to Geoapify.</p>}
    {message && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">Search could not load: {error} You can still use the map or GPS.</p>}
    {(capabilities?.externalSearch || provider === 'geoapify') && <p className="mt-2 text-xs text-slate-500">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">© OpenStreetMap contributors</a></p>}
    <span role="status" aria-live="polite" className="sr-only">{loading ? 'Searching places' : showList && results.length ? `${results.length} places found` : ''}</span>
  </div>
}
