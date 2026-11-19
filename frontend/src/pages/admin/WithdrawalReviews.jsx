import { useCallback, useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, LoadError, PageTitle, Spinner } from '../../components/ui/Common'
import { uploadImage, uploadError } from '../../components/PhotoPicker'
import { fmtDate, money } from '../../lib/format'

function Request({ w, refresh, notify }) {
  const [bank, setBank] = useState(null)
  const [reference, setReference] = useState('')
  const [receipt, setReceipt] = useState(null)
  const awaiting = w.payoutStatus === 'AWAITING_TRANSFER'
  const closed = ['PAID', 'LEGACY_PAID', 'REJECTED'].includes(w.payoutStatus || w.status)
  async function reveal() {
    setError('')
    try { setBank((await api.get('/admin/withdrawals/' + w.id + '/destination')).data) }
    catch (err) { setError(errorMessage(err)) }
  }
  async function upload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setReceipt(null)
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or PDF receipt up to 5 MB.')
      return
    }
    setBusy(true)
    setError('')
    try { setReceipt(await uploadImage(file, 'withdrawal-receipt', w.id)) }
    catch (err) { setError(uploadError(err)) }
    finally { setBusy(false) }
  }
  async function record(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/admin/withdrawals/' + w.id + '/transfer', { reference, receipt })
      notify(data.emailSent === false ? 'Transfer recorded. The email could not be delivered; the tutor has an in-app notification.' : 'Transfer recorded and tutor notified.')
      await refresh()
    } catch (err) { setError(errorMessage(err)); await refresh() }
    finally { setBusy(false) }
  }
  const [action, setAction] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function review(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/admin/withdrawals/' + w.id + '/review', { status: action, expectedStatus: w.status, ...(action === 'REJECTED' && { reason }) })
      notify(data.emailSent === false ? 'Decision saved. The email could not be delivered; the tutor has an in-app notification.' : 'Decision saved and tutor notified.')
      await refresh()
    } catch (err) { setError(errorMessage(err)); await refresh() }
    finally { setBusy(false) }
  }
  return <article className="card min-w-0 space-y-3 break-words p-4">
    <h2 className="text-lg font-bold text-navy">{w.tutor} · {money(w.amount)}</h2>
    <p>{fmtDate(w.date)} · {w.bank.bankName} ••{w.bank.lastFour} · {w.bank.accountName}</p>
    {w.status === 'ESCALATED' && <p className="text-sm font-semibold">Bank details changed after this request. Verify the original account with the tutor before approving.</p>}
    <p className="font-semibold">{({ AWAITING_TRANSFER: 'Awaiting transfer', PAID: 'Paid', LEGACY_PAID: 'Previously approved (legacy record)', PENDING: 'Pending review', ESCALATED: 'Bank change under review', REJECTED: 'Rejected' })[w.payoutStatus || w.status]}</p>
    {awaiting && <div className="space-y-3">
      <button type="button" className="btn-outline min-h-11" onClick={() => bank ? setBank(null) : reveal()}>{bank ? 'Hide bank details' : 'Show bank details for transfer'}</button>
      {bank && <p className="break-all">{bank.bankName}<br />{bank.accountName}<br />{bank.accountNumber}</p>}
      <form onSubmit={record} className="space-y-3">
        <p>Complete the transfer through your bank, then record its reference and receipt here. Check your bank history before retrying a transfer.</p>
        <label className="block">Bank transfer reference<input className="input min-h-11 text-base" required minLength={3} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label>
        <label className="block">Transfer receipt<input className="block min-h-11 w-full min-w-0 max-w-full text-base" type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} onChange={upload} /></label>
        <p className="text-sm">Private JPEG, PNG or PDF, up to 5 MB. {receipt && 'Receipt uploaded.'}</p>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" required />I confirm the bank transfer succeeded for this amount and account.</label>
        <button className="btn-primary min-h-11" disabled={busy || !receipt || reference.trim().length < 3}>{busy ? 'Saving…' : 'Record transfer as paid'}</button>
      </form>
    </div>}
    {w.reason && <p>Reason: {w.reason}</p>}
    {w.transferRef && <p>Transfer reference: {w.transferRef}</p>}
    {w.paidAt && <p>Paid on {fmtDate(w.paidAt)}</p>}
    {w.receiptUrl && <a className="inline-flex min-h-11 items-center underline" href={w.receiptUrl} target="_blank" rel="noreferrer">View transfer receipt</a>}
    {!awaiting && !closed && (action ? <form onSubmit={review} className="space-y-2">
      {action === 'REJECTED' ? <label className="block">Reason for rejection<textarea required maxLength={191} className="input text-base" value={reason} onChange={e => setReason(e.target.value)} /></label> :
        <p>Record approval of {money(w.amount)} for the account ending {w.bank.lastFour}? The amount stays reserved until you complete and record the bank transfer.</p>}
      <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11" disabled={busy || (action === 'REJECTED' && !reason.trim())}>Confirm decision</button><button type="button" disabled={busy} className="btn-outline min-h-11" onClick={() => setAction('')}>Cancel</button></div>
    </form> : <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11" onClick={() => setAction('APPROVED')}>Approve</button><button className="btn-outline min-h-11" onClick={() => setAction('REJECTED')}>Reject</button></div>)}
    {error && <ErrorBox>{error}</ErrorBox>}
  </article>
}

export default function WithdrawalReviews() {
  const [notice, setNotice] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/admin/withdrawals')
    .then(({ data }) => { setRows(data.requests); setError('') })
    .catch(err => setError(errorMessage(err))), [])
  useEffect(() => { load() }, [load])
  return <div className="min-w-0 space-y-3"><PageTitle title="Withdrawal requests" subtitle="Review tutors’ requests to withdraw their earnings." sparkle={false} />
    <p className="card p-4 text-sm text-slate-600">Approve the request, complete the bank transfer, then record its reference and private receipt. The tutor receives an update at each decision.</p>
    {notice && <p role="status">{notice}</p>}
    {error ? <LoadError message={error} onRetry={load} /> : !rows ? <Spinner /> : rows.length ? rows.map(w => <Request key={w.id + '-' + (w.payoutStatus || w.status)} w={w} refresh={load} notify={setNotice} />) : <p className="card p-5">No withdrawal requests are waiting for review.</p>}
  </div>
}
