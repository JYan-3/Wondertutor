import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import { LoadError, SectionCard, Spinner, StatusPill } from '../../components/ui/Common'
import LessonDetails from '../../components/LessonDetails'
import { fmtDate, fmtTimeRange, greeting, timeAgo } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { childSubjects } from '../../lib/subjects'
import { recordRef } from '../../lib/recordRef'
import { DAY_SHORT, hhmmLabel } from '../../lib/format'
import { ParentHeaderDecor } from '../../components/ParentPageEffects'

const ACTIVITY_ICON = {
  BOOKING_CONFIRMED: ['calendar', 'bg-emerald-100 text-emerald-600'],
  BOOKING_SENT: ['clock', 'bg-accent-100 text-accent-600'],
  REVIEW_POSTED: ['star', 'bg-accent-100 text-accent-600'],
  PAYMENT_SUCCESS: ['wallet', 'bg-emerald-100 text-emerald-600'],
}

export default function ParentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { setChatOpen, setResult } = useMatching()
  const [data, setData] = useState(null)
  const [matching, setMatching] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadError, setLoadError] = useState('')

  const load = () => {
    setLoadError('')
    api.get('/parent/dashboard').then((r) => setData(r.data)).catch((e) => setLoadError(errorMessage(e)))
  }
  useEffect(() => {
    load()
    api.get('/parent/matching/latest').then((r) => setMatching(r.data.matching)).catch(() => {})
  }, [])

  if (!data) return loadError ? <LoadError message={loadError} onRetry={load} /> : <Spinner />
  const { children, counts, upcoming, activity } = data

  return (
    <div>
      <div className="relative mb-6 flex items-start justify-between">
        <div className="parent-dashboard-copy">
          <h1 className="brand-title text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">
            {greeting()}, {user.fullName}! <span className="parent-dashboard-wave inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_1]">👋</span>
          </h1>
          <p className="mt-1 text-lg text-slate-500">Let's find the right learning support for your child.</p>
        </div>
        <div className="parent-dashboard-art flex items-center gap-4 lg:pr-4">
          <ParentHeaderDecor />
          <div className="hidden font-hand text-2xl leading-6 text-brand-200 [transform:rotate(-8deg)] xl:block">
            Small<br />Steps<br />Brighter<br />Futures
          </div>
        </div>
      </div>

      {counts.needsAttention > 0 && <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p className="min-w-0 flex-1 text-sm"><b>{counts.needsAttention} {counts.needsAttention === 1 ? 'lesson needs' : 'lessons need'} attention.</b> The lesson time has passed and the tutor has not completed the record. Check the details or report a problem.</p>
        <Link to="/parent/bookings?tab=attention" className="btn-outline min-h-11 w-full px-4 sm:w-auto">Review lessons</Link>
      </div>}

      {upcoming.length > 0 && <UpcomingLessons lessons={upcoming} onView={setDetail} className="mb-6" />}

      <div className="grid gap-6 lg:grid-cols-[1.12fr_1fr]">
        {/* ───── left column ───── */}
        <div className="space-y-6">
          <section className="card relative overflow-hidden border-accent/30 bg-gradient-to-r from-accent-50 to-white p-6">
            <Icon name="sparkle" fill className="absolute left-5 top-5 h-7 w-7 text-accent" />
            <div className="pl-12 sm:pr-44">
              <h2 className="text-2xl font-extrabold text-navy">Find a Tutor</h2>
              <p className="mt-1 text-sm text-slate-600">Tell us what your child needs and we'll recommend suitable tutors.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link to="/parent/find-tutor" className="btn-primary h-12 px-7 text-base">Find a Tutor <Icon name="arrow-right" className="h-4 w-4" /></Link>
                <button onClick={() => setChatOpen(true)} className="btn h-12 border border-accent bg-white/70 px-7 text-base text-navy hover:bg-accent-50">
                  <Icon name="sparkle" fill className="h-4 w-4 text-accent" /> Chat with AI
                </button>
              </div>
            </div>
            <div className="absolute bottom-3 right-6 hidden sm:block">
              <span className="absolute -top-2 right-0 flex h-20 w-20 rotate-[8deg] items-center justify-center rounded-full bg-accent-100 p-2 text-center font-hand text-sm font-bold leading-4 text-navy">
                Your AI<br />Learning<br />Assistant
              </span>
              <Robot className="float-y relative -left-8 top-3 h-32 w-32" />
            </div>
          </section>

          <SectionCard title={children.length > 2 ? `Your Children (${children.length})` : 'Your Children'} action={<Link to="/parent/children" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">Manage Children <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Names remain readable; the title and Manage link expose additional children. */}
              {children.slice(0, 2).map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={c.photoUrl} name={c.name} className="h-12 w-12 shrink-0" />
                    <div className="min-w-0">
                      <div className="break-words text-base font-bold text-navy">{c.name}</div>
                      <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="calendar" className="h-3.5 w-3.5 text-brand-500" /> {gradeLabel(c.educationLevel, c.grade)}</div>
                      {childSubjects(c).length > 0 && <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="book" className="h-3.5 w-3.5 shrink-0 text-brand-500" /> <span className="truncate">{childSubjects(c).slice(0, 2).join(', ')}{childSubjects(c).length > 2 ? ` +${childSubjects(c).length - 2}` : ''}</span></div>}
                    </div>
                  </div>
                  <Link to={`/parent/children?edit=${recordRef(c)}`} className="btn-outline mt-3 w-full">View Profile <Icon name="arrow-right" className="h-4 w-4" /></Link>
                </div>
              ))}
              <Link to="/parent/children?add=1" className="parent-hover-lift flex items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-3 transition hover:bg-brand-50 sm:col-span-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-500"><Icon name="plus" className="h-5 w-5" /></span>
                <span><span className="block font-bold text-navy">Add Child</span><span className="text-sm text-slate-600">Add another child profile.</span></span>
              </Link>
            </div>
          </SectionCard>

          <SectionCard title="Recent Activity" action={<Link to="/parent/bookings?tab=all" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">View All Activity <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            {activity.length === 0 && <p className="py-4 text-sm text-slate-500">Nothing yet. Your bookings and payments will show up here.</p>}
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => {
                const [icon, tone] = ACTIVITY_ICON[a.type] || ['bell', 'bg-brand-50 text-brand-500']
                const body = (
                  <>
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-navy">{a.title}</div>
                      <div className="truncate text-sm text-slate-500">{a.message}</div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{timeAgo(a.createdAt)}</span>
                  </>
                )
                // Each activity opens the booking, payment or complaint it is about
                return (
                  <li key={a.id}>
                    {a.link
                      ? <Link to={a.link} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-brand-25">{body}</Link>
                      : <div className="flex items-center gap-3 py-3">{body}</div>}
                  </li>
                )
              })}
            </ul>
          </SectionCard>
        </div>

        {/* ───── right column ───── */}
        <div className="space-y-6">
          <SectionCard title="Booking Summary" action={<Link to="/parent/bookings?tab=all" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">View All Bookings <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                ['calendar', counts.upcoming, 'Upcoming', 'bg-brand-50', 'bg-brand-100 text-brand-500', 'upcoming'],
                ['clock', counts.pending, 'Pending', 'bg-accent-50', 'bg-accent-100 text-accent-600', 'pending'],
                ['check', counts.completed, 'Completed', 'bg-ok-50', 'bg-ok text-white', 'completed'],
              ].map(([icon, n, label, bg, tone, tab]) => (
                <button key={label} onClick={() => navigate(`/parent/bookings?tab=${tab}`)} className={`parent-hover-lift flex min-w-0 flex-col items-start gap-2 rounded-xl p-3 text-left ${bg} transition hover:shadow-md sm:flex-row sm:items-center`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-2xl font-extrabold leading-8 text-navy">{n}</span><span className="break-words text-xs text-slate-600">{label}</span></span>
                </button>
              ))}
            </div>
          </SectionCard>

          {upcoming.length === 0 && <UpcomingLessons lessons={upcoming} onView={setDetail} />}

          <SectionCard title="Continue Where You Left Off">
            {matching ? (
              <div className="flex items-start gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white"><Icon name="search" className="h-6 w-6" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-navy">Tutor search in progress</div>
                  <p className="text-sm text-slate-500">You have {matching.total} tutor{matching.total === 1 ? '' : 's'} matching your latest preferences.</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Icon name="book" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.subject}</span>
                    {matching.criteria.grade && <span className="flex items-center gap-1"><Icon name="calendar" className="h-3.5 w-3.5 text-brand-500" />{gradeLabel(matching.criteria.level, matching.criteria.grade)}</span>}
                    <span className="flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.mode === 'ONLINE' ? 'Online' : matching.criteria.mode === 'PHYSICAL' ? 'Physical' : 'Online / Physical'}</span>
                    {matching.criteria.location && <span className="flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.location}</span>}
                    {matching.criteria.days?.length > 0 && <span className="flex items-center gap-1"><Icon name="clock" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.days.map((d) => DAY_SHORT[d]).join(', ')}{matching.criteria.timeStart && ` · ${hhmmLabel(matching.criteria.timeStart)}`}</span>}
                  </div>
                  <button onClick={() => { setResult(matching); navigate('/parent/find-tutor/results') }} className="btn-primary mt-4 h-11 px-6">
                    View Recommendations <Icon name="arrow-right" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name="search" className="h-6 w-6" /></span>
                <div>
                  <div className="font-bold text-navy">No tutor search yet</div>
                  <p className="text-sm text-slate-500">Start with the matching wizard or chat with our AI Tutor Assistant.</p>
                  <Link to="/parent/find-tutor/match" className="btn-primary mt-3 px-5">Start Matching</Link>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <LessonDetails booking={detail} onClose={() => setDetail(null)} onChanged={load} />
    </div>
  )
}

