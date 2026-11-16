import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../components/ProtectedRoute'
import { LoadError, PageTitle, Spinner } from '../components/ui/Common'

export default function Help() {
  const { user } = useAuth()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const load = () => {
    setError('')
    api.get('/public/faq').then(r => setEntries(r.data.entries)).catch(e => setError(errorMessage(e)))
  }
  useEffect(() => { load() }, [])
  const shown = entries?.filter(e => `${e.topic} ${e.answer}`.toLowerCase().includes(query.trim().toLowerCase())) || []
  return <div className="mx-auto w-full max-w-3xl py-4">
    <PageTitle title="Help & FAQs" subtitle="Find answers about tutor matching, bookings, payments and your account." sparkle={false} />
    <section className="card mb-6 p-5">
      <h2 className="text-lg font-bold text-navy">New to WonderTutor?</h2>
      <p className="mt-2 text-slate-600">Choose a guide for a walkthrough, or search the answers below.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/for-parents" className="btn-outline min-h-11">For Parents</Link>
        <Link to="/for-tutors" className="btn-outline min-h-11">For Tutors</Link>
        <Link to="/how-it-works" className="btn-outline min-h-11">How It Works</Link>
      </div>
      <Link to={user?.role === 'PARENT' ? '/parent/find-tutor' : '/tutors'} className="btn-primary mt-4 min-h-11">Find a tutor</Link>
    </section>
    <label className="mb-2 block text-sm font-semibold text-navy" htmlFor="faq-search">Search FAQs</label>
    <div className="mb-4 flex flex-wrap gap-2">
      <input id="faq-search" type="search" className="input min-w-0 flex-1" placeholder="Try payment, refund or availability" value={query} onChange={e => setQuery(e.target.value)} />
      {query && <button className="btn-outline min-h-11" onClick={() => setQuery('')}>Clear search</button>}
    </div>
    {error ? <LoadError message={error} onRetry={load} /> : !entries ? <Spinner /> : <>
      <p role="status" className="mb-3 text-sm text-slate-600">{shown.length} {shown.length === 1 ? 'answer' : 'answers'} found</p>
      {!shown.length && <div className="card p-5 text-slate-700">No matching answers. Try a shorter search or clear the search to see all topics.</div>}
      <div className="space-y-3">{shown.map(e => <details key={e.id} className="card p-4 open:border-brand-300">
        <summary className="cursor-pointer py-1 font-semibold text-navy focus-visible:outline-2 focus-visible:outline-brand-500">{e.topic}</summary>
        <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{e.answer}</p>
      </details>)}</div>
    </>}
    <section className="mt-6 rounded-xl border border-brand-100 bg-brand-50 p-5">
      <h2 className="font-bold text-navy">Still need help?</h2>
      <p className="mt-2 text-slate-700">If something went wrong, include the lesson or payment details and what happened. Never include passwords, OTP codes or bank login details.</p>
      <Link to={user?.role === 'PARENT' ? '/parent/complaints' : user?.role === 'TUTOR' ? '/tutor/bookings' : user?.role === 'ADMIN' ? '/admin/complaints' : '/login'} className="btn-outline mt-3 min-h-11">{user?.role === 'PARENT' ? 'Report an issue' : user?.role === 'TUTOR' ? 'Open my bookings' : user?.role === 'ADMIN' ? 'Review complaints' : 'Log in for account help'}</Link>
      {user && <Link to={homeFor(user.role)} className="ml-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">My Dashboard</Link>}
    </section>
  </div>
}
