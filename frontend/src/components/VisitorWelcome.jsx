import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from './ui/Icon'
import { Modal } from './ui/Common'

const CHOICE_KEY = 'wt-visitor-choice'
const CHOICES = ['PARENT', 'TUTOR', 'BROWSE']

function hasChosen() {
  try { return CHOICES.includes(sessionStorage.getItem(CHOICE_KEY)) } catch { return false }
}

// This only chooses public guidance. It never signs in or sets an account role.
export default function VisitorWelcome() {
  const { user, loading, sessionError } = useAuth()
  const [dismissed, setDismissed] = useState(hasChosen)
  const open = !dismissed && !loading && !sessionError && !user

  function choose(choice) {
    try { sessionStorage.setItem(CHOICE_KEY, choice) } catch { /* Dismissal still works if storage is unavailable. */ }
    setDismissed(true)
  }

  // A portal keeps the welcome above the sticky navigation and landing artwork.
  return createPortal(
    <Modal open={open} onClose={() => choose('BROWSE')} title="Welcome to WonderTutor" width="max-w-2xl motion-reduce:animate-none!">
      <div className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 via-brand-25 to-white p-4 sm:p-6">
        <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-8 -z-10 h-28 w-28 rounded-full bg-accent-100/70" />
        <p className="eyebrow hidden sm:block">A good place to begin</p>
        <h3 className="max-w-md font-display text-xl font-bold leading-tight text-navy sm:mt-2 sm:text-3xl">What brings you here today?</h3>
        <p className="mt-2 text-sm leading-5 text-slate-600 sm:mt-3 sm:leading-relaxed">Choose a guide to help you get started, or take a look around.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link to="/for-parents" onClick={() => choose('PARENT')} aria-label="I'm a Parent"
          className="group relative flex min-h-18 items-center gap-3 rounded-2xl border border-brand-100 bg-brand-25 p-3 text-navy hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-safe:transition-colors sm:min-h-44 sm:flex-col sm:items-stretch sm:p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-500 sm:h-10 sm:w-10"><Icon name="user" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold sm:text-xl">I’m a Parent</span><span className="mt-1 hidden text-sm leading-relaxed text-slate-600 sm:block">Find the right learning support for my child.</span></span>
          <Icon name="arrow-right" className="h-4 w-4 shrink-0 text-brand-500 sm:absolute sm:right-5 sm:top-7 sm:h-5 sm:w-5" />
        </Link>
        <Link to="/for-tutors" onClick={() => choose('TUTOR')} aria-label="I'm a Tutor"
          className="group relative flex min-h-18 items-center gap-3 rounded-2xl border border-accent-100 bg-accent-50/60 p-3 text-navy hover:border-accent hover:bg-accent-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-safe:transition-colors sm:min-h-44 sm:flex-col sm:items-stretch sm:p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-navy sm:h-10 sm:w-10"><Icon name="cap" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold sm:text-xl">I’m a Tutor</span><span className="mt-1 hidden text-sm leading-relaxed text-slate-600 sm:block">Share my teaching and manage my lessons.</span></span>
          <Icon name="arrow-right" className="h-4 w-4 shrink-0 sm:absolute sm:right-5 sm:top-7 sm:h-5 sm:w-5" />
        </Link>
      </div>
      <button type="button" onClick={() => choose('BROWSE')} className="btn-outline mt-3 min-h-12 w-full gap-2 sm:mt-4">Just Looking<Icon name="arrow-right" className="h-4 w-4" /></button>
      <p className="mt-3 hidden text-center text-xs leading-relaxed text-slate-500 sm:block">You can explore every guide. No account needed to look around.</p>
    </Modal>,
    document.body,
  )
}
