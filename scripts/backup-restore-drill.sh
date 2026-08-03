#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$ROOT/.env}
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker-compose.yml}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${POSTGRES_DB:?}" "${POSTGRES_USER:?}" "${VENTA_BACKUP_PASSWORD:?}" "${VENTA_RESTORE_PASSWORD:?}"
drill_db=${POSTGRES_DB}_restore_drill
backup=$(ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$ROOT/scripts/backup-postgres.sh")
trap 'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$drill_db" >/dev/null 2>&1 || true' EXIT INT TERM
COMPOSE_FILE="$COMPOSE_FILE" "$ROOT/scripts/verify-backup.sh" "$backup"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$drill_db"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$VENTA_RESTORE_PASSWORD" postgres createdb -h 127.0.0.1 -U venta_restore -O venta_restore "$drill_db"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$drill_db" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$VENTA_RESTORE_PASSWORD" postgres \
  pg_restore -h 127.0.0.1 -U venta_restore -d "$drill_db" --no-owner --no-comments --exit-on-error < "$backup"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$drill_db" -v ON_ERROR_STOP=1 <<SQL
REASSIGN OWNED BY venta_restore TO venta_owner;
ALTER DATABASE "$drill_db" OWNER TO venta_owner;
REVOKE CONNECT ON DATABASE "$drill_db" FROM PUBLIC,venta_restore;
GRANT CONNECT ON DATABASE "$drill_db" TO venta_migrator,venta_app,venta_auth,venta_ingress,venta_backup;
SQL
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$VENTA_BACKUP_PASSWORD" postgres \
  psql -h 127.0.0.1 -U venta_backup -d "$drill_db" -At <<'SQL' > "$backup.restored-manifest"
SELECT format('SELECT %L || E''\\t'' || count(*) FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN('public','drizzle') AND c.relkind IN('r','p') ORDER BY n.nspname,c.relname;
\gexec
SQL
chmod 0600 "$backup.restored-manifest"
diff -u "$backup.manifest" "$backup.restored-manifest"
printf 'Restore drill PASS: %s\n' "$drill_db"
