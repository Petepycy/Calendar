#!/usr/bin/env bash

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS_DIR="$ROOT/.pids"

RED='\033[0;31m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; RESET='\033[0m'
info() { echo -e "${CYAN}[stop]${RESET} $*"; }
ok()   { echo -e "${GREEN}[  ok]${RESET} $*"; }
warn() { echo -e "${RED}[ err]${RESET} $*"; }

kill_pid() {
  local name="$1" file="$PIDS_DIR/$2.pid"
  if [[ -f "$file" ]]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && ok "$name stopped (PID $pid)"
    else
      warn "$name (PID $pid) was not running"
    fi
    rm -f "$file"
  else
    warn "No PID file for $name"
  fi
}

info "Stopping frontend..."
kill_pid "Frontend" frontend

info "Stopping backend..."
kill_pid "Backend" backend

info "Stopping PostgreSQL (docker compose)..."
docker compose -f "$ROOT/docker-compose.yml" stop
ok "PostgreSQL stopped"

echo ""
echo -e "${GREEN}All services stopped.${RESET}"
