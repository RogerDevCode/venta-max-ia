#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_DIR"

PORT="${PORT:-3000}"

echo "==> [RUN] Iniciando preparación del entorno en puerto ${PORT}..."

# 1. Función para liberar el puerto especificado si está ocupado
free_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    pids=$(fuser "$port"/tcp 2>/dev/null | tr -s ' ' '\n' || true)
  elif command -v ss >/dev/null 2>&1; then
    pids=$(ss -tulpn "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  fi

  pids=$(echo "$pids" | xargs || true)

  if [ -n "$pids" ]; then
    echo "==> [RUN] El puerto $port está ocupado por el/los proceso(s) PID: $pids. Eliminando (kill)..."
    for pid in $pids; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "[+] Enviando SIGTERM al proceso PID $pid..."
        kill "$pid" 2>/dev/null || true
      fi
    done
    sleep 1

    for pid in $pids; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "[!] El proceso PID $pid no finalizó con SIGTERM. Enviando SIGKILL (-9)..."
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
    echo "[+] Puerto $port liberado exitosamente."
  else
    echo "[+] El puerto $port se encuentra libre."
  fi
}

# 2. Liberar el puerto 3000 si estuviera ocupado
free_port "$PORT"

# 3. Validar disponibilidad de gestor de paquetes
PKG_MANAGER=""
if command -v pnpm >/dev/null 2>&1; then
  PKG_MANAGER="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PKG_MANAGER="npm"
else
  echo "[-] ERROR CRÍTICO: No se encontró 'pnpm' ni 'npm' instalados en el sistema." >&2
  exit 1
fi

# 4. Validar existencia de dependencias node_modules
if [ ! -d "node_modules" ]; then
  echo "[!] Advertencia: La carpeta 'node_modules' no existe. Ejecutando $PKG_MANAGER install..."
  $PKG_MANAGER install || {
    echo "[-] ERROR: Falló la instalación de dependencias." >&2
    exit 1
  }
fi

echo "==> [RUN] Iniciando servidor Next.js en http://localhost:${PORT} con ${PKG_MANAGER}..."
export PORT="$PORT"

exec $PKG_MANAGER dev
