import { moderateQuiz } from '../../services/quiz.service.js'

export async function moderate(req, res) {
  res.json({ quiz: await moderateQuiz(Number(req.params.id), req.user, req.body) })
}
