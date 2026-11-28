import { attendanceLabels, refundHoldLabels } from '../../lib/attendanceReview'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, LoadError, Modal, PageTitle, Spinner } from '../../components/ui/Common'
import { ComplaintPill } from '../parent/Complaints'
import { fmtDate, fmtShortDate, fmtTime } from '../../lib/format'
import ComplaintsReport from '../../components/ComplaintsReport'
import WarnUser from '../../components/WarnUser'
import { fmtTimeRange, money } from '../../lib/format'
import { recordRef } from '../../lib/recordRef'
import Pagination from '../../components/ui/Pagination'

const TABS = [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In Progress'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']]

// Admin: review complaints (OPEN -> IN_PROGRESS -> RESOLVED / DISMISSED) and reply to the parent
export default function AdminComplaints() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const page = params.get('page') || '1'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const request = useRef(0)
  const [sel, setSel] = useState(null)
  // Bumped after every status change so the report above recounts
  const [reportVersion, setReportVersion] = useState(0)

  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    const current = ++request.current
    setLoadError('')
    setLoading(true)
    return api.get('/admin/complaints', { params: { status, page, pageSize: 20 } })
      .then(r => { if (current === request.current) setData(r.data) })
      .catch(e => { if (current === request.current) setLoadError(errorMessage(e)) })
      .finally(() => { if (current === request.current) setLoading(false) })
  }, [status, page])
  useEffect(() => { load(); return () => { ++request.current } }, [load])

  function setFilter(key, value) {
    const next = new URLSearchParams(params)
    if (key !== 'page') next.delete('page')
    if (value) next.set(key, String(value))
    else next.delete(key)
    setParams(next)
  }

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div>
      <PageTitle title="Complaints & Reports" subtitle="Review complaints and missed check-in requests." />
      <ComplaintsReport refreshKey={reportVersion} />
      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        {TABS.map(([v, l]) => (
          <button key={l} aria-pressed={status === v} onClick={() => setFilter('status', v)} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${status === v ? 'border-brand-500 bg-brand-500 text-white' : 'border-brand-200 bg-white text-navy hover:border-brand-500'}`}>
            {l}{data && ` (${v ? data.counts[v] : total})`}
          </button>))}
      </div>

      {loading ? <Spinner /> : loadError ? <LoadError message={loadError} onRetry={load} /> : !data ? null : data.complaints.length === 0 ? (
        <div className="card"><EmptyState icon="shield" title="No complaints here">Nothing to review in this list.</EmptyState></div>
      ) : (
        <div className="space-y-3">
          {data.complaints.map((c) => (
            <article key={c.id} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1 basis-[260px] break-words">
                <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-extrabold text-navy">{c.category}</h2><ComplaintPill status={c.status} /></div>
                <div className="mt-0.5 text-xs text-slate-500">
                  From {c.filedBy.name} ({c.filedBy.email}) · {fmtShortDate(c.createdAt)}
                  {c.against && <> · Against {c.against.name}</>}
                  {c.booking && <> · {c.booking.subject} lesson on {fmtDate(c.booking.startAt)}</>}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.description}</p>
              </div>
              <button onClick={() => setSel(c)} className="btn-outline px-5">{['OPEN', 'IN_PROGRESS'].includes(c.status) ? 'Review' : 'View'} <Icon name="arrow-right" className="h-4 w-4" /></button>
            </article>))}
        </div>
      )}
      {!loading && !loadError && data?.pagination && <div className="mt-4 space-y-3">
        <p role="status" className="text-center text-sm text-slate-600">{data.pagination.total} complaint{data.pagination.total === 1 ? '' : 's'} · Page {data.pagination.page} of {data.pagination.totalPages}</p>
        <Pagination {...data.pagination} onChange={value => setFilter('page', value)} label="Complaint pages" />
      </div>}

      <ReviewModal complaint={sel} onClose={() => setSel(null)} onReviewChanged={load} onDone={() => { setSel(null); load(); setReportVersion((v) => v + 1) }} />
    </div>
  )
}

function ReviewModal({ complaint: c, onClose, onDone, onReviewChanged }) {
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [inv, setInv] = useState(null) // what the Admin needs to investigate: booking, payment, attendance, history
  const investigationRequest = useRef(0)
  const [review, setReview] = useState(null)
  const loadInvestigation = useCallback(() => {
    if (!c) return
    const current = ++investigationRequest.current
    setError('')
    setInv(null)
    return api.get(`/admin/complaints/${recordRef(c)}`)
      .then(r => { if (current === investigationRequest.current) { setInv(r.data.investigation); if (r.data.complaint?.review) setReview(r.data.complaint.review) } })
      .catch(e => { if (current === investigationRequest.current) setError(errorMessage(e)) })
  }, [c])
  useEffect(() => {
    setResponse(c?.adminResponse || ''); setReview(c?.review || null); setError(''); setInv(null); loadInvestigation()
    return () => { ++investigationRequest.current }
  }, [c, loadInvestigation])
  if (!c) return null
  const attendance = c.category === 'Missed check-in'
  const evidence = inv?.attendanceReview
  const closed = ['RESOLVED', 'DISMISSED'].includes(c.status)

  async function act(status, outcome) {
    setError('')
    // The parent reads this response, so a closed complaint always says what was done or why
    if (outcome === 'MORE_INFO' && !response.trim()) return setError('Write your question for the tutor and parent.')
    if (status !== 'IN_PROGRESS' && response.trim().length < 3) return setError('Write a response to the parent before resolving or dismissing.')
    setBusy(true)
    try {
      await api.patch(`/admin/complaints/${recordRef(c)}`, { status, ...(outcome && { outcome }), adminResponse: response || undefined, ...(attendance && evidence && { reviewedAt: evidence.reviewedAt }) })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function openAttendanceReview() {
    setBusy(true); setError('')
    try { await api.post(`/admin/complaints/${recordRef(c)}/attendance-review`); onDone() }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={c.category} width="max-w-2xl">
      <div className="space-y-3">
        <ComplaintPill status={c.status} />
        <div className="rounded-xl bg-brand-25 p-3 text-sm">
          <div className="mb-1 text-xs text-slate-500">From {c.filedBy.name} · {fmtShortDate(c.createdAt)}{c.against && ` · Against ${c.against.name}`}</div>
          <p className="text-slate-700">{c.description}</p>
        </div>
        {attendance && evidence && <section className="space-y-2">
          <h3 className="font-bold">Attendance evidence</h3>
          {evidence.attendanceRefundState && <p>{refundHoldLabels[evidence.attendanceRefundState]}</p>}
          {evidence.outcome && <p>{attendanceLabels[evidence.outcome]}</p>}
          {evidence.appealUntil && <p>Reconsideration available until {fmtDate(evidence.appealUntil)}.</p>}
          {evidence.penaltyAmount && <p>Attendance penalty: {money(evidence.penaltyAmount)}. {evidence.penaltyEffectiveAt ? `Effective ${fmtDate(evidence.penaltyEffectiveAt)} if the decision remains final.` : 'Paused during reconsideration.'}</p>}
          {evidence.tutorReplyPending && <p>{evidence.waiting?.tutor === false ? 'Tutor response period ended. Admin can decide using the available evidence.' : `Waiting for the tutor to reply${evidence.tutorResponseDueAt ? ` until ${fmtDate(evidence.tutorResponseDueAt)}, ${fmtTime(evidence.tutorResponseDueAt)} (Malaysia time)` : ''}.`}</p>}
          {!!evidence.history?.length && <ol className="space-y-2">{evidence.history.map(entry => <li key={entry.id} className="break-words">
            <strong>{attendanceLabels[entry.action]}</strong> · {fmtShortDate(entry.createdAt)} · {entry.message}
            {entry.evidenceUrl && <a href={entry.evidenceUrl} target="_blank" rel="noreferrer" className="ml-2 underline">View supporting evidence</a>}
          </li>)}</ol>}
          {evidence.proof ? <a className="btn-outline" href={evidence.proof} target="_blank" rel="noreferrer">View tutor proof</a> : <p>No proof attached.</p>}
          <p>Parent response: {{ YES: 'The lesson took place', NO: 'The lesson did not take place', UNSURE: 'Unsure' }[evidence.parentAnswer] || 'Awaiting response'}</p>
          {!evidence.parentAnswer && <p>{evidence.waiting?.parent === false ? 'Parent response period ended. Admin can decide using the available evidence.' : evidence.parentResponseDueAt ? `Parent response due ${fmtDate(evidence.parentResponseDueAt)}, ${fmtTime(evidence.parentResponseDueAt)} (Malaysia time).` : ''}</p>}
          {evidence.parentNote && <p className="break-words">{evidence.parentNote}</p>}
          {!closed && <button className="btn-outline" onClick={loadInvestigation}>Refresh evidence</button>}
        </section>}
        <Investigation inv={inv} />
        {inv?.quiz && <QuizModeration quiz={inv.quiz} onRefresh={loadInvestigation} />}
        {review && <ReviewModeration review={review} onRefresh={loadInvestigation} onChanged={(updated) => { setReview((previous) => ({ ...previous, ...updated })); onReviewChanged() }} />}
        {c.against && !closed && <WarnUser userId={c.against.id} name={c.against.name} complaintId={c.id} onDone={loadInvestigation} />}
        <ErrorBox>{error}</ErrorBox>
        <label className="block text-sm font-bold text-navy">{attendance ? 'Response to the tutor and parent' : 'Response to the parent'} {closed ? '' : <span className="font-normal text-slate-500">(required to resolve or dismiss)</span>}
          <textarea rows={4} maxLength={1000} disabled={closed} className="input mt-1.5 resize-none disabled:bg-slate-50" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Explain what was done or why the complaint is closed." />
        </label>
        {!closed && (
          <div className="flex flex-wrap justify-end gap-2">
            {c.status === 'OPEN' && <button disabled={busy} onClick={() => act('IN_PROGRESS')} className="btn-outline">Mark In Progress</button>}
            {c.category === 'No-show or lateness' && c.booking && <button disabled={busy} onClick={openAttendanceReview} className="btn-outline">Open attendance review</button>}
            {attendance && <>
              <button disabled={busy || !evidence} onClick={() => act('IN_PROGRESS', 'MORE_INFO')} className="btn-outline">Ask for more information</button>
              <button disabled={busy || !evidence || (evidence.waiting ? evidence.waiting.parent || evidence.waiting.tutor : !evidence.parentAnswer || evidence.tutorReplyPending)} onClick={() => act('DISMISSED', 'NOT_HELD')} className="btn-danger">Mark lesson as not held</button>
            </>}
            <button disabled={busy || (attendance && (!evidence || (evidence.waiting ? evidence.waiting.parent || evidence.waiting.tutor : !evidence.parentAnswer || evidence.tutorReplyPending)))} onClick={() => act('DISMISSED', attendance ? 'UNVERIFIED' : undefined)} className="btn-danger">{attendance ? 'Mark attendance as unverified' : 'Dismiss'}</button>
            <button disabled={busy || (attendance && (!evidence || (evidence.waiting ? evidence.waiting.parent || evidence.waiting.tutor : !evidence.parentAnswer || evidence.tutorReplyPending)))} onClick={() => act('RESOLVED')} className="btn-primary">{attendance ? 'Approve attendance' : 'Resolve'}</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function QuizModeration({ quiz, onRefresh }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function moderate() {
    setBusy(true); setError('')
    try { await api.patch(`/admin/quizzes/${quiz.id}/moderation`, { isHidden: !quiz.isHidden, expectedHidden: quiz.isHidden, reason: reason.trim() }); setReason(''); await onRefresh() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <section aria-label="Quiz moderation" className="space-y-3 rounded-xl border border-brand-100 p-3 text-sm"><h3 className="font-bold text-navy">Reported quiz · {quiz.title}</h3><p>{quiz.isHidden ? 'Hidden from parents.' : 'Visible to parents.'} Review the content before deciding.</p>{quiz.moderationReason && <p>Previous decision: {quiz.moderationReason}</p>}<ol className="list-inside list-decimal space-y-2">{quiz.questions.map((q, i) => <li key={i} className="break-words">{q.text}{q.options?.length > 0 && <span className="block pl-4 text-slate-600">{q.options.join(' · ')}</span>}{q.imageUrl && <a className="ml-2 underline" href={q.imageUrl} target="_blank" rel="noreferrer">View question image</a>}</li>)}</ol><label className="block font-semibold">Reason for decision<textarea className="input mt-1 text-base" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><ErrorBox>{error}</ErrorBox><button type="button" className={quiz.isHidden ? 'btn-outline min-h-11' : 'btn-danger min-h-11'} disabled={busy || reason.trim().length < 3} onClick={moderate}>{quiz.isHidden ? 'Restore quiz' : 'Hide quiz'}</button></section>
}

function ReviewModeration({ review, onChanged, onRefresh }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function moderate() {
    setError('')
    if (reason.trim().length < 3) return setError('Explain the moderation decision (at least 3 characters).')
    setBusy(true)
    try {
      const result = await api.patch(`/admin/reviews/${review.id}/moderation`, { isHidden: !review.isHidden, expectedHidden: review.isHidden, reason: reason.trim() })
      onChanged(result.data.review)
      setReason('')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <section aria-label="Review moderation" className="space-y-2 rounded-xl border border-brand-100 p-3 text-sm">
    <h3 className="font-bold text-navy">Reported review · {review.rating}/5 stars</h3>
    <p className="break-words whitespace-pre-wrap text-slate-700">{review.comment || 'No written comment.'}</p>
    {review.photoUrl && <a href={review.photoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center font-semibold text-brand-600 underline">View review photo</a>}
    <p className="text-slate-600">{review.isHidden ? 'Hidden from public profiles and rating totals.' : 'Visible on the tutor profile.'} Honest negative feedback is allowed. Hide content for a policy violation, not because of a low rating.</p>
    {review.moderationReason && <p className="text-xs text-slate-500">Previous decision: {review.moderationReason}</p>}
    <label className="block font-semibold text-navy">Reason for this decision<textarea rows={2} maxLength={500} className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <ErrorBox>{error}</ErrorBox>
    {error && <button onClick={onRefresh} className="min-h-10 font-semibold text-brand-600 underline">Refresh review</button>}
    <button disabled={busy} onClick={moderate} className={review.isHidden ? 'btn-outline' : 'btn-danger'}>{busy ? 'Saving…' : review.isHidden ? 'Restore review' : 'Hide review'}</button>
    <p className="text-xs text-slate-500">The author is notified. This does not close the complaint; write your response and resolve or dismiss it separately.</p>
  </section>
}

// The facts around a complaint: the lesson, whether it was paid, whether the tutor checked in, and the account's record
function Investigation({ inv }) {
  if (!inv) return <p className="text-sm text-slate-500">Loading the related lesson, payment and history…</p>
  const { booking: b, payment: p, attendance: a, sessionSummary: s, otherComplaints, warnings } = inv
  const line = (label, value) => <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold text-navy">{value}</dd></div>
  return (
    <section className="space-y-3 rounded-xl border border-slate-100 p-3 text-sm" aria-label="Investigation">
      <h3 className="font-bold text-navy">Investigation</h3>
      {!b ? <p className="text-slate-500">This complaint is not linked to a lesson.</p> : (
        <dl className="divide-y divide-slate-50">
          {line('Lesson', `${b.subject} for ${b.child} (${b.status.toLowerCase().replace('_', ' ')})`)}
          {line('When', `${fmtDate(b.startAt)}, ${fmtTimeRange(b.startAt, b.endAt)} · ${b.teachingMode === 'ONLINE' ? 'Online' : 'Physical'}`)}
          {b.cancelReason && line('Cancel reason', b.cancelReason)}
          {line('Payment', p ? `${money(p.amount)} · ${p.status.toLowerCase().replace('_', ' ')}${p.method ? ` (${p.method})` : ''}` : 'No payment')}
          {p?.refunds.map((r) => <div key={r.id}>{line('Refund', `${money(r.amount)} · ${r.status.toLowerCase()} (${r.type === 'AUTO' ? 'automatic' : 'Admin review'})`)}</div>)}
          {line('Attendance', a?.checkInAt ? `Checked in ${fmtDate(a.checkInAt)}${a.distanceMetres != null ? ` · ${Math.round(a.distanceMetres)} m from the address` : ''}${a.checkOutAt ? ', checked out' : ''}` : b.teachingMode === 'ONLINE' ? 'Not tracked for online lessons' : 'No check-in recorded')}
          {s && line('Lesson summary', s.content)}
        </dl>
      )}
      {a?.photoUrl && /^https?:\/\//i.test(a.photoUrl) && <a href={a.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"><Icon name="file" className="h-3.5 w-3.5" /> View the check-in photo</a>}
      <div>
        <h4 className="font-semibold text-navy">Record of this account</h4>
        {otherComplaints.length === 0 && warnings.length === 0 ? <p className="text-slate-500">No other complaints or warnings.</p> : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
            {otherComplaints.map((o) => <li key={o.id}>Complaint: {o.category} ({o.status.toLowerCase().replace('_', ' ')}), {fmtShortDate(o.createdAt)}</li>)}
            {warnings.map((w) => <li key={w.id}>Warning: {w.reason} ({fmtShortDate(w.createdAt)})</li>)}
          </ul>
        )}
      </div>
    </section>
  )
}
