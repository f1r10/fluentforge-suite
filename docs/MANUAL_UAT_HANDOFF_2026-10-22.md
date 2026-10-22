# FluentForge — controlled manual UAT handoff (2026-10-22)

## Scope and status
**READY FOR CONTROLLED STAGING UAT**, not certified for production merge/deployment.
Verified candidate commit: `286678add8da02f11816fa5665ced7d91a314f29`.
Both CI runs for this exact commit succeeded (GitHub Actions 39745945438 and 39745937658).
CI tests a disposable synthetic environment; it does **not** prove the seven private PDF fixtures or EC2 disaster recovery. Do not silently convert missing evidence to PASS.

Do not overwrite the live EC2 instance or its data. Do not run a destructive restore in production. Create an isolated empty staging Compose project and verify migration history and storage before proceeding.

## Isolated staging bootstrap (no production modifications)
On a separate UAT host or a workstation with adequate resources, clone this PR
branch and run:

```bash
git fetch origin chatgpt/integration-hardening-lessons-20261019
git switch chatgpt/integration-hardening-lessons-20261019
bash scripts/setup-isolated-uat.sh
```

The bootstrap creates a fresh `.env.uat.local`, uses Docker Compose project
`fluentforge-uat` (separate database/media/processing volumes), and binds the
application to `127.0.0.1:3100`. It refuses to overwrite an existing UAT
environment. On a remote host, reach it over SSH port forwarding, not by
exposing the UAT service on the public interface:

```bash
ssh -L 3100:127.0.0.1:3100 <uat-host>
```

Then open `http://127.0.0.1:3100/`. Perform initial teacher setup with the
generated setup token from the private environment file, and create **disposable**
students for the acceptance scenarios. Do not reuse production credentials.
The script builds a fresh *empty* staging environment, **not** an EC2 restore
verification. Use a different staging Compose project for isolated disaster
recovery experiments; never restore onto these newly created UAT records.

## Operator preflight (read-only)
1. Record the deployed commit, Docker/Compose versions, disk free space, TLS certificate expiry and /health. Save logs with secrets redacted.
2. Take a PostgreSQL custom-format backup and storage snapshots, record checksums and the snapshot consistency caveat.
3. Provision a separate staging stack (distinct project, DB volumes, storage volumes and port). Verify no connection string points at production.
4. Apply migrations, run all CI-equivalent checks, and create disposable teacher and two student identities. Preserve original source PDF fixture files privately.

## Manual acceptance matrix — each case requires screenshot/log evidence
| ID | Role | Scenario | PASS criteria |
|---|---|---|---|
| UAT-01 | Teacher | Teacher sign-in, profile, branding, logout/relogin | Valid session; no raw validation JSON; branding persists |
| UAT-02 | Teacher | Import baseline QA01 PDF | 10 complete questions, options and answer key match original |
| UAT-03 | Teacher | Import A1 2-column and A2 sectional PDFs | 40/60 source questions; no ordering or section answer-key mix-up |
| UAT-04 | Teacher | Import nested-statement and present-simple PDFs | 25/32 correct top-level question units; editable draft |
| UAT-05 | Teacher | Import Beginner 100 exercises | 100 source units or explicitly reported exceptions; drawings/tables/clock remain visible |
| UAT-06 | Teacher | Import C1 word list | 1801 source senses; POS, gloss, level, duplicate/same-lemma senses individually reviewed |
| UAT-07 | Teacher | Reject -> edit -> approve -> commit -> reload | No dropped rows, no stale-state errors, teacher approval is mandatory |
| UAT-08 | Teacher | PDF question image crop then edit answer and re-open | Private PNG exists and remains linked to correct question |
| UAT-09 | Student A | Open assigned questions, catalog, practice, exam | Correct content and scoring, including preserved image/media |
| UAT-10 | Student B | Attempt unassigned catalog/lesson and Student A session | Server denies access; no indirect ID leaks |
| UAT-11 | Teacher | Publish lesson, revise, assign student A | Immutable revision and default-off existing catalog locking |
| UAT-12 | Student A | Resume lesson on two devices | Same persisted checkpoints; no fabricated graded score for view-only Reading/Listening |
| UAT-13 | Teacher + student | Listening, Reading, Vocabulary and exam report flows | Context and media preserved; answer report shows correct/incorrect evidence |
| UAT-14 | Operator | Restore backup into empty isolated stack | Row counts, event/audit replay, media digests, restart and TLS verified |
| UAT-15 | Teacher | Reimport/retry/import 1801 rows and exports | No duplicate sense loss, rate/time stable and formats open correctly |
| UAT-16 | Both | AZ/EN/RU/TR and mobile layout | Labels legible, no overlapping controls, keyboard accessible |

For each FAIL, capture timestamp, account type, document SHA-256, expected/actual state, network response, backend logs, and reproducible steps **without passwords, tokens, or private PDF content**.

## Release blockers vs allowed UAT scope
- Real seven-PDF full extraction and answer-key verification are the **purpose of the manual UAT**; absent evidence is not a claim of product readiness.
- Lesson Mode Reading/Listening are **view-only acknowledgement** until a dedicated aggregate grading feature is implemented and tested. Do not mislabel view-only as a grade.
- Real isolated EC2 restore/reboot is an operator requirement before production release; synthetic CI cannot establish this.
- Merge to `main` only after UAT failures are fixed, regressions pass and host restore is proven.

## Evidence and rollback
Store the UAT report and test artifacts privately. Create a release tag only for verified commit SHA. For failure, revert staging to known-good SHA and isolated backup; never point the staging restore at live production volumes.
