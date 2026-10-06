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
- [ ] Question Bank: bulk paste, spreadsheet import, image/media picker
- [x] Vocabulary Bank: translations, definitions, IPA, POS, examples, topics/tags
- [x] Reading library: passages, layouts, topics/tags, question sets
- [x] Listening library: transcript, sections, playback rules, topics/tags, question sets
- [ ] Media Library: upload/storage/deduplication/preview

## Catalogs & Practice
- [x] Nested reusable catalogs
- [x] Mixed question/vocabulary/reading/listening catalog content
- [x] Drag/drop + up/down catalog item ordering
- [x] Group and individual student catalog assignments
- [x] Catalog practice settings and context-preservation rules
- [x] Student assigned-catalog dashboard
- [x] Catalog practice workspace with instant/end feedback foundations
- [x] Practice grading for choice, text/cloze, matching and ordering
- [x] Practice activity logging
- [ ] Global self-practice generator with filters, previous mistakes and unused questions
- [ ] Vocabulary practice modes beyond flashcard reveal
- [ ] Practice resume/local persistence and finished-practice history UI
- [ ] Practice analytics/progress dashboard

## Exams
- [ ] Full exam builder and sections
- [ ] Catalog/question-bank/random-pool sources
- [ ] Assignment to groups/students
- [ ] Immutable publish snapshots
- [ ] Attempt engine, autosave, deadline enforcement, auto-submit
- [ ] Automatic/manual/AI-assisted grading and Student Questions Box
- [ ] Results release and answer/explanation visibility controls
- [ ] Exam monitoring and violation timeline

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
