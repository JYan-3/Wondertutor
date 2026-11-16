# WonderTutor documentation

Start with the [latest system review — 15 November 2026](SYSTEM_REVIEW_2026-11-15.md) for current fixes, verified results and remaining release gates. Older narrative review files have been removed; Git history retains them if needed.

## FYP design and evaluation

| Document | Purpose |
| --- | --- |
| [Requirements traceability](REQUIREMENTS_TRACEABILITY.md) | Functional requirements, implementation evidence, client decisions and acceptance scenarios; updated 15 November. |
| [Data model and class diagrams](CURRENT_DATA_MODEL.md) | Editable Mermaid sources and exported ERD/class/layer diagrams. The diagrams are a dated 12 November snapshot and need regeneration from the current schema before submission. |
| [UI design reference](UI_v1.pdf) | Original interface mockups. |
| [AI assistant](AI_ASSISTANT.md) | Read-only tool design, API, privacy, configuration, evaluation method and dated diagnostic results. |
| [Tutor test cases](testing/tutor-test-cases.csv) | Teammate's test-case reference. |
| [12 November QA evidence](testing/history/QA_EVIDENCE_2026-11-12.json) | Historical synthetic test/browser evidence for Chapter6; not current release totals. |
| [13 November QA evidence](testing/history/QA_EVIDENCE_2026-11-13.json) | Historical integrated/AI diagnostic evidence, including distinctions between real and mocked checks. |

## Deployment, security and API

| Document | Purpose |
| --- | --- |
| [Hostinger deployment](HOSTINGER_DEPLOYMENT.txt) | Build/start, environment, migrations, scheduled jobs, readiness and recovery guidance. |
| [Browser sessions and CSRF](SAFER_SESSIONS_2026-11-12.md) | Cookie session design, role-safe login/logout and request protection. |
| [Public IDs](PUBLIC_IDS_2026-11-12.md) | UUID references, compatibility, ownership checks and backfill/deployment. |
| [Child photo privacy](CHILD_PHOTO_PRIVACY_2026-11-12.md) | Private child media, legacy-file migration and retention considerations. |
| [Postman collection](WonderTutor.postman_collection.json) | API checks using the cookie jar and CSRF bootstrap. Use a disposable database for requests that change data. |

The schema and migrations in `backend/prisma/` are the data-model source of truth. Keep the API/backend and frontend together when deploying contract changes. Actual `.env` files, SQL dumps, backups and private browser artifacts belong outside the published documentation.
