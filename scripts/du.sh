#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/dd.sh"

set -euo pipefail

PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_DIR"

# Por defecto usa docker-compose.dev.yml, salvo que se pase otro archivo como argumento
COMPOSE_FILE="${1:-docker-compose.dev.yml}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[-] Error: No se encontró el archivo de docker-compose '$COMPOSE_FILE'." >&2
  exit 1
fi

echo "==> [DU] Levantando servicios de Docker usando por defecto '${COMPOSE_FILE}'..."

# Determinar comando de compose
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose -f $COMPOSE_FILE"
else
  echo "[-] ERROR: Ni 'docker compose' ni 'docker-compose' están instalados/disponibles." >&2
  exit 1
fi

# Intentar levantar los servicios
if ! $DOCKER_COMPOSE_CMD up -d; then
  echo "[-] ERROR CRÍTICO: Falló el comando '$DOCKER_COMPOSE_CMD up -d'." >&2
  echo "[!] Mostrando últimos logs de Docker Compose:" >&2
  $DOCKER_COMPOSE_CMD logs --tail=50 >&2 || true
  exit 1
fi

echo "==> [DU] Verificando salud y estado de los contenedores..."

MAX_WAIT_SECONDS=30
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT_SECONDS ]; do
  CONTAINER_INFO=$($DOCKER_COMPOSE_CMD ps --format "{{.Name}} | {{.Service}} | {{.State}} | {{.Health}}" 2>/dev/null || $DOCKER_COMPOSE_CMD ps 2>/dev/null || echo "")

  if [ -z "$CONTAINER_INFO" ]; then
    echo "[-] ERROR: No se pudieron obtener los datos de los contenedores o la lista está vacía." >&2
    exit 1
  fi

  # Detectar estados fallidos o no saludables
  FAILED_CONTAINERS=$(echo "$CONTAINER_INFO" | grep -iE "exited|dead|unhealthy" || true)

  if [ -n "$FAILED_CONTAINERS" ]; then
    echo "" >&2
    echo "==========================================================" >&2
    echo "[-] ERROR DE DOCKER: Se detectaron contenedores fallidos!" >&2
    echo "==========================================================" >&2
    echo "$FAILED_CONTAINERS" >&2
    echo "----------------------------------------------------------" >&2
    echo "[!] Imprimiendo últimos logs de los servicios para diagnóstico:" >&2
    $DOCKER_COMPOSE_CMD logs --tail=50 >&2 || true
    echo "==========================================================" >&2
    echo "[-] ATENCIÓN USUARIO: Un proceso en Docker no se ejecutó bien." >&2
    exit 1
  fi

  # Detectar si aún hay algún contenedor iniciando o reiniciando
  STARTING_CONTAINERS=$(echo "$CONTAINER_INFO" | grep -iE "starting|restarting|created" || true)

  if [ -z "$STARTING_CONTAINERS" ]; then
    echo ""
    echo "=========================================================="
    echo "==> [DU] Todos los procesos Docker están arriba y saludables."
    echo "=========================================================="
    $DOCKER_COMPOSE_CMD ps
    echo "=========================================================="
    exit 0
  fi

  sleep 2
  ELAPSED=$((ELAPSED + 2))
  echo "[+] Esperando a que los servicios completen su inicio ($ELAPSED/${MAX_WAIT_SECONDS}s)..."
done

echo "[!] ADVERTENCIA: Transcurrieron $MAX_WAIT_SECONDS segundos. Los servicios continúan iniciando."
$DOCKER_COMPOSE_CMD ps
exit 0
