import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import TutorPageHeader from '../../components/TutorPageHeader'
import Icon from '../../components/ui/Icon'
import { LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { fmtDate, fmtTimeRange, greeting } from '../../lib/format'

const ACTIONS = [
  { to: '/tutor/availability', icon: 'calendar', action: 'Set teaching hours' },
  { to: '/tutor/setup', icon: 'user', action: 'Edit my profile' },
  { to: '/tutor/preview', icon: 'eye', action: 'Preview my profile' },
]

function LessonRow({ lesson, showDate = false, featured = false }) {
  return <div className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0 break-words"><strong className={featured ? 'text-xl text-navy sm:text-2xl' : 'text-navy'}>{lesson.subject} · {lesson.student}</strong>
      <p className="text-sm text-slate-600">{showDate && fmtDate(lesson.startAt) + ' · '}{fmtTimeRange(lesson.startAt, lesson.endAt)} (MYT)</p>
    </div>
    <Link to={lesson.to} className={featured ? 'btn-primary min-h-11 sm:shrink-0' : 'inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-brand-700 hover:underline sm:self-center'}>{lesson.action}{!featured && <Icon name="arrow-right" className="h-4 w-4 shrink-0" />}</Link>
  </div>
}

export default function TutorDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let sequence = 0
    async function refresh() {
      const request = ++sequence
      try {
        const { data } = await api.get('/tutor/dashboard')
        if (active && request === sequence) { setData(data); setError('') }
      } catch (e) {
        if (active && request === sequence) setError(errorMessage(e))
      }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [attempt])

  if (error) return <LoadError message={error} onRetry={() => { setError(''); setAttempt(n => n + 1) }} />
  if (!data) return <Spinner />
  const hasSchedule = data.nextLesson !== undefined && Array.isArray(data.actions) && Array.isArray(data.todaySessions)
  const stats = [
    ['New requests', data.newRequests, 'clock', 'Requests waiting for your response'],
    ['Upcoming lessons', data.upcomingSessions, 'calendar', 'Confirmed lessons ahead'],
    ['Parent rating', data.ratingCount ? `${Number(data.ratingAvg).toFixed(1)} / 5` : 'No reviews yet', 'star', data.ratingCount ? `${data.ratingCount} parent review${data.ratingCount === 1 ? '' : 's'}` : 'Ratings appear after parents review lessons'],
  ]

  return (
    <div className="space-y-6">
      <TutorPageHeader dashboard title={`${greeting()}, ${user.fullName}!`} subtitle="Your next lesson and the actions that need you. All times are in Malaysia time." />
      {hasSchedule ? <>
      <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
      <SectionCard title="Next lesson" icon="calendar" className="tutor-next-lesson">
        {data.nextLesson ? <LessonRow lesson={data.nextLesson} showDate featured /> : <p>No upcoming confirmed lessons.</p>}
      </SectionCard>
        <SectionCard title="Action needed" icon="clock" className={data.actions?.length ? 'tutor-needs-attention' : ''}>
          {data.actions?.length ? <div className="divide-y divide-slate-100">{data.actions.map(lesson => <LessonRow key={lesson.ref} lesson={lesson} showDate />)}</div> : <p>No outstanding requests or session follow-ups.</p>}
          <Link to="/tutor/bookings" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">View all bookings</Link>
        </SectionCard>
      </div>
      <div>
        <SectionCard title="Today's sessions" icon="calendar" className="tutor-paper-blue">
          {data.todaySessions?.length ? <div className="divide-y divide-slate-100">{data.todaySessions.map(lesson => <LessonRow key={lesson.ref} lesson={lesson} />)}</div> : <p>No sessions scheduled today.</p>}
        </SectionCard>
      </div>
      </> : <SectionCard title="Lesson schedule" icon="calendar">
        <p>The dashboard could only load your totals. Open Bookings to see your lessons and requests.</p>
        <Link to="/tutor/bookings" className="btn-outline mt-3 min-h-11">View all bookings</Link>
      </SectionCard>}
      <dl className="grid gap-3 sm:grid-cols-3" aria-label="Teaching overview">
        {stats.map(([label, value, icon, hint]) => (
          <div key={label} className="rounded-xl border border-brand-100 bg-white p-4 sm:p-5">
            <dt className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon name={icon} className="h-5 w-5 text-brand-500" />{label}</dt>
            <dd className="mt-3 text-2xl font-bold text-navy">{value}</dd>
            <dd className="mt-1 text-xs text-slate-500">{hint}</dd>
          </div>
        ))}
      </dl>
      <SectionCard title="Manage your teaching" icon="briefcase">
        <div className="grid gap-2 sm:grid-cols-3">
          {ACTIONS.map((item) => (
            <Link key={item.to} to={item.to} className="flex min-h-11 items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              <Icon name={item.icon} className="h-5 w-5" />{item.action}<Icon name="arrow-right" className="ml-auto h-4 w-4" />
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