function UpcomingLessons({ lessons, onView, className = '' }) {
  return <SectionCard title="Upcoming Lessons" className={className} action={<Link to="/parent/bookings?tab=upcoming" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">View all upcoming <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
    {lessons.length === 0 ? <p className="py-2 text-sm text-slate-600">No upcoming lessons yet. <Link to="/parent/find-tutor" className="font-semibold text-brand-600 underline">Find a tutor</Link> and send a booking request.</p> : <>
      {lessons.length > 2 && <p className="mb-3 text-sm text-slate-600">Showing your next two lessons. View all upcoming for your full schedule.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {lessons.slice(0, 2).map(lesson => <article key={lesson.id} className="min-w-0 rounded-xl border border-brand-100 bg-brand-25/40 p-4">
          <div className="flex items-center gap-3">
            <Avatar src={lesson.tutor.photoUrl} name={lesson.tutor.name} className="h-12 w-12 shrink-0" rounded="rounded-xl" />
            <div className="min-w-0"><h3 className="break-words font-bold text-navy">{lesson.subject}</h3><p className="break-words text-sm text-slate-600">{lesson.tutor.name}</p></div>
          </div>
          <p className="mt-3 flex items-start gap-2 text-sm text-navy"><Icon name="calendar" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /><span>{fmtDate(lesson.startAt)} · {fmtTimeRange(lesson.startAt, lesson.endAt)}</span></p>
          <p className="mt-1 text-sm text-slate-600">Child: {lesson.child.name} · {gradeLabel(lesson.child.educationLevel, lesson.child.grade)}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-start gap-1.5 text-sm text-slate-600"><Icon name={lesson.teachingMode === 'ONLINE' ? 'monitor' : 'pin'} className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{lesson.teachingMode === 'ONLINE' ? 'Online' : `Physical${lesson.location ? ` · ${lesson.location}` : ''}`}</span></span>
            <StatusPill status={lesson.status || 'CONFIRMED'} />
          </div>
          <button type="button" onClick={() => onView(lesson)} className="btn-outline mt-3 w-full">View Lesson Details <Icon name="arrow-right" className="h-4 w-4" /></button>
        </article>)}
      </div>
    </>}
  </SectionCard>
}
