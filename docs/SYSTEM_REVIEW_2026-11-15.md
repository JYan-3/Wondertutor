# WonderTutor system review — 15 November 2026

Reviewed the shared code at `fc05835`, after fast-forwarding four new main commits from Yan Hsi. The review covers authentication/ownership, parent workflows, tutor/admin integration, reporting, failure recovery, responsive pages and deployment dependencies. Fixes focus on Xin Yue's parent and complaint-management responsibilities. This is regression and exploratory testing, not a client acceptance certificate or production load test.

The original Lora/Inter/Caveat typography, light-blue design and parent decorations are preserved. This release contains the reviewed fixes and handover notes; production deployment remains a separate step. Actual `.env` files, SQL dumps, backups and private QA artifacts are excluded from the Git release.

## Fixes

| Priority | Verified issue | Result |
| --- | --- | --- |
| High | A tutor can now finish a lesson after admin approves a missed check-in, but parent progress/report/AI data ignored that decision. Physical lessons appeared to have missing attendance; online ones appeared unknown. | Reports, the timeline, CSV and AI tools now distinguish **attendance confirmed by admin** from an actual check-in. Check-in totals and timestamps are never invented. Only a resolved, approved decision counts; reopening the case removes that confirmation from reports. |
| High | A parent could submit an answer from an older attendance question after admin replaced it. The server did not require the question version the parent saw. | Parent replies carry the review timestamp. The server compares it and atomically updates only that version. A stale answer returns 409 and the page reloads the latest question without replaying the answer. One successful reply creates one notification per active admin in the same transaction. |
| Important | Admin Complaints fetched every complaint. A slow earlier filter or investigation response could replace newer results, and failed page changes could leave an old actionable list on screen. | Bounded pages default to 20, with a maximum of 50. Global status counts remain available; identical dates have an ID tie-breaker. URL filters survive Next/Previous and reloads. Empty final pages clamp safely. Outdated responses are ignored; failed pages offer retry for the same filter/page. |
| Usability | A lesson marked not held still asked the parent to chase missing attendance/report records. | Booking rows/details explain the admin decision and link to payment/refund status. Admin-approved attendance awaiting a tutor summary asks for that summary, not a new GPS record. Queued or approved refunds are explicitly separate from money returned. |

Key implementation paths:

- `backend/src/services/progress.service.js`, parent children controller, assistant tools/answers/schemas: shared attendance interpretation and minimised AI results.
- `backend/src/services/booking.dto.js`, parent bookings controller and `frontend/src/pages/parent/MyBookings.jsx`: versioned parent responses and post-review wording.
- Admin complaints controller/page: pagination, stable ordering, failure recovery and request isolation.
- Parent ChildProgress/ProgressReport, `frontend/src/lib/attendance.js` and assistant result cards: truthful display/export labels.

The progress queries select attendance-decision metadata only. Complaint descriptions, proof URLs, GPS coordinates and upload signatures are not added to model results. Existing ownership checks, cookie sessions, CSRF checks, booking locks and monetary settlement rules remain.

## Database and teammate integration

Created a complete local SQL backup outside the repository, under `C:/Users/tanxi/.wondertutor/backups/`, before applying Yan Hsi's migrations:

1. `20261115090000_missed_check_in_review`
2. `20261115093000_attendance_reconsideration`
3. `20261115100000_attendance_refund`

Prisma Client was regenerated. Windows initially locked its DLL while the development API was running; the identified WonderTutor/nodemon process was stopped, generation completed, and the development API was restarted. No working database reset or reseed was performed. The migrations add/backfill attendance-review fields and history as defined in their SQL. This review adds no further schema migration.

Deploy the backend and frontend together: the parent attendance-response endpoint now requires `reviewedAt`, taken from `booking.attendanceReview.updatedAt`. The repository's tutor-session integration fixtures were updated to exercise that contract. The admin complaint response adds `pagination: { page, pageSize, total, totalPages }`; `complaints` and global `counts` remain.

On another checkout or Hostinger, apply migrations with `npm run db:deploy` before starting the updated backend. Actual `.env` files, database dumps and backups are not part of the code changes.

## Verification

