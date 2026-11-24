import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, PageTitle, SectionCard, Spinner } from '../../components/ui/Common'
import Icon from '../../components/ui/Icon'
import './Quizzes.css'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'
import { gradeLabel } from '../../lib/education'
import { fmtDate } from '../../lib/format'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'

function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function ParentQuizzes() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const updateParams = useRef(setParams)
  useEffect(() => { updateParams.current = setParams }, [setParams])
  const requestId = useRef('')
  const mounted = useRef(false), loadRequest = useRef(0), viewRequest = useRef(0), submitting = useRef(false)
  const session = useRef(null)
  const questionStart = useRef(null), reviewStart = useRef(null), focusNavigation = useRef(false)
  const [quizzes, setQuizzes] = useState([]), [children, setChildren] = useState([]), [history, setHistory] = useState([])
  const [quiz, setQuiz] = useState(null), [result, setResult] = useState(null), [board, setBoard] = useState(null)
  const [nickname, setNickname] = useState(''), [answers, setAnswers] = useState([])
  const [search, setSearch] = useState(''), [subject, setSubject] = useState(''), [level, setLevel] = useState(''), [reviewing, setReviewing] = useState(false), [step, setStep] = useState(0)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [resultLoading, setResultLoading] = useState(false), [resultRetry, setResultRetry] = useState(0), [savedAttemptId, setSavedAttemptId] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const attemptParam = params.get('attempt') || '', childParam = params.get('child') || ''
  const selectedChild = children.find(c => matchesRecordRef(c, childParam))
  const child = String(selectedChild?.id || '')
  const dirty = Boolean(quiz && answers.some(a => a.trim()))
  useEffect(() => { session.current = { dirty } }, [dirty])
  useUnsavedWarning(dirty, 'You have unfinished quiz answers. Leave without submitting?')
  const setAttemptParam = useCallback(id => updateParams.current(previous => {
    const next = new URLSearchParams(previous)
    if (id) next.set('attempt', String(id)); else next.delete('attempt')
    return next
  }, { replace: true }), [])
  const load = useCallback(async () => {
    const current = ++loadRequest.current
    setLoading(true); setError('')
    try {
      const [q, c, h] = await Promise.all([api.get('/parent/quizzes'), api.get('/parent/children'), api.get('/parent/quiz-attempts')])
      if (!mounted.current || current !== loadRequest.current) return
      setQuizzes(q.data.quizzes); setChildren(c.data.children); setHistory(h.data.attempts); setHistoryError('')
    } catch (e) {
      if (mounted.current && current === loadRequest.current) setError(errorMessage(e))
    } finally { if (mounted.current && current === loadRequest.current) setLoading(false) }
  }, [])
  const refreshHistory = useCallback(async () => {
    try {
      const response = await api.get('/parent/quiz-attempts')
      if (mounted.current) { setHistory(response.data.attempts); setHistoryError('') }
    } catch { if (mounted.current) setHistoryError('Your quiz was submitted, but the attempt list could not refresh.') }
  }, [])
  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false }
  }, [load])
  useEffect(() => {
    if (!focusNavigation.current) return
    focusNavigation.current = false
    const target = reviewing ? reviewStart.current : questionStart.current
    target?.focus({ preventScroll: true })
    target?.scrollIntoView?.({ block: 'start' })
  }, [step, reviewing])
  useEffect(() => {
    const current = ++viewRequest.current
    let active = true
    if (!attemptParam) { setResult(null); setResultLoading(false); return }
    if (submitting.current || (session.current.dirty && !window.confirm('Discard your answers and view this result?'))) {
      setAttemptParam(null)
      return
    }
    setQuiz(null); setBoard(null); setResult(null); setError(''); setBusy(false)
    if (!/^[1-9]\d*$/.test(attemptParam)) { setResultLoading(false); setError('This quiz result link is invalid.'); return }
    setResultLoading(true)
    api.get(`/parent/quiz-attempts/${attemptParam}`)
      .then(response => {
        if (!active || !mounted.current || current !== viewRequest.current) return
        const fresh = response.data
        setResult(fresh); setSavedAttemptId(null)
        setHistory(previous => previous.map(attempt => attempt.id === fresh.id ? { ...attempt, status: fresh.status, score: fresh.status === 'PENDING' ? null : fresh.score, maxScore: fresh.maxScore } : attempt))
      })
      .catch(e => { if (active && mounted.current && current === viewRequest.current) setError(errorMessage(e)) })
      .finally(() => { if (active && mounted.current && current === viewRequest.current) setResultLoading(false) })
    return () => { active = false }
  // A result-ready notification can navigate to the same attempt already open here.
  }, [attemptParam, location.key, resultRetry, setAttemptParam])
  const chooseChild = value => {
    setParams(previous => { const next = new URLSearchParams(previous); const selected = children.find(c => String(c.id) === value); if (selected) next.set('child', String(recordRef(selected))); else next.delete('child'); return next }, { replace: true })
  }
  const goToQuestion = index => {
    if (index === step && !reviewing) { questionStart.current?.focus({ preventScroll: true }); questionStart.current?.scrollIntoView?.({ block: 'start' }); return }
    focusNavigation.current = true; setStep(index); setReviewing(false)
  }
  const reviewAnswers = () => {
    const missing = answers.findIndex((answer, index) => !validAnswer(quiz.questions[index], answer))
    if (!child || !nickname.trim()) { setError('Choose a child and enter a nickname.'); return }
    if (missing >= 0) { setError(`Question ${missing + 1} needs an answer.`); goToQuestion(missing); return }
    setError(''); focusNavigation.current = true; setReviewing(true)
  }
  const open = q => { if (submitting.current) return; ++viewRequest.current; focusNavigation.current = false; requestId.current = newRequestId(); setAttemptParam(null); setReviewing(false); setStep(0); setQuiz(q); setAnswers(q.questions.map(() => '')); setResult(null); setBoard(null); setError(''); setSavedAttemptId(null); setResultLoading(false) }
  const showResult = id => { if (!submitting.current) setAttemptParam(id) }
  const submit = async e => {
    e.preventDefault()
    if (!reviewing || !quiz || submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const response = await api.post(`/parent/quizzes/${quiz.id}/attempts`, { requestId: requestId.current, childId: Number(child), versionId: quiz.versionId, nickname, answers })
      if (!mounted.current) return
      // Once accepted, recovery only fetches this attempt; it never submits the answers again.
      setQuiz(null); setAnswers([]); setReviewing(false); setSavedAttemptId(response.data.id); setAttemptParam(response.data.id)
      refreshHistory()
    } catch (e) { if (mounted.current) setError(errorMessage(e)) }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  const showBoard = async q => {
    const current = ++viewRequest.current
    setBusy(true); setError('')
    try { const response = await api.get(`/parent/quizzes/${q.id}/leaderboard?version=${q.versionId}`); if (mounted.current && current === viewRequest.current) { setBoard({ quiz: q, entries: response.data.leaderboard }); setQuiz(null); setResult(null) } }
    catch (e) { if (mounted.current && current === viewRequest.current) setError(errorMessage(e)) }
    finally { if (mounted.current && current === viewRequest.current) setBusy(false) }
  }
  const back = () => { if (submitting.current || (dirty && !window.confirm('Discard your answers?'))) return; ++viewRequest.current; setAttemptParam(null); setQuiz(null); setResult(null); setBoard(null); setResultLoading(false); setBusy(false); setSavedAttemptId(null); setError('') }
  const visibleHistory = child ? history.filter(a => matchesRecordRef(a.child, child)) : history
  const visible = quizzes.filter(q => `${q.title} ${q.subject} ${q.tutor}`.toLowerCase().includes(search.toLowerCase()) && (!subject || q.subject === subject) && (!level || q.level === level))
  const answered = quiz ? quiz.questions.filter((q, i) => validAnswer(q, answers[i])).length : 0
  return <div className="parent-quiz min-w-0 space-y-4">
    <div className="parent-quiz-page-header"><PageTitle title="Quizzes" subtitle="Find a quiz, practise and see your progress." /><img src="/img/art/student-workbook.png" alt="" aria-hidden="true" /></div>
    {!quiz && <ErrorBox>{error}</ErrorBox>}
    {historyError && <div className="card p-4"><p role="status" className="text-sm">{historyError}</p><button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={refreshHistory}>Refresh attempts</button></div>}
    {error && !quiz && !result && !board && !attemptParam && <button type="button" className="btn-outline min-h-11" onClick={load}>Try again</button>}
    {(quiz || result || board || attemptParam) && <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={back}><Icon name="arrow-left" className="h-4 w-4" /> Back to quizzes</button>}
    {resultLoading ? <Spinner label="Loading quiz result…" /> : attemptParam && !result && !quiz ? <SectionCard title={savedAttemptId ? 'Quiz submitted' : 'Quiz result unavailable'}><p>{savedAttemptId ? 'Your answers have been saved. You can retry loading this result safely.' : 'We could not open this result. Retry or return to your quizzes.'}</p>{/^[1-9]\d*$/.test(attemptParam) && <button type="button" className="btn-primary mt-4 min-h-11" onClick={() => setResultRetry(n => n + 1)}>Retry loading result</button>}</SectionCard> : quiz ? <form className="space-y-4" onSubmit={submit}><fieldset disabled={busy} className="min-w-0 space-y-4">
      <div className="parent-quiz-welcome"><div className="parent-quiz-welcome-icon" aria-hidden="true"><Icon name="trophy" className="h-7 w-7" /></div><div><h2 className="font-display text-xl font-bold text-navy sm:text-2xl">Ready to practise?</h2><p className="text-sm text-slate-700 sm:text-base">Take a quiz and see how your child is doing.</p></div></div>
      <section className="parent-quiz-session card min-w-0 p-4 sm:p-6" aria-labelledby="quiz-session-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><span className="parent-quiz-kicker"><Icon name="sparkle" className="h-4 w-4" /> Quiz details</span>
            <h2 id="quiz-session-title" className="mt-2 break-words font-display text-2xl font-bold text-navy">{quiz.title}</h2>
            <p className="mt-1 break-words text-sm text-slate-600">{quiz.description}</p>
            <p className="mt-2 text-sm text-slate-600">{quiz.subject} · {gradeLabel(quiz.level, quiz.grade)} · {quiz.tutor}</p>
          </div>
          <span className="parent-quiz-badge"><Icon name="book" className="h-4 w-4" /> {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">{quiz.questions.some(q => q.type === 'LONG') ? 'Long answers will be marked by the tutor.' : 'Answers are marked automatically.'}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold text-navy">Choose your child<select required className="input mt-1 min-h-11 text-base font-normal" value={child} onChange={e => chooseChild(e.target.value)}><option value="">Choose child</option>{children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-semibold text-navy">Leaderboard nickname<input required minLength={2} maxLength={30} className="input mt-1 min-h-11 text-base font-normal" value={nickname} onChange={e => setNickname(e.target.value)} /><span className="mt-1 block text-xs font-normal text-slate-600">Other parents can see this nickname. Do not use your child’s full name. Use letters, numbers, spaces, hyphens or underscores.</span></label>
        </div>
      </section>
      {reviewing ? <div ref={reviewStart} tabIndex={-1} aria-label="Review your answers" className="scroll-mt-24"><SectionCard title="Review your answers">
        <p>Check your answers before submitting.</p>
        <ol className="mt-4 space-y-2">{quiz.questions.map((q, i) => <li key={i} className="parent-quiz-review-row rounded-xl border border-brand-100 p-3"><strong>Question {i + 1}:</strong> {q.text}<p className="whitespace-pre-wrap break-words text-sm">{validAnswer(q, answers[i]) ? `Your answer: ${reviewAnswer(q, answers[i])}` : 'Not answered'}</p><button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => goToQuestion(i)}>Edit answer</button></li>)}</ol>
        <ErrorBox className="mt-3">{error}</ErrorBox>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-outline min-h-11" onClick={() => goToQuestion(step)}>Continue editing</button><button disabled={busy} className="btn-primary min-h-11">{busy ? 'Submitting…' : 'Confirm submission'}</button></div>
      </SectionCard></div> : <div className="parent-quiz-play-layout"><div className="min-w-0 space-y-4">
        <section className="parent-quiz-question card min-w-0 overflow-hidden" aria-labelledby="quiz-question-title">
          <div className="parent-quiz-progress p-4 sm:px-6 sm:py-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="quiz-question-title" ref={questionStart} tabIndex={-1} className="scroll-mt-24 font-display text-xl font-bold text-navy" aria-live="polite">Question {step + 1} of {quiz.questions.length}</h2><span className="text-sm font-semibold text-brand-700">{answered} of {quiz.questions.length} answered</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={quiz.questions.length} aria-valuenow={answered}><div className="h-full rounded-full bg-brand-500" style={{ width: `${answered / quiz.questions.length * 100}%` }} /></div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Question navigation">{quiz.questions.map((q, i) => <button key={i} type="button" aria-label={`Question ${i + 1}${validAnswer(q, answers[i]) ? ', answered' : ', not answered'}`} aria-current={i === step ? 'step' : undefined} onClick={() => goToQuestion(i)} className={`parent-quiz-step ${i === step ? 'is-current' : validAnswer(q, answers[i]) ? 'is-answered' : ''}`}>{i + 1}</button>)}</div>
          </div>
          <div className="p-4 sm:p-6"><p className="mb-4 whitespace-pre-wrap break-words text-lg font-bold text-navy">{quiz.questions[step].text} <span className="text-sm font-medium text-slate-500">· {quiz.questions[step].points} {quiz.questions[step].points === 1 ? 'point' : 'points'}</span></p>
            {quiz.questions[step].imageUrl && <img src={quiz.questions[step].imageUrl} alt="Question illustration" className="mb-4 max-h-72 max-w-full rounded-xl object-contain" />}
            <AnswerInput q={quiz.questions[step]} index={step} value={answers[step]} onChange={value => setAnswers(a => a.map((x, j) => j === step ? value : x))} playful />
          </div>
        </section>
        <ErrorBox>{error}</ErrorBox><div className="flex flex-wrap justify-between gap-2"><button type="button" className="btn-outline min-h-11 flex-1 sm:flex-none" disabled={step === 0} onClick={() => goToQuestion(step - 1)}>Previous</button>{step < quiz.questions.length - 1 ? <button type="button" className="btn-primary min-h-11 flex-1 sm:flex-none" onClick={() => goToQuestion(step + 1)}>Next <Icon name="arrow-right" className="h-4 w-4" /></button> : <button type="button" className="btn-primary min-h-11 flex-1 sm:flex-none" onClick={reviewAnswers}>Review answers</button>}</div>
      </div><QuizLeaderboard key={`${quiz.id}-${quiz.versionId}`} quiz={quiz} /></div>}
    </fieldset></form>
    : result ? <>
      <section className="parent-quiz-result card p-5 sm:p-6"><span className="parent-quiz-kicker"><Icon name="award" className="h-4 w-4" /> Quiz results</span><h2 className="mt-2 break-words font-display text-2xl font-bold text-navy">{result.version.content.title || result.version.quiz.title}</h2>{(result.child?.name || result.createdAt) && <p className="mt-2 text-sm text-slate-600">{result.child?.name}{result.child?.name && result.createdAt ? ' · ' : ''}{result.createdAt && <time dateTime={result.createdAt}>{fmtDate(result.createdAt)}</time>}</p>}<p className="mt-3 text-lg font-bold">{result.status === 'PENDING' ? `Awaiting tutor review · ${result.score} / ${result.maxScore} points marked so far` : `Final score: ${result.score} / ${result.maxScore}`}</p>{result.status === 'PENDING' && <button type="button" className="btn-outline mt-3 min-h-11" onClick={() => setResultRetry(n => n + 1)}><Icon name="refresh" className="h-4 w-4" /> Refresh result</button>}{result.advice && <p className="mt-3 whitespace-pre-wrap break-words"><strong>Tutor advice:</strong> {result.advice}</p>}</section>
      {result.version.content.questions.map((q, i) => <SectionCard key={i} title={`Question ${i + 1}`}><p className="whitespace-pre-wrap break-words">{q.text}</p>{q.imageUrl && <img src={q.imageUrl} alt="Question illustration" className="my-3 max-h-72 max-w-full rounded-lg" />}<p className="mt-2 whitespace-pre-wrap break-words">Your answer: {showAnswer(q, result.answers[i]?.answer ?? '')}</p><p>Score: {result.answers[i]?.score ?? 'Awaiting review'} / {q.points}</p>{['CHOICE', 'TRUE_FALSE', 'MULTIPLE', 'MATCH', 'ORDER', 'SHORT', 'FILL'].includes(q.type) && <p className="break-words">Correct answer: {correctAnswer(q)}</p>}{q.explanation && <p className="mt-2 whitespace-pre-wrap break-words">Explanation: {q.explanation}</p>}{result.answers[i]?.feedback && <p className="mt-2 whitespace-pre-wrap break-words">Tutor feedback: {result.answers[i]?.feedback}</p>}</SectionCard>)}
      {quizzes.find(q => q.id === result.version.quizId) && <button className="btn-primary min-h-11" onClick={() => open(quizzes.find(q => q.id === result.version.quizId))}><Icon name="refresh" className="h-4 w-4" /> Try again</button>}
    </>
    : board ? <SectionCard title={`${board.quiz.title} leaderboard`}><p className="mb-3 text-sm text-slate-600">Shows each learner’s latest fully marked score.</p>{board.entries.length ? <ol className="space-y-2">{board.entries.map((a, i) => <li key={i} className="parent-quiz-rank flex min-h-14 items-center gap-3 rounded-xl p-3"><span className="parent-quiz-rank-number" aria-label={`Rank ${a.rank}`}>{a.rank}</span><span className="min-w-0 flex-1 break-words font-semibold">{a.nickname}</span><strong>{a.score} / {a.maxScore}</strong></li>)}</ol> : <p>No completed scores yet.</p>}</SectionCard>
    : <>
      <section className="parent-quiz-hero card relative min-w-0 overflow-hidden p-5 sm:p-7"><div className="parent-quiz-hero-copy relative z-10"><span className="parent-quiz-kicker"><Icon name="sparkle" className="h-4 w-4" /> Practice zone</span><h2 className="mt-2 font-display text-2xl font-bold text-navy sm:text-3xl">A little practice goes a long way.</h2><p className="mt-2 max-w-lg text-sm text-slate-600 sm:text-base">Pick a tutor’s quiz and learn one question at a time.</p></div><img src="/img/art/student-workbook.png" alt="" aria-hidden="true" className="parent-quiz-hero-art" /></section>
      {!loading && !children.length && !error && <SectionCard title="Add a child to start practising"><p>Save your child’s details so their quiz scores and tutor feedback are saved with their quiz attempts.</p><Link className="btn-primary mt-4 min-h-11" to="/parent/children?add=1"><Icon name="plus" className="h-4 w-4" /> Add a child</Link></SectionCard>}
      {!loading && childParam && !selectedChild && children.length > 0 && <p role="status" className="text-sm text-slate-600">The linked child could not be found. Choose one of your children below.</p>}
      <SectionCard title="Find a quiz"><div className="grid gap-3 sm:grid-cols-3"><label>Search<input className="input min-h-11 text-base" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Subject<select className="input min-h-11 text-base" value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{[...new Set(quizzes.map(q => q.subject))].map(s => <option key={s}>{s}</option>)}</select></label><label>Level<select className="input min-h-11 text-base" value={level} onChange={e => setLevel(e.target.value)}><option value="">All levels</option><option value="KINDERGARTEN">Kindergarten</option><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option></select></label></div></SectionCard>
      {loading ? <Spinner label="Loading quizzes…" /> : <>
        {visible.length > 0 && <div className="flex items-center justify-between gap-2"><h2 className="font-display text-xl font-bold text-navy">Quizzes to explore</h2><span className="text-sm text-slate-600">{visible.length} {visible.length === 1 ? 'quiz' : 'quizzes'}</span></div>}
        <div className="grid gap-4 md:grid-cols-2">{visible.map(q => <article key={q.id} className="parent-quiz-card card min-w-0 p-4 sm:p-5"><div className="flex items-start gap-3"><div className="parent-quiz-icon" aria-hidden="true"><Icon name="book" className="h-6 w-6" /></div><div className="min-w-0 flex-1"><span className="parent-quiz-badge">{q.subject}</span><h3 className="mt-2 break-words font-display text-xl font-bold text-navy">{q.title}</h3><p className="mt-1 break-words text-sm text-slate-600">{q.description}</p></div></div><p className="mt-4 break-words text-sm text-slate-600">{gradeLabel(q.level, q.grade)} · {q.questions.length} {q.questions.length === 1 ? 'question' : 'questions'} · {q.tutor}</p><div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary min-h-11 flex-1 sm:flex-none" disabled={busy || !children.length} onClick={() => open(q)}>Start quiz <Icon name="arrow-right" className="h-4 w-4" /></button><button className="btn-outline min-h-11 flex-1 sm:flex-none" disabled={busy} onClick={() => showBoard(q)}><Icon name="trophy" className="h-4 w-4" /> Leaderboard</button></div></article>)}</div>
        {!visible.length && !error && <div className="parent-quiz-empty card p-5 text-center"><Icon name="search" className="mx-auto h-7 w-7 text-brand-500" /><p className="mt-2 font-semibold text-navy">No quizzes found.</p><p className="mt-1 text-sm text-slate-600">Try another search or filter, or check back later.</p></div>}
      </>}
      <SectionCard title="Your children’s attempts">
        {children.length > 0 && <label className="mb-3 block text-sm font-semibold text-navy">Attempts for<select className="input mt-1 min-h-11 text-base font-normal sm:max-w-xs" value={child} onChange={e => chooseChild(e.target.value)}><option value="">All children</option>{children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {loading ? <p>Loading attempts…</p> : visibleHistory.length ? visibleHistory.map(a => <button type="button" className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 border-b border-brand-100 py-3 text-left" key={a.id} disabled={busy} onClick={() => showResult(a.id)}><span className="min-w-0 break-words"><span className="block font-semibold">{a.child.name} · {a.version.content?.title || a.version.quiz.title}</span>{a.createdAt && <time dateTime={a.createdAt} className="mt-1 block text-sm text-slate-600">{fmtDate(a.createdAt)}</time>}</span><span className="font-semibold text-brand-700">{a.status === 'PENDING' ? 'Awaiting tutor review' : `${a.score} / ${a.maxScore}`} →</span></button>) : <p>{selectedChild ? `No attempts yet for ${selectedChild.name}.` : 'No attempts yet.'}</p>}
      </SectionCard>
    </>}
  </div>
}

function QuizLeaderboard({ quiz }) {
  const [data, setData] = useState({ loading: true, entries: [], error: false })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    api.get(`/parent/quizzes/${quiz.id}/leaderboard?version=${quiz.versionId}`)
      .then(({ data: response }) => { if (active) setData({ loading: false, entries: Array.isArray(response.leaderboard) ? response.leaderboard : [], error: false }) })
      .catch(() => { if (active) setData({ loading: false, entries: [], error: true }) })
    return () => { active = false }
  }, [quiz.id, quiz.versionId, retry])
  return <aside className="parent-quiz-leaderboard card min-w-0 p-5" aria-labelledby="quiz-leaderboard-title">
    <div className="flex items-center gap-2"><Icon name="trophy" className="h-6 w-6 text-brand-600" /><h2 id="quiz-leaderboard-title" className="font-display text-xl font-bold text-navy">Leaderboard</h2></div>
    <p className="mt-2 text-sm text-slate-600">Top 5 latest fully marked scores for this quiz.</p>
    {data.loading ? <p className="mt-4 text-sm" role="status">Loading leaderboard…</p> : data.error ? <div className="mt-4 text-sm"><p>Could not load the leaderboard.</p><button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => { setData({ loading: true, entries: [], error: false }); setRetry(n => n + 1) }}>Try again</button></div> : data.entries.length ? <ol className="mt-4 space-y-2">{data.entries.slice(0, 5).map((entry, i) => <li key={i} className="parent-quiz-rank flex min-h-14 items-center gap-3 rounded-xl p-3"><span className="parent-quiz-rank-number" aria-label={`Rank ${entry.rank}`}>{entry.rank}</span><span className="min-w-0 flex-1 break-words font-semibold">{entry.nickname}</span><strong className="shrink-0">{entry.score} / {entry.maxScore}</strong></li>)}</ol> : <p className="mt-4 text-sm text-slate-600">No completed scores yet. Be the first to finish!</p>}
    <img src="/img/art/student-workbook.png" alt="" aria-hidden="true" className="parent-quiz-leaderboard-art" />
  </aside>
}

function parseList(value) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
function validAnswer(q, value) {
  if (!value?.trim()) return false
  if (!['MULTIPLE', 'MATCH', 'ORDER'].includes(q.type)) return true
  const values = parseList(value)
  if (!values.length || values.some(n => !Number.isInteger(n) || n < 0) || new Set(values).size !== values.length) return false
  return q.type === 'MULTIPLE' || values.length === q.options.length
}
export function AnswerInput({ q, index, value, onChange, playful = false }) {
  const optionClass = selected => playful ? `parent-quiz-option ${selected ? 'is-selected' : ''}` : 'my-2 flex min-h-11 items-center gap-3 rounded-lg border border-brand-100 p-3'
  const optionText = (v, n, selected) => <>{playful && <span className="parent-quiz-option-letter" aria-hidden="true">{String.fromCharCode(65 + n)}</span>}<span className="min-w-0 flex-1 break-words">{v}</span>{playful && selected && <span className="text-xs font-bold text-brand-700">Selected</span>}</>
  if (['CHOICE', 'TRUE_FALSE'].includes(q.type)) return <fieldset><legend className="sr-only">Choose an answer</legend><div className={playful ? 'grid gap-2 sm:grid-cols-2' : ''}>{q.options.map((v, n) => { const selected = value === String(n); return <label key={n} className={optionClass(selected)}><input type="radio" aria-label={v} className="h-4 w-4 shrink-0 accent-brand-500" name={`q${index}`} checked={selected} onChange={() => onChange(String(n))} />{optionText(v, n, selected)}</label> })}</div></fieldset>
  if (q.type === 'MULTIPLE') { const values = parseList(value); return <fieldset><legend className="mb-2 text-sm font-semibold text-navy">Select all correct answers</legend><div className={playful ? 'grid gap-2 sm:grid-cols-2' : ''}>{q.options.map((v, n) => { const selected = values.includes(n); return <label key={n} className={optionClass(selected)}><input type="checkbox" aria-label={v} className="h-4 w-4 shrink-0 accent-brand-500" checked={selected} onChange={e => onChange(JSON.stringify(e.target.checked ? [...values, n] : values.filter(x => x !== n)))} />{optionText(v, n, selected)}</label> })}</div></fieldset> }
  if (['MATCH', 'ORDER'].includes(q.type)) { const current = parseList(value); return <fieldset><legend>{q.type === 'MATCH' ? 'Choose the matching answer for each item' : 'Choose each item in the correct order'}</legend>{q.options.map((v, i) => <label key={i} className="my-2 block rounded-lg border border-brand-100 p-3">{q.type === 'MATCH' ? v : `Position ${i + 1}`}<select aria-label={q.type === 'MATCH' ? `Match for ${v}` : `Position ${i + 1}`} className="input mt-1 text-base" value={current[i] ?? ''} onChange={e => { const next = Array.from({ length: q.options.length }, (_, n) => current[n] ?? -1); next[i] = e.target.value === '' ? -1 : Number(e.target.value); onChange(JSON.stringify(next)) }}><option value="">Choose</option>{(q.type === 'MATCH' ? q.choices : q.options).map((o, n) => <option key={n} value={n}>{o}</option>)}</select></label>)}</fieldset> }
  return <label className="block">Your answer{['SHORT', 'FILL'].includes(q.type) ? <input maxLength={200} className="input text-base" value={value} onChange={e => onChange(e.target.value)} /> : <textarea maxLength={4000} className="input text-base" value={value} onChange={e => onChange(e.target.value)} />}</label>
}
function reviewAnswer(q, answer) {
  if (['CHOICE', 'TRUE_FALSE'].includes(q.type)) return q.options[Number(answer)]
  const values = parseList(answer)
  if (q.type === 'MULTIPLE') return values.map(i => q.options[i]).join(', ')
  if (q.type === 'MATCH') return values.map((n, i) => `${q.options[i]} → ${q.choices[n]}`).join('; ')
  if (q.type === 'ORDER') return values.map(i => q.options[i]).join(' → ')
  return answer
}
function showAnswer(q, answer) {
  if (q.type === 'CHOICE') return q.options[Number(answer)]
  if (q.type === 'TRUE_FALSE') return ['True', 'False'][Number(answer)]
  const values = parseList(answer)
  if (q.type === 'MULTIPLE') return values.map(i => q.options[i]).join(', ')
  if (q.type === 'ORDER') return values.map(i => (q.presentation || q.options.map((_, n) => q.options.length - 1 - n)).map(n => q.options[n])[i]).join(' → ')
  if (q.type === 'MATCH') return values.map((n, i) => `${q.options[i]} → ${(q.presentation || q.options.map((_, j) => q.options.length - 1 - j)).map(j => q.pairs[j])[n]}`).join('; ')
  return answer
}
function correctAnswer(q) {
  if (q.type === 'CHOICE') return q.options[q.correct]
  if (q.type === 'TRUE_FALSE') return ['True', 'False'][q.correct]
  if (q.type === 'MULTIPLE') return q.correctMany.map(i => q.options[i]).join(', ')
  if (q.type === 'MATCH') return q.options.map((v, i) => `${v} → ${q.pairs[i]}`).join('; ')
  if (q.type === 'ORDER') return q.options.join(' → ')
  return q.accepted.join(', ')
}
