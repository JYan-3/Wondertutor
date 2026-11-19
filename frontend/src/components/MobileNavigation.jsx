import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { Modal } from './ui/Common'
import Icon from './ui/Icon'

export function MobileNavLink({ to, end, icon, children, onClick }) {
  return (
    <NavLink to={to} end={end} onClick={onClick}
      className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium ${isActive ? 'bg-brand-50 font-semibold text-brand-700 shadow-[inset_3px_0_var(--color-accent)]' : 'text-navy hover:bg-brand-25'}`}>
      <Icon name={icon} className="h-5 w-5 shrink-0" />
      {children}
    </NavLink>
  )
}

export default function MobileNavigation(props) {
  const location = useLocation()
  return <MobileMenu key={location.key} {...props} />
}

function MobileMenu({ children, title = 'Menu', navigationLabel = 'Mobile' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const closeMenu = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia?.('(min-width: 64rem)')
    function dismissOnDesktop() {
      if (desktop?.matches) setOpen(false)
    }
    dismissOnDesktop()
    desktop?.addEventListener('change', dismissOnDesktop)
    return () => desktop?.removeEventListener('change', dismissOnDesktop)
  }, [open])

  return (
    <>
      <button type="button" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-brand-100 bg-brand-25 px-2.5 text-sm font-semibold text-navy hover:bg-brand-50 sm:px-3 lg:hidden"
        onClick={event => { event.currentTarget.focus(); setOpen(true) }}>
        <Icon name="menu" className="h-5 w-5" /> Menu
      </button>
      {open && createPortal(
        <Modal id={id} open={open} onClose={closeMenu} title={title} placement="right" closeLabel="Close menu" layerClassName="z-[1100]">
          <nav aria-label={navigationLabel} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children(closeMenu)}
          </nav>
        </Modal>, document.body,
      )}
    </>
  )
}
