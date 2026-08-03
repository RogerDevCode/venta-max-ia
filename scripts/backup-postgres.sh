#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$ROOT/.env}
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker-compose.yml}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/backups}
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$(pwd)/$ENV_FILE" ;; esac
case "$COMPOSE_FILE" in /*) ;; *) COMPOSE_FILE="$(pwd)/$COMPOSE_FILE" ;; esac
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${POSTGRES_DB:?}" "${VENTA_BACKUP_PASSWORD:?}"
mkdir -p "$BACKUP_DIR" && chmod 0700 "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
output=${BACKUP_FILE:-$BACKUP_DIR/vocero_${stamp}.dump}
partial=${output}.partial
trap 'rm -f "$partial"' EXIT INT TERM
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$VENTA_BACKUP_PASSWORD" postgres \
  pg_dump -h 127.0.0.1 -U venta_backup -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner > "$partial"
[ -s "$partial" ] || { echo "ERROR: dump vacío" >&2; exit 3; }
mv "$partial" "$output" && chmod 0600 "$output"
sha256sum "$output" > "$output.sha256" && chmod 0600 "$output.sha256"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$VENTA_BACKUP_PASSWORD" postgres \
  psql -h 127.0.0.1 -U venta_backup -d "$POSTGRES_DB" -At <<'SQL' > "$output.manifest"
SELECT format('SELECT %L || E''\\t'' || count(*) FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN('public','drizzle') AND c.relkind IN('r','p') ORDER BY n.nspname,c.relname;
\gexec
SQL
chmod 0600 "$output.manifest"
trap - EXIT INT TERM
printf '%s\n' "$output"
