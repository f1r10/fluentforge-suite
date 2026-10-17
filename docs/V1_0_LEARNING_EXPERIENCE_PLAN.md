# FluentForge V1.0 — Learning experience release plan

Status: **implementation plan and foundation**; **not a completed feature declaration**.
Product scope: **one teacher + that teacher's students**, self-hosted PostgreSQL, AZ/EN/RU/TR UI, no AI required or enabled in these workflows.
Owner principle: reuse existing content, grading, assignments, student records and audit trails rather than building another LMS alongside FluentForge.

## Research-backed decisions

- Moodle: activity completion can depend on attempted work and passing score; access to later activities can be restricted until conditions are met. Sources: https://docs.moodle.org/405/en/activity_completion_settings and https://moodledev.io/docs/5.1/apis/subsystems/availability
- Anki: spaced repetition schedules reviews by retention. Anki's modern FSRS requires calibrated review history; **do not call our deterministic initial schedule FSRS**. Source: https://docs.ankiweb.net/deck-options
- H5P: dictation associates uploaded audio with a teacher-written transcript; replay limits and punctuation-aware scoring are configurable. Source: https://h5p.org/dictation
- Duolingo: a focused Practice area resurfaces prior mistakes and vocabulary without overwhelming the main lesson route. Source: https://blog.duolingo.com/guide-to-duolingo-practice-hub/

## User journeys

### Teacher: create an ordered lesson from existing content

1. Open Catalogs -> Create/Edit catalog -> enable **Lesson mode** (normal catalogs remain unchanged).
2. Set title, short goal, CEFR band, estimated duration, optional opening explanation and completion requirement.
3. Arrange steps: theory (teacher text / approved document); vocabulary; reading; listening; question or exam practice; optional dictation.
4. For each step: required/optional and completion condition (**view**, **submit/attempt**, **pass with teacher-configured percentage**). Preserve context: reading/listening questions never detached from their parent.
5. Preview the *student* flow, assign to a student/group using existing catalog assignments, then publish a **stable revision**.
6. Editing a published lesson creates a new revision; progress on the previous revision is retained. Draft must not leak into assigned students.
7. Reuse the existing teacher student profile to see last step, completion date, attempts, wrong answers and teacher overrides without technical IDs.

### Student: continue the assigned lesson

- Dashboard: a single **Continue learning** action for the next unfinished assigned lesson and a small **Reviews due today** tile.
- Lesson page: title, goal, progress such as 2/5, one primary "Continue" CTA, and a compact stepper. No five independent menus for five steps.
- If sequential mode is on, a required previous step must be completed before the next required step can open. Optional steps do not block. Locks are checked *server-side*; hidden links are not authorization.
- An incomplete score step may be retried according to teacher rules; grade comes from the existing server grader, not from the browser.
- Existing catalogs, free practice and exams must continue working outside lesson mode.

### Student: spaced review for words and mistakes

