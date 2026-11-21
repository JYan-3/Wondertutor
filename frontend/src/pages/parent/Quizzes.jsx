import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, PageTitle, SectionCard } from '../../components/ui/Common'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'
import { gradeLabel } from '../../lib/education'

function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function ParentQuizzes() {
  const [params] = useSearchParams()
  const requestId = useRef('')
  const [quizzes, setQuizzes] = useState([]), [children, setChildren] = useState([]), [history, setHistory] = useState([])
  const [quiz, setQuiz] = useState(null), [result, setResult] = useState(null), [board, setBoard] = useState(null)
  const [child, setChild] = useState(''), [nickname, setNickname] = useState(''), [answers, setAnswers] = useState([])
  const [search, setSearch] = useState(''), [subject, setSubject] = useState(''), [level, setLevel] = useState(''), [reviewing, setReviewing] = useState(false), [step, setStep] = useState(0)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const dirty = Boolean(quiz && answers.some(a => a.trim()))
  useUnsavedWarning(dirty, 'You have unfinished quiz answers. Leave without submitting?')
  const load = async () => { const [q, c, h] = await Promise.all([api.get('/parent/quizzes'), api.get('/parent/children'), api.get('/parent/quiz-attempts')]); setQuizzes(q.data.quizzes); setChildren(c.data.children); setHistory(h.data.attempts) }
  useEffect(() => { load().catch(e => setError(errorMessage(e))) }, [])
  useEffect(() => { const id = Number(params.get('attempt')); if (id) api.get(`/parent/quiz-attempts/${id}`).then(r => setResult(r.data)).catch(e => setError(errorMessage(e))) }, [params])
  const run = async fn => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  const open = q => { requestId.current = newRequestId(); setReviewing(false); setStep(0); setQuiz(q); setAnswers(q.questions.map(() => '')); setResult(null); setBoard(null) }
  const showResult = id => run(async () => { setResult((await api.get(`/parent/quiz-attempts/${id}`)).data); setQuiz(null); setBoard(null) })
  const submit = e => { e.preventDefault(); if (!reviewing) return; run(async () => { const r = await api.post(`/parent/quizzes/${quiz.id}/attempts`, { requestId: requestId.current, childId: Number(child), versionId: quiz.versionId, nickname, answers }); setResult((await api.get(`/parent/quiz-attempts/${r.data.id}`)).data); setQuiz(null); await load() }) }
  const showBoard = q => run(async () => { setBoard({ quiz: q, entries: (await api.get(`/parent/quizzes/${q.id}/leaderboard?version=${q.versionId}`)).data.leaderboard }); setQuiz(null); setResult(null) })
  const back = () => { if (quiz && answers.some(a => a.trim()) && !window.confirm('Discard your answers?')) return; setQuiz(null); setResult(null); setBoard(null) }
  const visible = quizzes.filter(q => `${q.title} ${q.subject} ${q.tutor}`.toLowerCase().includes(search.toLowerCase()) && (!subject || q.subject === subject) && (!level || q.level === level))
  return <div className="min-w-0 space-y-4"><PageTitle title="Quizzes" subtitle="Find a quiz, practise and see your progress." /><ErrorBox>{error}</ErrorBox>
    {(quiz || result || board) && <button type="button" className="btn-outline min-h-11" onClick={back}>Back to quizzes</button>}
    {quiz ? <form className="space-y-4" onSubmit={submit}><SectionCard title={quiz.title}><p>{quiz.description}</p><p className="my-2 text-sm">{quiz.subject} · {gradeLabel(quiz.level, quiz.grade)} · {quiz.tutor}</p><p className="text-sm">{quiz.questions.some(q => q.type === 'LONG') ? 'Long answers will be marked by the tutor.' : 'Answers are marked automatically.'}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Choose your child<select required className="input text-base" value={child} onChange={e => setChild(e.target.value)}><option value="">Choose child</option>{children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Leaderboard nickname<input required minLength={2} maxLength={30} className="input text-base" value={nickname} onChange={e => setNickname(e.target.value)} /><span className="text-xs">Other parents can see this nickname. Do not use your child’s full name. Use letters, numbers, spaces, hyphens or underscores.</span></label></div></SectionCard>
      {reviewing ? <SectionCard title="Review your answers"><p className="mb-3">Check your answers before submitting.</p><ol className="space-y-2">{quiz.questions.map((q, i) => <li key={i} className="rounded-lg border border-brand-100 p-3"><strong>Question {i + 1}:</strong> {q.text}<p className="text-sm whitespace-pre-wrap break-words">{validAnswer(q, answers[i]) ? `Your answer: ${reviewAnswer(q, answers[i])}` : 'Not answered'}</p><button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => { setStep(i); setReviewing(false) }}>Edit answer</button></li>)}</ol><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-outline" onClick={() => setReviewing(false)}>Continue editing</button><button disabled={busy} className="btn-primary min-h-11">{busy ? 'Submitting…' : 'Confirm submission'}</button></div></SectionCard> : <><SectionCard title={`Question ${step + 1} of ${quiz.questions.length}`}><p className="mb-3 whitespace-pre-wrap font-semibold">{quiz.questions[step].text} · {quiz.questions[step].points} {quiz.questions[step].points === 1 ? 'point' : 'points'}</p>{quiz.questions[step].imageUrl && <img src={quiz.questions[step].imageUrl} alt="Question illustration" className="mb-3 max-h-72 max-w-full rounded-lg" />}<AnswerInput q={quiz.questions[step]} index={step} value={answers[step]} onChange={value => setAnswers(a => a.map((x, j) => j === step ? value : x))} /></SectionCard><div className="flex flex-wrap gap-2"><button type="button" className="btn-outline min-h-11" disabled={step === 0} onClick={() => setStep(step - 1)}>Previous</button>{step < quiz.questions.length - 1 ? <button type="button" className="btn-primary min-h-11" onClick={() => setStep(step + 1)}>Next</button> : <button type="button" className="btn-primary min-h-11" onClick={() => { const missing = answers.findIndex((a, i) => !validAnswer(quiz.questions[i], a)); if (!child || !nickname.trim()) { setError('Choose a child and enter a nickname.'); return } if (missing >= 0) { setError(`Question ${missing + 1} needs an answer.`); setStep(missing); return } setError(''); setReviewing(true) }}>Review answers</button>}</div></>}</form>
    : result ? <><SectionCard title={result.version.quiz.title}><p className="text-lg font-bold">{result.status === 'PENDING' ? `Awaiting tutor review · ${result.score} / ${result.maxScore} points marked so far` : `Final score: ${result.score} / ${result.maxScore}`}</p>{result.advice && <p className="mt-3 whitespace-pre-wrap"><strong>Tutor advice:</strong> {result.advice}</p>}</SectionCard>{result.version.content.questions.map((q, i) => <SectionCard key={i} title={`Question ${i + 1}`}><p className="whitespace-pre-wrap">{q.text}</p>{q.imageUrl && <img src={q.imageUrl} alt="Question illustration" className="my-3 max-h-72 max-w-full rounded-lg" />}<p className="mt-2 whitespace-pre-wrap">Your answer: {showAnswer(q, result.answers[i].answer)}</p><p>Score: {result.answers[i].score ?? 'Awaiting review'} / {q.points}</p>{['CHOICE', 'TRUE_FALSE', 'MULTIPLE', 'MATCH', 'ORDER', 'SHORT', 'FILL'].includes(q.type) && <p>Correct answer: {correctAnswer(q)}</p>}{q.explanation && <p className="mt-2">Explanation: {q.explanation}</p>}{result.answers[i].feedback && <p className="mt-2 whitespace-pre-wrap">Tutor feedback: {result.answers[i].feedback}</p>}</SectionCard>)}{quizzes.find(q => q.id === result.version.quizId) && <button className="btn-primary" onClick={() => open(quizzes.find(q => q.id === result.version.quizId))}>Try again</button>}</>
    : board ? <SectionCard title={`${board.quiz.title} leaderboard`}><p className="mb-3 text-sm">Shows each learner’s latest fully marked score.</p>{board.entries.length ? <ol className="divide-y divide-brand-100">{board.entries.map((a, i) => <li key={i} className="flex min-h-11 items-center justify-between gap-3 py-2"><span>{a.rank}. {a.nickname}</span><strong>{a.score} / {a.maxScore}</strong></li>)}</ol> : <p>No completed scores yet.</p>}</SectionCard>
    : <><SectionCard title="Find a quiz"><div className="grid gap-3 sm:grid-cols-3"><label>Search<input className="input text-base" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Subject<select className="input text-base" value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{[...new Set(quizzes.map(q => q.subject))].map(s => <option key={s}>{s}</option>)}</select></label><label>Level<select className="input text-base" value={level} onChange={e => setLevel(e.target.value)}><option value="">All levels</option><option value="KINDERGARTEN">Kindergarten</option><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option></select></label></div></SectionCard><div className="grid gap-4 md:grid-cols-2">{visible.map(q => <SectionCard key={q.id} title={q.title}><p>{q.description}</p><p className="my-2 text-sm">{q.subject} · {gradeLabel(q.level, q.grade)} · {q.questions.length} questions · {q.tutor}</p><div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => open(q)}>Start quiz</button><button className="btn-outline" onClick={() => showBoard(q)}>Leaderboard</button></div></SectionCard>)}</div>{!visible.length && <p>No quizzes found.</p>}<SectionCard title="Your children’s attempts">{history.length ? history.map(a => <button className="block min-h-11 w-full border-b border-brand-100 py-2 text-left" key={a.id} onClick={() => showResult(a.id)}>{a.child.name} · {a.version.quiz.title} · {a.status === 'PENDING' ? 'Awaiting tutor review' : `${a.score} / ${a.maxScore}`} →</button>) : <p>No attempts yet.</p>}</SectionCard></>}
  </div>
}

