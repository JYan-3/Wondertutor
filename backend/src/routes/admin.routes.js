// Admin API. Xin Yue: user management + complaints. Yan Hsi adds booking oversight, finance and settings below.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as users from '../controllers/admin/users.controller.js'
import * as complaints from '../controllers/admin/complaints.controller.js'
import { moderateReview } from '../controllers/admin/reviews.controller.js'
import * as settings from '../controllers/admin/settings.controller.js'
import * as ops from '../controllers/admin/operations.controller.js'
import * as withdrawals from '../controllers/admin/withdrawals.controller.js'
import * as quizzes from '../controllers/admin/quiz.controller.js'
import { viewVerificationDocument } from '../controllers/verificationDocument.controller.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = validateIdParams(Router(), { publicIds: [
  { prefix: '/complaints/', model: 'complaint', scope: () => ({}), notFound: 'Complaint not found' },
] })
router.use(requireAuth, requireRole('ADMIN'))

router.get('/dashboard', users.dashboard)

// [XY] user management
router.get('/users', users.listUsers)
router.get('/users/:id', users.getUser)
router.post('/users/:id/deactivate', users.setStatus)
router.post('/users/:id/reactivate', users.setStatus)
router.post('/users/:id/warn', users.warnUser)
router.post('/qualifications/:id/review', users.reviewQualification)
router.get('/qualifications/:id/file', rateLimit({ name: 'verification-document', max: 30, windowMs: 60000, keyBy: req => req.user.id }), viewVerificationDocument)

// [XY] complaints
router.get('/complaints', complaints.listComplaints)
router.get('/complaints/report', complaints.complaintsReport)
router.get('/complaints/export', complaints.exportComplaints)
router.get('/complaints/:id', complaints.getComplaint)
router.post('/complaints/:id/attendance-review', complaints.startAttendanceReview)
router.patch('/complaints/:id', complaints.updateComplaint)
router.patch('/reviews/:id/moderation', moderateReview)
router.patch('/quizzes/:id/moderation', quizzes.moderate)

router.get('/rates', ops.rates)
router.patch('/rates/:id', ops.rate)
router.get('/bookings', ops.bookings)
router.post('/bookings/:id/decision', ops.decide)
router.get('/refunds', ops.refunds)
router.post('/refunds/:id/decision', ops.refund)
router.get('/transactions', ops.ledger)
router.get('/salary/:id', ops.payslip)
router.get('/reports', ops.reports)
router.get('/withdrawals', withdrawals.list)
router.post('/withdrawals/:id/review', withdrawals.review)
router.post('/withdrawals/:id/recheck', withdrawals.recheck)
router.post('/withdrawals/:id/reject-held', withdrawals.rejectHeld)
router.post('/withdrawals/:id/start-transfer', withdrawals.startTransfer)
router.post('/withdrawals/:id/release-transfer', withdrawals.releaseTransfer)
router.get('/withdrawals/:id/destination', withdrawals.destination)
router.post('/withdrawals/:id/transfer', withdrawals.transfer)
router.get('/settings', settings.list)
router.get('/settings/history', settings.history)
router.patch('/settings', settings.update)

export default router
