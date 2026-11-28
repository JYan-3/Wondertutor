import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/ui/Icon'
import TutorPageHeader from '../../components/TutorPageHeader'
import { Records } from '../../components/ui/AdminRecords'
import { useRecords } from '../../lib/adminRecords'
import { fmtDate, fmtTime } from '../../lib/format'
import { recordRef } from '../../lib/recordRef'
import { gradeLabel } from '../../lib/education'
import Pagination from '../../components/ui/Pagination'

const PAGE_SIZE = 5

function lessonState(lesson, now) {
  if (lesson.status === 'COMPLETED') return 'completed'
  if (lesson.status === 'DISPUTED') return 'disputed'
  if (Date.parse(lesson.startAt) > now) return 'upcoming'
  return Date.parse(lesson.endAt) > now ? 'in progress' : 'awaiting completion'
}

function StudentLessons({ lessons, now, selected }) {
  const [filter, setFilter] = useState('all')
  const [lessonPage, setLessonPage] = useState(1)
  const historyRef = useRef(null)
  const counts = { upcoming: 0, completed: 0, disputed: 0 }
  const rows = lessons.map(lesson => {
    const state = lessonState(lesson, now)
    counts[state] = (counts[state] || 0) + 1
    return { lesson, state }
  })
  // The booking list is ordered by lesson time, earliest first.
  const last = lessons.findLast(lesson => lesson.status === 'COMPLETED')
  const next = rows.find(row => row.state === 'upcoming')?.lesson
  const { child } = lessons[0]
  const filteredRows = rows.filter(row => filter === 'all' || row.state === filter)
  const totalLessonPages = Math.ceil(filteredRows.length / PAGE_SIZE)
  const currentLessonPage = Math.min(lessonPage, Math.max(1, totalLessonPages))
  const lessonStart = (currentLessonPage - 1) * PAGE_SIZE
  const changeFilter = value => { setFilter(value); setLessonPage(1) }
  return <details open={selected} className={`tutor-student-detail min-w-0 rounded-xl border border-brand-100 bg-white p-4 ${selected ? 'is-selected' : ''}`}>
    <summary className="min-h-11 cursor-pointer break-words py-2">
      <strong className="font-display text-2xl text-navy">{child.name}</strong> · {gradeLabel(child.educationLevel, child.grade)}
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
        {Object.entries(counts).map(([state, count]) => <span key={state}>{count} {state}</span>)}
      </span>
    </summary>
    <div className="my-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <section className="border border-brand-100 order-2 min-w-0 sm:order-1 break-words rounded-xl p-3">
        <h3 className="font-semibold text-navy">Last completed lesson</h3>
        {last ? <>
          <p className="mt-1 text-sm">{last.subject} · {fmtDate(last.startAt)}</p>
          {last.report ? <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="font-semibold">Progress note</dt><dd className="whitespace-pre-wrap">{last.report.progressNote?.trim() || 'No progress note recorded.'}</dd></div>
            <div><dt className="font-semibold">Homework</dt><dd className="whitespace-pre-wrap">{last.report.homework?.trim() || 'No homework recorded.'}</dd></div>
          </dl> : <p className="mt-2 text-sm">No report recorded for this lesson.</p>}
          <Link className="inline-flex min-h-11 items-center text-brand-700 underline" to={'/tutor/bookings/' + recordRef(last) + '/session'}>View report</Link>
        </> : <p className="mt-1 text-sm">No completed lessons yet.</p>}
      </section>
      <section className="border border-brand-100 order-1 min-w-0 sm:order-2 break-words rounded-xl border border-brand-100 p-3">
        <h3 className="font-semibold text-navy">Next confirmed lesson</h3>
        {next ? <><p className="mt-2 text-sm">{next.subject} · {fmtDate(next.startAt)}, {fmtTime(next.startAt)} (MYT)</p><p className="my-3 text-sm">{next.teachingMode === 'PHYSICAL' ? 'Physical lesson' : next.teachingMode === 'ONLINE' ? 'Online lesson' : ''}</p><Link className="btn-primary min-h-11 w-full" to={'/tutor/bookings/' + recordRef(next) + '/session'}>Open session</Link></>
          : <p className="mt-1 text-sm">No upcoming confirmed lesson.</p>}
      </section>
    </div>
    <div ref={historyRef} className="my-3 flex scroll-mt-24 flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-navy">Lesson history</h3>
      <label className="text-sm">Show lessons<select aria-label={`Show lessons for ${child.name}`} className="input ml-2 min-h-11 w-auto max-w-full text-base" value={filter} onChange={e => changeFilter(e.target.value)}><option value="all">All lessons</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="disputed">Disputed</option><option value="awaiting completion">Awaiting completion</option><option value="in progress">In progress</option></select></label></div>
    {!filteredRows.length && <p className="py-3 text-sm text-slate-600">No lessons in this section.</p>}
    <div className="mb-3 flex flex-wrap gap-2" aria-label={`Lesson history for ${child.name}`}>
      {['all', 'upcoming', 'completed', 'disputed'].map(state => <button key={state} type="button" onClick={() => changeFilter(state)} aria-pressed={filter === state} className="tutor-history-tab min-h-11 border-b-4 border-transparent px-3 text-sm font-semibold capitalize aria-pressed:border-accent aria-pressed:text-brand-700">{state === 'all' ? 'All lessons' : `${state} (${counts[state]})`}</button>)}
    </div>
    <ul className="divide-y divide-slate-100">{filteredRows.slice(lessonStart, lessonStart + PAGE_SIZE).map(({ lesson, state }) => <li key={lesson.id}>
      <Link className="flex min-h-11 flex-wrap items-center gap-x-2 break-words py-2 underline" to={'/tutor/bookings/' + recordRef(lesson) + '/session'}>
        {fmtDate(lesson.startAt)}, {fmtTime(lesson.startAt)} · {lesson.subject} · {state}
      </Link>
    </li>)}</ul>
    {totalLessonPages > 1 && <div className="mt-4 space-y-2"><p className="text-center text-sm text-slate-600">Showing {lessonStart + 1}–{Math.min(lessonStart + PAGE_SIZE, filteredRows.length)} of {filteredRows.length} lessons</p><Pagination page={currentLessonPage} totalPages={totalLessonPages} onChange={page => { setLessonPage(page); historyRef.current?.scrollIntoView?.({ block: 'start' }) }} label={`Lesson history pages for ${child.name}`} /></div>}
  </details>
}