function parseList(value) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
function validAnswer(q, value) {
  if (!value?.trim()) return false
  if (!['MULTIPLE', 'MATCH', 'ORDER'].includes(q.type)) return true
  const values = parseList(value)
  if (!values.length || values.some(n => !Number.isInteger(n) || n < 0) || new Set(values).size !== values.length) return false
  return q.type === 'MULTIPLE' || values.length === q.options.length
}
export function AnswerInput({ q, index, value, onChange }) {
  if (['CHOICE', 'TRUE_FALSE'].includes(q.type)) return <fieldset><legend className="sr-only">Choose an answer</legend>{q.options.map((v, n) => <label key={n} className="my-2 flex min-h-11 items-center gap-3 rounded-lg border border-brand-100 p-3"><input type="radio" name={`q${index}`} checked={value === String(n)} onChange={() => onChange(String(n))} />{v}</label>)}</fieldset>
  if (q.type === 'MULTIPLE') { const values = parseList(value); return <fieldset><legend>Select all correct answers</legend>{q.options.map((v, n) => <label key={n} className="my-2 flex min-h-11 items-center gap-3 rounded-lg border border-brand-100 p-3"><input type="checkbox" checked={values.includes(n)} onChange={e => onChange(JSON.stringify(e.target.checked ? [...values, n] : values.filter(x => x !== n)))} />{v}</label>)}</fieldset> }
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
