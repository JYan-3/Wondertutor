import { z } from 'zod'
import * as service from '../../services/quiz.service.js'
export async function list(req, res) { res.json({ quizzes: await service.parentList() }) }
export async function get(req, res) { res.json(await service.parentQuiz(Number(req.params.id))) }
export async function submit(req, res) { res.status(201).json(await service.submit(req.parent.id, Number(req.params.id), req.body)) }
export async function history(req, res) { res.json({ attempts: await service.history(req.parent.id) }) }
export async function result(req, res) { res.json(await service.result(req.parent.id, Number(req.params.id))) }
export async function leaderboard(req, res) { const version = z.coerce.number().int().positive().parse(req.query.version); res.json({ leaderboard: await service.leaderboard(Number(req.params.id), version) }) }
export async function hideLeaderboard(req, res) { await service.hideFromLeaderboard(req.parent.id, Number(req.params.id)); res.json({ ok: true }) }
export async function report(req, res) { res.status(201).json(await service.reportQuiz(req.user.id, Number(req.params.id), req.body)) }
