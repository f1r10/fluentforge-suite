# Roadmap
## V1.0 learning experience extension (in progress)

Scope: **single teacher + students, no AI required**. Detailed acceptance plan:
[docs/V1_0_LEARNING_EXPERIENCE_PLAN.md](docs/V1_0_LEARNING_EXPERIENCE_PLAN.md).

- [x] Research Moodle course sequencing, Anki-style intervals, H5P dictation patterns.
- [x] Add pure, regression-tested lesson sequencing, deterministic spaced reviews and dictation grading.
- [x] Add student due-review schedule and server-graded practice integration.
- [x] Add due-review student page, dashboard shortcut, and AZ/EN/RU/TR labels (CI and device acceptance pending).
- [x] Add initial teacher-enabled listening dictation, student writing widget and server scoring (CI and device acceptance pending).
- [ ] Integrate **Lesson mode** with existing catalogs: teacher-created ordered steps, progress, draft/publish immutable revision, strict server-side unlock rules and student "Continue learning".
- [ ] Support teacher-configurable step completion (view/attempt/passing score) and verify historical grades do not mutate on lesson edits.
- [ ] Complete review idempotency/concurrency testing on two devices and validate all graded pathways (including exam mistakes) alongside teacher progress.
- [ ] Complete dictated audio playback limits, content visibility and teacher-level answer-detail integration; test multiple audio formats.
- [ ] Real teacher/student UX accessibility tests, realistic language PDFs/Word/Excel import verification and browser acceptance.
- [ ] Real target-host HTTPS/security, migration, backup/restore and reboot acceptance; merge and tag only when passing.


## Foundation
- [x] Full PostgreSQL schema foundation
- [x] Branding + AZ/EN/RU/TR interface languages
- [x] Teacher login, first-run setup, one-time recovery codes
- [x] Student access-key login, revocation, sessions
- [x] Students & groups management
- [x] Security/data-integrity hardening and CI (test + lint + build)
- [x] Heavy-processing service boundary for later OCR/AI/transcription workers
- [x] Plain PostgreSQL/self-host runtime adapter: PostgreSQL + PostgREST, built-in scrypt/JWT sessions, signed local object storage, provider-compatible server/browser clients, dedicated Compose stack and Supabase-free CI smoke coverage

## Content
- [x] Question Bank: filters, bulk actions, all planned question structures, versioning, duplicates, topics
- [x] Server-side typed question validation and deterministic grading primitives
- [x] Question Bank: Media Library picker + image/diagram/map coordinate labelling
- [x] Question Bank: bulk paste + CSV/TSV/XLS/XLSX mapping, validation, duplicate review and provenance
- [x] Vocabulary Bank: translations, definitions, IPA, POS, examples, topics/tags
- [x] Reading library: passages, layouts, topics/tags, question sets
- [x] Listening library: transcript, sections, playback rules, topics/tags, question sets
- [x] Media Library: private signed upload/storage, preview, trash/restore, checksum deduplication when available

## Catalogs & Practice
- [x] Nested reusable catalogs
- [x] Mixed question/vocabulary/reading/listening catalog content
- [x] Drag/drop + up/down catalog item ordering
- [x] Group and individual student catalog assignments
- [x] Catalog practice settings and context-preservation rules
- [x] Student assigned-catalog dashboard
- [x] Catalog practice workspace with instant/end feedback
- [x] Practice grading for choice, text/cloze, matching and ordering
- [x] Practice activity logging
- [x] Global self-practice generator: language, level, type, topic, assigned catalog, source, count
- [x] Previous-mistakes, unused-question and exclude-answered self-practice filters
- [x] Browser-local resume for unfinished self-practice
- [x] Practice analytics: today/week, accuracy, current mistakes, topic stats, 14-day activity
- [x] Finished-practice history UI
- [x] Vocabulary practice: flashcards, translation recall, reverse recall, multiple choice, persistent learner state

## Exams
- [x] Full exam builder and sections
- [x] Question / Reading / Listening / Catalog sources
- [x] Balanced random question pools with filters
- [x] Assignment to groups/students
- [x] Immutable published exam snapshots
- [x] Per-attempt randomized snapshot generation
- [x] Attempt engine with server-authoritative deadline
- [x] Browser backup + server autosave
- [x] Answer change count, time spent, flags and numbered navigation
- [x] Unanswered-submit warning and automatic deadline submission
- [x] Late-entry full-duration vs must-finish-by-close policy
- [x] Question/option/section randomization
- [x] Back-navigation restrictions
- [x] Copy/paste and tab-switch monitoring
- [x] Server-side tab-switch-limit auto-submit enforcement
- [x] Automatic grading and manual-review fallback
- [x] Student Questions Box / manual score override with audit
- [x] Result release: immediate / after close / after teacher approval
- [x] Answer/explanation visibility timing enforcement
- [x] Teacher approval queue for after-approval results
- [x] AI-assisted open-answer grading suggestion with explicit teacher apply/save and audit
- [x] Full teacher attempt-monitoring / violation timeline UI
- [x] Strict server-controlled listening play limits: atomic DB leases, hashed capability tokens, private Range proxy, attempt/deadline enforcement and teacher playback audit

## Processing / Operations
- [x] Document import review pipeline: private source upload, queued extraction, confidence/duplicate review, approve/reject/edit, provenance and commit
- [x] PDF/scanned PDF text extraction with Tesseract OCR fallback
- [x] Document layout/table/image association, reading-order reconstruction and linked Reading/question context import
- [x] Native DOCX/XLS/XLSX/CSV/TSV/TXT extraction + legacy DOC/RTF conversion
- [x] Reusable document import profiles with language/level/status/content defaults and confidence policy
- [x] Advanced custom field/section mapping templates: reusable sheet allowlists, header/data rows, field/options/section mapping, tags/scoring metadata and provenance
- [x] External Python/FastAPI processing worker with durable local queue and CI
- [x] Local Whisper transcription via processing worker and Listening editor
- [x] Optional AI adapters: disabled-by-default local OpenAI-compatible provider + optional Gemini provider
- [x] Export Center: Questions, Vocabulary, Readings, Listenings, Catalogs, Exams, Students, Results, Logs and portable content package (JSON/XLSX/CSV)
- [x] Validated application Backup/Restore: relational data + private media/source files, checksums, dry-run, empty-target guard and resumable restore
- [x] Trash retention, expired export/upload cleanup, dependency-safe permanent cleanup and teacher retention controls
- [x] Production Docker/self-host deployment: hardened Node/worker images, Compose, health/readiness, migration runner, CI smoke test and self-hosting runbook
- [x] Performance/security acceptance testing: fresh-stack migrations, RLS/RPC/storage invariants, production security headers, hot-path index coverage, synthetic query-plan/latency checks and plain-runtime Docker smoke tests

## Branding polish
- [x] Logo/favicon file upload: validated signed uploads, byte-signature checks, dynamic favicon/logo rendering and Backup/Restore portability
