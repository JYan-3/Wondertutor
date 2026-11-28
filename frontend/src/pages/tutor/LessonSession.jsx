import { attendanceLabels, refundHoldLabels } from '../../lib/attendanceReview'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { uploadImage, uploadError } from '../../components/PhotoPicker'
import TutorPageHeader from '../../components/TutorPageHeader'
import { ErrorBox, LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { fmtDate, fmtTime, fmtTimeRange, money } from '../../lib/format'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'
import { hasConfirmedLessonLocation } from '../../lib/lessonLocation'

function readLocation() {
  return new Promise((resolve, reject) => {
    if (window.isSecureContext === false) return reject(new Error('Location requires HTTPS. Open the secure WonderTutor website, then try again.'))
    if (!navigator.geolocation) return reject(new Error('Location is unavailable. On a phone, open WonderTutor using HTTPS and enable location access.'))
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 90 || !Number.isFinite(coords.longitude) || Math.abs(coords.longitude) > 180) return reject(new Error('Your device returned an invalid location. Please try again.'))
      resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy })
    }, err => reject(new Error(err.code === 1 ? 'Allow location access for WonderTutor in your browser and phone settings, then try again.' : err.code === 3 ? 'Location took too long. Move near a window or outdoors and try again with precise location enabled.' : 'Could not get your location. Turn on your phone location services and try again near the lesson address.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  })
}

function distanceFrom(point, s) {
  if (!point || s.latitude == null || s.longitude == null) return null
  const rad = n => n * Math.PI / 180
  const a = Math.sin(rad(point.lat - s.latitude) / 2) ** 2 +
    Math.cos(rad(s.latitude)) * Math.cos(rad(point.lat)) * Math.sin(rad(point.lng - s.longitude) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

function SessionForm({ session: s, setSession }) {
  const [point, setPoint] = useState(null)
  const [locating, setLocating] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [now, setNow] = useState(() => Date.parse(s.serverTime))
  const [proof, setProof] = useState(null)
  const [reason, setReason] = useState('')
  const [content, setContent] = useState('')
  const [progress, setProgress] = useState('')
  const [plan, setPlan] = useState('')
  const [homework, setHomework] = useState('')
  useEffect(() => {
    const started = performance.now()
    const tick = () => setNow(Date.parse(s.serverTime) + performance.now() - started)
    tick()
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [s.serverTime])
  const physical = s.mode === 'PHYSICAL'
  const locationReady = !physical || hasConfirmedLessonLocation(s)
  const active = s.status === 'CONFIRMED' && !needsRefresh
  const ended = now >= Date.parse(s.endAt)
  const checkInOpens = Date.parse(s.startAt) - 10 * 60_000
  const checkInCloses = Math.min(Date.parse(s.startAt) + 15 * 60_000, Date.parse(s.endAt))
  const checkInOpen = now >= checkInOpens && now < checkInCloses
  const attendance = s.attendance
  const awaitingVenue = physical && !locationReady && s.status === 'CONFIRMED' && !ended && !attendance?.checkInAt
  const distance = locationReady ? distanceFrom(point, s) : null
  const within = distance != null && distance <= s.radius
  const entry = active && locationReady && checkInOpen && !attendance?.checkInAt
  const exit = active && ended && attendance?.checkInAt && !attendance.checkOutAt
  const reportReady = active && ended && (attendance?.checkOutAt || s.review?.attendanceApproved) && !s.report
  const path = '/tutor/bookings/' + recordRef(s) + '/session'

  function updateSession(data) {
    if (data.latitude !== s.latitude || data.longitude !== s.longitude || data.locationConfirmedAt !== s.locationConfirmedAt) {
      setPoint(null)
      setPhoto(null)
    }
    setSession(data)
  }

  async function run(task) {
    setBusy(true)
    setError('')
    try { await task() } catch (err) {
      setError(errorMessage(err))
      setNeedsRefresh((current) => current || err.response?.status === 409)
    }
    finally { setBusy(false) }
  }
  async function locate() {
    setPoint(null)
    setLocating(true)
    try {
      const current = await readLocation()
      setPoint(current)
      return current
    } finally { setLocating(false) }
  }
  async function send(fields) {
    const { data } = await api.post(path, fields)
    updateSession(data)
  }
  async function checkIn() {
    if (!physical) return send({ action: 'check-in' })
    if (!locationReady) throw new Error('The parent must confirm the full lesson address and entrance pin before check-in.')
    // Reacquire GPS at submission in case the tutor moved after the distance check.
    const fresh = await locate()
    await send({ action: 'check-in', coords: { lat: fresh.lat, lng: fresh.lng }, photo })
  }
  async function takePhoto(file) {
    setPhoto(null)
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG or PNG photo up to 5 MB.')
    try { setPhoto(await uploadImage(file, 'attendance', s.id)) } catch (e) { throw new Error(uploadError(e)) }
  }
  const reconsider = active && s.review?.status === 'DISMISSED' && !s.review?.appealUsed && (!s.review?.appealUntil || Date.parse(s.review.appealUntil) > now)
  const replyRequested = active && s.review?.tutorReplyPending
  const proofField = <label className="block font-semibold">Supporting photo or document (optional)
    <input type="file" accept="image/jpeg,image/png,application/pdf" className="input mt-1 w-full text-base" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      setProof(null)
      run(async () => {
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or PDF up to 5 MB.')
        const receipt = await uploadImage(file, 'attendance-proof', s.id)
        if (s.review && !reconsider && !replyRequested) await send({ action: 'attach-proof', photo: receipt })
        else setProof(receipt)
      })
    }} />
  </label>
  return <div className="min-w-0 space-y-4">
    <Link to={'/tutor/bookings?booking=' + recordRef(s)} className="btn-outline min-h-11">Back to my bookings</Link>
    <TutorPageHeader title={s.subject + ' · ' + s.student} subtitle={fmtDate(s.startAt) + ' · ' + fmtTimeRange(s.startAt, s.endAt) + ' (Malaysia time) · ' + (physical ? locationReady ? s.address : awaitingVenue ? 'Physical lesson · exact address awaiting confirmation' : 'Physical lesson · exact address not recorded' : 'Online lesson')} />
    {physical && (locationReady
      ? <div className="min-w-0 rounded-xl bg-brand-25 p-3"><p className="break-words font-semibold text-navy">Lesson address: {s.address}</p><p className="mt-1 text-sm text-slate-600">The pin marks the entrance confirmed by the parent. Your location check does not move it.</p>
          <iframe title="Confirmed lesson venue on OpenStreetMap" className="mt-3 h-64 w-full min-w-0 rounded-lg border border-brand-100 sm:h-80" loading="lazy" referrerPolicy="strict-origin"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent([Math.max(-180, s.longitude - 0.004), Math.max(-90, s.latitude - 0.003), Math.min(180, s.longitude + 0.004), Math.min(90, s.latitude + 0.003)].join(','))}&layer=mapnik&marker=${encodeURIComponent(`${s.latitude},${s.longitude}`)}`} />
          <a href={`https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=17/${s.latitude}/${s.longitude}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand-600 hover:underline">View lesson map</a>
          <p className="text-sm text-slate-600">If the map does not load, use the link above. You can still check your location below.</p></div>
      : <p role={awaitingVenue ? 'alert' : 'status'} className="rounded-xl bg-amber-50 p-3 text-amber-900">{awaitingVenue
        ? 'The precise lesson address has not been confirmed. Ask the parent to confirm the full address and entrance pin in My Bookings, then refresh this session. An area centre cannot be used for GPS check-in.'
        : 'The exact lesson address was not recorded for this lesson. Existing attendance and session reports are kept. The old area centre is not a confirmed GPS attendance point.'}</p>)}
    {error && <div role="alert"><ErrorBox>{error}</ErrorBox></div>}
    {(needsRefresh || awaitingVenue) && <button className="btn-outline min-h-11" disabled={busy} onClick={() => run(async () => {
      const { data } = await api.get(path)
      updateSession(data)
      setNeedsRefresh(false)
    })}>Refresh session</button>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <SectionCard title="Check in" icon="calendar">
          {attendance?.checkInAt ? <p>Checked in at {fmtTime(attendance.checkInAt)}.</p> : s.review ? <div role="status" className="space-y-2 break-words">
            <p>Missed check-in review · {{ OPEN: 'Submitted', IN_PROGRESS: 'Under review', RESOLVED: 'Resolved', DISMISSED: 'Dismissed' }[s.review.status]}</p>
            {s.review.attendanceRefund?.attendanceRefundState ? <p>{refundHoldLabels[s.review.attendanceRefund.attendanceRefundState]}</p> : s.review.attendanceRefund && <p>Refund review: {{ PENDING: 'Awaiting admin decision', ESCALATED: 'Escalated', APPROVED: 'Approved', REJECTED: 'Declined' }[s.review.attendanceRefund.status]}</p>}
            {s.review.attendanceApproved && <p>Attendance confirmed by admin. {s.report ? 'Report submitted.' : 'You can submit your lesson report below.'}</p>}
            {s.review.hasEvidence && <p>Supporting evidence submitted. Admin can view it during the review.</p>}
            {s.review.attendanceOutcome && !s.review.attendanceApproved && <p>{attendanceLabels[s.review.attendanceOutcome]}</p>}
            {s.review.appealUntil && reconsider && <p>Request reconsideration by {fmtDate(s.review.appealUntil)}, {fmtTime(s.review.appealUntil)} (Malaysia time).</p>}
            {s.review.penaltyAmount && <p>{s.review.penaltyEffectiveAt && Date.parse(s.review.penaltyEffectiveAt) <= now ? 'Final attendance penalty' : 'Potential attendance penalty'}: {money(s.review.penaltyAmount)}. It is deducted only after the decision is final.</p>}
            {['OPEN', 'IN_PROGRESS'].includes(s.review.status) && !replyRequested && proofField}
            {!!s.review.reviewHistory?.length && <details><summary>Review history</summary>
              <ul>{s.review.reviewHistory.map((entry, i) => <li key={i}>{attendanceLabels[entry.action]} · {entry.message}</li>)}</ul>
            </details>}
            {(reconsider || replyRequested) && <form className="space-y-2" onSubmit={e => {
              e.preventDefault()
              run(async () => {
                await send({ action: reconsider ? 'reconsider' : 'review-reply', reason: reason.trim(), ...(proof && { photo: proof }) })
                setReason('')
                setProof(null)
              })
            }}>
              <label className="block">{reconsider ? 'Describe your new evidence' : 'Reply to the admin question'}
                <textarea required maxLength={1000} value={reason} className="input w-full" onChange={e => setReason(e.target.value)} />
              </label>
              {proofField}
              {proof && <p>Proof ready to submit.</p>}
              <button disabled={busy || !reason.trim()} className="btn-primary min-h-11">{reconsider ? 'Request reconsideration' : 'Send reply to admin'}</button>
            </form>}
            <p>Your explanation: {s.review.description}</p>
            {s.review.adminResponse && <p>Admin response: {s.review.adminResponse}</p>}
          </div> : now >= checkInCloses && s.status === 'CONFIRMED' ? <form className="space-y-3" onSubmit={e => {
            e.preventDefault()
            run(() => send({ action: 'request-review', reason: reason.trim(), ...(proof && { photo: proof }) }))
          }}>
            <p>The check-in window has closed. You can ask an admin to review what happened.</p>
            <label className="block font-semibold">Why did you miss check-in?
              <textarea required maxLength={1000} className="input mt-1 min-h-20 w-full text-base" value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            {proofField}
            {proof && <p role="status">Proof ready to submit.</p>}
            <button className="btn-primary min-h-11" disabled={!reason.trim() || busy || !active}>Request admin review</button>
          </form> : <div className="space-y-3">
            {physical ? <>
              <p>Check in within <b>{s.radius} metres</b> of the lesson address and add a photo for the attendance record.</p>
              <button disabled={!active || !locationReady || ended || busy} className="btn-outline min-h-11 w-full sm:w-auto" onClick={() => run(async () => {
                  const { data } = await api.get(path)
                  updateSession(data)
                  if (!hasConfirmedLessonLocation(data)) throw new Error('The parent must confirm the exact lesson address before you can check your location.')
                  await locate()
                })}>{locating ? 'Finding your location…' : point ? 'Refresh my location' : 'Check my location'}</button>
              <p className="text-sm text-slate-600">On your phone, allow precise location for this website. Checking your distance does not check you in.</p>
              {point && distance != null && <p role="status">{within ? 'Within range' : 'Outside the check-in area'} · {Math.round(distance)} m from the address · GPS accuracy ±{Math.round(point.accuracy)} m</p>}
              {point && (!Number.isFinite(point.accuracy) || point.accuracy > s.radius) && <p role="status" className="text-sm text-amber-800">Your location estimate is imprecise. Move near a window or outdoors and refresh your location.</p>}
              <label className="block font-semibold">Check-in photo
                <input className="input mt-1 min-h-11 w-full min-w-0 text-base" type="file" accept="image/jpeg,image/png" capture="environment" disabled={!entry || busy}
                  onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; run(() => takePhoto(file)) }} />
              </label>
              {photo && <p role="status">Photo ready for check-in.</p>}
            </> : <p>Check in from 10 minutes before until 15 minutes after the lesson starts.</p>}
            {now < checkInOpens && <p>Check-in opens at {fmtTime(checkInOpens)} on {fmtDate(checkInOpens)}.</p>}
            {ended && <p>The scheduled lesson has ended.</p>}
            <button className="btn-primary min-h-11 w-full sm:w-auto" disabled={!entry || busy || (physical && !(within && photo))} onClick={() => run(checkIn)}>Check in</button>
          </div>}
        </SectionCard>
        <SectionCard title="Check out" icon="clock">
          {attendance?.checkOutAt ? <p>Checked out at {fmtTime(attendance.checkOutAt)}.</p> : <>
            <p className="mb-3">After checking in, you can check out from {fmtTime(s.endAt)} on {fmtDate(s.endAt)}.</p>
            <button className="btn-outline min-h-11 w-full sm:w-auto" disabled={!exit || busy} onClick={() => run(() => send({ action: 'check-out' }))}>Check out</button>
          </>}
        </SectionCard>
        <SectionCard title="Session summary and progress report" icon="file">
          {s.report ? <dl className="space-y-3">{[['What was covered', s.report.content], ['Student progress', s.report.progressNote], ['Homework / follow-up', s.report.homework], ['Plan for next session', s.report.recommendations]].filter(([,v]) => v).map(([k,v]) =>
            <div key={k}><dt className="font-bold">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>)}</dl> :
            <form onSubmit={e => { e.preventDefault(); run(() => send({ action: 'report', content, progressNote: progress, recommendations: plan, ...(homework.trim() && { homework: homework.trim() }) })) }}>
              <fieldset disabled={!reportReady || busy} className="min-w-0 space-y-3">
                {[[ 'What was covered', content, setContent, true ], [ 'Student progress', progress, setProgress, true ], [ 'Homework / follow-up (optional)', homework, setHomework, false ], [ 'Plan for next session (optional)', plan, setPlan, false ]].map(([label, value, setter, required]) =>
                  <label key={label} className="block text-sm font-semibold">{label}<textarea className="input mt-1 min-h-20 w-full text-base" maxLength={5000} required={required} value={value} onChange={e => setter(e.target.value)} /></label>)}
                <button disabled={!content.trim() || !progress.trim()} className="btn-primary min-h-11 w-full sm:w-auto">Submit report and complete session</button>
              </fieldset>
              {!reportReady && <p className="mt-2 text-sm text-slate-600">Check out to write the report.</p>}
            </form>}
        </SectionCard>
      </div>
      <SectionCard title="Attendance record" icon="clock">
        <dl className="space-y-2 text-sm">{[['Check-in', attendance?.checkInAt && fmtTime(attendance.checkInAt)], ...(physical ? [['Distance', attendance?.distance != null && Math.round(attendance.distance) + ' m']] : []),
          ['Check-out', attendance?.checkOutAt && fmtTime(attendance.checkOutAt)], ['Report', s.report ? 'Submitted' : 'Pending']].map(([k,v]) =>
          <div className="flex justify-between gap-3" key={k}><dt>{k}</dt><dd className="font-bold">{v || 'Not yet'}</dd></div>)}</dl>
        {attendance?.photo && <img src={attendance.photo} className="mt-3 max-h-48 max-w-full rounded-lg" alt="Lesson check-in photo" />}
      </SectionCard>
    </div>
  </div>
}

export default function LessonSession() {
  const { id } = useParams()
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setSession(null)
    api.get('/tutor/bookings/' + id + '/session', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setSession(data) })
      .catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)) })
    return () => controller.abort()
  }, [id, attempt])
  if (error) return <LoadError message={error} onRetry={() => { setError(''); setAttempt(n => n + 1) }} />
  return matchesRecordRef(session, id) ? <SessionForm key={id} session={session} setSession={setSession} /> : <Spinner />
}
