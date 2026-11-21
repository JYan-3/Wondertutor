import { z } from 'zod'
import { randomInt } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { cloudinaryUrl } from '../utils/validators.js'
import { isSubjectAtLevel } from '../data/catalog.js'
import { AppError } from '../utils/AppError.js'

const question = z.object({
  type: z.enum(['CHOICE', 'TRUE_FALSE', 'MULTIPLE', 'SHORT', 'FILL', 'MATCH', 'ORDER', 'LONG']), text: z.string().trim().min(1).max(1000),
  points: z.number().int().min(1).max(100), options: z.array(z.string().trim().min(1).max(250)).max(6).default([]),
  correct: z.number().int().min(0).max(5).nullable().default(null), accepted: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  explanation: z.string().trim().max(1000).default(''), correctMany: z.array(z.number().int().min(0).max(5)).max(6).default([]), pairs: z.array(z.string().trim().max(250)).max(6).default([]), imageUrl: cloudinaryUrl('Question image').nullable().optional().default(null),
}).strict().superRefine((q, ctx) => {
  if (q.type === 'CHOICE' && (q.options.length < 2 || q.correct === null || q.correct >= q.options.length)) ctx.addIssue({ code: 'custom', message: 'Choose a correct answer from at least two options.' })
  if (q.type === 'TRUE_FALSE' && ![0, 1].includes(q.correct)) ctx.addIssue({ code: 'custom', message: 'Choose true or false as the correct answer.' })
  if (q.type === 'MULTIPLE' && (q.options.length < 2 || q.correctMany.length < 1 || new Set(q.correctMany).size !== q.correctMany.length || q.correctMany.some(n => n >= q.options.length))) ctx.addIssue({ code: 'custom', message: 'Choose valid correct answers.' })
  if (q.type === 'MATCH' && (q.options.length < 2 || q.options.length !== q.pairs.length || q.pairs.some(x => !x) || new Set(q.pairs.map(x => x.toLowerCase())).size !== q.pairs.length)) ctx.addIssue({ code: 'custom', message: 'Add at least two pairs with different answers.' })
  if (q.type === 'ORDER' && (q.options.length < 2 || new Set(q.options.map(x => x.toLowerCase())).size !== q.options.length)) ctx.addIssue({ code: 'custom', message: 'Add at least two different items in the correct order.' })
  if (['SHORT', 'FILL'].includes(q.type) && !q.accepted.length) ctx.addIssue({ code: 'custom', message: 'Add at least one accepted answer.' })
})
export const quizInput = z.object({ title: z.string().trim().min(1).max(150), description: z.string().trim().max(2000),
  subject: z.string().trim().min(1).max(100), level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']), grade: z.number().int().min(1),
  quizMode: z.enum(['MIXED', 'SINGLE']).default('MIXED'), questions: z.array(question).min(1).max(50) }).strict().refine(q => q.quizMode !== 'SINGLE' || new Set(q.questions.map(x => x.type)).size <= 1, 'A single-type quiz must use one question type.').refine(q => q.grade <= ({ KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 })[q.level] && isSubjectAtLevel(q.subject, q.level), 'Choose a valid subject and grade for this level.')
const draftInput = z.object({ title: z.string().trim().max(150), description: z.string().trim().max(2000),
  subject: z.string().trim().max(100), level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']), grade: z.number().int().min(1).max(6),
  quizMode: z.enum(['MIXED', 'SINGLE']).default('MIXED'), questions: z.array(z.object({ type: z.enum(['CHOICE', 'TRUE_FALSE', 'MULTIPLE', 'SHORT', 'FILL', 'MATCH', 'ORDER', 'LONG']), text: z.string().trim().max(1000), points: z.number().int().min(1).max(100),
    options: z.array(z.string().trim().max(250)).max(6), correct: z.number().int().min(0).max(5).nullable(), accepted: z.array(z.string().trim().max(200)).max(10), explanation: z.string().trim().max(1000), correctMany: z.array(z.number().int().min(0).max(5)).max(6).default([]), pairs: z.array(z.string().trim().max(250)).max(6).default([]), imageUrl: cloudinaryUrl('Question image').nullable().optional().default(null) }).strict()).max(50) }).strict()