- Use one logical schedule per (student, entity kind, entity ID). Vocabulary is linked to existing \`student_vocabulary_state\`; question mistakes are linked to the existing mistake record and contextual Reading/Listening if necessary.
- First implementation: deterministic recall schedule (approximately 1, 3, 7, 14, 30, 60, 120 days after **successful due reviews**, up to a cap); wrong answers reset the interval. Do **not** claim this is FSRS.
- No schedule is advanced by showing the answer, flipping a flashcard, refreshing a page, or clicking "Known"; only server-graded attempts count.
- Repeating an already-successful item before its due time must not repeatedly accelerate intervals.
- Server UTC timestamps; client displays the learner's timezone. Overdue items remain due, with no punitive streak loss.
- Practice queue: due vocabulary; unresolved question mistakes; contextual reading/listening parent activities. Filter out archived, deleted, unassigned/private materials.
- Reasonable defaults: up to 20 due reviews shown per session, teacher-adjustable. Wrong answer receives explanation/expected answer **after submission**.
- Teacher can see counts of due/completed/overdue, not internal algorithm metrics.

### Teacher: build a listening dictation

1. Open an existing Listening and add a **Dictation** activity using the same private audio. Optional segment start/end and slower teacher-uploaded audio.
2. Enter the exact transcript and optionally accepted alternatives. Select whether case, punctuation and diacritics matter (sensible defaults: case-insensitive, punctuation-insensitive, diacritics-sensitive).
3. Set replay policy and whether the correct transcript appears after submission.
4. Preview as a student; publish with the Listening or a lesson step.

### Student: dictation

- Audio player with repeat button and remaining plays if limited; answer editor, submit, then word-level feedback ("missing", "extra", "different").
- Grade is computed on the **server**, based on a versioned teacher-written transcript; no AI, external speech-to-text, browser-trusted score, or automatically invented correct text.
- Never send answer text to the student **before** policy permits showing it. Preserve score even when results are initially hidden.
- Store attempts, score, timing and feedback in teacher/student activity history. Rate-limit submits and prevent double-credit on request retries.

## Architecture — implementation order

### Phase 0: release hardening (required before shipping)

- Keep the current GitHub \`main\` untouched while work continues on \`chatgpt/full-system-build\`.
- Regression set: numbered bilingual vocabulary, real PDF split questions, library persistence, bulk approval validation, reading/listening context, exam row selection, student activity, two-device access.
- Test on an actual HTTPS Linux server: teacher setup, student separate session, OCR, PDF/Word/Excel, audio Range streaming, backups and *restore to a fresh target*, reboot persistence, mobile layouts, security headers, role isolation, and audit privacy.
- CI green is a prerequisite, not deployment acceptance. Do not tag V1.0 before real-host testing.

### Phase 1: reusable lesson sequencing

- Retain \`catalogs\`, \`catalog_items\`, \`catalog_assignments\`, Question Bank, Reading, Listening, Vocabulary, Exams.
- Extend catalog settings for \`lesson_mode\` and a small \`lesson_policy\`; add stored theory content and ordered lesson-step definitions referencing **existing catalog_items**, plus immutable published revisions.
- New persisted per-student per-revision completion / teacher override state, unique constraints and indices. No progress update merely from viewing the dashboard.
- Backend server functions for teacher save, preview, publish and student next step / mark viewed / submit / retry. Reuse existing authoritative graders.
- Student dashboard "Continue learning", teacher "Lesson mode" editor and 4-language strings.
- Acceptance: required next step locked until previous passes; optional step doesn't block; student cannot change scores, open another student's content, or access unassigned lessons; teacher edit doesn't rewrite history.

### Phase 2: spaced review

- Add durable \`student_review_schedules\` and history with unique \`(student_id, entity_type, entity_id)\`, due timestamp, step, lapses, last graded event ID for idempotence; indexes on student + due_at.
- Centralize schedule mutation in a server-only transaction (or DB function invoked from every approved grading path). Update *all* existing vocabulary and question practice paths; retain student_vocabulary_state as current mastery snapshot.
- Backfill existing vocabulary history safely: no fabricated prior review intervals; existing incorrect results can enter due queue. Never modify old grades.
- Student "Today's review" and teacher per-student review insight. Keep ordinary practice and mistakes routes.
- Acceptance: wrong/correct intervals, duplicate post/reload, parallel devices, DST / UTC boundary, early repeat, archived/deleted item, contextual questions, revoked student access.

### Phase 3: listening dictation

- Add \`listening_dictations\` (listening_id, transcript, accepted alternatives, time region, grading policy, status, version) and \`dictation_attempts\` (student_id, dictation version, typed answer, feedback, score, submitted_at, idempotency key).
- Teacher editor integrated into existing Listening; student tab in existing Listening + optional lesson step. Do not introduce a standalone shadow media library.
- Reuse private audio authorized URL and playback controls; **authorization is not achieved by obscuring the URL**. Build access checks and an attempt-bound player; server checks replay eligibility.
- Grade with deterministic Unicode-aware word alignment; default punctuation/case ignored and diacritics preserved. Limit input length, cap algorithmic work, prevent exposing protected transcript before answer release.
- Acceptance: missing/extra/substituted word, capitalization, diacritics, apostrophes, punctuation toggle, empty response, multiple sentences, no audio access by unassigned student, replays, two devices, resume, history.

### Phase 4: release quality

- All four interface languages and consistent branding; no visible implementation jargon; keyboard-only navigation, WCAG contrast, mobile audio UX.
- Test 1 teacher, at least 2 students in separate groups, a draft/published lesson, word + question mistake, two dictations with and without punctuation rules, long audio and file repair.
- Backup/restore includes new tables and private media. Versioned lesson and dictation data remains reproducible after teacher edits.
- Security: RLS plus server checks; rate limits; audit events; IDOR/BOLA; all protected answer keys excluded from pre-submit student payloads.
- Performance: index due review queue, pagination and limits; avoid downloading full media/transcripts into the lesson list.
- Rollback: additive forward-only migrations, feature disabled by default until acceptance, no deletion of existing catalogs/grades.
- Merge PR to main only after CI + actual host acceptance; production release tag thereafter.

## Explicit exclusions from V1.0

No multi-teacher tenant management, SaaS billing, AI generation, Whisper-based automatic dictation answers, AI speech scoring, automatic pronunciation judgment, social feed, gamified leaderboard or unverified CEFR certification.

## Implementation log

- Research and architecture recorded.
- Foundational deterministic sequencing/review/dictation algorithms and unit tests are separate from server routes.
- **These foundations alone do not mean the teacher and student UI is implemented**; phases 1–4 must be integrated and accepted before calling this feature set done.
