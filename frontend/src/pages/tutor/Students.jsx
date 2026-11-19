import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { SectionCard } from '../../components/ui/Common'
import TutorPageHeader from '../../components/TutorPageHeader'
import { Records } from '../../components/ui/AdminRecords'
import { useRecords } from '../../lib/adminRecords'
import { fmtDate, fmtTime } from '../../lib/format'
import { recordRef } from '../../lib/recordRef'
import { gradeLabel } from '../../lib/education'

function lessonState(lesson, now) {
  if (lesson.status === 'COMPLETED') return 'completed'
  if (lesson.status === 'DISPUTED') return 'disputed'
  if (Date.parse(lesson.startAt) > now) return 'upcoming'
  return Date.parse(lesson.endAt) > now ? 'in progress' : 'awaiting completion'
}

function StudentLessons({ lessons, now }) {
  const [filter, setFilter] = useState('all')
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
  return <details className="mt-3 min-w-0 rounded-xl border border-brand-100 bg-brand-25 px-4 py-2 open:bg-white">
    <summary className="min-h-11 cursor-pointer break-words py-2">
      <strong>{child.name}</strong> · {gradeLabel(child.educationLevel, child.grade)}
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
        {Object.entries(counts).map(([state, count]) => <span key={state}>{count} {state}</span>)}
      </span>
    </summary>
    <div className="my-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <section className="tutor-paper-note order-2 min-w-0 sm:order-1 break-words rounded-xl p-3">
        <h3 className="font-semibold text-navy">Last completed lesson</h3>
        {last ? <>
          <p className="mt-1 text-sm">{last.subject} · {fmtDate(last.startAt)}</p>
          {last.report ? <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="font-semibold">Progress note</dt><dd className="whitespace-pre-wrap">{last.report.progressNote?.trim() || 'No progress note recorded.'}</dd></div>
            <div><dt className="font-semibold">Homework</dt><dd className="whitespace-pre-wrap">{last.report.homework?.trim() || 'No homework recorded.'}</dd></div>
          </dl> : <p className="mt-2 text-sm">No report recorded for this lesson.</p>}
        </> : <p className="mt-1 text-sm">No completed lessons yet.</p>}
      </section>
      <section className="tutor-paper-blue order-1 min-w-0 sm:order-2 break-words rounded-xl border border-brand-100 p-3">
        <h3 className="font-semibold text-navy">Next confirmed lesson</h3>
        {next ? <p className="mt-1 text-sm">{next.subject} · {fmtDate(next.startAt)}, {fmtTime(next.startAt)} (MYT)</p>
          : <p className="mt-1 text-sm">No upcoming confirmed lesson.</p>}
      </section>
    </div>
    <div className="my-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-navy">Lesson history</h3>
      <label className="text-sm">Show lessons<select aria-label={`Show lessons for ${child.name}`} className="input ml-2 min-h-11 w-auto max-w-full text-base" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All lessons</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="disputed">Disputed</option><option value="awaiting completion">Awaiting completion</option><option value="in progress">In progress</option></select></label></div>
    {!rows.some(row => filter === 'all' || row.state === filter) && <p className="py-3 text-sm text-slate-600">No lessons in this section.</p>}
    <ul className="divide-y divide-slate-100">{rows.filter(row => filter === 'all' || row.state === filter).map(({ lesson, state }) => <li key={lesson.id}>
      <Link className="flex min-h-11 flex-wrap items-center gap-x-2 break-words py-2 underline" to={'/tutor/bookings/' + recordRef(lesson) + '/session'}>
        {fmtDate(lesson.startAt)}, {fmtTime(lesson.startAt)} · {lesson.subject} · {state}
      </Link>
    </li>)}</ul>
  </details>
}

export default function Students() {
  const source = useRecords('/tutor/bookings')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 60000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])
  return <div className="min-w-0 space-y-4"><TutorPageHeader title="My students" subtitle="Prepare for the next lesson with the last lesson in view." /><SectionCard title="Student lessons" className="tutor-student-list">
    <label className="mb-4 block max-w-lg text-sm font-semibold text-navy">Find a student<input className="input min-h-11 w-full text-base" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <Records source={source}>{({ bookings }) => {
      const students = new Map()
      for (const b of bookings) {
        if (!['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status) || !b.child.name.toLowerCase().includes(query.trim().toLowerCase())) continue
        if (!students.has(b.child.id)) students.set(b.child.id, [])
        students.get(b.child.id).push(b)
      }
      return students.size ? [...students].map(([id, lessons]) => <StudentLessons key={id} lessons={lessons} now={now} />) : <p className="mt-3">No matching students.</p>
    }}</Records>
  </SectionCard></div>
}
