# FluentForge self-hosting runbook

FluentForge now supports two production backend modes:

1. **Plain PostgreSQL runtime (recommended for fully self-managed installs)** — PostgreSQL + PostgREST + FluentForge's built-in auth/session provider + local filesystem object storage. No Supabase or Lovable service is required.
2. **Supabase-compatible runtime** — keeps the existing Supabase Auth/PostgREST/Storage path for deployments that already use it.

Both modes use the same application schema and business logic. Do not run both backends against the same live installation at the same time.

## Requirements

- Linux server with Docker Engine and Docker Compose v2.
- DNS/TLS reverse proxy for public production use.
- At least 4 GB RAM for the base application. OCR/LibreOffice/Whisper workloads need additional RAM and disk.
- Persistent storage for PostgreSQL, application objects, the processing queue and the Whisper model cache.

The processing service is internal-only in both provided Compose stacks.

---

# Option A — plain PostgreSQL runtime

This mode is self-contained and does not require Supabase/Lovable.

## 1. Configure

```bash
cp .env.postgres.example .env.postgres
chmod 600 .env.postgres
```

Replace every placeholder. Generate independent random values for:

- `POSTGRES_PASSWORD`
- `APP_JWT_SECRET` — minimum 32 characters
- `APP_STORAGE_SECRET` — minimum 32 characters
- `SETUP_TOKEN`
- `PROCESSING_SHARED_SECRET`

Do not reuse the database, JWT and storage secrets.

## 2. Start the stack

```bash
docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  up -d --build app scheduler
```

The dependency chain is deliberate:

```text
PostgreSQL healthy
  -> runtime compatibility bootstrap
  -> checksum-verified schema migrations
  -> PostgREST
  -> processing worker
  -> FluentForge web application
```

The migration container creates the portable compatibility surface required by the schema before applying numbered migrations:

- `anon`, `authenticated` and `service_role` PostgreSQL roles;
- `auth.uid()` and `auth.jwt()` compatibility functions;
- storage bucket metadata;
- all normal FluentForge schema migrations.

PostgreSQL and PostgREST are not published to the host by the supplied Compose file. Only the FluentForge app is bound, by default to `127.0.0.1:3000`.

## 3. Persistent data

The Compose stack uses named volumes:

- `postgres-data` — relational data;
- `app-storage` — media, source files, exports, backups and branding objects;
- `processing-data` — processing worker state;
- `whisper-models` — local model cache.

The plain runtime storage provider uses signed HMAC capabilities for private uploads/downloads, rejects path traversal, enforces bucket size limits and supports HTTP Range responses for media playback.

## 4. Health and readiness

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

`/api/health` checks web-process liveness.

`/api/ready` performs a service-role JWT request through PostgREST and verifies a real database query. It returns HTTP 503 when the backend is unavailable.

## 5. First-run setup

Open the HTTPS site and complete the teacher setup using `SETUP_TOKEN`.

The plain runtime stores:

- password hashes with scrypt and a per-password random salt;
- refresh tokens only as SHA-256 hashes;
- signed access tokens with HS256 using `APP_JWT_SECRET`;
- storage capabilities with `APP_STORAGE_SECRET`.

Teacher recovery codes and student access keys continue to be stored only as hashes as in the Supabase-backed mode.

After first setup, verify:

- teacher login/logout;
- student creation and access-key login;
- private media upload and preview;
- a document import reaching the processing worker;
- Backup & Restore.

## 6. Logs

```bash
docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  ps

docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  logs -f --tail=200 app postgrest postgres processing-service
```

## 7. Upgrade

Before upgrading, create both an application-level backup and infrastructure-level backups of the PostgreSQL and storage volumes.

Then:

```bash
git pull --ff-only

docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  build

docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  up -d app scheduler
```

The one-shot `migrate` service applies only pending migrations and rejects checksum drift for migrations already recorded in `public.fluentforge_schema_migrations`.

---

# Option B — Supabase-compatible runtime

Use this mode when you already have a managed or self-hosted Supabase-compatible backend.

## 1. Configure

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Configure:

- browser `VITE_SUPABASE_*` values;
- server-side Supabase URL and keys;
- direct `DATABASE_URL` for migrations;
- `SETUP_TOKEN`;
- `PROCESSING_SHARED_SECRET`;
- `PROCESSING_ALLOWED_SOURCE_HOSTS`.

