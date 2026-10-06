# FluentForge release acceptance

This is the release gate for a production candidate. A green CI run is necessary but is not, by itself, proof that a specific public server is production-ready.

## Automated gates

The pull-request head must pass all CI jobs:

- `verify`: unit tests, lint, production build, migration-runner syntax.
- `database-acceptance`: fresh database migrations, RLS/RPC/security invariants and query budgets.
- `processing-service`: Python compile and processing/OCR/YouTube/PDF tests.
- `plain-postgres-runtime`: Supabase-free PostgreSQL/PostgREST/runtime-auth/local-storage stack, signed storage Range checks, scheduler authentication and a real Chromium teacher/student smoke path.
- `production-container`: production image build, Compose validation and security-header smoke test.

The Chromium smoke path performs first-run teacher setup, persists the teacher session, creates a real student, captures the one-time student access key, verifies a fresh teacher credential login, then signs in as the new student in a separate browser context and confirms the student dashboard renders.

## Deployment-environment gates

Run these against the actual target host before merging or tagging a production release:

1. Put the app behind HTTPS and confirm HTTP redirects to HTTPS. Confirm the reverse proxy forwards `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` and does not expose PostgreSQL, PostgREST or the processing worker.
2. Generate fresh independent production secrets. Keep environment files outside source control with restrictive permissions. Confirm no placeholder or CI credential remains.
3. Deploy from the exact PR commit. Confirm `/api/health` and `/api/ready` return success through the public hostname.
4. Complete first-run teacher setup, sign out and sign in again. Create a student and verify access-key login from a separate browser/device profile.
5. Exercise at least one real Grammar/Vocabulary/Reading/Listening activity and one exam attempt. Confirm teacher analytics and student progress reflect the activity.
6. Upload representative image/audio/video/document files. Confirm private preview/download behavior and HTTP Range playback. Run one OCR/document-processing job and one local Whisper transcription on the hardware intended for production.
7. If YouTube import will be enabled operationally, test one authorized single-video import and the reference/embed fallback. Treat upstream YouTube behavior as an external integration.
8. Enable scheduled backups temporarily and confirm the scheduler creates a backup. Create a manual backup too. Restore a recent `.ffbackup` into a separate empty installation and verify representative records and files.
9. Restart the application stack and then reboot the host. Confirm PostgreSQL data, object storage, processing state and the Whisper model cache persist as expected.
10. Check desktop and mobile layouts for teacher and student paths, including login, dashboard, student management, question/exam screens and media playback.
11. Review monitoring privacy defaults, audit logs, technical logs, storage usage, retention/cleanup controls and backup retention.
12. Record the deployed commit SHA, deployment timestamp, backup reference and rollback procedure.

## Merge policy

Keep the pull request in draft while any deployment-environment gate is unresolved. After all required gates pass, mark the PR ready for review, rerun CI on the final head, merge to `main`, and create the release tag from the merge result.