| Check | Result and scope |
| --- | --- |
| Backend Jest regression | **1,115/1,115 tests, 70 suites passed**, using the isolated `wondertutor_test` database. |
| Frontend Vitest regression | **660/660 tests passed** after the final booking wording change. |
| Production frontend build | Passed. |
| Lint | Zero errors; 71 warnings remain in the integrated codebase. |
| Responsive browser checks | **117 page/viewport checks**: 39 public, parent, tutor and admin routes at 1440, 375 and 320px. No horizontal page overflow or JavaScript page errors. |
| Browser journeys | **7/7 passed**, listed below; changes and money simulation were confined to synthetic test-database records. |
| AI deterministic replay | **100/100 passed**. This measures backend regression, not live NLP accuracy. |
| Live AI smoke | Three synthetic matching questions in English, Malay and Chinese passed tool/argument/task checks against configured `gemini-3.5-flash-lite` on Google's API host. Latencies were 1,086 / 1,083 / 986 ms. These are reused examples, not a held-out benchmark or reliability guarantee. |
| Production dependency audit | Frontend: zero findings. Backend: three high entries in one Prisma/config/deepmerge-ts dependency chain remain; see below. |

Browser journeys:

1. Add, edit and remove a child on a phone.
2. Read admin-confirmed attendance in progress/report and download the same distinction in CSV.
3. Select two available slots on different dates and submit two booking records.
4. Tutor accepts through its UI; parent completes the explicitly labelled simulated FPX checkout; confirmed payment state persists.
5. Replace an admin attendance question while the parent has the old form open. The old answer is rejected, the current question appears, and a fresh reply creates one admin notification.
6. Navigate the admin complaint pages with a retained status filter, read both responses, mark a lesson not held and verify exactly one pending refund. Parent details show the final decision and refund follow-up route at phone widths.
7. Reject anonymous booking reads, parent access to admin complaints, another family's progress UUID and a write with no CSRF proof.

The browser harness initially targeted the tutor confirmation by the wrong button label and expected a manual refresh where My Bookings already refreshes automatically. Those harness assumptions were corrected. No application fix was needed for those two failures. The 117 successful layout checks were retained on the unchanged layout code while the journeys were rerun; the final attendance wording was additionally checked at 320px. Browser sessions and the temporary isolated API were closed afterwards. Real reCAPTCHA, Google OAuth, bank settlement, Cloudinary device capture and OTP delivery were not automated in this pass.

Private evidence is under `%TEMP%/wt-browser-qa/`:

- `review-2026-11-15-{backend,frontend,browser,live-ai}.json`
- `review-2026-11-15-{build,lint,ai-replay}.txt`
- `review-2026-11-15-{backend,frontend}-audit.json`
- `review-system-*.png` and the synthetic CSV.

## Remaining work before a real-client release

1. **Billplz merchant/staging evidence.** The signed callback, original-bill timeout reconciliation, cancellation races and refund accounting have regression coverage. This pass did not prove real bank settlement or send a real refund. Use the client's eligible merchant setup and collect sandbox/provider evidence before accepting money.
2. **Hostinger deployment rehearsal.** Verify the actual Node subscription/runtime, HTTPS/proxy/cookie behaviour, database permissions, migration order, scheduled housekeeping, monitoring, encrypted off-host backup and restore procedure on the deployment. A local backup is not a Hostinger restore drill.
3. **Prisma dependency advisory.** The current audit reports `prisma`, `@prisma/config` and `deepmerge-ts` through the same [recursive-object advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Its patched library version is 8.0.0; the audit's proposed Prisma fix is a major version upgrade. The project currently specifies Prisma 6, so no forced major upgrade/override was applied. The advisory requires recursive object graphs; plain JSON alone does not create that condition. No public exploit path was demonstrated here, but the advisory remains unresolved and should be addressed in a controlled dependency upgrade or supported backport.
4. **Browser security hardening.** Helmet is enabled, but the application's Content Security Policy is currently disabled for external-service compatibility. An enforced policy still needs staging validation with Google login/reCAPTCHA, fonts, Cloudinary and optional map tiles.
5. **Operational scale and client policy.** Some parent histories/exports still read a full history; email has no durable delivery outbox, and chat/rate-limit state is per process. Measure realistic data volumes and restart/failure recovery before scaling. Confirm child-note visibility, suspension/history access and verification-first ranking with the client; these are policy decisions, not cosmetic changes.
6. **Human acceptance.** Ask a first-time parent, tutor and admin to complete the agreed scenarios without coaching. Record completion, errors, help requests and satisfaction. Automated pass counts do not establish client satisfaction.

## Architecture/report impact

The architecture remains a React presentation layer, Express controllers/services and Prisma/MySQL persistence in a modular monolith deployed as one Node application. No folder rename or new service is needed for these fixes.

The current generated Prisma model contains **30 models and 39 declared foreign-key relationships**. Update older ERD snapshots to include `AttendanceReviewEntry → Complaint` and nullable `Complaint.attendanceRefundId → Refund`, alongside the already integrated availability/finance/session additions. The new progress attendance source is derived output, not a new database table. Activity diagrams should distinguish admin-approved attendance from GPS check-in, fresh attendance responses from stale ones, and refund review/approval from recorded transfer.
