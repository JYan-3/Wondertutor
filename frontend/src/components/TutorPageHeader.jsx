import { useEffect } from 'react'
import { PageTitle } from './ui/Common'

export default function TutorPageHeader({ title, subtitle, right, dashboard = false }) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [])

  return <header className={`tutor-heading relative isolate mb-6 overflow-hidden rounded-2xl ${dashboard ? 'tutor-heading-dashboard' : ''}`}>
    <img src="/img/art/tutor-workspace.png" alt="" width="2172" height="724" className="tutor-heading-art pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-1/2 object-cover object-right" />
    <div className="tutor-heading-copy min-w-0 p-5 sm:p-7">
      {dashboard && <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-700">Your teaching day</p>}
      <PageTitle title={title} subtitle={subtitle} sparkle={false} />
    </div>
    {right && <div className="tutor-heading-actions relative flex min-w-0 flex-wrap gap-2 px-5 pb-5 sm:px-7">{right}</div>}
  </header>
}
