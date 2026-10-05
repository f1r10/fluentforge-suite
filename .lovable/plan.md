# Language Learning Platform — Phased Build Plan

Built on the Lovable stack (TanStack Start + Lovable Cloud). The full domain model from the spec is preserved; features ship phase by phase without simplifying the schema.

## Phases
1. **Shell, branding, languages** — editable system name, logo, login screen, accent color; interface in Azerbaijani, English, Russian, Turkish (each student picks their own).
2. **Login and people** — teacher username/password + 5 one-time recovery codes; students log in with a single Access Key (`username@SECRET`, stored hashed); revoke/regenerate key, disable, archive, end sessions; groups (multi-membership).
3. **Question Bank + question engine** — all listed types as typed payloads, topics (nested), tags, answer normalization, versioning with immutable snapshots, fast editor (Save & Add Next, bulk actions), phone-style multi-select.
4. **Vocabulary** — multi-language translations, examples, practice modes (flashcards, typing, spelling, multiple choice), learner states.
5. **Reading, Listening, Media Library** — first-class content with linked question sets, playback rules, transcripts, reusable media.
6. **Catalogs** — mixed content, ordering, student practice.
7. **Exams and attempts** — availability vs duration, server timer, autosave + offline cache, randomization/pools, scoring, manual/AI review box, result policy.
8. **Document import + review** — PDF/DOCX/XLSX/CSV/images, side-by-side review, confidence, duplicates, import profiles, spreadsheet column mapping.
9. **Monitoring and activity** — online presence, human-readable timelines, assessment and audit logs.
10. **Analytics** — question, catalog, student analytics; dashboards with widget control.
11. **Inbox, search, trash, exports, packages, backups.**
12. **AI/OCR/transcription** behind replaceable providers (Lovable AI built in; optional Gemini key).

This first approval covers **Phases 1–2 plus the full database schema**, so the foundation is real and later phases plug in cleanly.

## Design
White interface, Arial, one accent color (editable), plain tables and forms, mobile-first student side.

## Technical details
- Lovable Cloud: Postgres with RLS, storage buckets (media, sources, branding), server functions for all business logic.
- Roles in a separate `user_roles` table (`teacher`, `student`) with `has_role()`.
- Teacher: Cloud auth account mapped from username; recovery codes stored as hashes in `admin_recovery_codes`, single-use, regenerating invalidates the set.
- Students: access key verified in a server function (hash compare, rate-limited attempts), which signs the student into a Cloud auth account; key rotation updates the hash and revokes sessions.
- Full schema migration in phase 1: all entities listed in the spec (questions/versions with JSONB payloads, vocabulary, reading/listening with explicit parent context, catalogs, exams/sections/items/snapshots, attempts/answers, reviews, activity events, notifications, jobs, audit log), with indexes and soft-delete columns.
- i18n dictionary files for az/en/ru/tr; branding/settings in `system_settings`.
- Heavy jobs (import, OCR, exports) via job tables processed by server routes in later phases.
