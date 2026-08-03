#!/bin/sh
set -eu
backup=${1:-}
[ -f "$backup" ] && [ -f "$backup.sha256" ] && [ -s "$backup.manifest" ] || { echo "ERROR: backup/checksum/manifiesto incompleto" >&2; exit 2; }
sha256sum --check "$backup.sha256"
docker compose -f "${COMPOSE_FILE:-docker-compose.yml}" exec -T postgres pg_restore --list < "$backup" >/dev/null
printf 'Backup verificable: %s\n' "$backup"
