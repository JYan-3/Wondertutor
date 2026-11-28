import { attendanceLabels, refundHoldLabels } from '../../lib/attendanceReview'
import { useState } from 'react'
import api from '../../api/client'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Records, Rows, DecisionForm, Note, Period } from '../../components/ui/AdminRecords'
import { useRecords, exportRows } from '../../lib/adminRecords'
import { fmtDate, money } from '../../lib/format'
import WithdrawalReviews from './WithdrawalReviews'

const transactionStatus = x => {
  if (x.type === 'Withdrawal') return x.settled ? 'Transfer recorded' : ({ PENDING: 'Requested — no transfer yet', APPROVED: 'Approved — awaiting transfer', REJECTED: 'Rejected — no transfer', ESCALATED: 'Review needed — no transfer yet' }[x.status] || x.status)
  if (x.type === 'Refund') return x.settled ? 'Refund transfer recorded' : ({ PENDING: 'Awaiting refund review', APPROVED: 'Approved — awaiting refund transfer', REJECTED: 'Rejected — no refund', ESCALATED: 'Refund review needed' }[x.status] || x.status)
  return x.status
}
const transactionAmount = x => ['Withdrawal', 'Refund'].includes(x.type) && !x.settled ? 'Requested: ' + money(Math.abs(Number(x.amount))) : money(x.amount)
const transactionColumns = [['Date', x => fmtDate(x.date)], ['Transaction', x => x.type + ' #' + x.id], ['Booking', x => x.bookingId ?? '—'],
  ['Tutor', x => x.tutor], ['Parent', x => x.parent || '—'], ['Status', transactionStatus], ['Amount', transactionAmount], ['Saved rate', x => x.rate == null ? '—' : Number(x.rate) + '%'],
  ['Commission', x => money(x.commission)], ['Tutor share', x => x.type === 'Withdrawal' && !x.settled ? '—' : money(x.tutorNet)]]

function Transactions() {
  const [period,setPeriod] = useState(''), [q,setQ] = useState('')
  const [page, setPage] = useState(1)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const params = new URLSearchParams(period)
  params.set('page', String(page)); params.set('pageSize', '20')
  if (q.trim()) params.set('q', q.trim())
  const source = useRecords('/admin/transactions?' + params.toString())
  async function download(rows, paged) {
    if (!paged) return exportRows('transactions', transactionColumns, rows)
    setExporting(true); setExportError('')
    try {
      const request = new URLSearchParams(params); request.set('export', '1')
      const { data } = await api.get('/admin/transactions?' + request.toString())
      exportRows('transactions', transactionColumns, data.rows)
    } catch (err) { setExportError(err.message || 'Could not export transactions.') } finally { setExporting(false) }
  }
  return <SectionCard title="Transactions"><Period value={period} onChange={value => { setPeriod(value); setPage(1) }} /><label className="my-3 block">Search transactions<input className="input text-base" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Type, booking or name" /></label>
    {exportError && <p role="alert">{exportError}</p>}
    <Records source={source}>{({rows, pagination}) => {
      const filtered = pagination ? rows : rows.filter(x => [x.type,x.id,x.bookingId,x.tutor,x.parent,x.status].join(' ').toLowerCase().includes(q.toLowerCase()))
      const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(filtered.length / 20)), current = pagination?.page ?? Math.min(page, totalPages)
      return <><button className="btn-outline mb-3 min-h-11" disabled={exporting} onClick={() => download(filtered, Boolean(pagination))}>{exporting ? 'Preparing…' : 'Export CSV'}</button><Rows columns={transactionColumns} rows={pagination ? filtered : filtered.slice((current - 1) * 20, current * 20)} />
        {totalPages > 1 && <nav aria-label="Transaction pages" className="mt-4 flex flex-wrap items-center gap-2"><button className="btn-outline min-h-11" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {totalPages}</span><button className="btn-outline min-h-11" disabled={current === totalPages} onClick={() => setPage(current + 1)}>Next</button></nav>}</>
    }}</Records></SectionCard>
}

