# Private teacher PDF source inspection — 2026-10-22

Status: **source-level inspection performed; parser/database E2E NOT certified.**

Seven private teacher-supplied originals were recovered from the authorized file
Library in this ChatGPT session. SHA-256 prefixes matched the seven previously
documented source goldens in `check_real_pdf_regressions.py`. Raw files are
not redistributed or committed to this public repository.

| SHA-256 prefix | Pages | Expected educational records | Embedded visible image occurrences before repeated-decoration filter | Remaining visually significant regions in source-level simulation |
| --- | ---: | ---: | ---: | ---: |
| d503f3eaf29f6269 | 3 | 10 questions | 0 | 0 |
| d3565e46be72d0b0 | 5 | 40 questions | 10 | 1 |
| 94f6f5d2fabd0827 | 11 | 60 questions | 14 | 3 |
| 1b150c0d40022012 | 3 | 25 questions | 0 | 0 |
| e600e74aa01485d9 | 3 | 32 questions | 3 | 0 |
| fd15eb0e8559bb3e | 10 | 100 numbered exercises | 52 | 15 |
| 43e867b619e50d2d | 33 | 1801 lexical sense rows | 66 | 0 |

**Evidence limits.** Counts on the right are image occurrences as reported
by PyMuPDF and a standalone geometric simulation of repeated-art filtering,
not a successful full `detect_candidates` run. C1 contains repeated header
art; A2 and A1 include repeat branding. Beginner mixes checkbox decorations
with visual instructional material; dropping every image would lose data.
Question count expectations are source acceptance targets, not measured
parser outputs for this session.

The integrated PR #14 now includes:
- repeat-logo/checkbox suppression with pure regression tests;
- restricted processing-service PDF crop API and API tests;
- normalized image/table region selection and browser-compatible media IDs;
- idempotent private media storage on teacher-approved import;
- retention of PDF/image originals while visual provenance is needed.

**Still required before certification**
1. Run `python processing-service/scripts/check_real_pdf_regressions.py /path/to/teacher-fixtures --strict`
   in an environment with the source PDFs and exact updated code.
2. Inspect *all* 1801 C1 senses, ambiguous POS, answer-key scope for A2, and
   the Beginner missing-number/chart/clock exercises. Raw page numbering alone
   is not a sufficient parser success criterion.
3. Verify the image PNG is actually presented to an assigned student,
   and that teacher edits/re-approval do not detach it.
4. Run isolated database and storage restore, then reboot and TLS checks on
   an independently provisioned EC2 test stack. Do not run a destructive
   restore on the live instance.
5. Treat view-only Reading/Listening Lesson Mode as ungraded until aggregate
   grading has a tested authoritative implementation.
