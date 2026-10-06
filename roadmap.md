# Roadmap

## Foundation
- [x] Full PostgreSQL schema foundation
- [x] Branding + AZ/EN/RU/TR interface languages
- [x] Teacher login, first-run setup, one-time recovery codes
- [x] Student access-key login, revocation, sessions
- [x] Students & groups management
- [x] Security/data-integrity hardening and CI (test + lint + build)
- [x] Heavy-processing service boundary for later OCR/AI/transcription workers
- [ ] Plain PostgreSQL/self-host runtime adapter replacing mandatory Lovable/Supabase dependency

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
- [ ] Vocabulary practice modes beyond flashcard reveal

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
- [ ] AI-assisted open-answer grading suggestion (score/confidence/reason)
- [x] Full teacher attempt-monitoring / violation timeline UI
- [ ] Strict server-controlled listening play limits (private delivery exists; counted streaming/proxy enforcement still required)

## Processing / Operations
- [ ] Document import review pipeline
- [ ] PDF/scanned PDF OCR and layout extraction
- [ ] DOC/DOCX/XLS/XLSX/CSV import profiles
- [ ] External Python/FastAPI processing worker
- [ ] Local Whisper transcription
- [ ] Optional local AI / Gemini adapters
- [ ] Export packages and reports
- [ ] Backup/restore
- [ ] Trash retention and cleanup jobs
- [ ] Production Docker/self-host deployment
- [ ] Performance/security acceptance testing

## Branding polish
- [ ] Logo/favicon file upload (currently URL fields)
