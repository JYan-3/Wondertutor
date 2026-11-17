import { useEffect } from 'react'
import { PageTitle } from './ui/Common'
import Icon from './ui/Icon'

export default function TutorPageHeader({ title, subtitle, right, dashboard = false }) {
  useEffect(() => {
    // Start each tutor page at its heading rather than the previous page's scroll position.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [])

  return (
    <div className={`tutor-heading relative isolate mb-6 overflow-hidden rounded-2xl ${dashboard ? 'tutor-heading-dashboard' : ''}`}>
      {dashboard ? <img
        src="/img/art/signup-tutor.jpg"
        alt=""
        className="tutor-heading-art absolute inset-y-0 right-0 -z-10 h-full w-[36%] object-cover sm:w-2/5"
      /> : <div aria-hidden="true" className="tutor-heading-sketch pointer-events-none absolute inset-y-0 right-0 w-14 sm:w-1/4">
        <span className="absolute right-2 top-4 grid h-9 w-9 rotate-12 place-items-center rounded-lg border-2 border-white bg-accent text-navy sm:right-[38%] sm:top-[22%] sm:h-14 sm:w-14">
          <Icon name="book" strokeWidth={1.6} className="h-5 w-5 sm:h-8 sm:w-8" />
        </span>
        <Icon name="edit" strokeWidth={1.5} className="absolute bottom-3 right-5 h-4 w-4 -rotate-12 text-amber-200 sm:right-[72%] sm:h-7 sm:w-7" />
        <Icon name="cap" strokeWidth={1.4} className="absolute right-[10%] top-1/3 hidden h-10 w-10 -rotate-12 text-amber-200 sm:block" />
      </div>}
      {dashboard && <span aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 rotate-12 drop-shadow-sm sm:bottom-4 sm:right-5">
        <Icon name="star" fill strokeWidth={1.6} className="h-8 w-8 text-accent [&>path]:stroke-white sm:h-11 sm:w-11" />
      </span>}
      <div className={dashboard
        ? 'flex min-h-40 w-2/3 flex-col justify-center break-words p-5 sm:min-h-48 sm:w-3/5 sm:p-8 [&>div]:mb-0'
        : 'break-words py-5 pl-5 pr-14 sm:w-3/4 sm:p-7 [&>div]:mb-0'}>
        {dashboard && <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-100">
          <Icon name="briefcase" className="h-4 w-4 text-amber-200" /> Tutor workspace
        </p>}
        <PageTitle title={title} subtitle={subtitle} right={right} sparkle={false} />
      </div>
    </div>
  )
}
