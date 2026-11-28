import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import VerificationCard from '../../components/VerificationCard'
import TutorPageHeader from '../../components/TutorPageHeader'
import { LoadError, Spinner, VerifiedTick } from '../../components/ui/Common'
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
        subtitle={ownProfile ? 'Your teaching profile, all in one place.' : 'Check the teaching details parents see. Your contact details and identity documents stay private.'}
      />

      <section className="tutor-profile-identity card grid min-w-0 items-center gap-5 p-5 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)_18rem]">
        <Avatar src={p.profilePhotoUrl} name={p.fullName} className="h-24 w-24 sm:h-36 sm:w-36" text="text-4xl" />
        <div className="min-w-0 space-y-2">
          <h2 className="flex flex-wrap items-center gap-2 break-words font-display text-3xl font-bold text-navy">{p.fullName} {verified && <VerifiedTick />}</h2>
          <p>{[...new Set(p.subjects.map(s => s.subject))].join(', ') || 'No subjects yet'} tutor</p>
          <p className="flex items-center gap-2"><Icon name="pin" className="h-5 w-5 shrink-0" />{p.location || 'Home area not added'}</p>
          <p className="flex items-center gap-2"><Icon name="monitor" className="h-5 w-5 shrink-0" />{p.offersOnline && p.offersPhysical ? 'Online & physical lessons' : p.offersOnline ? 'Online lessons' : p.offersPhysical ? 'Physical lessons' : 'Teaching mode not added'}</p>
          <p>RM {p.hourlyRate || '–'} / hour · {p.yearsExperience} years of experience</p>
        </div>
        <div className="tutor-profile-actions space-y-2 lg:border-l lg:border-brand-100 lg:pl-6">
          <Link to="/tutor/setup" className="btn-primary min-h-11 w-full"><Icon name="edit" className="h-5 w-5" />Edit profile</Link>
          {ownProfile && <Link to="/tutor/preview" className="btn-outline min-h-11 w-full"><Icon name="eye" className="h-5 w-5" />Preview public profile</Link>}
          <p className="text-center text-xs text-slate-600">A profile photo is optional.</p>
        </div>
      </section>

      <div className={ownProfile ? 'tutor-profile-sections grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}>
        <div className="min-w-0 space-y-3">
          <section className="card p-5"><h2 className="font-display text-2xl font-bold text-navy">About me</h2><p className="mt-2 whitespace-pre-line break-words">{p.bio || 'No introduction yet.'}</p></section>
          <section className="card p-5"><h2 className="font-display text-2xl font-bold text-navy">Subjects I teach</h2>
            {p.subjects.length ? <ul className="mt-2 divide-y divide-brand-100">{p.subjects.map((s, i) => <li key={i} className="flex flex-wrap items-center gap-2 py-3"><Icon name="book" className="h-5 w-5 shrink-0" /><strong>{s.subject}</strong><span>· {gradeLabel(s.educationLevel, s.minGrade)}{s.maxGrade !== s.minGrade ? ` – ${gradeLabel(s.educationLevel, s.maxGrade)}` : ''}</span></li>)}</ul> : <p className="mt-2">No subjects added yet.</p>}
          </section>
          <section className="card p-5"><h2 className="font-display text-2xl font-bold text-navy">Teaching approach</h2><p className="mt-2 whitespace-pre-line break-words">{p.teachingApproach || 'No teaching approach added yet.'}</p>
            {p.characteristics?.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{p.characteristics.map(c => <li key={c} className="rounded-full bg-brand-50 px-3 py-1 text-sm">{c}</li>)}</ul>}
            {ownProfile && <Link to="/tutor/setup" state={{ step: 'teaching' }} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline">Edit teaching details</Link>}
          </section>
      <div className="space-y-3">
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Qualifications <span className="font-sans text-sm font-normal text-slate-500">(optional)</span></h2>
          {ownProfile && <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline" to="/tutor/setup" state={{ step: 'documents' }}>Manage qualifications</Link>}
          {ownProfile && <p className="text-sm text-slate-600">Document previews are watermarked. A watermark cannot prevent screenshots, and deleting a document may not immediately remove every backup.</p>}
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
        {ownProfile && <VerificationCard profile={p} compact />}
      </div>
    </div>
  )
}
