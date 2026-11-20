import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import TutorCard from '../../components/TutorCard'
import { CompareBar, useCompare } from '../../components/Compare'
import Pagination from '../../components/ui/Pagination'
import FilterChips, { countActive, NO_EXTRA } from '../../components/FilterChips'
import PlaceSearch from '../../components/PlaceSearch'
import { ErrorBox, FilterDropdown, LoadError, PageTitle, SelectBox, Spinner, EmptyState } from '../../components/ui/Common'
import { GRADE_GROUPS, parseGrade } from '../../lib/education'
import { subjectsForLevel } from '../../lib/subjects'
import { hhmmLabel, todayYmd } from '../../lib/format'
import TutorSearchNotice, { OnlineTutorAlternatives } from '../../components/TutorSearchNotice'

const SORTS = [
  ['recommended', 'Recommended'],
  ['price_asc', 'Price: Low to High'],
  ['price_desc', 'Price: High to Low'],
  ['rating', 'Highest Rated'],
  ['experience', 'Most Experienced'],
  ['nearest', 'Nearest'],
]
const PAGE_SIZE = 9
const EMPTY_BAR = { name: '', subject: '', grade: '', location: '', date: '', time: '' }
const HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`) // One-hour starts 07:00–21:00, ending by 22:00

export default function FindTutor() {
  const compare = useCompare() // up to 3 tutors ticked for the side-by-side comparison
  const navigate = useNavigate()
  const { catalog, kids, kidsLoaded, patchCriteria, loadError, reloadShared } = useMatching()

  // Top search bar (draft values, applied when "Search Tutors" is pressed)
  const [bar, setBar] = useState(null)
  // What the results currently reflect
  const [applied, setApplied] = useState(null)
  const [extra, setExtra] = useState(NO_EXTRA)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterToggle = useRef(null)
  const prefilled = useRef(new Set(['subject', 'grade', 'location']))
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)
  const resultsTop = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [retry, setRetry] = useState(0)
  const initialised = useRef(false)
  // Tutors whose heart was just clicked: a second click waits until the first save/unsave has finished
  const [saving, setSaving] = useState(() => new Set())

  // First visit: pre-fill from the parent's first child and saved area, so results show immediately
  useEffect(() => {
    if (initialised.current || !catalog || !kidsLoaded) return
    initialised.current = true
    const kid = kids[0]
    const grade = kid ? `${kid.educationLevel}:${kid.grade}` : 'PRIMARY:5'
    const allowed = subjectsForLevel(catalog.subjects, catalog.subjectLevels, parseGrade(grade).level)
    const initial = {
      ...EMPTY_BAR,
      subject: allowed.includes(kid?.subject) ? kid.subject : allowed.includes('Mathematics') ? 'Mathematics' : allowed[0] || '',
      grade,
      location: catalog.homeLocation || '',
    }
    setBar(initial)
    setApplied(initial)
  }, [catalog, kids, kidsLoaded])

  const query = useMemo(() => {
    if (!applied) return null
    const p = { sort, page, pageSize: PAGE_SIZE }
    if (applied.name) p.name = applied.name
    if (applied.subject) p.subject = applied.subject
    if (applied.grade) Object.assign(p, parseGrade(applied.grade))
    if (applied.location) p.location = applied.location
    if (applied.date && applied.time) Object.assign(p, { date: applied.date, time: applied.time })
    if (extra.minPrice !== '') p.minPrice = extra.minPrice
    if (extra.maxPrice !== '') p.maxPrice = extra.maxPrice
    if (extra.minRating) p.minRating = extra.minRating
    if (extra.days.length) p.days = extra.days.join(',')
    if (extra.maxDistance) p.maxDistance = extra.maxDistance
    if (extra.mode) p.mode = extra.mode
    if (extra.characteristics.length) p.characteristics = extra.characteristics.join(',')
    return p
  }, [applied, extra, sort, page])

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError('')
    setRequestError('')
    api.get('/parent/tutors', { params: query })
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && setRequestError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [query, retry])

  if (!bar || !catalog) return loadError ? <LoadError message={loadError} onRetry={reloadShared} /> : <Spinner />

  function changeField(key, value) {
    const next = { ...bar, [key]: value }
    prefilled.current.delete(key)
    // A name lookup starts across the directory, retaining filters the parent chose.
    if (key === 'name' && value.trim()) {
      for (const field of prefilled.current) next[field] = ''
      prefilled.current.clear()
    }
    if (key === 'grade' && !subjectsForLevel(catalog.subjects, catalog.subjectLevels, parseGrade(value).level).includes(next.subject)) next.subject = ''
    setBar(next)
  }

  function changeExtra(next) {
    if (next.maxDistance) prefilled.current.delete('location')
    setExtra(next)
    setPage(1)
  }

  function clearFilters() {
    prefilled.current.clear()
    setBar(EMPTY_BAR)
    setApplied(EMPTY_BAR)
    setExtra(NO_EXTRA)
    setSort('recommended')
    setPage(1)
    setError('')
  }
  // Save / unsave straight from the results; the heart updates at once
  async function toggleSave(t) {
    if (saving.has(t.id)) return
    setSaving((s) => new Set(s).add(t.id))
    try {
      const r = await api.post(`/parent/favourites/${t.id}`)
      setData(d => ({ ...d, tutors: d.tutors.map(x => x.id === t.id ? { ...x, isFavourite: r.data.isFavourite } : x),
        ...(d.onlineAlternatives && { onlineAlternatives: { ...d.onlineAlternatives, tutors: d.onlineAlternatives.tutors.map(x => x.id === t.id ? { ...x, isFavourite: r.data.isFavourite } : x) } }),
      }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(t.id); return n })
    }
  }

  const search = () => {
    // The availability filter needs both parts; half of it would be silently ignored
    if (Boolean(bar.date) !== Boolean(bar.time)) {
      setFiltersOpen(true)
      return setError('Choose both a date and a start time, or clear the availability filter.')
    }
    setError('')
    const name = bar.name.trim()
    const next = name === bar.name ? bar : { ...bar, name }
    setBar(next)
    setApplied(next)
    setPage(1)
    if (filtersOpen) filterToggle.current?.focus()
    setFiltersOpen(false)
  }

  function tryAiMatching() {
    const { level, grade } = bar.grade ? parseGrade(bar.grade) : { level: '', grade: null }
    patchCriteria({ subject: bar.subject, level, grade, location: bar.location, childId: kids.find((k) => k.educationLevel === level && k.grade === grade)?.id ?? null })
    navigate('/parent/find-tutor/match')
  }

  const dateTimeLabel = bar.date && bar.time ? `${bar.date} · ${hhmmLabel(bar.time)}` : 'Select date & time'
  const dirty = applied && Object.keys(bar).some(key => bar[key] !== applied[key])
  const filterCount = [applied.subject, applied.grade, applied.location, applied.date && applied.time].filter(Boolean).length + countActive(extra)

  return (
    <div>
      <h1 className="brand-title mb-3 text-2xl font-bold text-navy lg:hidden">Find a Tutor</h1>
      <div className="hidden lg:block">
        <PageTitle title="Find the Right Tutor for Your Child" subtitle="Browse qualified tutors or let our AI Tutor Assistant help you find suitable matches." />
      </div>

      <section className="parent-search-panel card p-3 lg:p-5">
        <form id="parent-tutor-search" aria-label="Search tutors" onSubmit={event => { event.preventDefault(); search() }} className="flex flex-col">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-sm font-semibold text-navy">Tutor name</span>
              <input type="search" maxLength={80} value={bar.name} onChange={event => changeField('name', event.target.value)}
                className="input h-11" placeholder="Search by name" />
            </label>
            <button type="submit" aria-label="Search Tutors" disabled={loading && !dirty} className="btn-accent h-11 w-11 shrink-0 px-0 sm:w-auto sm:px-5">
              <Icon name="search" className="h-[18px] w-[18px]" /><span className="hidden sm:inline">{loading ? 'Searching…' : 'Search Tutors'}</span>
            </button>
          </div>
          <div className="parent-matching-prompt mt-2 flex items-center justify-between gap-2 lg:order-last lg:mt-4 lg:gap-3 lg:border lg:border-brand-100 lg:p-4">
            <button ref={filterToggle} type="button" aria-label={filterCount ? `Filters, ${filterCount} applied` : 'Filters'} aria-expanded={filtersOpen} aria-controls="parent-search-fields parent-extra-filters"
              onClick={() => setFiltersOpen(!filtersOpen)} className="btn-outline h-11 shrink-0 gap-1.5 px-2.5 lg:hidden">
              <Icon name="sliders" className="h-4 w-4" /> Filters{filterCount > 0 && <span className="text-xs">({filterCount})</span>}
            </button>
            <Robot className="hidden h-10 w-10 shrink-0 lg:block" />
            <div className="hidden min-w-0 flex-1 lg:block">
              <div className="font-bold text-navy">Not sure which tutor to choose?</div>
              <div className="text-sm text-slate-500">Let our AI Tutor Assistant understand your child's learning needs and recommend suitable tutors.</div>
            </div>
            <button type="button" onClick={tryAiMatching} className="btn-primary px-4 max-lg:bg-transparent max-lg:px-1.5 max-lg:text-brand-600 max-lg:shadow-none">Try AI Matching <Icon name="arrow-right" className="h-4 w-4" /></button>
          </div>
          <div id="parent-search-fields" className={`mt-4 ${filtersOpen ? 'block' : 'hidden'} lg:block`}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-navy">Subject</span>
                <SelectBox icon="book" value={bar.subject} onChange={event => changeField('subject', event.target.value)}>
                  <option value="">All subjects</option>
                  {subjectsForLevel(catalog.subjects, catalog.subjectLevels, parseGrade(bar.grade).level).map((s) => <option key={s}>{s}</option>)}
                </SelectBox>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-navy">Education Level</span>
                <SelectBox icon="cap" value={bar.grade} onChange={event => changeField('grade', event.target.value)}>
                  <option value="">All education levels</option>
                  {GRADE_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                  ))}
                </SelectBox>
              </label>
              <PlaceSearch
                label="Location" value={bar.location} onChange={value => changeField('location', value)} quiet
                labelClass="mb-1.5 block text-sm font-semibold text-navy" placeholder="Any location: search a town or postcode"
              />
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-navy">Availability</span>
                <AvailabilityPicker bar={bar} setBar={setBar} label={dateTimeLabel} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2">
              <p className="text-sm text-slate-600">Leave filters empty to browse all tutors.</p>
              <button type="button" onClick={clearFilters} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 hover:underline">Clear filters</button>
            </div>
          </div>
          {dirty && <p role="status" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-navy">Your filters have changed. Select Search Tutors to update the results.</p>}
          <ErrorBox className="mt-3">{error}</ErrorBox>
        </form>

        <div id="parent-extra-filters" className={`mt-3 ${filtersOpen ? 'block' : 'hidden'} lg:flex lg:flex-wrap lg:items-center lg:justify-between lg:gap-3`}>
          <div className="max-lg:[&>div]:grid max-lg:[&>div]:grid-cols-2 sm:max-lg:[&>div]:grid-cols-3 max-lg:[&>div>.relative]:contents max-lg:[&_.pop-in]:static max-lg:[&_.pop-in]:col-span-full max-lg:[&_.pop-in]:w-full max-lg:[&>div>button:first-child]:hidden">
            <FilterChips extra={extra} setExtra={changeExtra} locationName={applied.location} showClear={false} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-navy lg:mt-0">
            Sort by:
            <select value={sort} onChange={event => { setSort(event.target.value); setPage(1) }} className="input h-11 w-48 font-medium">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="submit" form="parent-tutor-search" disabled={loading && !dirty} className="btn-accent mt-4 min-h-11 w-full lg:hidden">Show results</button>
        </div>
      </section>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 lg:mt-6">
        <div ref={resultsTop} className="scroll-mt-24">
          {/* "Showing 1–9 of 11 tutors": what is on screen out of everything that matches */}
          <h2 className="text-base font-bold text-navy lg:text-xl" aria-live="polite">{requestError ? 'Tutors could not be loaded' : loading ? 'Searching…' : resultsHeading(data)}</h2>
          {!loading && !requestError && data?.total > 0 && sort === 'recommended' && (
            <p className="hidden text-sm text-slate-600 lg:block">
              {(data.personalised ?? data.tutors.some(tutor => tutor.match))
                ? <>Best match first{data.rankedBy?.length ? `, based on ${data.rankedBy.join(' and ')}` : ''}. Every card shows its match score and why.</>
                : 'Verified tutors first, then parent ratings and teaching experience. Choose a subject and education level to see match scores.'}
            </p>
          )}
        </div>
        <Link to="/parent/favourites" aria-label="Saved tutors" className="ml-auto flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
          <Icon name="heart" className="h-4 w-4" /><span>Saved<span className="hidden sm:inline"> tutors</span></span>
        </Link>
      </div>

      <section aria-label="Tutor results" aria-busy={loading} className="mt-2 max-lg:[&>div[role=status]]:my-2 max-lg:[&>div[role=status]]:p-3 lg:mt-4">
        {requestError ? <LoadError title="We couldn't load tutors" message={requestError} onRetry={() => setRetry(value => value + 1)} /> : <>
        {loading && (data ? <p role="status" className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-navy">Updating tutor results…</p> : <Spinner label="Searching for tutors…" />)}
        <TutorSearchNotice scope={data?.searchScope} hasResults={data?.total > 0} />
        {data && data.tutors.length === 0 && !loading && data.searchScope?.mode !== 'PHYSICAL' && (
          <div className="card"><EmptyState icon="search" title="No tutors match these filters">Try another name or remove some filters.</EmptyState></div>
        )}
        <div inert={loading} className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
          {data?.tutors.map((t) => <TutorCard key={t.id} tutor={t} match={t.match} saved={t.isFavourite} onToggleSave={toggleSave} compare={compare} />)}
        </div>
        {data?.total === 0 && <OnlineTutorAlternatives total={data.onlineAlternatives?.total}>
          <div inert={loading} className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
            {data.onlineAlternatives?.tutors.map(t => <TutorCard key={t.id} tutor={t} match={t.match} saved={t.isFavourite} onToggleSave={toggleSave} compare={compare} />)}
          </div>
        </OnlineTutorAlternatives>}
        <CompareBar compare={compare} />
        {data && (
          <div className="mt-6">
            <Pagination
              page={data.total === 0 && data.onlineAlternatives?.total ? data.onlineAlternatives.page : data.page}
              totalPages={data.total === 0 && data.onlineAlternatives?.total ? data.onlineAlternatives.totalPages : data.totalPages}
              onChange={(p) => { setPage(p); resultsTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              label="Tutor results pages"
            />
          </div>
        )}
        </>}
      </section>
    </div>
  )
}

// "Showing 1–9 of 11 tutors" / "Showing 1 tutor" / "No tutors found"
export function resultsHeading(data) {
  if (!data) return 'Searching…'
  if (data.total === 0) return data.searchScope?.mode === 'PHYSICAL' ? 'Nearby tutor results' : 'No tutors found'
  const from = (data.page - 1) * data.pageSize + 1
  const to = from + data.tutors.length - 1
  if (data.total === 1) return 'Showing 1 tutor'
  if (from === 1 && to === data.total) return `Showing all ${data.total} tutors`
  return `Showing ${from}–${to} of ${data.total} tutors`
}

// "Select date & time" popover: a date and a 1-hour start time
function AvailabilityPicker({ bar, setBar, label }) {
  return (
    <FilterDropdown label={<span className="flex items-center gap-2"><Icon name="calendar" className="h-[18px] w-[18px] text-brand-500" />{label}</span>} width="w-72 max-w-[calc(100vw-3.25rem)]" active={!!bar.date}>
      {(close) => (
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-navy">Date
            <input type="date" min={todayYmd()} className="input mt-1 h-10" value={bar.date} onChange={(e) => setBar({ ...bar, date: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold text-navy">Start time
            <select className="input mt-1 h-10" value={bar.time} onChange={(e) => setBar({ ...bar, time: e.target.value })}>
              <option value="">Select time</option>
              {HOURS.map((h) => <option key={h} value={h}>{hhmmLabel(h)}</option>)}
            </select>
          </label>
          <div className="flex justify-between">
            <button type="button" className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:underline" onClick={() => { setBar({ ...bar, date: '', time: '' }); close() }}>Clear</button>
            <button type="button" className="btn-primary px-4 py-1.5" onClick={close}>Done</button>
          </div>
          <p className="text-xs text-slate-500">Press “Search Tutors” to apply. Only tutors free at that time are shown.</p>
        </div>
      )}
    </FilterDropdown>
  )
}
