# FluentForge product hardening — real-source acceptance

Status: **work in progress**, not a production-ready release. Integrated candidate: PR #14. CI and isolated host tests are distinct gates. Changes are
prepared on an isolated branch. Existing QA01, exam attempts, teacher accounts,
and stored imports must remain compatible.

## What was actually checked

Seven previously supplied PDFs were inspected with native PDF text extraction
and SHA-256 verification, not guessed from filenames. Keep originals **outside
the public repository** unless their authors permit redistribution.

| SHA-256 prefix | Source | Pages | Acceptance count |
|---|---|---:|---:|
| d503f3eaf29f6269 | QA01_A1_10_MCQ_AnswerKey.pdf | 3 | 10 MCQs |
| d3565e46be72d0b0 | Elementary 1A two-column exam | 5 | 40 MCQs |
| 94f6f5d2fabd0827 | A2 English multi-section exam | 11 | 60 questions: 20 Grammar / 25 Reading / 15 Listening |
| 1b150c0d40022012 | Azerbaijani nested-statement exam | 3 | 25 top-level questions |
| e600e74aa01485d9 | Present Simple fill-in test | 3 | 32 text questions |
| fd15eb0e8559bb3e | Beginner 100 mixed exercises | 10 | 100 numbered exercises |
| 43e867b619e50d2d | BTU C1 vocabulary list | 33 | 1801 source lexical rows |

The C1 source includes distinct senses of the same lemma and POS:
`run verb WORKING`, `run verb PUBLISH`,
`projection noun CALCULATION` and `projection noun IMAGE`.
A plain `word+language` unique/duplicate rule is incorrect. A2 answer
numbering restarts within Reading and Listening tasks; a flat numeric answer
key is incorrect. Beginner has chart/table rows and image-dependent questions.

A correct *count* is only one acceptance dimension. Also require:
1. Exact source question/sense coverage, stable source page/crop and no silent loss.
2. Question type, all answer choices, correct-answer provenance and explanations.
3. Reading/Listening parent context preserved and inaccessible to unassigned students.
4. For ambiguous sources: teacher-visible raw region, editable draft, no invented key.
5. Reload/retry idempotence; duplicate-safe commit and correct analytics.
6. No degradation of QA01 control and existing manually created questions.

## Run the real PDF harness (NOT in public CI, originals are private)

In a Python environment with `processing-service/requirements.txt` installed:

```bash
python processing-service/scripts/check_real_pdf_regressions.py /path/to/teacher-fixtures --strict \
  > real-pdf-regression.json
```

Non-zero status is a release blocker. A passing count is **not enough** to
certify content correctness: inspect sample source crops, 100% A2 answer-key
scopes, all C1 repeated lemmas, image-questions, and downstream teacher import.

This script neither writes to a database nor changes live application data.
Never mark real-fixture tests PASS based only on synthetic unit tests.

## Safe adoption of external open-source components

- [Docling (MIT)](https://github.com/docling-project/docling):
  investigate as an *optional* document-structure fallback for table/column/OCR
  pages. CPU/ML model memory cost and third-party model licenses must be checked.
  Preserve existing native PyMuPDF+Tesseract extraction as the default.
- [PyMuPDF4LLM](https://github.com/pymupdf/pymupdf4llm):
  useful reading-order comparison; review licensing separately before embedding.
- [H5P Question Set (MIT)](https://github.com/h5p/h5p-question-set):
  UI/interaction reference for mixed question types; reuse ideas, not a shadow
  question engine or a second authoritative grader.
- [Moodle activity completion](https://docs.moodle.org/405/en/activity_completion_settings):
  completion policies distinguish view, attempt, and pass. Lesson step locks
  must be **server-authoritative** and attached to immutable published revisions.

All optional parser paths must be measured on the same seven PDFs with
regression-based routing before replacing the working default.

## Acceptance gates / work order

### Gate A — Vocabulary and source fidelity
- [x] Pure tests distinguishing different POS and two same-POS source senses.
- [x] Sense-aware import precheck, ambiguous lemmas require teacher review.
- [x] High-confidence approval scans beyond PostgREST default row limits.
- [ ] Real C1 import: inspect 1801 entries, matching senses, permissions.
- [ ] Ensure existing active vocabulary, student state, and export preserve sense references.
- [ ] Confirm bulk matching remains performant for 1801 records; avoid N+1 DB queries.

### Gate B — PDF fidelity
- [x] Add local real-PDF SHA-256 + expected-count harness.
- [ ] Run harness against all seven original PDFs; record failures.
- [ ] Fix specific layouts via per-format fixtures and run CI after each patch.
- [ ] Optional Docling layout adapter behind explicit opt-in, no default behavior change.
- [ ] Teacher corrections and rejection/commit tested against malformed cases.

### Gate C — Lesson Mode / complete learning journey
- [x] Pure lesson progress and completion rules exist.
- [x] Versioned published lesson snapshots built on existing catalog items (PR #12 implementation).
- [x] Server-side access/unlock/checkpoint APIs + DB constraint/RLS (CI coverage, not live UAT).
- [x] Teacher editor/publish and student Continue learning screens (synthetic browser smoke).
- [x] Two-device progress, independent catalogs unaffected (automated regression).
- [ ] Graded Reading/Listening activity rather than clearly labelled view-only acknowledgement.
- [ ] Real teacher/student acceptance on representative content and devices.

### Backup preflight (safe to run on the real EC2 host)

The new `scripts/ec2-backup-preflight.sh` makes a read-only `pg_dump -Fc`,
archives the `app-storage` and `processing-data` Docker volumes, checks
PostgreSQL's archive index and validates SHA-256 hashes. It **never** calls
`docker compose down`, removes volumes or resets the database.

```bash
cd ~/fluentforge-suite
bash scripts/ec2-backup-preflight.sh
```

Do not send backup archives or secret environment files through chat.
Because processing data may include a live SQLite DB and uploads may change
during archive creation, the volume archives are *hot snapshots*, not
transactionally consistent point-in-time restores. Validate them on a
separate Compose project with a **different project name and app port**.
Do not mark DR PASS until that isolated restore passes user/data and media
checksum checks. Operator-supplied EC2 terminal access is required.

### Gate D — AWS disaster recovery (operator and real host required)
- [ ] Confirm running EC2 commit matches GitHub and secrets aren't placeholders.
- [ ] Create PostgreSQL custom-format backup and archive private storage volumes.
- [ ] Verify archives/checksums and restore on a **separate empty stack**.
- [ ] Compare row counts, related entities, object checksums and account sign-in.
- [ ] Restart/reboot, verify persistence and HTTPS renewal with logs.
- [ ] Confirm setup and all key teacher/student endpoints. No DB reset on live.

### Gate E — Security/release
- [ ] Two-student cross-account IDOR/BOLA, exam answer embargo and replay limits.
- [ ] All types: create, publish, solve, grade, report, edit, restore.
- [ ] Mobile + AZ/EN/RU/TR terminology and error-message pass.
- [ ] No P0/P1 bugs. Merge to main after evidence, release tag only after EC2 acceptance.

## Why production certification is not yet possible here

GitHub CI runs a synthetic disposable environment; it does not have the
operator's EC2 shell/session, application storage snapshot or backup destination.
Successful CI is valuable but cannot prove a restore/reboot on that instance.
Document unsupported checks as BLOCKED rather than PASS.
