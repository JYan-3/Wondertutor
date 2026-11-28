import { prisma } from '../config/prisma.js'
import { api, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'
beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)
const body = { title: 'Fractions', description: 'Practice', subject: 'Mathematics', level: 'PRIMARY', grade: 5, questions: [
  { type: 'CHOICE', text: 'Choose', points: 2, options: ['One', 'Two'], correct: 1, accepted: [], explanation: '' },
  { type: 'SHORT', text: 'Number', points: 2, options: [], correct: null, accepted: ['Thirty', '30'], explanation: '' },
  { type: 'LONG', text: 'Explain', points: 6, options: [], correct: null, accepted: [], explanation: '' },
] }
test('publication, marking, notifications, privacy, retries and versioning', async () => {
  const tutor = await makeTutor(), otherTutor = await makeTutor(), parent = await makeParent(), otherParent = await makeParent()
  const created = await api(tutor.token).post('/tutor/quizzes', body)
  expect(created.status).toBe(201)
  expect((await api(parent.token).get('/parent/quizzes')).quizzes).toHaveLength(0)
  expect((await api(otherTutor.token).post(`/tutor/quizzes/${created.id}/publish`)).status).toBe(404)
  expect((await api(tutor.token).post(`/tutor/quizzes/${created.id}/publish`)).status).toBe(200)
  const quiz = (await api(parent.token).get('/parent/quizzes')).quizzes[0]
  expect(quiz.questions[0].correct).toBeUndefined()
  expect(quiz.questions[1].accepted).toBeUndefined()
  const attempt = { requestId: '17d209f0-7576-490b-b8f4-e28fe6d4a556', childId: parent.child.id, versionId: quiz.versionId, nickname: 'Math Star', answers: ['1', '  THIRTY ', 'I explained'] }
  expect((await api(otherParent.token).post(`/parent/quizzes/${created.id}/attempts`, attempt)).status).toBe(404)
  const submitted = await api(parent.token).post(`/parent/quizzes/${created.id}/attempts`, attempt)
  expect(submitted.status).toBe(201)
  expect((await api(parent.token).post(`/parent/quizzes/${created.id}/attempts`, attempt)).id).toBe(submitted.id)
  expect((await api(otherParent.token).get(`/parent/quiz-attempts/${submitted.id}`)).status).toBe(404)
  expect((await api(otherTutor.token).post(`/tutor/quiz-attempts/${submitted.id}/review`, { marks: [], advice: '', complete: true })).status).toBe(404)
  expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'QUIZ_REVIEW' } })).toBe(1)
  const list = await api(tutor.token).get('/tutor/quizzes')
  expect(list.quizzes.find(q => q.id === created.id).versions[0].attempts).toHaveLength(1)
  const review = { marks: [{ index: 2, score: 5, feedback: 'Good explanation' }], advice: 'Keep practising', complete: true }
  expect((await api(tutor.token).post(`/tutor/quiz-attempts/${submitted.id}/review`, { ...review, marks: [{ ...review.marks[0], score: 7 }] })).status).toBe(400)
  expect((await api(tutor.token).post(`/tutor/quiz-attempts/${submitted.id}/review`, review)).status).toBe(200)
  expect((await api(tutor.token).post(`/tutor/quiz-attempts/${submitted.id}/review`, review)).status).toBe(409)
  expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'QUIZ_RESULT' } })).toBe(1)
  const afterReview = await api(tutor.token).get('/tutor/quizzes')
  expect(afterReview.quizzes.find(q => q.id === created.id).versions[0].attempts).toHaveLength(0)
  const result = await api(parent.token).get(`/parent/quiz-attempts/${submitted.id}`)
  expect(result.score).toBe(9)
  expect(result.advice).toBe('Keep practising')
  let board = (await api(parent.token).get(`/parent/quizzes/${created.id}/leaderboard?version=${quiz.versionId}`)).leaderboard
  expect(board).toEqual([{ rank: 1, nickname: 'Math Star', score: 9, maxScore: 10 }])
  const retry = await api(parent.token).post(`/parent/quizzes/${created.id}/attempts`, { ...attempt, requestId: 'dfb3822c-9b0a-424a-858a-a0e3366c1f4e', answers: ['0', 'wrong', 'again'] })
  expect((await api(parent.token).get(`/parent/quizzes/${created.id}/leaderboard?version=${quiz.versionId}`)).leaderboard[0].score).toBe(9)
  await api(tutor.token).post(`/tutor/quiz-attempts/${retry.id}/review`, { ...review, marks: [{ ...review.marks[0], score: 1 }] })
  board = (await api(parent.token).get(`/parent/quizzes/${created.id}/leaderboard?version=${quiz.versionId}`)).leaderboard
  expect(board).toEqual([{ rank: 1, nickname: 'Math Star', score: 1, maxScore: 10 }])
  expect((await api(otherParent.token).patch(`/parent/quiz-attempts/${retry.id}/hide-leaderboard`)).status).toBe(404)
  expect((await api(parent.token).patch(`/parent/quiz-attempts/${retry.id}/hide-leaderboard`)).status).toBe(200)
  expect((await api(parent.token).get(`/parent/quizzes/${created.id}/leaderboard?version=${quiz.versionId}`)).leaderboard).toEqual([])
  const privateAttempt = await api(parent.token).post(`/parent/quizzes/${created.id}/attempts`, { ...attempt, requestId: '8f778ad3-92fb-4902-8500-af22f61b3901', nickname: '', showOnLeaderboard: false })
  expect(privateAttempt.status).toBe(201)
  expect((await api(parent.token).get(`/parent/quizzes/${created.id}/leaderboard?version=${quiz.versionId}`)).leaderboard).toEqual([])
  expect((await api(parent.token).get(`/parent/quiz-attempts/${privateAttempt.id}`)).status).toBe(200)
  expect((await api(tutor.token).put(`/tutor/quizzes/${created.id}`, { ...body, title: 'Changed' })).status).toBe(200)
  expect((await api(parent.token).get(`/parent/quizzes/${created.id}`)).title).toBe('Fractions')
  await api(tutor.token).post(`/tutor/quizzes/${created.id}/publish`)
  expect((await api(parent.token).post(`/parent/quizzes/${created.id}/attempts`, { ...attempt, requestId: 'efa1ff96-e1c2-487d-b942-666de36cf942' })).status).toBe(409)
  expect((await api(parent.token).get(`/parent/quiz-attempts/${submitted.id}`)).version.content.title).toBe('Fractions')
})