function RefundItem({r,done}) {
  const [action,setAction] = useState(r.status === 'APPROVED' ? 'issued' : 'approve')
  return <details className="rounded-xl border border-brand-100 p-3"><summary className="cursor-pointer py-2 font-semibold">#{r.bookingId} · {r.parent} · {money(r.amount)} · {r.status}</summary>
    {r.attendanceOutcome && <p>Attendance review: {attendanceLabels[r.attendanceOutcome]}</p>}
    <p className="my-2">Reason: {r.reason} · Paid: {money(r.paid)}</p>{r.decision && <p>{r.decision}</p>}
    {r.policy && <p className="my-2 text-sm">{r.policy === 'PARENT_LATE' ? 'Late parent cancellation: refund 90%; the remaining 10% goes to the tutor after transfer.' : r.policy === 'ATTENDANCE_NOT_HELD' ? 'Lesson not held: refund the remaining lesson payment.' : 'Early parent cancellation: refund the full lesson payment.'}</p>}
    {r.attendanceRefundState === 'AWAITING_APPEAL' && <p role="status">{refundHoldLabels.AWAITING_APPEAL}</p>}
    {r.attendanceRefundState === 'ON_HOLD' ? <p role="status">{refundHoldLabels.ON_HOLD}</p> : r.attendanceRefundState === 'AWAITING_APPEAL' && r.status === 'APPROVED' ? null : <DecisionForm label={action === 'issued' ? 'Record completed transfer' : 'Save refund decision'} done={done} submit={f => api.post('/admin/refunds/' + r.id + '/decision',
      action === 'issued' ? { action, reference: f.reference } : action === 'reject' ? { action, reason: f.reason } : { action, amount: Number(f.amount), basis: f.basis, reason: f.reason })}>
      {r.status === 'APPROVED' ? <label>Reference from the completed bank or gateway refund<input name="reference" required maxLength={100} className="input text-base" /></label> : <>
        <label>Decision<select className="input text-base" value={action} onChange={e => setAction(e.target.value)}><option value="approve">Approve refund</option>{r.attendanceOutcome !== 'NOT_HELD' && <option value="reject">Reject refund</option>}</select></label>
        {action === 'approve' && <><label>Refund amount (RM)<input name="amount" type="number" required min="0.01" max={r.amount} step="0.01" defaultValue={r.amount} readOnly={Boolean(r.policy)} className="input text-base" /></label>
          <label>Eligibility<select className="input text-base" name="basis" required defaultValue=""><option disabled value="">Choose a basis</option><option>Mutual agreement</option><option>Refund policy condition</option></select></label></>}
        <Note label="Record the evidence and reason" maxLength={150} />
      </>}
    </DecisionForm>}</details>
}
function Refunds() {
  const [page, setPage] = useState(1)
  const source = useRecords('/admin/refunds?page=' + page + '&pageSize=20')
  return <SectionCard title="Refunds"><Records source={source}>{({rows}) => rows.length ? <div className="space-y-2">{rows.map(r =>
    <RefundItem key={r.id + '-' + r.status} r={r} done={source.reload} />)}</div> : <p>No refunds waiting for review or transfer.</p>}</Records>
    {source.data?.pagination?.totalPages > 1 && <nav aria-label="Refund pages" className="mt-4 flex flex-wrap items-center gap-2"><button className="btn-outline min-h-11" disabled={source.data.pagination.page <= 1} onClick={() => setPage(source.data.pagination.page - 1)}>Previous</button><span>Page {source.data.pagination.page} of {source.data.pagination.totalPages}</span><button className="btn-outline min-h-11" disabled={source.data.pagination.page >= source.data.pagination.totalPages} onClick={() => setPage(source.data.pagination.page + 1)}>Next</button></nav>}
  </SectionCard>
}
function Salary() {
  const list = useRecords('/admin/rates')
  const [id,setId] = useState(''), [period,setPeriod] = useState('')
  const summary = useRecords(id ? '/admin/salary/' + id + '?' + period : null)
  return <SectionCard title="Tutor salary summary"><div className="space-y-3 print:hidden"><Records source={list}>{({tutors}) => <label>Tutor<select className="input text-base" value={id} onChange={e => setId(e.target.value)}><option value="">Choose a tutor</option>{tutors.map(t => <option key={t.id} value={t.id}>{t.name} · #{t.id}</option>)}</select></label>}</Records>
    <Period value={period} onChange={setPeriod} /></div>
    {id && <Records source={summary}>{s => <div className="mt-4 space-y-3"><h2 className="text-xl font-bold">{s.tutor} · Earnings statement</h2>
      <p>Payment period: {new URLSearchParams(period).get('from') || 'Beginning'} to {new URLSearchParams(period).get('to') || 'no end date'}.</p>
      <p className="text-sm text-slate-600">Lessons are grouped by the parent’s payment date and use their current refund and lesson status. Withdrawals are grouped by transfer date.</p>
      <Rows rows={s.sessions} columns={[['Paid on',x => fmtDate(x.date)],['Booking',x=>x.bookingId],['Subject',x=>x.subject],['Gross',x=>money(x.fee)],['Refunds',x=>money(x.refunded)],['Commission',x=>money(x.commission)],['Net',x=>money(x.net)]]} />
      <dl>{[['Gross lesson fees',s.gross],['Refunds',s.refunded],['Commission deducted',s.commission],['Net earnings',s.net],['Attendance penalties assessed',s.penalties ?? 0],['Net after penalties',s.netAfterPenalties ?? s.net],['Withdrawals paid in period',s.approved],['Currently available',s.available]].map(([k,v]) => <div key={k} className="flex justify-between gap-2 border-b py-1"><dt>{k}</dt><dd>{money(v)}</dd></div>)}</dl>
      <button className="btn-outline min-h-11 print:hidden" onClick={() => window.print()}>Print or save PDF</button></div>}</Records>}
  </SectionCard>
}
export default function Finance() {
  const [tab,setTab] = useState('Transactions')
  return <div className="min-w-0 space-y-4"><PageTitle title="Financial management" subtitle="Review payments, withdrawals, refunds and tutor earnings." />
    <div className="flex flex-wrap gap-2 print:hidden">{['Transactions','Withdrawals','Refunds','Salary summary'].map(t => <button key={t} aria-pressed={tab === t} className={(tab === t ? 'btn-primary' : 'btn-outline') + ' min-h-11'} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'Transactions' ? <Transactions /> : tab === 'Withdrawals' ? <WithdrawalReviews /> : tab === 'Refunds' ? <Refunds /> : <Salary />}</div>
}
