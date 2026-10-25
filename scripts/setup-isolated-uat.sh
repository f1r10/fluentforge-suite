#!/usr/bin/env bash
# Create an isolated local staging installation for teacher/student UAT.
# Never connects to or changes the production Compose project.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."

PROJECT="${FLUENTFORGE_UAT_PROJECT:-fluentforge-uat}"
PORT="${FLUENTFORGE_UAT_PORT:-3100}"
ENV_FILE="${FLUENTFORGE_UAT_ENV_FILE:-.env.uat.local}"
COMPOSE_FILE="docker-compose.postgres.yml"

[[ "$PROJECT" =~ ^[a-z][a-z0-9_-]{2,48}$ ]] || { echo "Invalid UAT project name" >&2; exit 1; }
[[ "$PROJECT" != "fluentforge-postgres" && "$PROJECT" != "fluentforge-production" ]] || {
  echo "Refusing to reuse the known production project name" >&2; exit 1;
}
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || {
  echo "UAT port must be 1024-65535" >&2; exit 1;
}
[[ "$ENV_FILE" != ".env.postgres" && "$ENV_FILE" != ".env.production" ]] || {
  echo "Refusing to use production environment file" >&2; exit 1;
}
[[ "$ENV_FILE" != */* ]] || { echo "Keep staging env in repository root" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker not installed" >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL not installed" >&2; exit 1; }
if [[ -e "$ENV_FILE" ]]; then
  echo "Existing $ENV_FILE detected; refusing to overwrite or reuse unknown credentials." >&2
  echo "Use a fresh FLUENTFORGE_UAT_ENV_FILE for a new isolated stack." >&2
  exit 1
fi
if docker ps --format '{{.Names}}' | grep -Eq "^(${PROJECT}[-_])"; then
  echo "An existing UAT stack uses this project name. Not touching it." >&2
  exit 1
fi
if command -v ss >/dev/null && ss -ltn | grep -Eq "[:.]${PORT}[[:space:]]"; then
  echo "Port $PORT is already listening." >&2
  exit 1
fi

secret() { openssl rand -hex 32; }
{
  printf '# Generated isolated UAT settings. Keep private.\n'
  printf 'POSTGRES_DB=fluentforge_uat\nPOSTGRES_USER=postgres\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$(secret)"
  printf 'APP_JWT_SECRET=%s\n' "$(secret)"
  printf 'APP_STORAGE_SECRET=%s\n' "$(secret)"
  printf 'SETUP_TOKEN=%s\n' "$(secret)"
  printf 'PROCESSING_SHARED_SECRET=%s\n' "$(secret)"
  printf 'SCHEDULED_JOB_SECRET=%s\n' "$(secret)"
  printf 'APP_BIND_ADDRESS=127.0.0.1\nAPP_PORT=%s\n' "$PORT"
  printf 'AI_PROVIDER=disabled\nWHISPER_MODEL=small\nWHISPER_DEVICE=cpu\n'
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Explicit '-p' isolates all named data volumes and containers. Bind only to loopback.
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT")
"${COMPOSE[@]}" config --quiet
echo "[uat] Starting isolated stack: $PROJECT (127.0.0.1:$PORT)"
"${COMPOSE[@]}" up --build -d
echo "[uat] Container status:"
"${COMPOSE[@]}" ps
echo "[uat] Run full browser smoke after teacher setup:"
echo "  FLUENTFORGE_UAT_PROJECT=$PROJECT docker compose --env-file $ENV_FILE -f $COMPOSE_FILE -p $PROJECT logs --tail=80 app"
echo "[uat] Open http://127.0.0.1:$PORT/ locally, or use an authenticated SSH tunnel."
echo "[uat] Never publish this UAT endpoint or reuse its credentials in production."