function StudentWorkspace({ bookings, query, now, studentPage, setStudentPage }) {
  const [chosen, setChosen] = useState(null)
  const studentListRef = useRef(null)
  const students = new Map()
  for (const b of bookings) {
    if (!['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status) || !b.child.name.toLowerCase().includes(query.trim().toLowerCase())) continue
    if (!students.has(b.child.id)) students.set(b.child.id, [])
    students.get(b.child.id).push(b)
  }
  if (!students.size) return <p className="p-5">No matching students.</p>
  const totalStudentPages = Math.ceil(students.size / PAGE_SIZE)
  const currentStudentPage = Math.min(studentPage, totalStudentPages)
  const studentStart = (currentStudentPage - 1) * PAGE_SIZE
  const visibleStudents = [...students].slice(studentStart, studentStart + PAGE_SIZE)
  const current = visibleStudents.some(([id]) => id === chosen) ? chosen : visibleStudents[0][0]
  return <div className="min-w-0 space-y-4"><div ref={studentListRef} className="grid min-w-0 scroll-mt-24 items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
    <aside className="card hidden min-w-0 overflow-hidden lg:block" aria-label="Choose a student">
      <h2 className="border-b border-brand-100 p-4 font-display text-xl font-bold text-navy">My students ({students.size})</h2>
      {visibleStudents.map(([id, lessons]) => <button key={id} aria-pressed={current === id} className="flex min-h-11 w-full items-center gap-3 border-b border-brand-100 border-l-4 border-l-transparent p-4 text-left aria-pressed:border-l-brand-600 aria-pressed:bg-brand-50" onClick={() => setChosen(id)}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-2xl font-bold text-navy">{lessons[0].child.name[0]}</span>
        <span className="min-w-0"><strong className="block break-words font-display text-lg">{lessons[0].child.name}</strong><span className="mt-1 flex flex-wrap gap-1 text-xs"><span className="rounded bg-brand-50 px-2 py-1">{[...new Set(lessons.map(b => b.subject))].join(', ')}</span><span className="rounded bg-amber-50 px-2 py-1">{gradeLabel(lessons[0].child.educationLevel, lessons[0].child.grade)}</span></span></span>
      </button>)}
    </aside>
    <div className="min-w-0 space-y-3">{visibleStudents.map(([id, lessons]) => <StudentLessons key={id} lessons={lessons} now={now} selected={id === current} />)}
      <p className="tutor-paper-note rounded-xl p-4 text-center italic">Start with a quick homework review.</p>
    </div>
  </div>{totalStudentPages > 1 && <div className="space-y-2"><p className="text-center text-sm text-slate-600">Showing {studentStart + 1}–{Math.min(studentStart + PAGE_SIZE, students.size)} of {students.size} students</p><Pagination page={currentStudentPage} totalPages={totalStudentPages} onChange={page => { setStudentPage(page); studentListRef.current?.scrollIntoView?.({ block: 'start' }) }} label="Student pages" /></div>}</div>
}

export default function Students() {
  const source = useRecords('/tutor/bookings')
  const [query, setQuery] = useState('')
  const [studentPage, setStudentPage] = useState(1)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 60000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])
  return <div className="min-w-0 space-y-4"><TutorPageHeader title="My students" subtitle="Prepare for the next lesson with the last lesson in view." right={<label className="flex w-full max-w-lg items-center gap-2 rounded-xl border border-brand-200 bg-white px-3"><Icon name="search" className="h-5 w-5 shrink-0" /><input aria-label="Find a student" placeholder="Find a student" className="min-h-11 min-w-0 w-full bg-transparent text-base outline-none" type="search" value={query} onChange={e => { setQuery(e.target.value); setStudentPage(1) }} /></label>} />
    <Records source={source}>{({ bookings }) => <StudentWorkspace bookings={bookings} query={query} now={now} studentPage={studentPage} setStudentPage={setStudentPage} />}</Records>
  </div>
}
