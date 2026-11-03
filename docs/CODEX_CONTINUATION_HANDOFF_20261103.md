# FluentForge — Codex Continuation Handoff
**Updated:** 2026-11-03  
**Repository:** https://github.com/f1r10/fluentforge-suite  
**Purpose:** Continue the existing product locally on the user's computer. This is an execution handoff, not a product-completion claim.

## 1. Mandatory starting point

Read these files before changing code:

1. `AGENTS.md` — repository-wide engineering and safety rules.
2. This file — current handoff, active branches, known defects and acceptance gates.
3. `README.md` — product capabilities, local development and self-hosting.
4. `docs/V1_1_MULTI_TEACHER_PRINT_RESULTS_PLAN.md` — authoritative multi-tenant security, printing and result-release requirements.
5. `docs/PRODUCT_HARDENING_REAL_FIXTURES.md` — real PDF/vocabulary fixtures and non-synthetic acceptance requirements.
6. `docs/SELF_HOSTING.md` — deployment configuration and safe local setup.
7. Relevant migrations `0048` through `0058`, the CI workflow, `scripts/acceptance-db.mjs`, and `scripts/release-browser-smoke.cjs`.

Do not treat old chat transcripts, this handoff, README feature lists, database tables, or green unit tests as proof that a workflow is complete. Verify current code and actual persisted behavior.

## 2. Repository and release-line state (last verified 2026-11-03)

