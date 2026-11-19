import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import TutorPaymentStatus from '../../components/TutorPaymentStatus'
import TutorPageHeader from '../../components/TutorPageHeader'
import { ErrorBox, LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { fmtDate, money } from '../../lib/format'

const statusLabel = { PENDING: 'In review', APPROVED: 'Awaiting transfer', AWAITING_TRANSFER: 'Awaiting transfer', PAID: 'Paid', LEGACY_PAID: 'Previously approved (legacy record)', REJECTED: 'Rejected', ESCALATED: 'Bank change under review' }
const monthKey = date => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date))
const accountLabel = bank => bank.bankName + ' ••' + bank.lastFour
function exportCsv(rows) {
  const header = ['Date', 'Booking', 'Student', 'Lesson', 'Fee (RM)', 'Refund (RM)', 'Saved rate (%)', 'Commission (RM)', 'Tutor share (RM)', 'Status']
  const cells = rows.map(r => [fmtDate(r.date), r.bookingId, r.student, r.subject, r.fee, r.refunded, r.rate, r.commission, r.net, r.state])
  const quote = value => {
    const s = String(value)
    return '"' + (/^\s*[=+@-]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"'
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + [header, ...cells].map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'lesson-earnings.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function LessonAmounts({ row }) {
  const amounts = [
    ['Lesson fee', row.fee],
    [`Saved commission (${Number(row.rate)}%)`, row.originalCommission],
  ]
  if (Number(row.refunded) > 0) {
    amounts.push(
      ['Your share before refund', row.originalShare],
      ['Refund to parent', row.refunded],
      ['Taken from your share', row.tutorRefundShare],
      ['Taken from commission', row.platformRefundShare],
      ['Commission after refund', row.commission],
    )
  }
  amounts.push(['Tutor share', row.net])
  return <div><div className="mb-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center text-sm">
    <div className="rounded-lg border border-brand-100 p-2">Lesson fee<strong className="block text-lg text-navy">{money(row.fee)}</strong></div><span aria-hidden="true" className="hidden sm:block">−</span>
    <div className="rounded-lg border border-brand-100 p-2">Commission ({Number(row.rate)}%)<strong className="block text-lg text-navy">{money(row.originalCommission)}</strong></div><span aria-hidden="true" className="hidden sm:block">=</span>
    <div className="rounded-lg bg-brand-50 p-2">Original tutor share<strong className="block text-lg text-navy">{money(row.originalShare)}</strong></div>
  </div>{Number(row.refunded) > 0 && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm">Partial refund <strong>{money(row.refunded)}</strong> → Revised tutor share <strong>{money(row.net)}</strong><span className="mt-1 block text-slate-600">Refund shared proportionally between tutor and platform.</span></p>}
  <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand-700">Full lesson breakdown</summary><dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{amounts.map(([label, amount]) =>
    <div key={label} className="min-w-0 rounded-lg bg-brand-25 p-3"><dt className="text-slate-600">{label}</dt><dd className="mt-1 font-semibold text-navy">{money(amount)}</dd></div>
  )}</dl></details></div>
}

function WithdrawalList({ rows }) {
  return <ul className="divide-y divide-brand-100">{rows.map(w =>
    <li key={w.id} className="break-words py-3"><strong>{money(w.amount)} · {statusLabel[w.payoutStatus || w.status]}</strong>
      <p className="text-sm">{fmtDate(w.date)} · {accountLabel(w.bank)}</p>{w.reason && <p>Reason: {w.reason}</p>}
      {w.transferRef && <p className="text-sm">Transfer reference: {w.transferRef}</p>}
      {w.paidAt && <p className="text-sm">Paid on {fmtDate(w.paidAt)}</p>}
      {w.receiptUrl && <a className="inline-flex min-h-11 items-center underline" href={w.receiptUrl} target="_blank" rel="noreferrer">View transfer receipt</a>}
    </li>
  )}</ul>
}

function BankCard({ data, refresh }) {
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const bank = data.bank
  function open(next) { setMode(next); setError(''); setNote('') }
  async function submit(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const details = mode === 'remove' ? null : { bankName: f.get('bankName'), accountName: f.get('accountName'), accountNumber: f.get('accountNumber') }
    setBusy(true)
    setError('')
    try {
      await api.put('/tutor/earnings/bank', { currentBankId: bank?.id ?? null, details, confirmation: f.get('confirmation') })
      setMode('')
      setNote(details ? 'Bank details saved.' : 'Bank account removed.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
      if (err.response?.status === 409) {
        // Do not replay bank changes against a newly selected account. Re-read
        // the destination and require a fresh form and confirmation instead.
        await refresh()
        setMode('')
        setNote('Review the latest bank account, then start again if you still want to change it.')
      }
    } finally { setBusy(false) }
  }
  async function sendCode() {
    setBusy(true)
    setError('')
    try { await api.post('/tutor/earnings/bank-code'); setNote('Check your email for the confirmation code.') }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <SectionCard title="Payout bank account" icon="wallet">
    {bank ? <p className="mb-3 break-words">{accountLabel(bank)}<br />{bank.accountName}</p> : <p className="mb-3">Add a bank account to request a withdrawal.</p>}
    {mode ? <form onSubmit={submit} key={mode} className="space-y-3">
      {mode !== 'remove' && <>
        <label className="block">Bank<input name="bankName" className="input min-h-11 text-base" required maxLength={100} defaultValue={bank?.bankName} /></label>
        <label className="block">Account holder<input name="accountName" className="input min-h-11 text-base" required maxLength={100} defaultValue={bank?.accountName} /></label>
        <label className="block">Account number<input name="accountNumber" className="input min-h-11 text-base" required inputMode="numeric" pattern="[0-9]{6,20}" maxLength={20} autoComplete="off" /></label>
      </>}
      {bank && <p className="text-sm">Open withdrawals keep their original account and pause for admin review.</p>}
      {data.bankAuth === 'code' && <button className="btn-outline min-h-11" disabled={busy} type="button" onClick={sendCode}>Email confirmation code</button>}
      <label className="block">{data.bankAuth === 'code' ? 'Email code' : 'Confirm your password'}<input className="input min-h-11 text-base" name="confirmation" required type={data.bankAuth === 'code' ? 'text' : 'password'} autoComplete={data.bankAuth === 'code' ? 'one-time-code' : 'current-password'} /></label>
      <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11" disabled={busy}>{mode === 'remove' ? 'Confirm removal' : 'Save account'}</button><button className="btn-outline min-h-11" type="button" disabled={busy} onClick={() => open('')}>Cancel</button></div>
    </form> : <div className="flex flex-wrap gap-2"><button className="btn-outline min-h-11" onClick={() => open('edit')}>{bank ? 'Edit account' : 'Add bank account'}</button>{bank && <button className="btn-outline min-h-11" onClick={() => open('remove')}>Remove account</button>}</div>}
    {error && <ErrorBox>{error}</ErrorBox>}{note && <p role="status">{note}</p>}
  </SectionCard>
}

export default function Earnings() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [amount, setAmount] = useState('')
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState('all')
  const load = useCallback(() => api.get('/tutor/earnings')
    .then(({ data: result }) => { setData({ ...result, month: monthKey(new Date()) }); setError('') })
    .catch(err => setError(errorMessage(err))), [])
  useEffect(() => { load() }, [load])
  if (error) return <LoadError message={error} onRetry={load} />
  if (!data) return <Spinner />
  const rows = data.transactions.filter(r => period === 'all' || monthKey(r.date) === data.month)

  const isPending = w => w.status === 'PENDING' || w.status === 'ESCALATED' || w.payoutStatus === 'AWAITING_TRANSFER'
  const pendingWithdrawals = data.withdrawals.filter(isPending)
  const closedWithdrawals = data.withdrawals.filter(w => !isPending(w))

  async function withdraw(e) {
    e.preventDefault()
    setBusy(true)
    setNotice('')
    try {
      await api.post('/tutor/earnings/withdrawals', { amount, version: data.version, bankId: data.bank.id })
      setNotice('Withdrawal requested. Your funds are on hold for review.')
      setAmount('')
      setWithdrawOpen(false)
    } catch (err) { setNotice(errorMessage(err)) }
    finally { await load(); setBusy(false) }
  }
  return <div className="min-w-0 space-y-4">
    <TutorPageHeader title="My earnings" subtitle="Understand your lesson earnings and track bank transfers." />
    <div className="tutor-earnings-overview grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0">        <SectionCard title="Available to withdraw" icon="wallet" className="tutor-paper-blue"><p className="mb-3 font-display text-4xl font-bold text-navy sm:text-5xl">{money(data.available)}</p>{!withdrawOpen && <button className="btn-primary min-h-11 w-full" disabled={busy || !data.bank || Number(data.available) <= 0} onClick={() => setWithdrawOpen(true)}>Request withdrawal</button>}
        {!data.bank && <p className="mt-2 text-sm">Add a bank account to request a withdrawal.</p>}
        {withdrawOpen && <form onSubmit={withdraw} className="mt-3 space-y-3">
          <label className="block">Amount (RM)<input className="input min-h-11 text-base" type="number" min="0.01" max={Number(data.available)} step="0.01" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <p className="text-sm">Up to {money(data.available)} available.</p>
          <p className="break-words">{data.bank ? 'Pay to ' + accountLabel(data.bank) : 'Add a bank account below to withdraw.'}</p>
          <button className="btn-primary min-h-11 w-full" disabled={busy || !data.bank || Number(data.available) <= 0 || !amount}>{busy ? 'Submitting…' : 'Confirm withdrawal'}</button><button type="button" className="btn-outline min-h-11 w-full" disabled={busy} onClick={() => setWithdrawOpen(false)}>Cancel</button>
        </form>}
        {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
        </SectionCard></div>
      <dl className="grid min-w-0 grid-cols-2 gap-3">
        {[['Pending withdrawals', money(data.held), 'Reserved for review or bank transfer'], ['Transferred', money(data.withdrawn), 'Bank transfers recorded']].map(([label, value, hint]) => <div key={label} className="min-w-0 rounded-xl border border-brand-100 bg-white p-4"><dt className="text-sm">{label}</dt><dd className="my-2 break-words text-2xl font-bold text-navy">{value}</dd><dd className="text-xs text-slate-600">{hint}</dd></div>)}
      </dl>
      <div className="min-w-0"><BankCard data={data} refresh={load} /></div>
    </div>
    <div className="min-w-0 space-y-4">

        <p className="rounded-lg border border-brand-100 bg-white p-3 text-sm text-slate-600">Admin approval reserves your payout. The transfer is complete only after the bank transfer is recorded.</p>
        <SectionCard title="How your earnings are calculated">
          <p className="mb-4 text-sm text-slate-600">Total earned: {money(data.totalEarned)} · Pending lesson report: {money(data.pending)} · Your current commission rate: {Number(data.rate)}% (platform base: {Number(data.baseRate)}%). Each lesson uses its saved rate.</p>
          <div className="mb-3 flex flex-wrap gap-2"><select aria-label="Transaction period" className="input min-h-11 w-auto max-w-full text-base" value={period} onChange={e => setPeriod(e.target.value)}><option value="all">All dates</option><option value="month">This month</option></select>
            <button className="btn-outline min-h-11" disabled={!rows.length} onClick={() => exportCsv(rows)}>Export CSV</button></div>
          {!rows.length && <p>No lesson payments for this period.</p>}
          <ul className="divide-y divide-brand-100">{rows.map(r => <li key={r.id} className="space-y-2 break-words py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3"><strong>{r.subject} · {r.student}</strong><span>{r.state}</span></div>
            <p className="text-sm">{fmtDate(r.date)} · Booking #{r.bookingId}</p>
            {r.bookingStatus && <p className="text-sm">Lesson · {r.bookingStatus[0] + r.bookingStatus.slice(1).toLowerCase().replaceAll('_', ' ')}</p>}
            {r.bookingStatus === 'COMPLETED' && <Link className="inline-flex min-h-11 items-center underline" to={'/tutor/bookings/' + (r.bookingRef || r.bookingId) + '/session'}>View lesson report</Link>}
            <TutorPaymentStatus payment={r.payment} />
            <LessonAmounts row={r} />
          </li>)}</ul>
        </SectionCard>
        <SectionCard title="Withdrawal history" icon="clock">
          <p className="text-sm">Total paid: {money(data.withdrawn)}</p>
          {!closedWithdrawals.length && <p className="mt-2">{data.withdrawals.length ? 'No completed transfers or rejections yet.' : 'No withdrawals yet.'}</p>}
          {pendingWithdrawals.length > 0 && <div className="mb-3"><h3 className="mt-3 font-semibold">Pending withdrawals</h3><p className="text-sm">{money(data.held)} is already set aside from your available balance.</p><WithdrawalList rows={pendingWithdrawals} /></div>}
          <WithdrawalList rows={closedWithdrawals} />
        </SectionCard>
    </div>
  </div>
}