test('draft validation, automatic result, ties and archived visibility', async () => {
  const t = await makeTutor(), p = await makeParent(), p2 = await makeParent()
  const incomplete = { ...body, title: '', questions: [] }
  const draft = await api(t.token).post('/tutor/quizzes', incomplete)
  expect(draft.status).toBe(201)
  expect((await api(t.token).post(`/tutor/quizzes/${draft.id}/publish`)).status).toBe(400)
  const auto = { ...body, title: 'Automatic', questions: body.questions.slice(0, 2) }
  const q = await api(t.token).post('/tutor/quizzes', auto)
  await api(t.token).post(`/tutor/quizzes/${q.id}/publish`)
  const view = await api(p.token).get(`/parent/quizzes/${q.id}`)
  const answer = (childId, requestId, nickname) => ({ childId, requestId, nickname, versionId: view.versionId, answers: ['1', '30'] })
  const first = await api(p.token).post(`/parent/quizzes/${q.id}/attempts`, answer(p.child.id, '77a74a59-02ae-440f-93e4-931b39008b28', 'One'))
  const second = await api(p2.token).post(`/parent/quizzes/${q.id}/attempts`, answer(p2.child.id, 'd63a169a-f116-4a4b-9a1b-6c2eef4b4fbb', 'Two'))
  expect(first.status).toBe(201)
  expect(second.status).toBe(201)
  expect((await api(p.token).get(`/parent/quiz-attempts/${first.id}`)).score).toBe(4)
  const board = (await api(p.token).get(`/parent/quizzes/${q.id}/leaderboard?version=${view.versionId}`)).leaderboard
  expect(board.map(x => x.rank)).toEqual([1, 1])
  expect(board.every(x => Object.keys(x).sort().join(',') === 'maxScore,nickname,rank,score')).toBe(true)
  await api(t.token).post(`/tutor/quizzes/${q.id}/archive`)
  expect((await api(p.token).get(`/parent/quizzes/${q.id}`)).status).toBe(404)
  expect((await api(p.token).get(`/parent/quiz-attempts/${first.id}`)).score).toBe(4)
})

