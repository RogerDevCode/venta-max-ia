#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$ROOT/.env}
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker-compose.yml}

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
for variable in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD VENTA_MIGRATOR_PASSWORD VENTA_APP_PASSWORD VENTA_AUTH_PASSWORD VENTA_INGRESS_PASSWORD VENTA_BACKUP_PASSWORD VENTA_RESTORE_PASSWORD; do
  eval "value=\${$variable:-}"
  [ -n "$value" ] || { echo "ERROR: $variable es obligatorio" >&2; exit 2; }
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set database_name="$POSTGRES_DB" --set legacy_owner="$POSTGRES_USER" \
  --set postgres_password="$POSTGRES_PASSWORD" \
  --set migrator_password="$VENTA_MIGRATOR_PASSWORD" --set app_password="$VENTA_APP_PASSWORD" \
  --set auth_password="$VENTA_AUTH_PASSWORD" --set ingress_password="$VENTA_INGRESS_PASSWORD" \
  --set backup_password="$VENTA_BACKUP_PASSWORD" --set restore_password="$VENTA_RESTORE_PASSWORD" <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_owner') THEN CREATE ROLE venta_owner NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_migrator') THEN CREATE ROLE venta_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_app') THEN CREATE ROLE venta_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_auth') THEN CREATE ROLE venta_auth LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_ingress') THEN CREATE ROLE venta_ingress LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_backup') THEN CREATE ROLE venta_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='venta_restore') THEN CREATE ROLE venta_restore LOGIN NOINHERIT NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
END $roles$;
ALTER ROLE venta_migrator PASSWORD :'migrator_password' CONNECTION LIMIT 4;
ALTER ROLE venta_app PASSWORD :'app_password' CONNECTION LIMIT 30;
ALTER ROLE venta_auth PASSWORD :'auth_password' CONNECTION LIMIT 10;
ALTER ROLE venta_ingress PASSWORD :'ingress_password' CONNECTION LIMIT 10;
ALTER ROLE venta_backup PASSWORD :'backup_password' CONNECTION LIMIT 2;
ALTER ROLE venta_restore PASSWORD :'restore_password' CONNECTION LIMIT 2;
ALTER ROLE :"legacy_owner" PASSWORD :'postgres_password';
GRANT venta_owner TO venta_migrator WITH INHERIT FALSE, SET TRUE;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO venta_migrator, venta_app, venta_auth, venta_ingress, venta_backup;
REVOKE CONNECT ON DATABASE :"database_name" FROM venta_restore;
ALTER DATABASE :"database_name" OWNER TO venta_owner;
ALTER SCHEMA public OWNER TO venta_owner;
DO $schema_owner$
BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname='drizzle') THEN
    ALTER SCHEMA drizzle OWNER TO venta_owner;
  END IF;
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname='retired_whatsapp') THEN
    ALTER SCHEMA retired_whatsapp OWNER TO venta_owner;
  END IF;
END $schema_owner$;
DO $ownership$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle','retired_whatsapp') AND c.relkind IN ('r','p','v','m') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO venta_owner', CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, item.nspname, item.relname);
  END LOOP;
END $ownership$;
SQL
printf 'Roles PostgreSQL VentaMax reconciliados\n'
