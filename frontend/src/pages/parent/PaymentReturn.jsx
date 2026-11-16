import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { Spinner } from '../../components/ui/Common'

// The browser return is only a hint. Our server checks ownership and asks the
// provider for the actual transaction before confirming a lesson.
export default function PaymentReturn() {
  const [params] = useSearchParams()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const sent = useRef(null)
  const query = params.toString()

  useEffect(() => {
    const key = `${query}:${attempt}`
    if (sent.current === key) return
    sent.current = key
    setBusy(true)
    setError('')
    setResult(null)
    const values = new URLSearchParams(query)
    const billcode = values.get('billcode')
    const orderId = values.get('order_id')
    const id = values.get('billplz[id]')
    const signature = values.get('billplz[x_signature]')
    let body
    if (billcode && orderId) body = { gateway: 'toyyibpay', billcode, order_id: orderId }
    else if (id && signature) body = {
      id, paid: values.get('billplz[paid]') || 'false', paid_at: values.get('billplz[paid_at]') || undefined, x_signature: signature,
    }
    else {
      setError('This page is meant to be opened by the payment service. Check your payments instead.')
      setBusy(false)
      return
    }
    api.post('/parent/payments/return', body)
      .then((r) => { if (sent.current === key) setResult(r.data) })
      .catch((e) => { if (sent.current === key) setError(errorMessage(e)) })
      .finally(() => { if (sent.current === key) setBusy(false) })
  }, [query, attempt])

  if (!result && !error) return <div className="py-20 text-center"><Spinner /><p className="mt-3 text-sm text-slate-600">Checking your payment…</p></div>

  const ok = result?.outcome === 'SUCCESS'
  const waiting = result?.outcome === 'WAITING'
  const refunded = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(result?.outcome)
  const received = refunded || ['LATE', 'RECORDED'].includes(result?.outcome)
  const tone = ok ? 'bg-ok' : waiting || received || error ? 'bg-accent-600' : 'bg-red-500'
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="status">
        <span className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${tone}`}>
          <Icon name={ok ? 'check' : waiting || received || error ? 'clock' : 'x'} className="h-9 w-9" strokeWidth={3} />
        </span>
        <h1 className="text-2xl font-extrabold text-navy">{error ? 'Payment verification unavailable' : ok ? 'Payment successful' : waiting ? 'Payment pending' : refunded ? 'Refund recorded' : result?.outcome === 'RECORDED' ? 'Payment recorded' : received ? 'Payment received' : 'Payment not completed'}</h1>
        <p className="text-sm text-slate-600">{error || result.message}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {(waiting || error) && <button disabled={busy} onClick={() => setAttempt(n => n + 1)} className="btn-outline px-6">{busy ? 'Checking…' : 'Check payment again'}</button>}
          <Link to="/parent/payments" className="btn-primary px-6">Go to Payments</Link>
          {ok && <Link to="/parent/bookings" className="btn-outline px-6">My Bookings</Link>}
        </div>
      </div>
    </div>
  )
}
