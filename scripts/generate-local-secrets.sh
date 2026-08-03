#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$ROOT/.env}
umask 077
touch "$ENV_FILE"
chmod 0600 "$ENV_FILE"

read_value() { awk -F= -v key="$1" '$1==key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"; }
set_value() {
  key=$1 value=$2 tmp=${ENV_FILE}.tmp
  awk -F= -v key="$key" '$1!=key {print}' "$ENV_FILE" > "$tmp"
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 0600 "$tmp" && mv "$tmp" "$ENV_FILE"
}
ensure_hex() { [ -n "$(read_value "$1")" ] || set_value "$1" "$(openssl rand -hex 32)"; }
for key in POSTGRES_PASSWORD VENTA_MIGRATOR_PASSWORD VENTA_APP_PASSWORD VENTA_AUTH_PASSWORD VENTA_INGRESS_PASSWORD VENTA_BACKUP_PASSWORD VENTA_RESTORE_PASSWORD BETTER_AUTH_SECRET; do ensure_hex "$key"; done
[ -n "$(read_value ENCRYPTION_KEY)" ] || set_value ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
set_value POSTGRES_DB vocero
set_value POSTGRES_USER postgres
set_value APP_DATABASE_URL "postgresql://venta_app:$(read_value VENTA_APP_PASSWORD)@postgres:5432/vocero"
set_value AUTH_DATABASE_URL "postgresql://venta_auth:$(read_value VENTA_AUTH_PASSWORD)@postgres:5432/vocero"
set_value INGRESS_DATABASE_URL "postgresql://venta_ingress:$(read_value VENTA_INGRESS_PASSWORD)@postgres:5432/vocero"
set_value MIGRATOR_DATABASE_URL "postgresql://venta_migrator:$(read_value VENTA_MIGRATOR_PASSWORD)@postgres:5432/vocero"
set_value BACKUP_DATABASE_URL "postgresql://venta_backup:$(read_value VENTA_BACKUP_PASSWORD)@postgres:5432/vocero"
set_value RESTORE_ADMIN_URL "postgresql://venta_restore:$(read_value VENTA_RESTORE_PASSWORD)@postgres:5432/postgres"
printf 'Secretos locales presentes en %s (0600)\n' "$ENV_FILE"
