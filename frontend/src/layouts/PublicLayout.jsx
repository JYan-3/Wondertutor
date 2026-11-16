import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import Logo from '../components/Logo'
import PublicHeader from '../components/PublicHeader'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../components/ProtectedRoute'

// Public browsing stays open; only account actions require a signed-in parent.
const footerLink = 'inline-flex min-h-9 items-center text-slate-700 hover:text-brand-600 hover:underline'

export default function PublicLayout() {
  const { pathname, hash } = useLocation()
  // Someone who is already logged in (e.g. reading the Privacy Notice) is offered their dashboard, not Log In / Sign Up
  const { user } = useAuth()
  const isHome = pathname === '/'
  // The login page is a single screen: no footer, and the page fills the window height so nothing needs scrolling
  const isLogin = pathname === '/login'
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash])
  return (
    <div className={"flex min-h-screen flex-col overflow-x-clip"}>
      {/* A new page starts with closed menus, including browser back/forward. */}
      <PublicHeader key={pathname} user={user} pathname={pathname} />
      <main className={`${isLogin ? 'flex w-full flex-1 flex-col' : 'mx-auto w-full max-w-[81.25rem] px-3 md:px-6'} ${isHome || isLogin ? '' : 'pb-10'}`}>
        <Outlet />
      </main>
      {!isLogin && (
      <footer id="about" className={`scroll-mt-24 bg-brand-50 text-sm text-slate-700 ${isHome ? '' : 'mt-2'}`}>
        <div className="mx-auto grid max-w-[81.25rem] gap-8 px-4 py-8 md:px-8 lg:grid-cols-[26rem_1fr] lg:gap-16">
          <div>
            <Logo className="h-9" />
            <p className="mt-3 max-w-sm">A trusted tutoring platform connecting parents and tutors for a brighter tomorrow. Built with Wonderland Learning Materials &amp; Tuition Centre.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3 lg:max-w-2xl">
            <nav aria-label="Platform">
              <h2 className="mb-2 font-display text-base font-bold text-navy">Platform</h2>
              <ul className="space-y-1">
                <li><Link to="/tutors" className={footerLink}>Find a Tutor</Link></li>
                <li><Link to="/for-parents" className={footerLink}>For Parents</Link></li>
                <li><Link to="/for-tutors" className={footerLink}>For Tutors</Link></li>
              </ul>
            </nav>
            <nav aria-label="Support">
              <h2 className="mb-2 font-display text-base font-bold text-navy">Support</h2>
              <ul className="space-y-1">
                <li><Link to="/how-it-works" className={footerLink}>How It Works</Link></li>
                <li><Link to="/faq" className={footerLink}>FAQ</Link></li>
                {user
                  ? <li><Link to={homeFor(user.role)} className={footerLink}>My Dashboard</Link></li>
                  : <><li><Link to="/login" className={footerLink}>Log In</Link></li><li><Link to="/signup" className={footerLink}>Sign Up</Link></li></>}
                <li><Link to="/privacy" className={footerLink}>Privacy Notice</Link></li>
              </ul>
            </nav>
            <div>
              <h2 className="mb-2 font-display text-base font-bold text-navy">Contact</h2>
              <p className="flex min-h-9 items-start gap-2 pt-1.5">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                Banting, Selangor, Malaysia
              </p>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[81.25rem] px-4 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-brand-200/70 py-4 text-sm text-slate-600">
            <span>&copy; {new Date().getFullYear()} WonderTutor. All rights reserved.</span>
            <span>Learn Today, Brighter Tomorrow.</span>
          </div>
        </div>
      </footer>
      )}
    </div>
  )
}
