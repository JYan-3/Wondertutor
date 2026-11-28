import { useState } from 'react'
import api from '../../api/client'
import { ErrorBox, PageTitle, SectionCard } from '../../components/ui/Common'
import { Records, Rows, DecisionForm, Note } from '../../components/ui/AdminRecords'
import { useRecords, exportRows } from '../../lib/adminRecords'
import { fmtDate, fmtTime, money } from '../../lib/format'
import Pagination from '../../components/ui/Pagination'

const when = d => fmtDate(d) + ' · ' + fmtTime(d)
const columns = [['Booking', b => '#' + b.id], ['Parent', b => b.parent], ['Tutor', b => b.tutor], ['Subject', b => b.subject],
  ['Session', b => when(b.startAt)], ['Status', b => b.status], ['Hourly rate', b => money(b.agreed ?? b.counter ?? b.offered)]]

function Decision({ booking: b, issue, done }) {
  const [action,setAction] = useState('keep')
  return <details className="rounded-xl border border-brand-100 p-3">
    <summary className="cursor-pointer py-2 font-semibold">{issue.kind} · #{b.id} · {b.parent} and {b.tutor}</summary>
    <div className="my-3 space-y-1"><p>{b.subject} · {when(b.startAt)} · {b.status}</p><p>{issue.reason}</p>
      {issue.proposed && <p>Proposed time: {when(issue.proposed)}</p>}
      {issue.kind === 'Fee negotiation' && <p>Parent offered {money(b.offered)} / hour{b.counter && ' · Tutor offered ' + money(b.counter) + ' / hour'}</p>}</div>
    <DecisionForm label="Record final decision" done={done} submit={f => api.post('/admin/bookings/' + b.id + '/decision', {
      kind: issue.kind, caseId: issue.id, version: b.version, action, reason: f.reason, ...(action === 'set-fee' && { price: Number(f.price) }),
    })}>
      <label className="block">Decision<select className="input min-h-11 text-base" value={action} onChange={e => setAction(e.target.value)}>
        <option value="keep">{issue.kind === 'Schedule change' && b.cancellationChoiceStatus === 'RESCHEDULING' ? 'Decline new time and send refund for review' : 'Keep current booking and close case'}</option>
        {issue.kind === 'Schedule change' ? <option value="move">Approve proposed time</option> : <>
          {issue.kind === 'Fee negotiation' && <option value="set-fee">Set final hourly fee</option>}
          {b.status !== 'CANCELLED' && <option value="cancel">Cancel booking</option>}</>}
      </select></label>
      {action === 'set-fee' && <label>Hourly fee (RM)<input required name="price" type="number" step="0.01" min="0.01" max="1000" className="input text-base" /></label>}
      <Note label="Decision and reason for both parties" />
    </DecisionForm>
  </details>
}
export default function BookingOversight() {
  const [q,setQ] = useState(''), [status,setStatus] = useState(''), [notice,setNotice] = useState('')
  const [page, setPage] = useState(1), [issuePage, setIssuePage] = useState(1), [exportError, setExportError] = useState(''), [exporting, setExporting] = useState(false)
  const params = new URLSearchParams({ view: 'all', page: String(page), ...(q.trim() && { q: q.trim() }), ...(status && { status }) })
  const source = useRecords('/admin/bookings?' + params)
  const issuesSource = useRecords('/admin/bookings?' + new URLSearchParams({ view: 'escalations', page: String(issuePage) }))
  async function exportAll() {
    setExporting(true); setExportError('')
    try {
      const query = new URLSearchParams({ view: 'all', export: '1', ...(q.trim() && { q: q.trim() }), ...(status && { status }) })
      const { data } = await api.get('/admin/bookings?' + query)
      exportRows('bookings', columns, data.rows)
    } catch { setExportError('Could not export bookings. Please try again.') } finally { setExporting(false) }
  }
  return <div className="space-y-4"><PageTitle title="Booking oversight" subtitle="Review bookings and resolve requests that need an admin decision." />
    {notice && <p role="status">{notice}</p>}
    <Records source={issuesSource}>{({ rows, pagination }) => {
      const issues = rows.flatMap(b => b.cases.map(issue => ({b,issue})))
      return <SectionCard title={'Escalated bookings waiting for a decision (' + (pagination?.total ?? issues.length) + ')'}><div className="space-y-2">{issues.length ? issues.map(({b,issue}) =>
        <Decision key={issue.kind + issue.id} booking={b} issue={issue} done={() => { setNotice('Decision recorded. Both parties have been notified.'); source.reload(); issuesSource.reload() }} />) : 'No escalations are waiting.'}</div>{pagination && <Pagination {...pagination} onChange={setIssuePage} label="Escalation pages" />}</SectionCard>
    }}</Records>
    <SectionCard title="All bookings"><div className="mb-4 flex flex-wrap items-end gap-2"><label>Search<input className="input text-base" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Booking, parent or tutor" /></label>
      <label>Status<select className="input min-h-11 text-base" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DISPUTED'].map(s => <option key={s}>{s}</option>)}</select></label>
      <button className="btn-outline min-h-11" disabled={exporting} onClick={exportAll}>{exporting ? 'Exporting…' : 'Export CSV'}</button></div>
      <ErrorBox>{exportError}</ErrorBox><Records source={source}>{({ rows, pagination }) => <><Rows columns={[...columns,['Student',b => b.student],['Mode',b => b.mode]]} rows={rows} />{pagination && <><p className="my-3 text-center text-sm">{pagination.total} bookings · Page {pagination.page} of {pagination.totalPages}</p><Pagination {...pagination} onChange={setPage} label="Booking pages" /></>}</>}</Records>
    </SectionCard></div>
}
