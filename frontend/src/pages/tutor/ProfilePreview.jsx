import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import VerificationCard from '../../components/VerificationCard'
import TutorPageHeader from '../../components/TutorPageHeader'
import { LoadError, ModePills, Spinner, VerifiedTick } from '../../components/ui/Common'
import { gradeLabel } from '../../lib/education'

// "Preview my profile": the public facts parents will see, built from the tutor's own setup data.
// Private details (phone, emergency contact, identity document) are deliberately left out, as on the real profile.
export default function ProfilePreview({ ownProfile = false }) {
  const [p, setP] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setP((await api.get('/tutor/profile')).data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <LoadError message={error} onRetry={load} />
  if (!p) return <Spinner />

  const quals = p.documents.filter((d) => d.kind === 'QUALIFICATION' && (ownProfile || d.status === 'APPROVED'))
  const verified = p.status === 'VERIFIED'

  return (
    <div className="space-y-5">
      <TutorPageHeader
        title={ownProfile ? 'My Profile' : 'Preview of your profile'}
        subtitle={ownProfile ? undefined : 'Check the teaching details parents see. Your contact details and identity documents stay private.'}
        right={<div className="flex flex-wrap gap-2">
          <Link to="/tutor/setup" className="btn-outline min-h-11 px-4"><Icon name="edit" className="h-4 w-4" /> Edit profile</Link>
          {ownProfile && <Link to="/tutor/preview" className="btn-outline min-h-11 px-4">View parent preview</Link>}
        </div>}
      />

      <section className="tutor-paper-blue card flex flex-wrap items-center gap-5 p-6">
        <Avatar src={p.profilePhotoUrl} name={p.fullName} className="h-20 w-20" text="text-2xl" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 break-words font-display text-2xl font-bold text-navy">
            {p.fullName} {verified && <VerifiedTick />}
          </h2>
          <p className="text-sm text-slate-600">{[...new Set(p.subjects.map((s) => s.subject))].join(', ') || 'No subjects yet'}{p.location ? ` · ${p.location}` : ''}</p>
          <div className="mt-2"><ModePills online={p.offersOnline} physical={p.offersPhysical} /></div>
        </div>
        <div className="w-full border-t border-brand-100 pt-4 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
          <div className="font-display text-2xl font-bold text-navy">{p.hourlyRate ? `RM ${p.hourlyRate}` : 'RM –'}<span className="text-sm font-normal text-slate-600"> / hour</span></div>
          <div className="text-xs text-slate-600">{p.yearsExperience} years of experience</div>
        </div>
      </section>

      <div className={ownProfile ? 'grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]' : ''}>
      <section className="card min-w-0 break-words p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-navy">Teaching details</h2>
          <img src="/img/art/teaching-folder.png" alt="" width="80" height="80" className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20" />
        </div>
        <h3 className="font-semibold text-navy">Subjects and levels</h3>
        {p.subjects.length ? (
          <ul className="my-2 divide-y divide-brand-100 rounded-xl bg-brand-25 px-3 text-sm">
            {p.subjects.map((s, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 py-2">
                <strong>{s.subject}</strong><span>{gradeLabel(s.educationLevel, s.minGrade)}{s.maxGrade !== s.minGrade ? ` – ${gradeLabel(s.educationLevel, s.maxGrade)}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-slate-600">No subjects added yet.</p>}
        <h3 className="mt-4 font-semibold text-navy">Introduction</h3>
        <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{p.bio || 'No introduction yet.'}</p>
        {p.teachingApproach && <><h3 className="mt-4 font-semibold text-navy">Teaching approach</h3><p className="mt-1 whitespace-pre-line text-sm">{p.teachingApproach}</p></>}
        {ownProfile && <Link to="/tutor/setup" state={{ step: 'teaching' }} className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand-700 underline">Edit teaching details</Link>}
      </section>
      {ownProfile && <VerificationCard profile={p} />}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Qualifications</h2>
          {ownProfile && <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline" to="/tutor/setup" state={{ step: 'documents' }}>Manage qualifications</Link>}
          {quals.length ? (
            <ul className="mt-2 space-y-1 text-sm text-navy">
              {quals.map((q) => (
                <li key={q.id} className="break-words">{q.title}{q.institution ? `, ${q.institution}` : ''}{q.year ? ` (${q.year})` : ''}{q.status === 'APPROVED' && <span className="ml-2 rounded-full bg-ok-50 px-2 py-1 text-xs font-semibold text-green-800">Verified qualification</span>}{q.status === 'PENDING' && <span className="text-slate-500"> · {p.submittedAt ? 'awaiting verification' : 'ready to submit'}</span>}{q.status === 'REJECTED' && <span className="text-red-700"> · rejected</span>}</li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-600">None uploaded yet.</p>}
        </section>
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Portfolio</h2>
          {ownProfile && <Link to="/tutor/setup" state={{ step: 'photo' }} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline">Manage portfolio</Link>}
          {p.portfolio.length ? (
            <ul className="mt-2 space-y-1 text-sm text-navy">{p.portfolio.map((x) => <li key={x.id}>{x.title}</li>)}</ul>
          ) : <p className="mt-2 text-sm text-slate-600">Nothing added yet.</p>}
        </section>
      </div>
    </div>
  )
}
