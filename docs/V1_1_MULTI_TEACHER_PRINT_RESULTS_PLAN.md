# FluentForge V1.1 — multi-teacher tenancy, print builder and exam results

Status: **implementation specification and fail-closed rollout plan** (not a
deployed or completed feature). Baseline: `main` /
`release/v1.0.0` at `132e8ff648468bba5348a10fb0733bb31ea7dc6d`.
The existing AWS EC2 stack stays a **test** environment at the same hostname,
port 3000, and Compose project `fluentforge-postgres`.

## A. Security boundary first — no second teacher before every gate passes

**Critical V1 finding:** migration 0000 grants `public.is_teacher()` broad
`FOR ALL` access to many tables; migration 0001 adds a unique
`admin_users_single_teacher_uidx`. The app also uses service-role clients
for many teacher/student APIs. Removing the unique index or adding an admin UI
without replacing ALL relevant permissions would expose teachers to each
other's questions, students, files, results, backups or settings.

Model:
- One platform **superadmin** identity, separate from teachers; only
  teacher account management, read-only teacher profiles, and read-only
  names/membership/status of their groups/students. No question bank,
  personal notes, grades, exam answers, files, exports, media, audit payloads
  or the teacher's actual passwords. Superadmin actions audited.
- `tenant_id` (UUID) is an immutable boundary of each teacher workspace.
  One `teacher_account` per tenancy for now, extensible later.
- Existing V1 teacher and all rows migrate to **legacy tenant**, maintaining
  UUIDs, student access keys, results, attachments and historical snapshots.
- Teachers log in with their own username/password. Admin creates teacher,
  resets teacher password (never reads it), disables/archives accounts. Deleting
  means non-destructive archival: no cascade deletion of student work.
- Global student access keys remain high-entropy and unique; student identity
  is bound to the teacher's `tenant_id`.
- Every tenant-owned top-level entity has `tenant_id NOT NULL`; all child
  references, soft deletes, joins, cross-tenant associations and polymorphic
  references are enforced via composite `(tenant_id,id)` constraints or
  validated guard functions/triggers. Any null, missing or conflicting tenant
  must be rejected.
- Auth/JWT session selection is authoritative and revocation-aware; student
  tenancy derives from currentStudentId/owned student, never a client-supplied
  `tenant_id`. Teachers never choose an arbitrary tenant in requests.
- Use PostgreSQL RLS for authenticated read/write and tenant-filtered
  service-role repository functions. Service-role bypass never permits
  unfiltered tenant content through teacher/student routes.
- Settings, branding, media storage objects, export paths, import sources,
  notification channels, backups and scheduled jobs must also be tenant-scoped.
  Define explicitly which login-page branding is global.

Schema migration sequence (additive, versioned):
1. Add tenancy tables and superadmin role without enabling multi-teacher.
2. Seed one legacy tenant and backfill relationships in batches, no ID changes.
3. Add ownership columns and guarded same-tenant foreign keys, indexes and
   triggers, including join/polymorphic edges; validate referential integrity.
4. Replace broad `is_teacher()` policies with owner-scoped policies and
   fix every teacher and student repository/service-role access.
5. Add automated adversarial two-teacher/two-student tests for every endpoint,
   exports, backups, signed media URLs, PDF jobs, lessons and attempts.
6. Only after all gates pass: remove single-teacher unique index and enable
   admin creation of a second teacher.
7. Deploy solely to the existing test stack after backup + validated migration.

### Non-negotiable negative tests

- Teacher A cannot read/edit/delete B's students, groups, questions,
  vocabulary, media, imports, catalogs, exams, grades or exports by guessed IDs,
  search filters, direct API calls, storage URLs, shared source IDs or backup IDs.
- Teacher B cannot change A's branding/setting, reassign A students, release A
  results, create lessons from A catalog or view A notifications.
- Student A cannot access Student B under same teacher OR another tenant.
- An archived teacher cannot sign in or keep existing refresh sessions.
- Admin cannot read protected educational content through UI or raw server
  functions; admin list includes only username/name/status, group names and
  student names/status/memberships.
- Admin password reset invalidates existing access **and** refresh sessions,
  is rate-limited and recorded without recording the secret.
- Existing teacher sessions, student IDs, word senses, question versions,
  exam snapshots, immutable lesson revisions and backup digests survive
  migration; all V1 flows remain green.

## B. Print / compose worksheets

Teacher builds a **printable paper** in PDF and DOCX (Word), independently
from online publication/assignment. Teachers can choose catalog, individual
questions, topic(s), A1–C2 levels, type, language, vocabulary POS and words,
or an existing exam. Show preview and explicit count/order before render.

Required modes:
- **Student copy:** no answer key, no hidden teacher notes.
- **Teacher answer key:** optionally include correct answers and explanations,
  independent artifact, never published to students by mistake.
- MCQ options, true/false, matching, ordering, cloze and context-dependent
  Reading/Listening section text must be preserved. Print images securely
  (embedded attachment/cropped visual) or fail with an explicit missing-media
  warning; don't silently omit it.
- Exam print uses **immutable published snapshot** where one exists, not
  mutable question bank; for random pool exams, teacher selects/locks a
  reproducible randomized variant and prints its key alongside it.
- Selection is tenant-checked on the server; never client-controlled raw SQL.
- Use existing PDF and DOCX processing renderer; generated files are stored
  under tenant-specific private paths; download URLs are short-lived and
  authorized. Do not export students' answer data.

## C. Post-exam review and controlled release

Teacher workflow: `Submitted -> Auto-checked -> Needs manual review ->
Reviewed -> Ready for release -> Released`. Show exam/student summary and
per-question comparison: question snapshot, submitted answer, expected answer,
auto score, manual override and written teacher feedback. Explicit reasons
required for overrides; immutable audit log of previous and new score.
Bulk release for selected students or entire exam requires explicit confirmation
and zero unresolved required manual reviews, with idempotent atomic
server-side release and queued notification delivery.

Published result shows only teacher-approved score/feedback and answer-key
visibility consistent with exam settings. Do not leak answers before release.
Regrading after release must create a revision and deliberate
republish/correction notice, never silently rewrite historical result.
Support submitted/absent/incomplete distinction and withheld review state.

## D. Delivery gates and rollback

- GitHub branch for development only; never rewrite V1 history.
- Test migrations on a disposable PostgreSQL clone *before* live test DB.
- Each slice needs TypeScript/unit tests, Python where relevant, DB/RLS
  integration tests and teacher/student browser regression.
- Real teacher UAT, two-tenant abuse suite and isolated backup/restore before
  changing AWS test deployment. No second app, port or parallel permanent
  backend.
- Mark features incomplete until the user can perform every workflow
  end-to-end and verify persisted state.
