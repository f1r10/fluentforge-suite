# FluentForge Suite

FluentForge is a production-oriented language-learning, content-management, practice, examination, document-import, monitoring and analytics platform for a private teacher and their students.

It is not an English-only quiz site. The interface supports Azerbaijani, English, Russian and Turkish, while learning content can use teacher-configured languages.

The current production branch supports both:

- a fully self-managed PostgreSQL/PostgREST runtime with built-in auth/session handling and local private object storage; and
- a Supabase-compatible runtime for deployments that already use Supabase.

Lovable is not required in production.

## Core capabilities

FluentForge includes:

- first-run teacher setup, username/password login and one-time recovery codes;
- student access-key login, multi-device sessions, revocation, disable/archive and session termination;
- students, multiple groups/classes and private teacher notes;
- configurable branding, interface languages, learning/translation languages and dashboard widgets;
- extensible Question Bank with the complete planned question-type set, immutable versions, duplicate detection, provenance and bulk operations;
- Vocabulary Bank with practice modes, learner states and optional teacher-reviewed AI enrichment;
- Reading and Listening libraries with dependent question sets and configurable playback/display rules;
- reusable Media Library with private signed uploads, checksum deduplication, YouTube authorized import and reference/embed fallback;
- reusable mixed-content catalogs with assignments, ordering and analytics;
- student self-practice, mistake/unused filters, browser-local resume, favorites and question reporting;
- formal exams with immutable snapshots, random pools, navigation rules, autosave, server-authoritative timing, listening play limits, tab/copy monitoring, automatic/manual/AI-assisted grading and controlled result release;
- teacher monitoring, live sessions, privacy controls, activity timelines, exam reset, question/catalog/student analytics and study streaks;
- notification inboxes for teacher and students;
- document import/review for PDF, scanned PDF, DOC/DOCX, XLS/XLSX, CSV/TSV/TXT and legacy document conversion where supported;
- OCR, layout reconstruction, question/reading extraction, import profiles and custom field mapping;
- local Whisper transcription through the processing service;
- export center with JSON/CSV/XLSX exports plus server-rendered PDF analytics reports;
- manual and scheduled application backups, restore validation, retention and cleanup;
- unified trash, global teacher search, system/audit/technical log center and storage-usage reporting;
- optional local OpenAI-compatible AI and optional Gemini integration;
- production Docker Compose, migration runner, CI security/performance acceptance and Supabase-free smoke tests.

## Architecture

### Web application

- React 19
- TypeScript
- TanStack Start / Router / Query
- Tailwind CSS
- Zod validation
- server functions for application actions

The normal application/business logic remains in TypeScript service modules and server functions. React components do not directly own database business rules.

### Database

PostgreSQL is the canonical relational database.

The schema uses normalized tables for domain relationships and JSON/JSONB only where structured question-type or metadata payloads are appropriate.

Migrations are stored in:

```text
drizzle/migrations/
```

The migration runner records checksums and refuses migration drift for already-applied migrations.

### Heavy processing

`processing-service/` is a Python/FastAPI worker service used for workloads that should not run in the web request process:

- OCR and document extraction;
- LibreOffice conversion;
- local Whisper transcription;
- YouTube media import;
- PDF report rendering.

It keeps a durable local queue database in its own persistent volume.

### Object storage

Two deployment modes are supported.

**Plain PostgreSQL runtime**

- private local filesystem storage under a persistent Docker volume;
- signed HMAC upload/read capabilities;
- path-traversal validation;
- size enforcement;
- HTTP Range support for audio/video playback.

**Supabase-compatible runtime**

- uses the configured Supabase-compatible Storage service.

## Self-hosting modes

### Recommended: plain PostgreSQL runtime

This mode requires no Supabase or Lovable service.

Files:

```text
docker-compose.postgres.yml
.env.postgres.example
docs/SELF_HOSTING.md
```

Start:

```bash
cp .env.postgres.example .env.postgres
chmod 600 .env.postgres

# Replace every placeholder secret before starting.

docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  up -d --build
```

The stack includes:

- PostgreSQL 17
- migration/bootstrap job
- PostgREST
- FluentForge web app
- processing service
- hourly internal scheduled-backup trigger

Only the web app is bound to the host by default. PostgreSQL, PostgREST and the processing worker stay on the internal Docker network.

### Supabase-compatible runtime

Use:

```text
docker-compose.production.yml
.env.production.example
```

The web app still runs on your own server; Supabase-compatible Auth/PostgREST/Storage are external dependencies in this mode.

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for the full production runbook.

## Local development

Bun is the primary project package runner used by CI.

Install dependencies:

```bash
bun install
```

Run the web development server:

```bash
bun run dev
```

Verify the application:

```bash
bun run test
bun run lint
bun run build

# Or all three:
bun run verify
```

