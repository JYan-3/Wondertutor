import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import useScrollReveal from '../hooks/useScrollReveal'
import { guideActions, PUBLIC_GUIDES } from '../lib/publicGuides'

export default function HowItWorks() {
  const { user } = useAuth()
  const [audience, setAudience] = useState(user?.role === 'TUTOR' ? 'tutors' : 'parents')
  const root = useRef(null)
  const guide = PUBLIC_GUIDES[audience]
  const [action] = guideActions(audience, user)
  useScrollReveal(root, audience)
  useEffect(() => {
    const previous = document.title
    document.title = 'How It Works | WonderTutor'
    return () => { document.title = previous }
  }, [])

  return (
    <article ref={root} className="mx-auto max-w-5xl space-y-8 py-7 md:space-y-10 md:py-12">
      <header className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">How It Works</p>
        <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-navy sm:text-4xl lg:text-5xl">A clear path to your next lesson.</h1>
        <p className="mt-4 leading-relaxed text-slate-600">From finding the right fit to following up after a lesson, here’s how parents and tutors get started.</p>
      </header>

      <section aria-labelledby="journey-title">
        <div className="mx-auto grid max-w-sm grid-cols-2 gap-1 rounded-2xl border border-brand-100 bg-brand-50 p-1.5" role="group" aria-label="Choose your guide">
          {Object.entries(PUBLIC_GUIDES).map(([key, value]) => <button key={key} type="button" aria-pressed={audience === key} aria-controls="journey-steps"
            onClick={() => setAudience(key)} className={`min-h-12 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-500 ${audience === key ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-navy'}`}>{value.label}</button>)}
        </div>
        <div id="journey-steps" className="mt-7">
          <h2 id="journey-title" className="section-title text-center">{audience === 'parents' ? 'Find, book and learn.' : 'Introduce, schedule and teach.'}</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {guide.steps.map((step, index) => <li key={step.title} className="home-reveal card p-6" style={{ '--reveal-delay': `${index % 2 * 50}ms` }}>
              <div className="flex items-center justify-between"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><Icon name={step.icon} className="h-6 w-6" /></span><span aria-hidden="true" className="font-display text-3xl font-bold text-brand-200">{String(index + 1).padStart(2, '0')}</span></div>
              <h3 className="card-title mt-4"><span className="sr-only">Step {index + 1}: </span>{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
            </li>)}
          </ol>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={action.to} className="btn-primary min-h-12 px-6 max-sm:w-full">{action.label}<Icon name="arrow-right" className="h-4 w-4" /></Link>
            <Link to={`/for-${audience}`} className="btn-outline min-h-12 px-6 max-sm:w-full">Read the {audience === 'parents' ? 'parent' : 'tutor'} guide</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="journey-help" className="home-reveal rounded-3xl border border-brand-100 bg-brand-50 p-6 sm:p-8">
        <div className="flex items-start gap-3"><Icon name="shield" className="mt-1 h-6 w-6 shrink-0 text-brand-500" /><div><h2 id="journey-help" className="font-display text-xl font-bold text-navy">Know what happens next.</h2><p className="mt-2 leading-relaxed text-slate-700">A booking request needs the tutor’s response and verified payment before it becomes confirmed. Your booking details show its status, payment deadline and available actions.</p><Link to="/faq" className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-600 hover:underline">Questions about payments or bookings? Read the FAQ<Icon name="arrow-right" className="h-4 w-4 shrink-0" /></Link></div></div>
      </section>
    </article>
  )
}