- Canonical repository: `f1r10/fluentforge-suite`.
- Stable line: `main`; last verified main commit after the isolated PDF preview security fix was `1e398291c6c2e8fe48c34d8c40103910f505a0bf` (PR #16).
- V1.1 integration work is intentionally isolated. Do not start by merging it into main.
- Main must remain the stable V1 line until V1.1's automated and adversarial acceptance gates pass.
- PR #16: teacher-RLS authorization before issuing private PDF source preview signatures. Merged to main; its five CI checks passed. This is a GitHub merge, not proof of AWS deployment.
- PR #15: draft WIP, `feat/multi-teacher-print-exam-review-20261102`; admin foundation, tenant backfill, print builder and exam feedback. Its own description explicitly says it is not manual-UAT ready and must not be merged/deployed yet.
- PR #17: draft QA continuation, `chatgpt/fluentforge-v11-gates-20261102`; carries regression-test diagnostics and V1.1 integration work.
- PR #18: draft catalog PostgREST relationship fix, `fix/catalog-embed-ambiguity-20261102`; intended to continue the PR #17 / PR #15 V1.1 stack. Confirm its current base/head and ancestry from GitHub before assuming this is still true.
- PR #8 tracks real-source PDF/vocabulary hardening; PR #12 is the authoritative Lesson Mode implementation. Inspect their current state before duplicating or reverting work.
- The V1.1 branch has additive migrations through `0058` in the last inspected candidate. Never edit an already-applied migration; create the next numbered migration.

**GitHub state can move.** On the local machine, run `git fetch --all --prune`, inspect `git status`, all local changes, remote branch tips and PR heads before checkout or merge. Do not assume any SHA or branch tip in this file is still the newest one.

## 3. Product target and original requirements

FluentForge is a self-hosted language-learning and assessment platform, not an English-only quiz page. Preserve the current simple, clean, low-fatigue UI and existing design. Do not rewrite the app or replace its architecture without a demonstrated need.

### V1 single-teacher baseline

Keep all existing V1 behavior working:

- Teacher username/password authentication; five one-time recovery codes, stored hashed and shown only once.
- Student high-entropy access-key login, teacher-controlled issuance/revocation, multi-device use, disable/archive and session termination.
- Students, groups/classes, memberships, private teacher notes, activity timelines, audit and analytics.
- Teacher-controlled branding, logo, login text, dashboard and settings.
- Interface languages: Azerbaijani, English, Russian and Turkish. Student interface language is independent of learning/content and translation languages.
- Question Bank and typed question engine: single/multiple choice, true/false, open text, fill blank, matching, ordering, short answer, multi-gap and IELTS-style types already represented by the schema/registry. Validate type-specific payloads and answer keys server-side.
- Separate reusable banks/libraries for questions, vocabulary, reading, listening, media, catalogs, lessons and exams; preserve reading/listening parent context and access rules.
- Vocabulary practice modes, learner states, mistakes, favorites, progress, streaks and teacher notes.
- Student self-practice, assigned work, lesson continuation, timed exams, autosave/resume, exam monitoring, manual review and controlled feedback release.
- Import of PDF/scanned PDF, DOC/DOCX, XLS/XLSX, CSV/TSV/TXT/RTF and supported images. Include editable preview, field mapping, approve/reject/edit, safe commit and retry/resume.
- Media library and book/source uploads. YouTube supports authorized single-video import where possible and a working link/embed-only fallback when download is blocked or not appropriate.
- Exports, audit/history and backup/restore tooling.

AI is optional, not a required runtime dependency. Keep AI disabled by default unless explicitly configured. Teacher review remains authoritative; never auto-approve uncertain vocabulary or invented answer keys.

### V1.1 multi-teacher requirement

A separate platform superadmin must be able to create, reset-password, disable/archive and view metadata for teacher accounts. Every teacher must have a separate workspace. The platform admin may see only teacher profile/status and read-only group/student names, status and memberships. It must not read teacher content, questions, vocabulary, notes, grades, exam answers, files, exports, media, backups or private audit payloads. It must never read or display a teacher's password.

A teacher sees only their own workspace. Scope branding/settings, students, groups, question and vocabulary banks, reading/listening, catalogs, lessons, exams, attempts, feedback, media, source files, imports, exports, signed URLs, notifications, backups, scheduled jobs and audit access. Student identity and access keys must remain bound to the owning teacher's workspace. A student must not access another student, including within the same teacher's workspace.

The existing V1 teacher and all historical data must be migrated into one legacy workspace without changing IDs or losing students, keys, attempts, question versions, exam snapshots, lesson revisions, media, uploads or backup digests. Archive is non-destructive. It must prevent login and revoke active sessions.

**Critical safety gate:** do not enable creation of a second teacher until every RLS policy, service-role path, RPC, storage path, export/import/backup job, polymorphic reference and endpoint is tenant-safe and adversarial two-teacher/two-student tests pass. The single-teacher uniqueness constraint must remain until then. The current `createPlatformTeacher` handler intentionally throws a disabled message; that is a known unfinished requirement, not a completed feature.

## 4. Work already implemented in the V1.1 candidate

The PR #15 description and inspected source show these slices have been started:

- Separate platform-admin setup/login and middleware, distinct from teacher identity.
- Metadata-only teacher/group/student dashboard, password reset and non-destructive archive path.
- Additive workspace/tenant schema and legacy V1 ownership backfill.
- Archived workspace checks in teacher/student authentication and session handling.
- Tenant-oriented RLS and composite foreign-key / polymorphic-reference guard migrations.
- PDF/DOCX print builder for filtered question/vocabulary selections and catalog/published exam content; student copy versus answer key; immutable published exam snapshots and deterministic random-pool variants.
- Exam feedback release confirmation, idempotence and RLS embargo.
- Four-language interface additions and unit/database acceptance tests.
- Real-source regression harness and large import pagination work.

These are implementation claims, not acceptance results. Verify each workflow end to end and inspect all service-role code. In particular, the current candidate intentionally disables second-teacher creation.

## 5. Known defects and diagnostic history

### A. Catalog list / latest known CI blocker

GitHub CI run `41443268755` had these results:
- `verify`: PASS
- `production-container`: PASS
- `database-acceptance`: PASS
- `processing-service`: PASS
- `plain-postgres-runtime`: FAIL

The browser failure was at `/teacher/catalogs`: Playwright timed out waiting for the `New catalog` / `Add catalog` button. The failure followed tenant composite-FK additions, which introduced a second PostgREST relationship between `catalogs` and `catalog_items`. The candidate fix explicitly selects `catalog_items!catalog_items_catalog_id_fkey(count)` (and the explicit catalog-assignment relation) in `src/lib/catalog.functions.ts`.

PR #18 was opened for this fix. Verify that `catalog_items_catalog_id_fkey` is the real original FK in the migrated database, that the query succeeds under the authenticated teacher JWT, and that the full plain-Postgres Chromium workflow passes. Then audit **all** PostgREST embedded relationship strings affected by composite tenant FKs; do not stop after the catalog list.

### B. Import / PDF preview

- A previous source-preview path used a privileged lookup by caller-supplied job ID. PR #16 fixed this by first resolving the import job through the authenticated teacher's RLS context, then using privileged storage only to sign the already-authorized object.
- Import-job/source-file embeds must name the intended relationship explicitly: `source_files!import_jobs_source_file_id_fkey(...)`.
- The original PDF count-mismatch defect (for example, dozens of source questions collapsing into one imported question) is not proven fixed merely because a synthetic PDF passes. Run all private real fixtures and compare extracted rows, answer keys, pages/crops and parent contexts.
- Re-test upload, preview, edit, reject, approve, commit, retry/resume, source retention and question-bank persistence after reload. No silent loss or invented answers.

### C. Vocabulary import and listing

The following tenant-schema issues were found and patched in the candidate; verify each against the current branch and disposable PostgreSQL database:

- Ambiguous `import_jobs` → `source_files` relationship.
- Ambiguous vocabulary-entry embeds for translations, examples, topics and tags.
- Vocabulary sense lookup needed to be tenant-safe; migration `0056_tenant_safe_vocabulary_import_lookup.sql` defines `lookup_vocabulary_import_senses` with workspace enforcement.
- Bulk import-item linking needed a tenant-safe RPC; migration `0057_tenant_safe_bulk_import_links.sql` replaces the service-only behavior with explicit workspace/provenance validation and atomic rejection of forged or cross-workspace links.
- Vocabulary listing, filters and entry editor must use explicit FK hints where multiple FKs now exist.

Vocabulary matching must be sense-aware, not just word+language. Preserve separate senses and parts of speech (e.g. `run` as different verb senses; `projection` as different noun senses). All imported or externally suggested vocabulary must be teacher-reviewable; ambiguous matches must remain pending. Do not silently map an incorrect translation, POS, definition or example. Test 1,801 C1 rows, pagination beyond 1,000, retries and duplicate-safe commit.

### D. Print and result review

A print export must never silently truncate a catalog or omit image/media-bearing questions. The candidate has a 500-item cap with an explicit error rather than silently returning a partial paper; verify boundary tests at 500/501. Test student copy and teacher answer key independently, PDF and DOCX rendering, ordering, all question types, answer key correctness, context/media fidelity and short-lived authorized download links.

Exam review must keep answers embargoed until explicit release. Verify unresolved manual reviews block release, bulk release is atomic/idempotent, feedback appears only after release, and post-release regrading creates an immutable revision/audit trail.

### E. Lesson Mode and YouTube

PR #12 is the authoritative Lesson Mode work; do not reimplement it in parallel. Verify real teacher publish/edit and student continue/complete workflows. A graded Reading/Listening activity is still listed as outstanding in the real-fixture plan; view-only acknowledgement is not equivalent to a graded activity.

YouTube download has previously been blocked by provider bot challenges. Do not bypass access controls or rights restrictions. The teacher must be able to save a valid single-video link/embed reference when authorized download is unavailable. Test that the picker recognizes a pasted YouTube URL and that the student playback path works.

## 6. Real PDF fixtures — mandatory, private inputs

`docs/PRODUCT_HARDENING_REAL_FIXTURES.md` documents seven original teacher files. Do not add private source PDFs to public Git. Search the existing local project/approved fixture directory first. The expected acceptance dimensions include:

| Fixture | Expected source structure |
|---|---|
| QA01 A1 answer-key PDF | 3 pages, 10 MCQs |
| Elementary 1A two-column exam | 5 pages, 40 MCQs |
| A2 multi-section exam | 11 pages, 60 questions: 20 Grammar / 25 Reading / 15 Listening |
| Azerbaijani nested-statement exam | 3 pages, 25 top-level questions |
| Present Simple fill-in test | 3 pages, 32 text questions |
| Beginner mixed exercises | 10 pages, 100 exercises |
| BTU C1 vocabulary | 33 pages, 1,801 lexical rows |

The source plan lists SHA-256 prefixes and further requirements. Run:

```bash
python processing-service/scripts/check_real_pdf_regressions.py /path/to/teacher-fixtures --strict > real-pdf-regression.json
```

A passing count is insufficient. Inspect field-level fidelity, answer-key scope, duplicate senses, image-dependent questions, crops/provenance, Reading/Listening grouping and downstream teacher/student behavior. If originals are unavailable locally, do not fabricate fixtures or mark the gate PASS; record it BLOCKED and request the source files only after searching the repo and approved local fixture locations.

## 7. Local installation and safe test environment

The user wants the actual project running on their computer so Codex can reproduce bugs in the UI, inspect logs and finish implementation. Detect the host OS and available tools first. The user commonly works on Windows; use PowerShell/Windows-compatible commands where appropriate and Docker Desktop/WSL2 only if installed and healthy. Do not assume a particular local path.

1. Find any existing local clone. Check its remote, branch, `git status`, uncommitted/untracked files and ignored secrets before doing anything. Never overwrite or discard local work.
2. If there is no clone, clone the full Git history from the canonical GitHub repository into a new folder such as `C:\Users\<user>\Desktop\Firon\fluentforge-suite` (choose an actually available path; do not assume the placeholder).
3. Fetch all branches and inspect PR #15/#17/#18 heads and ancestry. Use a separate worktree or a dedicated feature branch for V1.1 if that avoids disturbing existing work.
4. Install the pinned dependencies using the lockfile and repository instructions. Check Bun, Node, Python and Docker Compose versions before changing system-wide tools.
5. Create a local-only environment file from `.env.postgres.example`. Generate unique local secrets securely; never print or commit them. Keep it git-ignored.
6. Start only a disposable local test stack using `docker-compose.postgres.yml`, a unique Compose project name such as `fluentforge-codex-qa`, and a free local port. Inspect Compose and environment variables first. Do not connect local tests to AWS or any user database.
7. Keep the local DB, object storage and processing volumes separate from any existing project. Do not run `docker compose down -v` unless the exact Compose project is the newly created disposable Codex test stack and the user data has been preserved.
8. Open the real app in Chromium/Playwright and reproduce the teacher and student journeys. Capture browser console errors, network/API responses, server logs, screenshots and DB state for every failure.

The existing AWS EC2 instance is a **test server**, not production: Ubuntu 24.04, app on localhost:3000 behind nginx/HTTPS, Compose project `fluentforge-postgres`. It is not authorized for this local task. Do not SSH, deploy, run migrations, restart containers, change firewall/ports or touch AWS data unless the user separately authorizes a specific deployment. Do not create a permanent parallel UAT stack.

## 8. Required execution order

Work autonomously through the following sequence. Do not stop after producing a plan or finding the first failure.

1. **Preserve and orient:** inspect Git state, PR heads, `AGENTS.md`, handoff files, current migrations, environment and scripts. Record the actual branch and commit.
2. **Reproduce baseline:** install locally, run existing unit/lint/build/verify checks and the disposable plain-Postgres stack. Reproduce the latest catalog failure and earlier import/vocabulary failures.
3. **Fix PostgREST relationship ambiguity:** inspect the actual FK catalog in PostgreSQL, add exact relation hints to every affected query, and add regression tests. Avoid guessed FK names.
4. **Finish import workflows:** PDF/DOC/DOCX/spreadsheets/CSV and source previews; complete teacher edit/reject/approve/commit/retry. Confirm teacher review for all vocabulary suggestions, sense-aware matching, exact POS/translation/definition and 1,801-row pagination. Ensure writes are idempotent and transactionally safe.
5. **Audit tenant security before enabling teacher creation:** enumerate every server function, RPC, storage access, signed URL, export, backup, scheduled task and polymorphic reference. Prove tenant scope under real authenticated JWTs and RLS. Test two teachers and at least two students per teacher. Try guessed IDs, altered filters, foreign source IDs, catalog/exam IDs, storage paths, export/backup IDs and session replay. Verify no cross-tenant read/write or metadata leakage.
6. **Complete platform admin:** separate setup/login and rate limiting; teacher create, reset password, archive/disable, session/refresh-token revocation and audit. Verify admin cannot access educational content. Only after all tenant gates pass, remove the single-teacher uniqueness restriction in a new migration and enable `createPlatformTeacher`.
7. **Finish print/exam review:** PDF/DOCX, 500/501 cap, images/context, immutable exam snapshots, answer-key variant, feedback embargo, bulk release, audit and revision history.
8. **Finish learning journeys:** vocabulary modes, reading/listening, catalog assignment, Lesson Mode, practice, exam, favorites, errors, progress, streak, notes, notifications and analytics. Test teacher and student roles separately.
9. **Finish backup/restore:** local disposable backup and restore tests with row counts, relationships and object checksums. Do not claim AWS disaster-recovery PASS without an operator-authorized isolated restore on the actual test host.
10. **Run full regression repeatedly:** after each fix, run the narrow test, then the complete suite. Continue until all locally executable release gates pass. A failed gate must be reproduced, root-caused, fixed and rerun; do not weaken/delete a test to get green.
11. **Integrate safely:** keep main untouched during development. Once the complete automated suite, plain-Postgres browser acceptance and adversarial tenant suite pass, merge the verified PRs in dependency order. Re-run CI on the exact merge commit. If an external/manual/AWS gate remains blocked, label it BLOCKED and do not call the product production-ready or deploy.
12. **Final local handover:** leave the application runnable locally, provide the exact start/stop commands and test URL, and preserve the local test data until the user has completed manual testing.

## 9. Required tests and evidence

At minimum inspect and run the actual repository scripts/workflows for:

- `bun run verify` (and separately identify test/lint/build results if the script does not include all of them).
- Processing service pytest suite.
- Production Docker image build.
- Migration/bootstrap against a fresh disposable PostgreSQL instance.
- `scripts/acceptance-db.mjs` including RLS, FK, RPC, exam feedback embargo and two-tenant negative tests.
- Plain-Postgres runtime startup, private storage upload/Range download, session and scheduled-backup security.
- `scripts/release-browser-smoke.cjs` with teacher and student journeys.
- Real seven-PDF fixture regression (private originals only).
- Backup restore, object checksums and restart persistence.

Create/update one integrated verification entry point that reports every gate as PASS / FAIL / BLOCKED and exits non-zero on FAIL or on a required gate incorrectly marked PASS. It must preserve the individual test logs and must not convert missing fixtures, skipped tests or untested AWS actions into PASS.

## 10. Engineering and interaction rules

- Make code changes, not just recommendations. Do not return a report instead of doing the work.
- Do not ask the user to repeat requirements already recorded here or in the plan. Ask only when a required private fixture, credential or operator-only action is genuinely unavailable.
- Keep changes minimal and rooted in reproduced defects. Do not rewrite the architecture or redesign the UI gratuitously.
- Never weaken authorization, RLS, validation, rate limits or tests to make CI green.
- Do not expose secrets in logs, screenshots, commits or chat.
- Preserve all historical user data. No destructive migration, database reset or volume deletion on any non-disposable environment.
- Never force-push, rewrite published history, amend/squash already-pushed commits, or silently retarget a PR. Respect the Lovable-connected repository history.
- Do not merge a failing or partially tested branch. Do not mark a draft ready merely because TypeScript/build passed.
- Update this handoff (and `AGENTS.md` if a durable rule changes) when the actual branch, blocker, test result or acceptance state changes.
- Final response should be factual and concise: exact branch/commit/PR, what is truly complete, PASS/FAIL/BLOCKED test matrix, local URL/start command, remaining operator-only blockers. Do not claim deployment or production readiness without evidence.

**Definition of done:** the user can run FluentForge locally; a teacher can complete every required content/import/print/exam workflow; a student can complete assigned and self-directed learning; two independent teacher workspaces and their students are isolated under adversarial tests; admin functions obey metadata-only access; backup/restore integrity is demonstrated; all automated gates pass on the exact integration commit. Only then is V1.1 ready for the user's manual test phase.
