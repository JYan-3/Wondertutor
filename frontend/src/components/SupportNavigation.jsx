import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from './ui/Icon'

const LINKS = [
  { to: '/how-it-works', label: 'How It Works', description: 'A guide to getting started', icon: 'book' },
  { to: '/faq', label: 'FAQ', description: 'Answers to common questions', icon: 'info' },
]

// A disclosure with ordinary links keeps keyboard and touch navigation familiar.
export default function SupportNavigation({ mobile = false, onNavigate }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const button = useRef(null)
  const panelId = useId()
  const active = LINKS.some(link => link.to === pathname)

  useEffect(() => {
    if (!open) return
    const dismiss = event => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <button ref={button} type="button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
        className={`flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 ${mobile ? 'w-full justify-between text-base' : 'border-b-[3px] text-sm'} ${!mobile && active ? 'border-accent text-brand-500' : 'border-transparent hover:text-brand-500'}`}>
        Support <Icon name="down" className={`h-4 w-4 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={panelId} className={mobile ? 'mb-2 rounded-2xl border border-accent-100 bg-brand-25 p-2' : 'absolute right-0 top-full z-40 w-64 pt-2'}>
          <ul className={mobile ? 'space-y-1' : 'space-y-1 rounded-2xl border border-brand-100 border-t-2 border-t-accent bg-white p-2 shadow-card'}>
            {LINKS.map(link => (
              <li key={link.to}>
                <Link to={link.to} aria-current={pathname === link.to ? 'page' : undefined}
                  onClick={() => { setOpen(false); onNavigate?.() }}
                  className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 text-navy hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 ${pathname === link.to ? 'bg-accent-50' : ''}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-navy"><Icon name={link.icon} className="h-5 w-5" /></span>
                  <span><span className="block text-sm font-semibold">{link.label}</span><span className="mt-0.5 block text-xs font-normal text-slate-600">{link.description}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
