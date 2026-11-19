import { Link } from 'react-router-dom'
import Logo from './Logo'
import MobileNavigation, { MobileNavLink } from './MobileNavigation'
import SupportNavigation, { MobileSupportLinks } from './SupportNavigation'
import { homeFor } from './ProtectedRoute'

const LINKS = [
  ['Home', '/', 'home'],
  ['Find a Tutor', '/tutors', 'search'],
  ['For Parents', '/for-parents', 'user'],
  ['For Tutors', '/for-tutors', 'cap'],
]

export default function PublicHeader({ user, pathname }) {
  const isActive = to => to === '/tutors'
    ? pathname === '/tutors' || pathname.startsWith('/tutors/')
    : pathname === to

  function followLink(to) {
    // Same-page navigation does not rerun the layout's pathname scroll effect.
    if (pathname === to) window.scrollTo(0, 0)
  }

  return (
    <header className="brand-header sticky top-0 z-30 w-full bg-white">
      <div className="mx-auto flex max-w-[81.25rem] items-center justify-between gap-3 px-4 py-2 md:px-8">
        <Link to="/" onClick={() => followLink('/')} aria-label="WonderTutor home" className="flex min-h-11 min-w-0 items-center">
          <Logo mark className="h-9 sm:hidden" />
          <Logo className="hidden h-9 max-w-full object-contain sm:block" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-navy lg:flex">
          {LINKS.map(([label, to]) => <Link key={to} to={to} onClick={() => followLink(to)} aria-current={isActive(to) ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-sm border-b-[3px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 ${isActive(to) ? 'border-accent text-brand-500' : 'border-transparent hover:text-brand-500'}`}>{label}</Link>)}
          <SupportNavigation />
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {user ? <Link to={homeFor(user.role)} className="btn-primary min-h-11 px-4 sm:px-5">My Dashboard</Link> : <>
            <Link to="/tutors" onClick={() => followLink('/tutors')} className="btn-accent min-h-11 px-3 lg:hidden">Find a Tutor</Link>
            <div className="hidden items-center gap-2 lg:flex">
              <Link to="/login" aria-current={pathname === '/login' ? 'page' : undefined} className={`btn-outline min-h-11 whitespace-nowrap px-5 ${pathname === '/login' ? 'bg-brand-50' : ''}`}>Log In</Link>
              <Link to="/signup" aria-current={pathname === '/signup' ? 'page' : undefined} className="btn-accent min-h-11 whitespace-nowrap px-5">Sign Up</Link>
            </div>
          </>}
          <MobileNavigation>
            {closeMenu => <>
              {LINKS.map(([label, to, icon]) => (
                <MobileNavLink key={to} to={to} icon={icon} end={to !== '/tutors'}
                  onClick={() => { closeMenu(); followLink(to) }}>
                  {label}
                </MobileNavLink>
              ))}
              <h3 className="mx-3 mb-1 mt-4 border-t border-brand-100 pt-4 text-sm font-semibold text-slate-600">Account</h3>
              {user ? <MobileNavLink to={homeFor(user.role)} icon="monitor" onClick={closeMenu}>My Dashboard</MobileNavLink> : <>
                <MobileNavLink to="/login" icon="lock" onClick={closeMenu}>Log In</MobileNavLink>
                <MobileNavLink to="/signup" icon="user" onClick={closeMenu}>Sign Up</MobileNavLink>
              </>}
              <h3 className="mx-3 mb-1 mt-4 border-t border-brand-100 pt-4 text-sm font-semibold text-slate-600">Support</h3>
              <MobileSupportLinks onNavigate={closeMenu} />
            </>}
          </MobileNavigation>
        </div>
      </div>
    </header>
  )
}
