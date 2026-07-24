#!/usr/bin/env bash
set -euo pipefail

compose_file="${COMPOSE_FILE:-docker-compose.dev.yml}"
backup_file="${WHATSAPP_BACKUP_FILE:-/tmp/venta-max-ia-pre-0014.sql}"
manifest_file="${WHATSAPP_BACKUP_MANIFEST:-/tmp/venta-max-ia-pre-0014.json}"
restore_db="venta_max_restore_drill"

docker compose -f "$compose_file" exec -T postgres \
  pg_dump -U postgres -d vocero --format=plain --no-owner --no-privileges > "$backup_file"

docker compose -f "$compose_file" exec -T postgres dropdb -U postgres --if-exists "$restore_db"
docker compose -f "$compose_file" exec -T postgres createdb -U postgres "$restore_db"
docker compose -f "$compose_file" exec -T postgres \
  psql -U postgres -d "$restore_db" --set=ON_ERROR_STOP=1 < "$backup_file" >/tmp/venta-max-ia-restore.log

counts="$(docker compose -f "$compose_file" exec -T postgres \
  psql -U postgres -d vocero --tuples-only --no-align \
  --command="select (select count(*) from meta_credentials),(select count(*) from template);")"
restore_counts="$(docker compose -f "$compose_file" exec -T postgres \
  psql -U postgres -d "$restore_db" --tuples-only --no-align \
  --command="select (select count(*) from meta_credentials),(select count(*) from template);")"
if [[ "$counts" != "$restore_counts" ]]; then
  echo "restore drill row counts do not match" >&2
  exit 1
fi

meta_count="${counts%%|*}"
template_count="${counts##*|}"
sha="$(sha256sum "$backup_file" | awk '{print $1}')"
printf '{"backupFile":"%s","sha256":"%s","restoreDrill":true,"counts":{"metaCredentials":%s,"templates":%s}}\n' \
  "$backup_file" "$sha" "$meta_count" "$template_count" > "$manifest_file"
echo "$manifest_file"
