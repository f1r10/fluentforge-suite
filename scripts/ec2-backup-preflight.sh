#!/usr/bin/env bash
# Live backup preflight: no service stop, no volume deletion or DB resets.
# A verified archive is NOT proof of successful restore to an isolated target.
set -Eeuo pipefail
umask 077

APP_DIR="${FLUENTFORGE_DIR:-$HOME/fluentforge-suite}"
COMPOSE_FILE="${FLUENTFORGE_COMPOSE_FILE:-docker-compose.postgres.yml}"
ENV_FILE="${FLUENTFORGE_ENV_FILE:-.env.postgres}"
PROJECT="${FLUENTFORGE_PROJECT:-fluentforge-postgres}"
OUT_DIR="${FLUENTFORGE_BACKUP_DIR:-$HOME/fluentforge-backups/dr-check-$(date -u +%Y%m%dT%H%M%SZ)}"

cd "$APP_DIR"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT")
"${COMPOSE[@]}" config --quiet
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"

echo '[1/4] PostgreSQL custom-format backup (services remain running)'
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT_DIR/postgres.dump"
[[ -s "$OUT_DIR/postgres.dump" ]] || { echo "Empty dump" >&2; exit 1; }
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$OUT_DIR/postgres.dump" >/dev/null

echo '[2/4] Archiving private storage (hot snapshot: still requires restore test)'
for spec in app-storage processing-data; do
  volume="${PROJECT}_${spec}"
  docker volume inspect "$volume" >/dev/null || { echo "Missing volume: $volume" >&2; exit 1; }
  docker run --rm \
    --mount "type=volume,source=${volume},target=/source,readonly" \
    --mount "type=bind,source=${OUT_DIR},target=/out" \
    alpine:3.20 \
    sh -c "tar -C /source -czf /out/${spec}.tar.gz ."
  tar -tzf "$OUT_DIR/${spec}.tar.gz" >/dev/null
done

echo '[3/4] Verifying checksums'
(cd "$OUT_DIR" && sha256sum postgres.dump app-storage.tar.gz processing-data.tar.gz > SHA256SUMS && sha256sum --check SHA256SUMS)

echo '[4/4] Archives verified; full isolated restore remains pending'
printf 'Backup directory: %s\n' "$OUT_DIR"
(cd "$OUT_DIR" && ls -lh postgres.dump app-storage.tar.gz processing-data.tar.gz SHA256SUMS)
echo 'Status: BACKUP INTEGRITY PASSED; ISOLATED RESTORE NOT YET TESTED'
