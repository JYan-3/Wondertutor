import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { LoadError, PageTitle, Spinner } from '../../components/ui/Common'

function waitingSince(date) {
  if (!date) return 'Nothing waiting'
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 86_400_000))
  return days === 0 ? 'Oldest: less than a day' : `Oldest: ${days} ${days === 1 ? 'day' : 'days'}`
}

// Admin home: the counts that need attention (user management + complaints). Yan Hsi adds finance/booking tiles.
export default function AdminDashboard() {
  const [d, setD] = useState(null)
  const [loadError, setLoadError] = useState('')
  const load = () => { setLoadError(''); api.get('/admin/dashboard').then((r) => setD(r.data)).catch((e) => setLoadError(errorMessage(e))) }
  useEffect(() => { load() }, [])
  if (!d) return loadError ? <LoadError message={loadError} onRetry={load} /> : <Spinner />

  const tiles = [
    ['user', d.parents, 'Parents', '/admin/users?role=PARENT', 'bg-brand-50', 'bg-brand-100 text-brand-500'],
    ['cap', d.tutors, 'Tutors', '/admin/users?role=TUTOR', 'bg-brand-50', 'bg-brand-100 text-brand-500'],
    ['shield', d.openComplaints, 'Open complaints', '/admin/complaints', 'bg-accent-50', 'bg-accent-100 text-accent-600'],
    ['award', d.pendingQuals, 'Qualifications to approve', '/admin/users?role=TUTOR&pending=1', 'bg-accent-50', 'bg-accent-100 text-accent-600'],
    ['info', d.flagged, 'Tutors below rating threshold', '/admin/users?role=TUTOR&flagged=1', 'bg-red-50', 'bg-red-100 text-red-500'],
    ['lock', d.deactivated, 'Deactivated accounts', '/admin/users?status=DEACTIVATED', 'bg-slate-50', 'bg-slate-200 text-slate-600'],
  ]
  return (
    <div>
      <PageTitle title="Admin Dashboard" subtitle="Things that need your attention." />
      <Link to="/admin/reports" className="btn-outline mb-4 min-h-11">View revenue and tutor performance reports</Link>
      {d.queues && <section className="mb-6" aria-labelledby="admin-queues-title">
        <h2 id="admin-queues-title" className="mb-3 text-xl font-bold text-navy">Action needed</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ['documents', 'Verification documents', 'Review documents', '/admin/users?role=TUTOR&pending=1'],
            ['scheduleChanges', 'Time-change disputes', 'Review requests', '/admin/bookings'],
            ['bookingDisputes', 'Booking disputes', 'Review cases', '/admin/bookings'],
            ['attendance', 'Missed check-in reviews', 'Review attendance', '/admin/complaints'],
            ['quizReports', 'Reported quizzes', 'Review reports', '/admin/complaints'],
            ['refundReview', 'Refunds awaiting review', 'Review refunds', '/admin/finance'],
            ['refundTransfer', 'Refunds awaiting transfer', 'Record transfers', '/admin/finance'],
            ['withdrawalReview', 'Withdrawals awaiting review', 'Review withdrawals', '/admin/finance'],
            ['withdrawalTransfer', 'Withdrawals awaiting transfer', 'Review transfers', '/admin/finance'],
          ].map(([key, label, action, link]) => <Link key={key} to={link} className="card flex min-h-24 min-w-0 items-center justify-between gap-3 p-4 hover:border-brand-400">
            <span className="min-w-0"><span className="block font-bold text-navy">{label}</span><span className="block text-sm text-slate-600">{waitingSince(d.queues[key]?.oldest)}</span><span className="text-sm font-semibold text-brand-600">{action} →</span></span>
            <strong className="text-2xl text-navy" aria-label={`${d.queues[key]?.count ?? 0} waiting`}>{d.queues[key]?.count ?? 0}</strong>
          </Link>)}
        </div>
      </section>}
      {d.jobs && <section className="card mb-6 p-4 sm:p-5" aria-labelledby="jobs-title">
        <h2 id="jobs-title" className="font-bold text-navy">Automatic tasks</h2>
        {!d.jobs.length ? <p className="mt-2 text-sm text-amber-800">No task runs recorded yet. Check that the scheduler is running.</p> : <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{d.jobs.map(job => {
          const stale = Date.now() - Date.parse(job.lastAttemptAt) > 15 * 60_000
          const failed = job.lastFailureAt && (!job.lastSuccessAt || Date.parse(job.lastFailureAt) > Date.parse(job.lastSuccessAt))
          return <li key={job.name} className="rounded-lg bg-brand-25 p-3 text-sm"><strong className="capitalize">{job.name}</strong><span className={'block ' + (stale || failed ? 'text-amber-800' : 'text-green-700')}>{stale ? 'No recent run — check scheduler' : failed ? 'Last run failed — check server logs' : 'Last run succeeded'}</span></li>
        })}</ul>}
        <p className="mt-2 text-xs text-slate-600">These results show recorded runs; check hosting logs if a task stops or fails.</p>
      </section>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(([icon, n, label, to, bg, tone]) => (
          <Link key={label} to={to} className={`flex items-center gap-4 rounded-2xl p-5 shadow-card transition hover:shadow-lg ${bg}`}>
            <span className={`flex h-14 w-14 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-7 w-7" /></span>
            <span className="flex-1"><span className="block text-3xl font-extrabold text-navy">{n}</span><span className="text-sm text-slate-600">{label}</span></span>
            <Icon name="right" className="h-5 w-5 text-slate-400" />
          </Link>
        ))}
      </div>
    </div>
  )
}
