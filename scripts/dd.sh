#!/usr/bin/env bash
set -euo pipefail

# Script to safely stop and tear down all Docker containers and services.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> [DD] Iniciando detención de todos los procesos Docker..."

# 1. Verificar disponibilidad del comando docker
if ! command -v docker >/dev/null 2>&1; then
  echo "[-] Error: El comando 'docker' no está instalado o no está en el PATH." >&2
  exit 1
fi

# 2. Verificar que el demonio de Docker esté respondiendo
if ! docker info >/dev/null 2>&1; then
  echo "[!] Advertencia: El demonio de Docker no está en ejecución o no se tienen permisos para acceder al socket." >&2
  echo "[+] No se encontraron procesos Docker activos accesible."
  exit 0
fi

# Function to run compose down safely
run_compose_down() {
  local compose_file="$1"
  if [ -f "$compose_file" ]; then
    echo "==> [DD] Deteniendo stack definido en ${compose_file}..."
    if docker compose version >/dev/null 2>&1; then
      docker compose -f "$compose_file" down --remove-orphans || echo "[!] Warning: docker compose down devolvió código diferente de cero." >&2
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose -f "$compose_file" down --remove-orphans || echo "[!] Warning: docker-compose down devolvió código diferente de cero." >&2
    fi
  fi
}

cd "$PROJECT_DIR"
run_compose_down "docker-compose.dev.yml"
run_compose_down "docker-compose.yml"

# 3. Detener cualquier contenedor individual que continúe corriendo
RUNNING_CONTAINERS=$(docker ps -q)

if [ -n "$RUNNING_CONTAINERS" ]; then
  echo "==> [DD] Deteniendo contenedores restantes en ejecución..."
  echo "$RUNNING_CONTAINERS" | xargs -r docker stop || {
    echo "[!] Fallo al detener algunos contenedores con 'docker stop', intentando 'docker kill'..." >&2
    echo "$RUNNING_CONTAINERS" | xargs -r docker kill || true
  }
  echo "==> [DD] Contenedores restantes detenidos."
else
  echo "==> [DD] No hay contenedores adicionales en ejecución."
fi

echo "==> [DD] Proceso finalizado exitosamente."
exit 0