export const attemptInput = z.object({ requestId: z.string().uuid(), childId: z.number().int().positive(), versionId: z.number().int().positive(),
  nickname: z.string().trim().min(2).max(30).regex(/^[\p{L}\p{N} _-]+$/u, 'Use letters, numbers, spaces, hyphens or underscores.'),
  answers: z.array(z.string().trim().max(4000)).min(1).max(50) }).strict()
export const reviewInput = z.object({ marks: z.array(z.object({ index: z.number().int().min(0), score: z.number().int().min(0), feedback: z.string().trim().max(2000) }).strict()).max(50), advice: z.string().trim().max(4000), complete: z.boolean() }).strict()
const norm = s => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
const own = async (id, tutorId, db = prisma) => {
  const quiz = await db.quiz.findFirst({ where: { id, tutorId }, include: { versions: { orderBy: { number: 'desc' }, take: 1 } } })
  if (!quiz) throw new AppError(404, 'Quiz not found.')
  return quiz
}
const presentation = q => q.presentation || Array.from({ length: q.options.length }, (_, i) => q.options.length - 1 - i)
const publicQuestion = q => ({ type: q.type, text: q.text, points: q.points, imageUrl: q.imageUrl || null, ...(['CHOICE', 'MULTIPLE'].includes(q.type) && { options: q.options }), ...(q.type === 'TRUE_FALSE' && { options: ['True', 'False'] }), ...(q.type === 'MATCH' && { options: q.options, choices: presentation(q).map(i => q.pairs[i]) }), ...(q.type === 'ORDER' && { options: presentation(q).map(i => q.options[i]) }) })
const publicQuiz = q => ({ id: q.id, title: q.versions[0].content.title, subject: q.versions[0].content.subject, level: q.versions[0].content.level, grade: q.versions[0].content.grade, description: q.versions[0].content.description, tutor: q.tutor.user.fullName, versionId: q.versions[0].id, questions: q.versions[0].content.questions.map(publicQuestion) })
export async function tutorList(tutorId) {
  return prisma.quiz.findMany({ where: { tutorId }, include: { versions: { orderBy: { number: 'desc' }, include: { _count: { select: { attempts: true } }, attempts: { where: { status: 'PENDING' }, select: { id: true } } } } }, orderBy: { updatedAt: 'desc' } })
}
export async function saveQuiz(tutorId, id, input) {
  const { questions, quizMode, ...details } = draftInput.parse(input)
  if (!id) return prisma.quiz.create({ data: { ...details, tutorId, draft: { questions, quizMode } } })
  await own(id, tutorId)
  return prisma.quiz.update({ where: { id }, data: { ...details, draft: { questions, quizMode } } })
}
export async function publish(tutorId, id) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Quiz WHERE id = ${id} FOR UPDATE`
    const q = await own(id, tutorId, tx)
    const input = quizInput.parse({ title: q.title, description: q.description, subject: q.subject, level: q.level, grade: q.grade, quizMode: q.draft.quizMode || 'MIXED', questions: q.draft.questions })
    // Store a random display order separately from the correct answers.
    const content = { ...input, questions: input.questions.map(item => {
      if (!['MATCH', 'ORDER'].includes(item.type)) return item
      const order = item.options.map((_, i) => i)
      for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]] }
      return { ...item, presentation: order }
    }) }
    const version = await tx.quizVersion.create({ data: { quizId: id, number: (q.versions[0]?.number || 0) + 1, content } })
    await tx.quiz.update({ where: { id }, data: { status: 'PUBLISHED' } })
    return { versionId: version.id }
  })
}
export async function archive(tutorId, id) { await own(id, tutorId); return prisma.quiz.update({ where: { id }, data: { status: 'ARCHIVED' } }) }
const publicInclude = { tutor: { include: { user: { select: { fullName: true } } } }, versions: { orderBy: { number: 'desc' }, take: 1 } }
export async function parentList() {
  const rows = await prisma.quiz.findMany({ where: { status: 'PUBLISHED' }, include: publicInclude, orderBy: { updatedAt: 'desc' } })
  return rows.filter(q => q.versions.length).map(publicQuiz)
}
export async function parentQuiz(id) {
  const q = await prisma.quiz.findFirst({ where: { id, status: 'PUBLISHED' }, include: publicInclude })
  if (!q || !q.versions.length) throw new AppError(404, 'Quiz not found.')
  return publicQuiz(q)
}
export async function submit(parentId, quizId, raw) {
  const input = attemptInput.parse(raw)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Quiz WHERE id = ${quizId} FOR UPDATE`
    const child = await tx.child.findFirst({ where: { id: input.childId, parentId } })
    if (!child) throw new AppError(404, 'Child not found.')
    const existing = await tx.quizAttempt.findUnique({ where: { requestId: input.requestId }, include: { version: true } })
    if (existing) {
      if (existing.childId !== child.id || existing.version.quizId !== quizId) throw new AppError(409, 'This request has already been used.')
      return { id: existing.id }
    }
    const q = await tx.quiz.findFirst({ where: { id: quizId, status: 'PUBLISHED' }, include: { versions: { orderBy: { number: 'desc' }, take: 1 }, tutor: true } })
    if (!q || q.versions[0]?.id !== input.versionId) throw new AppError(409, 'This quiz has changed. Please open it again.')
    const questions = q.versions[0].content.questions
    if (input.answers.length !== questions.length || input.answers.some(a => !a)) throw new AppError(400, 'Answer every question before submitting.')
    const answers = questions.map((question, index) => {
      const answer = input.answers[index]
      let score = null
      if (['CHOICE', 'TRUE_FALSE'].includes(question.type)) {
        const count = question.type === 'TRUE_FALSE' ? 2 : question.options.length
        if (!/^[0-9]$/.test(answer) || Number(answer) >= count) throw new AppError(400, 'Choose a valid answer.')
        score = Number(answer) === question.correct ? question.points : 0
      } else if (['MULTIPLE', 'MATCH', 'ORDER'].includes(question.type)) {
        let values
        try { values = JSON.parse(answer) } catch { throw new AppError(400, 'Choose a valid answer.') }
        const length = question.options.length
        if (!Array.isArray(values) || !values.length || values.some(n => !Number.isInteger(n) || n < 0 || n >= length) || new Set(values).size !== values.length || (question.type !== 'MULTIPLE' && values.length !== length)) throw new AppError(400, 'Choose a valid answer.')
        const expected = question.type === 'MULTIPLE' ? [...question.correctMany].sort((a, b) => a - b) : Array.from({ length }, (_, i) => presentation(question).indexOf(i))
        const given = question.type === 'MULTIPLE' ? [...values].sort((a, b) => a - b) : values
        score = given.every((n, i) => n === expected[i]) && given.length === expected.length ? question.points : 0
      } else if (['SHORT', 'FILL'].includes(question.type)) score = question.accepted.some(a => norm(a) === norm(answer)) ? question.points : 0
      return { answer, score, feedback: '' }
    })
    const pending = questions.some(item => item.type === 'LONG')
    const attempt = await tx.quizAttempt.create({ data: { requestId: input.requestId, versionId: input.versionId, childId: child.id, nickname: input.nickname, status: pending ? 'PENDING' : 'MARKED', answers, score: answers.reduce((sum, a) => sum + (a.score || 0), 0), maxScore: questions.reduce((sum, x) => sum + x.points, 0) } })
    if (pending) await tx.notification.create({ data: { userId: q.tutor.userId, type: 'QUIZ_REVIEW', title: 'Quiz answer needs marking', message: 'A quiz attempt is waiting for your review.', link: '/tutor/quizzes?attempt=' + attempt.id } })
    return { id: attempt.id }
  })
}
export async function tutorAttempts(tutorId, id) {
  await own(id, tutorId)
  return prisma.quizAttempt.findMany({ where: { version: { quizId: id } }, include: { version: true }, orderBy: { createdAt: 'desc' } })
}
export async function review(tutorId, id, raw) {
  const input = reviewInput.parse(raw)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM QuizAttempt WHERE id = ${id} FOR UPDATE`
    const a = await tx.quizAttempt.findFirst({ where: { id, version: { quiz: { tutorId } } }, include: { version: true, child: { include: { parent: true } } } })
    if (!a) throw new AppError(404, 'Attempt not found.')
    if (a.status !== 'PENDING') throw new AppError(409, 'This attempt has already been reviewed.')
    const questions = a.version.content.questions, indices = questions.flatMap((q, i) => q.type === 'LONG' ? [i] : [])
    if (new Set(input.marks.map(m => m.index)).size !== input.marks.length || input.marks.some(m => !indices.includes(m.index) || m.score > questions[m.index].points) || (input.complete && input.marks.length !== indices.length)) throw new AppError(400, 'Give a valid mark for every long answer.')
    const answers = a.answers.map((answer, i) => { const mark = input.marks.find(m => m.index === i); return mark ? { ...answer, score: mark.score, feedback: mark.feedback } : answer })
    const updated = await tx.quizAttempt.update({ where: { id }, data: { answers, advice: input.advice, score: answers.reduce((s, x) => s + (x.score || 0), 0), ...(input.complete && { status: 'MARKED', reviewedAt: new Date() }) } })
    if (input.complete) await tx.notification.create({ data: { userId: a.child.parent.userId, type: 'QUIZ_RESULT', title: 'Quiz feedback is ready', message: 'Your child’s quiz results and tutor feedback are ready.', link: '/parent/quizzes?attempt=' + id } })
    return updated
  })
}
export async function result(parentId, id) {
  const a = await prisma.quizAttempt.findFirst({ where: { id, child: { parentId } }, include: { version: { include: { quiz: { select: { title: true } } } } } })
  if (!a) throw new AppError(404, 'Attempt not found.')
  if (a.status !== 'PENDING') return a
  const answers = a.answers.map((x, i) => a.version.content.questions[i].type === 'LONG' ? { ...x, score: null, feedback: '' } : x)
  return { ...a, advice: null, answers, score: answers.reduce((sum, x) => sum + (x.score || 0), 0) }
}
export async function history(parentId) { const rows = await prisma.quizAttempt.findMany({ where: { child: { parentId } }, select: { id: true, status: true, nickname: true, score: true, maxScore: true, createdAt: true, version: { select: { quizId: true, quiz: { select: { title: true } } } }, child: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }); return rows.map(a => a.status === 'PENDING' ? { ...a, score: null } : a) }
export async function leaderboard(quizId, versionId) {
  const quiz = await prisma.quiz.findFirst({ where: { id: quizId, status: 'PUBLISHED' }, include: { versions: { orderBy: { number: 'desc' }, take: 1 } } })
  if (!quiz || quiz.versions[0]?.id !== versionId) throw new AppError(404, 'Quiz not found.')
  const rows = await prisma.quizAttempt.findMany({ where: { versionId, status: 'MARKED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { childId: true, nickname: true, score: true, maxScore: true } })
  const seen = new Set(), latest = rows.filter(a => { if (seen.has(a.childId)) return false; seen.add(a.childId); return true })
  latest.sort((a, b) => b.score / b.maxScore - a.score / a.maxScore)
  return latest.map(({ nickname, score, maxScore }, i) => ({ rank: i > 0 && score * latest[i - 1].maxScore === latest[i - 1].score * maxScore ? null : i + 1, nickname, score, maxScore })).map((row, i, all) => ({ ...row, rank: row.rank ?? all.slice(0, i).findLast(r => r.rank !== null).rank }))
}
