import * as service from '../../services/quiz.service.js'
export async function list(req, res) { res.json({ quizzes: await service.tutorList(req.tutor.id) }) }
export async function create(req, res) { res.status(201).json(await service.saveQuiz(req.tutor.id, null, req.body)) }
export async function update(req, res) { res.json(await service.saveQuiz(req.tutor.id, Number(req.params.id), req.body)) }
export async function publish(req, res) { res.json(await service.publish(req.tutor.id, Number(req.params.id))) }
export async function archive(req, res) { res.json(await service.archive(req.tutor.id, Number(req.params.id))) }
export async function attempts(req, res) { res.json({ attempts: await service.tutorAttempts(req.tutor.id, Number(req.params.id)) }) }
export async function review(req, res) { res.json(await service.review(req.tutor.id, Number(req.params.id), req.body)) }
