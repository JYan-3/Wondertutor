import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

test('a parent can report a quiz and admin can hide or restore it with an audit record', async () => {
  const tutor = await makeTutor(), parent = await makeParent(), admin = await makeAdmin()
  const input = { title: 'Fractions practice', description: 'Practice', subject: 'Mathematics', level: 'PRIMARY', grade: 5, questions: [{ type: 'CHOICE', text: 'Choose a number', points: 1, options: ['One', 'Two'], correct: 0, accepted: [], explanation: '' }] }
  const quiz = await api(tutor.token).post('/tutor/quizzes', input)
  expect((await api(tutor.token).post(`/tutor/quizzes/${quiz.id}/publish`)).status).toBe(200)
  const reportPath = `/parent/quizzes/${quiz.id}/report`
  expect((await api(parent.token).post(reportPath, { reason: 'too short' })).status).toBe(400)
  const report = await api(parent.token).post(reportPath, { reason: 'This question needs admin review.' })
  expect(report.status).toBe(201)
  expect((await api(parent.token).post(reportPath, { reason: 'This question needs admin review.' })).status).toBe(409)
  const detail = await api(admin.token).get(`/admin/complaints/${report.id}`)
  expect(detail.investigation.quiz).toMatchObject({ id: quiz.id, isHidden: false, questions: [{ text: 'Choose a number' }] })
  const moderation = `/admin/quizzes/${quiz.id}/moderation`
  const hide = { isHidden: true, expectedHidden: false, reason: 'Content needs correction.' }
  expect((await api(parent.token).patch(moderation, hide)).status).toBe(403)
  expect((await api(admin.token).patch(moderation, hide)).status).toBe(200)
  expect((await api(admin.token).patch(moderation, hide)).status).toBe(409)
  expect((await api(parent.token).get(`/parent/quizzes/${quiz.id}`)).status).toBe(404)
  expect((await api(tutor.token).post(`/tutor/quizzes/${quiz.id}/publish`)).status).toBe(409)
  expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'QUIZ_MODERATION' } })).toBe(1)
  expect((await api(admin.token).patch(moderation, { isHidden: false, expectedHidden: true, reason: 'The content was reviewed.' })).status).toBe(200)
  expect((await api(parent.token).get(`/parent/quizzes/${quiz.id}`)).status).toBe(200)
  expect(await prisma.quizModerationEntry.count({ where: { quizId: quiz.id } })).toBe(2)
})