The browser Supabase values are embedded at build time and require a rebuild when changed.

## 2. Apply migrations

For a fresh database:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  --profile migrate \
  run --rm migrate
```

Do not replay the initial migration blindly against an older installation whose migration history was managed outside the checksum runner. Reconcile its baseline first.

## 3. Build and start

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  build

docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  up -d app scheduler
```

Use the same `/api/health` and `/api/ready` checks described above.

---

# Reverse proxy and TLS

Both Compose stacks bind the web app to loopback by default. Put Caddy, Nginx, Traefik or another TLS reverse proxy in front of it.

Forward at least:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

Do not expose PostgreSQL, PostgREST or the processing worker directly to the Internet.

If direct LAN access is intentional, change `APP_BIND_ADDRESS`.

# Whisper

The `whisper-models` volume persists the local model cache.

For a strictly offline server:

```env
WHISPER_MODEL_PATH=/models/whisper/<model-directory>
WHISPER_LOCAL_FILES_ONLY=true
```

# Optional AI

The core product does not require AI.

For a local OpenAI-compatible endpoint:

```env
AI_PROVIDER=local
AI_LOCAL_BASE_URL=http://host.docker.internal:11434/v1
AI_LOCAL_MODEL=<your-model>
AI_LOCAL_API_KEY=
```

Gemini remains optional and is active only when `AI_PROVIDER=gemini` and its credentials are configured.

# Scheduled backups

Both supplied production Compose stacks include an internal `scheduler` service. The startup commands above explicitly start it; starting only the `app` service does not automatically start reverse dependencies such as the scheduler.

The scheduler calls:

```text
POST /api/scheduled-backup
```

once per hour over the private Docker network and authenticates with:

```env
SCHEDULED_JOB_SECRET=
```

The teacher controls whether scheduled backups are enabled, the interval and retention count from Backup & Restore settings. The database uses a concurrency-safe claim, so overlapping scheduler calls cannot create duplicate scheduled backups.

Verify the scheduler after deployment:

```bash
docker compose \
  --env-file .env.postgres \
  -f docker-compose.postgres.yml \
  logs --tail=100 scheduler
```

For the Supabase-compatible stack, use the same command with `.env.production` and `docker-compose.production.yml`.

Do not expose `/api/scheduled-backup` as an unauthenticated public cron endpoint. Keep `SCHEDULED_JOB_SECRET` independent from every other application secret.

# YouTube media import

Media Library supports:

- authorized YouTube download/import into private FluentForge storage; and
- reference/embed-only fallback.

The download flow requires teacher confirmation that they own the media or have the necessary permission/rights. The worker accepts only single-video YouTube URLs and rejects playlists/non-YouTube hosts.

The processing image includes `yt-dlp`, FFmpeg and a JavaScript runtime required by modern YouTube extraction. If YouTube requires account cookies for a particular video, provide them to the processing container only through a protected server-side file and never expose them to the browser.

Because upstream YouTube behavior changes independently of FluentForge, treat YouTube import as an operational integration that may require periodic `yt-dlp` updates.

# Backup policy

Use both layers:

1. FluentForge **Backup & Restore** for portable application-level recovery.
2. Infrastructure-level PostgreSQL and storage-volume/object-storage backups for disaster recovery and large installations.

The portable `.ffbackup` format includes relational application data and managed storage objects, including uploaded branding assets, but intentionally has in-process safety limits.

Before a major upgrade, verify at least one recent scheduled/manual backup and test restore on a separate empty installation.

# Security baseline

- Keep environment files mode 600.
- Never commit production secrets.
- Use independent high-entropy database, JWT, storage, setup and processing secrets.
- Keep the app bound to loopback behind a TLS reverse proxy.
- Keep PostgreSQL, PostgREST and the processing service internal-only.
- Keep Docker, the host OS and reverse proxy patched.
- Rotate any leaked credential immediately.
- Back up PostgreSQL and storage before upgrades.
- Test restore on a separate empty installation.
- Review CI security/performance acceptance results before production releases.


# Release acceptance

Before merging a production candidate to `main`, follow [`RELEASE_ACCEPTANCE.md`](./RELEASE_ACCEPTANCE.md). CI covers a fresh plain-PostgreSQL stack and a real Chromium teacher/student smoke path, but public TLS, host persistence, real media processing and restore drills still need a deployment-environment check.
