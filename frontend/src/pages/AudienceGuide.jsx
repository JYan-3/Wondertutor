import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import useScrollReveal from '../hooks/useScrollReveal'
import { guideActions, PUBLIC_GUIDES } from '../lib/publicGuides'

export default function AudienceGuide({ audience }) {
  const { user } = useAuth()
  const guide = PUBLIC_GUIDES[audience]
  const root = useRef(null)
  const [primary, secondary] = guideActions(audience, user)
  useScrollReveal(root, audience)
  useEffect(() => {
    const previous = document.title
    document.title = `${guide.label} | WonderTutor`
    return () => { document.title = previous }
  }, [guide.label])

  return (
    <article ref={root} className="mx-auto max-w-6xl space-y-10 py-5 md:space-y-14 md:py-8">
      <section aria-labelledby="guide-title" className="relative isolate overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-brand-25 to-white px-5 py-8 sm:p-9 lg:p-12">
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 -z-10 h-80 w-80 rounded-full border-[44px] border-brand-100/40" />
        <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
          <div>
            <p className="eyebrow">{guide.label}</p>
            <h1 id="guide-title" className="mt-3 max-w-xl font-display text-3xl font-bold leading-tight text-navy sm:text-4xl lg:text-5xl">{guide.title}</h1>
            <p className="mt-4 max-w-xl leading-relaxed text-slate-700">{guide.introduction}</p>
            <ul className="mt-5 space-y-2.5 text-sm text-slate-700">
              {guide.highlights.map(text => <li key={text} className="flex items-start gap-2"><Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />{text}</li>)}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={primary.to} className="btn-primary min-h-12 px-5 max-sm:w-full">{primary.label}<Icon name="arrow-right" className="h-4 w-4" /></Link>
              <Link to={secondary.to} className="btn-outline min-h-12 px-5 max-sm:w-full">{secondary.label}</Link>
            </div>
          </div>
          <aside className="rounded-3xl border border-brand-100 bg-white/95 p-5 shadow-card sm:p-7">
            <h2 className="font-display text-xl font-bold leading-snug text-navy">{guide.panelTitle}</h2>
            <ul className="mt-5 space-y-4">
              {guide.panelItems.map(([icon, title, text]) => <li key={title} className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><Icon name={icon} className="h-5 w-5" /></span>
                <div className="min-w-0"><h3 className="text-sm font-semibold text-navy">{title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p></div>
              </li>)}
            </ul>
            <Link to="/how-it-works" className="mt-5 inline-flex min-h-11 items-center gap-2 border-t border-brand-100 pt-4 text-sm font-semibold text-brand-600 hover:underline">See the whole journey<Icon name="arrow-right" className="h-4 w-4" /></Link>
          </aside>
        </div>
      </section>

      <section aria-labelledby="guide-benefits">
        <div className="home-reveal"><p className="eyebrow">Built around you</p><h2 id="guide-benefits" className="section-title mt-2">{audience === 'parents' ? 'More clarity, from the very first search.' : 'More time for the teaching that matters.'}</h2></div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {guide.benefits.map(([icon, title, text], index) => <div key={title} className="home-reveal card p-6" style={{ '--reveal-delay': `${index * 50}ms` }}>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><Icon name={icon} className="h-6 w-6" /></span>
            <h3 className="card-title mt-4">{title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
          </div>)}
        </div>
      </section>

      <section aria-labelledby="guide-steps">
        <div className="home-reveal"><p className="eyebrow">Getting started</p><h2 id="guide-steps" className="section-title mt-2">Four steps to your next lesson.</h2></div>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2">
          {guide.steps.map((step, index) => <li key={step.title} className="home-reveal flex items-start gap-4 rounded-2xl border border-brand-100 bg-white p-5 sm:p-6" style={{ '--reveal-delay': `${index % 2 * 50}ms` }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div><h3 className="card-title"><span className="sr-only">Step {index + 1}: </span>{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p></div>
          </li>)}
        </ol>
        <div className="home-reveal mt-5 flex items-start gap-3 rounded-2xl bg-brand-50 p-5">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <div><h3 className="text-sm font-bold text-navy">{guide.noteTitle}</h3><p className="mt-1 text-sm leading-relaxed text-slate-700">{guide.note}</p></div>
        </div>
      </section>

      <section aria-labelledby="guide-questions" className="home-reveal mx-auto max-w-3xl">
        <h2 id="guide-questions" className="section-title">A few things you might be wondering.</h2>
        <div className="mt-5 space-y-3">
          {guide.questions.map(([question, answer]) => <details key={question} className="card p-5 open:border-brand-300">
            <summary className="cursor-pointer py-1 font-semibold text-navy focus-visible:outline-2 focus-visible:outline-brand-500">{question}</summary><p className="mt-3 text-sm leading-relaxed text-slate-600">{answer}</p>
          </details>)}
        </div>
        <Link to="/faq" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-600 hover:underline">Explore all FAQs<Icon name="arrow-right" className="h-4 w-4" /></Link>
      </section>

      <section aria-labelledby="guide-next" className="home-reveal rounded-3xl bg-navy px-5 py-8 text-white sm:p-9">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl"><h2 id="guide-next" className="font-display text-2xl font-bold sm:text-3xl">{guide.finalTitle}</h2><p className="mt-3 leading-relaxed text-white/85">{guide.finalText}</p></div>
          <Link to={primary.to} className="btn min-h-12 bg-white px-6 text-navy hover:bg-brand-50 max-sm:w-full">{primary.label}<Icon name="arrow-right" className="h-4 w-4" /></Link>
        </div>
      </section>
    </article>
  )
}
