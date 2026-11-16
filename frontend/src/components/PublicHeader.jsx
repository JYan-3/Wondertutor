import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'
import SupportNavigation from './SupportNavigation'
import { homeFor } from './ProtectedRoute'

const LINKS = [
  ['Home', '/'],
  ['Find a Tutor', '/tutors'],
  ['For Parents', '/for-parents'],
  ['For Tutors', '/for-tutors'],
]

export default function PublicHeader({ user, pathname }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const header = useRef(null)
  const menuButton = useRef(null)
  const isActive = to => to === '/tutors'
    ? pathname === '/tutors' || pathname.startsWith('/tutors/')
    : pathname === to

  useEffect(() => {
    if (!menuOpen) return
    const dismiss = event => { if (!header.current?.contains(event.target)) setMenuOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menuOpen])

  function followLink(to) {
    setMenuOpen(false)
    // Same-page navigation does not rerun the layout's pathname scroll effect.
    if (pathname === to) window.scrollTo(0, 0)
  }

  return (
    <header ref={header} className="sticky top-0 z-30 w-full bg-white"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault()
          setMenuOpen(false)
          menuButton.current?.focus()
        }
      }}>
      <div className="mx-auto flex max-w-[81.25rem] items-center justify-between gap-3 px-4 py-2 md:px-8">
        <Link to="/" onClick={() => followLink('/')} aria-label="WonderTutor home" className="flex min-h-11 items-center">
          <Logo mark className="h-9 sm:hidden" />
          <Logo className="hidden h-9 sm:block" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-navy lg:flex">
          {LINKS.map(([label, to]) => <Link key={to} to={to} onClick={() => followLink(to)} aria-current={isActive(to) ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-sm border-b-[3px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 ${isActive(to) ? 'border-accent text-brand-500' : 'border-transparent hover:text-brand-500'}`}>{label}</Link>)}
          <SupportNavigation />
        </nav>
        <div className="flex items-center gap-2">
          {user ? <Link to={homeFor(user.role)} className="btn-primary min-h-11 px-4 sm:px-5">My Dashboard</Link> : <>
            <Link to="/login" aria-current={pathname === '/login' ? 'page' : undefined} className={`btn-outline min-h-11 whitespace-nowrap px-3 sm:px-5 ${pathname === '/login' ? 'bg-brand-50' : ''}`}>Log In</Link>
            <Link to="/signup" aria-current={pathname === '/signup' ? 'page' : undefined} className="btn-accent min-h-11 whitespace-nowrap px-3 sm:px-5">Sign Up</Link>
          </>}
          <button ref={menuButton} type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-navy hover:bg-brand-50 lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen(value => !value)}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && <nav id="mobile-menu" aria-label="Mobile" className="border-t border-brand-100 bg-white px-4 py-2 lg:hidden">
        <ul>
          {LINKS.map(([label, to]) => <li key={to}><Link to={to} onClick={() => followLink(to)} aria-current={isActive(to) ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-sm text-base font-medium focus-visible:outline-2 focus-visible:outline-brand-500 ${isActive(to) ? 'text-brand-500' : 'text-navy'}`}>{label}</Link></li>)}
          <li><SupportNavigation mobile onNavigate={() => setMenuOpen(false)} /></li>
        </ul>
      </nav>}
    </header>
  )
}