test('all question types are marked on the server and invalid answers are rejected', async () => {
  const t = await makeTutor(), p = await makeParent()
  const base = { text: 'Question', points: 2, options: [], correct: null, accepted: [], explanation: '' }
  const q = await api(t.token).post('/tutor/quizzes', { ...body, title: 'All types', quizMode: 'MIXED', questions: [
    { ...base, type: 'CHOICE', options: ['A','B'], correct: 1 },
    { ...base, type: 'TRUE_FALSE', correct: 0 },
    { ...base, type: 'MULTIPLE', options: ['A','B','C'], correctMany: [0,2] },
    { ...base, type: 'SHORT', accepted: ['thirty','30'] },
    { ...base, type: 'FILL', accepted: ['Kuala Lumpur','KL'] },
    { ...base, type: 'MATCH', options: ['A','B','C'], pairs: ['1','2','3'] },
    { ...base, type: 'ORDER', options: ['First','Second','Third'] },
    { ...base, type: 'LONG' },
  ] })
  expect(q.status).toBe(201)
  expect((await api(t.token).post(`/tutor/quizzes/${q.id}/publish`)).status).toBe(200)
  const view = await api(p.token).get(`/parent/quizzes/${q.id}`)
  expect(view.questions[5].pairs).toBeUndefined()
  expect(view.questions[5].choices.slice().sort()).toEqual(['1','2','3'])
  expect(view.questions[6].options.slice().sort()).toEqual(['First','Second','Third'])
  const match = JSON.stringify(['1','2','3'].map(v => view.questions[5].choices.indexOf(v)))
  const order = JSON.stringify(['First','Second','Third'].map(v => view.questions[6].options.indexOf(v)))
  const wrongMatch = JSON.stringify(JSON.parse(match).reverse())
  const wrongOrder = JSON.stringify(JSON.parse(order).reverse())
  const submission = { requestId: 'aa2aa241-4161-4b9b-a959-bcc91e9603b6', childId: p.child.id, nickname: 'Star', versionId: view.versionId, answers: ['1','0','[0,2]',' THIRTY ','kl',match,order,'Explanation'] }
  const invalid = await api(p.token).post(`/parent/quizzes/${q.id}/attempts`, { ...submission, answers: ['1','0','[0,0]','30','kl',match,order,'Explanation'] })
  expect(invalid.status).toBe(400)
  const submitted = await api(p.token).post(`/parent/quizzes/${q.id}/attempts`, submission)
  expect(submitted.status).toBe(201)
  const pending = await api(p.token).get(`/parent/quiz-attempts/${submitted.id}`)
  expect(pending.score).toBe(14)
  expect(pending.answers[7].score).toBeNull()
  await api(t.token).post(`/tutor/quiz-attempts/${submitted.id}/review`, { marks: [{ index: 7, score: 1, feedback: 'Nice' }], advice: 'Keep practising', complete: true })
  expect((await api(p.token).get(`/parent/quiz-attempts/${submitted.id}`)).score).toBe(15)
  const wrong = await api(p.token).post(`/parent/quizzes/${q.id}/attempts`, { ...submission, requestId: '3f1ceeb4-31aa-4ef9-90f4-63dd05ea87e0', answers: ['0','1','[0]','wrong','wrong',wrongMatch,wrongOrder,'Explanation'] })
  expect((await api(p.token).get(`/parent/quiz-attempts/${wrong.id}`)).score).toBe(0)
  const single = await api(t.token).post('/tutor/quizzes', { ...body, quizMode: 'SINGLE' })
  expect((await api(t.token).post(`/tutor/quizzes/${single.id}/publish`)).status).toBe(400)
})
