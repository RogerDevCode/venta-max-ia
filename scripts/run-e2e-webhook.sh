#!/usr/bin/env bash
set -e

# Asegura que estamos en la raíz del proyecto
cd "$(dirname "$0")/.."

echo "Cargando variables de entorno..."
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "❌ No se encontró el archivo .env"
  exit 1
fi

echo "🚀 Ejecutando Simulador E2E Webhook en contenedor aislado..."
docker compose run --rm -v "$(pwd):/work" -w /work \
  -e NODE_ENV=development \
  -e APP_BASE_URL=http://app:3000 \
  -e TEST_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e APP_DATABASE_URL="postgresql://venta_app:${VENTA_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e AUTH_DATABASE_URL="postgresql://venta_auth:${VENTA_AUTH_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e INGRESS_DATABASE_URL="postgresql://venta_ingress:${VENTA_INGRESS_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
  migrator node --import tsx scripts/e2e-webhook-simulator.ts
