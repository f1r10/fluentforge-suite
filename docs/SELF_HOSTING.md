# FluentForge self-hosting runbook

This runbook deploys the FluentForge web application and processing worker on a Linux server with Docker Compose.

## Current backend boundary

The application containers do **not** depend on Lovable at runtime. The current application version still uses the Supabase-compatible APIs for authentication, PostgreSQL access and object storage.

For a fully self-managed installation today, point the environment variables at a self-hosted Supabase deployment. The separate roadmap item for a plain PostgreSQL/auth/storage runtime adapter is not complete yet. Do not describe the current build as a plain-PostgreSQL-only deployment.

## Requirements

- Linux server with Docker Engine and Docker Compose v2.
- A reachable Supabase-compatible backend with Auth, PostgreSQL and Storage.
- A direct PostgreSQL URL for schema migrations.
- DNS/TLS reverse proxy for public production use.
- At least 4 GB RAM for the base application. OCR/LibreOffice/Whisper workloads need additional RAM and disk.
- Enough persistent disk for the processing queue and local Whisper model cache.

The processing service is internal-only in the provided Compose file; port 8001 is not published on the host.

## 1. Prepare configuration

From the repository root:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit every placeholder in `.env.production`.

Generate strong independent values for:

- `SETUP_TOKEN`
- `PROCESSING_SHARED_SECRET`

Keep `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Gemini keys and local AI credentials server-side only.

`PROCESSING_ALLOWED_SOURCE_HOSTS` must contain the hostname used by signed source-file URLs. Leaving this unrestricted is not recommended for production.

The `VITE_SUPABASE_*` values are public browser configuration and are embedded when the web image is built. If they change, rebuild the app image.

## 2. Apply migrations

The repository includes a checksum-verified migration runner. It serializes migration execution with a PostgreSQL advisory lock and records applied filenames/checksums in `public.fluentforge_schema_migrations`.

For a **fresh Supabase-compatible database**:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  --profile migrate \
  run --rm migrate
```

Do not run this blindly against an existing FluentForge/Lovable database whose earlier migrations were applied outside this runner. Baseline/migration history must be reconciled first; the initial migration is intentionally not treated as an idempotent discovery script.

## 3. Build production images

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  build
```

The web build explicitly uses Nitro's `node-server` preset and produces a standalone `.output/server/index.mjs` runtime for Node.js 22.

## 4. Start services

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  up -d app processing-service
```

Inspect status:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  ps
```

Inspect logs:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  logs -f --tail=200 app processing-service
```

## 5. Health and readiness

Liveness:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

Backend readiness:

```bash
curl -fsS http://127.0.0.1:3000/api/ready
```

`/api/health` only checks that the web process can answer requests. Docker uses it as the liveness probe.

`/api/ready` additionally verifies server-side database access and returns HTTP 503 when the backend is unavailable.

## 6. Reverse proxy and TLS

The default Compose binding is `127.0.0.1:3000`. Put Caddy, Nginx, Traefik or another TLS reverse proxy in front of it.

Forward these headers:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

Do not expose the processing service directly to the Internet.

If you deliberately want direct LAN access without a host reverse proxy, change `APP_BIND_ADDRESS` in `.env.production`.

## 7. First-run setup

Open the public site through HTTPS and perform the teacher setup flow with the configured `SETUP_TOKEN`.

After setup:

- keep the setup token secret;
- generate teacher recovery codes and store them offline;
- verify student access-key login;
- verify a private media upload;
- verify a document import reaches the processing worker.

## 8. Whisper

The named Docker volume `whisper-models` persists the local model cache.

For a strictly offline server, pre-populate the model and use:

```env
WHISPER_MODEL_PATH=/models/whisper/<model-directory>
WHISPER_LOCAL_FILES_ONLY=true
```

The default example permits model download when the selected model is not already cached.

## 9. Optional local AI

The core product does not require AI.

For a local OpenAI-compatible endpoint:

```env
AI_PROVIDER=local
AI_LOCAL_BASE_URL=http://host.docker.internal:11434/v1
AI_LOCAL_MODEL=<your-model>
AI_LOCAL_API_KEY=
```

The Compose file maps `host.docker.internal` to the Linux Docker host.

Gemini remains optional and is enabled only when `AI_PROVIDER=gemini` and the Gemini variables are configured.

## 10. Backup policy

Use both layers:

1. FluentForge **Backup & Restore** for portable application-level recovery.
2. Infrastructure-level PostgreSQL and object-storage backups for disaster recovery and large installations.

The in-process `.ffbackup` format intentionally has safety limits and is not a substitute for large-volume database/object-storage backup.

Before an upgrade:

- create a FluentForge application backup;
- create infrastructure DB/storage backups;
- apply pending migrations;
- rebuild and restart the containers.

## 11. Upgrade

```bash
git pull --ff-only

docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  --profile migrate \
  run --rm migrate

docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  build

docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  up -d app processing-service
```

Then check both health endpoints and the application logs.

## 12. Security baseline

- Keep `.env.production` mode 600 and outside backups shared with untrusted users.
- Do not commit production secrets.
- Keep the app bound to loopback when a host reverse proxy is used.
- Keep the processing service unexposed.
- Use HTTPS for the public origin and Supabase endpoint.
- Restrict firewall access to required ports only.
- Rotate a leaked service-role key or processing secret immediately.
- Keep Docker, the host OS and reverse proxy patched.
- Test restore on a separate empty installation before relying on a backup policy.
