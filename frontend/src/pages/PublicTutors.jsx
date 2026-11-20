import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import Avatar from '../components/ui/Avatar'
import Icon from '../components/ui/Icon'
import Pagination from '../components/ui/Pagination'
import { ModePills, VerifiedTick } from '../components/ui/Common'
import { PublicBookLink } from '../components/PublicBookingActions'
import { LEVELS } from '../lib/education'
import { subjectsForLevel } from '../lib/subjects'
import TutorSearchNotice, { OnlineTutorAlternatives } from '../components/TutorSearchNotice'

const SORTS = [['recommended', 'Featured'], ['rating', 'Highest rated'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['experience', 'Most experienced']]

function PublicTutorCards({ tutors, fromSearch }) {
  return <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {tutors.map(tutor => <li key={tutor.id} className="min-w-0">
      <article className="card flex h-full flex-col p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar src={tutor.photoUrl} name={tutor.name} className="h-24 w-20" rounded="rounded-xl" text="text-2xl" />
          <div className="min-w-0 flex-1"><h2 className="flex items-start gap-1.5 break-words text-lg font-bold text-navy"><span>{tutor.name}</span>{tutor.verified && <VerifiedTick />}</h2><p className="mt-1 flex flex-wrap items-center gap-1 text-sm"><Icon name="star" className="h-4 w-4 text-accent-600" fill /><b>{Number(tutor.rating).toFixed(1)}</b><span className="text-slate-500">({tutor.reviewCount} reviews)</span></p></div>
        </div>
        <p className="mt-4 text-sm text-slate-700">{tutor.mainSubject} · {tutor.levels}</p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-600"><Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />{tutor.searchMode === 'ONLINE' ? 'Based in ' : ''}{tutor.location}</p>
        <div className="mt-3"><ModePills online={tutor.searchMode !== 'PHYSICAL' && tutor.offersOnline} physical={tutor.searchMode !== 'ONLINE' && tutor.offersPhysical} /></div>
        <p className="mt-auto pt-4 text-lg font-bold text-navy">RM {tutor.hourlyRate} <span className="text-xs font-normal text-slate-500">/ hour</span></p>
        <div className="mt-3 grid gap-2">
          <Link to={`/tutors/${tutor.id}${['ONLINE', 'PHYSICAL'].includes(tutor.searchMode) ? `?mode=${tutor.searchMode}` : ''}`} state={{ fromSearch }} className="btn-outline min-h-11">View Profile</Link>
          <PublicBookLink tutorId={tutor.id} mode={tutor.searchMode} className="btn-primary min-h-11" />
        </div>
      </article>
    </li>)}
  </ul>
}

function readFilters(params) {
  const level = params.get('level')?.toUpperCase() || ''
  return {
    name: params.get('name')?.trim() || '',
    subject: params.get('subject') || '',
    level: LEVELS.some(item => item.value === level) ? level : '',
    grade: params.get('grade') || '',
    location: params.get('location') || '',
    mode: ['ONLINE', 'PHYSICAL'].includes(params.get('mode')) ? params.get('mode') : '',
    sort: SORTS.some(([value]) => value === params.get('sort')) ? params.get('sort') : 'recommended',
  }
}

function TutorFilters({ initial, catalog, onSearch, onClear }) {
  const [draft, setDraft] = useState(initial)
  const [expanded, setExpanded] = useState(false)
  const allowedSubjects = subjectsForLevel(catalog.subjects, catalog.subjectLevels, draft.level)
  const level = LEVELS.find(item => item.value === draft.level)
  const dirty = Object.keys(initial).some(key => initial[key] !== draft[key])
  const filterCount = [initial.subject, initial.level, initial.grade, initial.location, initial.mode, initial.sort !== 'recommended'].filter(Boolean).length
  const change = (field, value) => setDraft(previous => {
    const next = { ...previous, [field]: value }
    if (field === 'level') {
      next.grade = ''
      if (!subjectsForLevel(catalog.subjects, catalog.subjectLevels, value).includes(previous.subject)) next.subject = ''
    }
    return next
  })
  const submit = event => {
    event.preventDefault()
    const values = { ...draft, name: draft.name.trim() }
    setDraft(values)
    setExpanded(false)
    onSearch(values)
  }
  const clear = () => {
    setDraft(readFilters(new URLSearchParams()))
    setExpanded(false)
    onClear()
  }
  return (
    <form aria-label="Browse tutors" onSubmit={submit} className="card mt-3 p-3 lg:mt-5 lg:p-5">
      <h2 className="mb-4 hidden font-bold text-navy lg:block">Find a tutor</h2>
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
        <div className="flex w-full items-end gap-2 sm:min-w-0 sm:flex-1 lg:max-w-xl">
          <label className="min-w-0 flex-1 text-sm font-semibold text-navy">Tutor name
            <input type="search" maxLength={80} placeholder="Search by name" className="input mt-1" value={draft.name} onChange={event => change('name', event.target.value)} />
          </label>
          <button type="submit" aria-label="Search Tutors" className="btn-primary h-11 w-11 shrink-0 px-0 sm:w-auto sm:px-5">
            <Icon name="search" className="h-4 w-4" /><span className="hidden sm:inline">Search Tutors</span>
          </button>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <button type="button" aria-label={filterCount ? `Filters, ${filterCount} applied` : 'Filters'} aria-expanded={expanded} aria-controls="public-tutor-filters" onClick={() => setExpanded(!expanded)} className="btn-outline min-h-11 px-3 lg:hidden">
            <Icon name="sliders" className="h-4 w-4" /> Filters{filterCount > 0 && <span className="text-xs">({filterCount})</span>}
          </button>
          <button type="button" onClick={clear} className={`${expanded || dirty || initial.name || filterCount ? 'block' : 'hidden'} min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 lg:block`}>Clear filters</button>
        </div>
      </div>
      <div id="public-tutor-filters" className={`${expanded ? 'grid' : 'hidden'} mt-4 gap-4 sm:grid-cols-2 lg:grid lg:grid-cols-3`}>
        <label className="block text-sm font-semibold text-navy">Education level
          <select className="input mt-1" value={draft.level} onChange={event => change('level', event.target.value)}>
            <option value="">All education levels</option>
            {LEVELS.map(item => <option key={item.value} value={item.value}>{item.value === 'SECONDARY' ? 'Secondary' : item.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">Subject
          <select className="input mt-1" value={draft.subject} onChange={event => change('subject', event.target.value)}>
            <option value="">All subjects</option>
            {allowedSubjects.map(subject => <option key={subject}>{subject}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">Year or form
          <select className="input mt-1" value={draft.grade} disabled={!level} onChange={event => change('grade', event.target.value)}>
            <option value="">{level ? 'All years / forms' : 'Choose a level first'}</option>
            {level && Array.from({ length: level.max }, (_, index) => <option key={index + 1} value={index + 1}>{level.label} {index + 1}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">Location
          <select className="input mt-1" value={draft.location} onChange={event => change('location', event.target.value)}>
            <option value="">All locations</option>
            {draft.location && !catalog.locations.includes(draft.location) && <option value={draft.location}>{draft.location}</option>}
            {catalog.locations.map(location => <option key={location}>{location}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">Teaching mode
          <select className="input mt-1" value={draft.mode} onChange={event => change('mode', event.target.value)}>
            <option value="">Online or physical</option><option value="ONLINE">Online</option><option value="PHYSICAL">Physical</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">Sort by
          <select className="input mt-1" value={draft.sort} onChange={event => change('sort', event.target.value)}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
      </div>
      {dirty && <p role="status" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-navy">Your filters have changed. Select Search Tutors to update the results.</p>}
      {expanded && <button type="submit" className="btn-primary mt-3 min-h-11 w-full lg:hidden">Apply filters</button>}
    </form>
  )
}

export default function PublicTutors() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const [catalog, setCatalog] = useState({ subjects: [], subjectLevels: {}, locations: [] })
  const [catalogError, setCatalogError] = useState('')
  const [result, setResult] = useState({ key: '', data: null, error: '' })
  const [retry, setRetry] = useState(0)
  const resultsTop = useRef(null)
  const queryKey = params.toString()
  const filters = useMemo(() => readFilters(new URLSearchParams(queryKey)), [queryKey])
  const query = useMemo(() => {
    const page = Number(new URLSearchParams(queryKey).get('page'))
    return { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')), page: Number.isSafeInteger(page) && page > 0 ? page : 1, pageSize: 9 }
  }, [filters, queryKey])
  const requestKey = JSON.stringify(query) + ':' + retry
  const loading = result.key !== requestKey
  const data = loading ? null : result.data
  const error = loading ? '' : result.error

  useEffect(() => {
    let cancelled = false
    window.scrollTo(0, 0)
    api.get('/public/home').then(({ data: home }) => {
      if (!cancelled) setCatalog({ subjects: home.subjects || [], subjectLevels: home.subjectLevels || {}, locations: home.locations || [] })
    }).catch(() => { if (!cancelled) setCatalogError('Filter options could not be loaded. You can still browse tutors or refresh this page.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.get('/public/tutors', { params: query }).then(response => { if (!cancelled) setResult({ key: requestKey, data: response.data, error: '' }) })
      .catch(failure => { if (!cancelled) setResult({ key: requestKey, data: null, error: errorMessage(failure) }) })
    return () => { cancelled = true }
  }, [query, requestKey])

  const search = values => {
    const next = new URLSearchParams()
    for (const [field, value] of Object.entries(values)) if (value && (field !== 'sort' || value !== 'recommended')) next.set(field, value)
    setParams(next)
  }
  const changePage = page => {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setParams(next)
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultsTop.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  return (
    <div className="py-4 lg:py-6">
      <h1 className="section-title">Find <span className="lg:hidden">a tutor</span><span className="hidden lg:inline">the Right Tutor for Your Child</span></h1>
      <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-slate-600 lg:block">Browse teaching information, qualifications, rates and parent reviews. Log in or create a parent account when you are ready to book.</p>
      <TutorFilters key={queryKey} initial={filters} catalog={catalog} onSearch={search} onClear={() => setParams({})} />
      {catalogError && <p role="status" className="mt-3 text-sm text-amber-800">{catalogError}</p>}
      <div ref={resultsTop} aria-busy={loading} className="mt-4 scroll-mt-24 sm:mt-6">
        {loading && <p role="status" className="rounded-xl bg-brand-50 p-4 text-sm text-navy">Loading tutors…</p>}
        {error && <div role="alert" className="card p-5 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="btn-outline mt-3 min-h-11">Try again</button></div>}
        {!loading && !error && data && <>
          <p role="status" className="mb-4 text-sm text-slate-600">{data.total} {data.searchScope?.mode === 'PHYSICAL' ? 'nearby physical ' : ''}tutor{data.total === 1 ? '' : 's'} found</p>
          <TutorSearchNotice scope={data.searchScope} hasResults={data.total > 0} />
          {data.tutors.length === 0 && data.searchScope?.mode !== 'PHYSICAL' && <div className="card p-6 text-center"><h2 className="font-bold text-navy">No tutors found</h2><p className="mt-2 text-sm text-slate-600">Try a different name or adjust your filters.</p><button type="button" onClick={() => setParams({})} className="btn-outline mt-4 min-h-11">Clear all filters</button></div>}
          <PublicTutorCards tutors={data.tutors} fromSearch={location.pathname + location.search} />
          {data.total === 0 && <OnlineTutorAlternatives total={data.onlineAlternatives?.total}>
            <PublicTutorCards tutors={data.onlineAlternatives?.tutors || []} fromSearch={location.pathname + location.search} />
          </OnlineTutorAlternatives>}
          <div className="mt-6"><Pagination page={data.total === 0 && data.onlineAlternatives?.total ? data.onlineAlternatives.page : data.page} totalPages={data.total === 0 && data.onlineAlternatives?.total ? data.onlineAlternatives.totalPages : data.totalPages} onChange={changePage} label="Tutor result pages" /></div>
        </>}
      </div>
    </div>
  )
}