For database-dependent development, use either a local Supabase instance or the plain PostgreSQL Docker stack.

## Database migrations

Run migrations against a configured PostgreSQL connection:

```bash
bun run migrate
```

Production Docker deployments use the dedicated `migrate` image/service.

Important rules:

- never edit an already-applied production migration;
- create a new numbered migration instead;
- the runner verifies migration checksums;
- plain PostgreSQL mode applies the runtime compatibility bootstrap before normal schema migrations.

## Processing service

The processing service is built automatically by both production Compose stacks.

Its main configuration includes:

```env
PROCESSING_SHARED_SECRET=
PROCESSING_MAX_SOURCE_BYTES=1073741824

WHISPER_MODEL=small
WHISPER_MODEL_PATH=
WHISPER_MODEL_CACHE=/models/whisper
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=int8
WHISPER_LOCAL_FILES_ONLY=false
WHISPER_BEAM_SIZE=5
WHISPER_VAD_FILTER=true
```

For a fully offline Whisper deployment, pre-populate the model directory and set:

```env
WHISPER_LOCAL_FILES_ONLY=true
WHISPER_MODEL_PATH=/models/whisper/<model-directory>
```

## YouTube media import

The Media Library supports two YouTube workflows:

1. authorized download/import into private FluentForge storage; or
2. link/embed-only reference when downloading is unavailable or not appropriate.

The download workflow requires explicit teacher confirmation that they own the content or have the necessary permission/rights.

Only single-video YouTube URLs are accepted by the import worker; playlists and non-YouTube hosts are rejected.

## Optional AI

Core FluentForge functionality works with AI disabled.

Default:

```env
AI_PROVIDER=disabled
```

Local OpenAI-compatible provider:

```env
AI_PROVIDER=local
AI_LOCAL_BASE_URL=http://host.docker.internal:11434/v1
AI_LOCAL_MODEL=<model-name>
AI_LOCAL_API_KEY=
```

Optional Gemini:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=
```

AI-assisted grading and vocabulary enrichment are suggestion workflows. Teacher review remains authoritative.

## Authentication and security model

Teacher:

- username + password;
- secure server-side password hashing;
- five one-time recovery codes;
- recovery codes stored only as hashes.

Students:

- one access-key field;
- high-entropy key generated by teacher;
- raw key shown only when generated/regenerated;
- persistent database stores only hashes;
- multi-device sessions supported;
- teacher can revoke keys and terminate sessions.

Production protections include:

- server-side authorization;
- RLS/security-definer boundaries;
- audit logs;
- login throttling/rate limiting;
- private object storage;
- signed upload/download capabilities;
- security headers;
- immutable exam/question snapshots;
- monitoring privacy controls.

## Backup and restore

Teacher-facing Backup & Restore supports:

- manual portable application backup;
- scheduled backups;
- configurable interval and retention count;
- relational application data;
- managed media/source/branding storage objects;
- package checksums;
- restore preview;
- empty-target guard;
- resumable restore.

Scheduled backups are triggered by an internal Docker scheduler and protected by `SCHEDULED_JOB_SECRET`. The database uses a concurrency-safe claim so simultaneous scheduler calls cannot create duplicate scheduled backups.

For disaster recovery, keep infrastructure-level PostgreSQL and storage-volume backups in addition to application-level `.ffbackup` packages.

## Health checks

Web liveness:

```text
GET /api/health
```

Backend readiness:

```text
GET /api/ready
```

In plain PostgreSQL mode, readiness verifies an actual service-role JWT request through PostgREST and a real database query.

## CI / acceptance

GitHub Actions verifies:

- unit/component tests;
- lint;
- production build;
- migration-runner syntax;
- processing-service compilation and tests;
- fresh-database migrations;
- RLS/RPC/storage security invariants;
- query/index/performance acceptance checks;
- production container build and smoke test;
- fully Supabase-free PostgreSQL/PostgREST runtime startup;
- signed local object upload and HTTP Range download.

The repository currently contains 31 numbered SQL migrations, TypeScript test coverage and Python processing-service tests.

## Production checklist

Before exposing FluentForge publicly:

1. use independent high-entropy secrets for database, JWT, storage, setup, processing and scheduled-job authentication;
2. keep environment files outside version control and mode 600;
3. run behind HTTPS using a reverse proxy;
4. do not expose PostgreSQL, PostgREST or the processing service to the public Internet;
5. configure scheduled backups and test a restore on a separate empty installation;
6. decide which monitoring metadata is allowed in Teacher Settings;
7. configure media limits and enabled interface/content languages;
8. keep Docker images, host OS and reverse proxy patched;
9. review GitHub Actions before each production release.

## Repository status

The active completed product work is maintained on:

```text
chatgpt/full-system-build
```

See `roadmap.md` for implementation coverage and `docs/SELF_HOSTING.md` for deployment details.
