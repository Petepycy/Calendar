#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS_DIR="$ROOT/.pids"
mkdir -p "$PIDS_DIR"

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
info()  { echo -e "${CYAN}[start]${RESET} $*"; }
ok()    { echo -e "${GREEN}[  ok ]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[ warn]${RESET} $*"; }

# ── 1. PostgreSQL via Docker Compose ─────────────────────────────────────────
info "Starting PostgreSQL (docker compose)..."
docker compose -f "$ROOT/docker-compose.yml" up -d --wait
ok "PostgreSQL ready"

# ── 2. Backend — Alembic migration + uvicorn ─────────────────────────────────
info "Running Alembic migrations..."
cd "$ROOT/backend"
.venv/bin/alembic upgrade head
ok "Migrations applied"

info "Starting FastAPI backend (port 8000)..."
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
  > "$ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PIDS_DIR/backend.pid"
ok "Backend started (PID $BACKEND_PID) — logs: logs/backend.log"

# ── 3. Frontend — Vite dev server ─────────────────────────────────────────────
info "Starting Vite frontend (port 5173)..."
cd "$ROOT/frontend"
npm run dev \
  > "$ROOT/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PIDS_DIR/frontend.pid"
ok "Frontend started (PID $FRONTEND_PID) — logs: logs/frontend.log"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}All services running:${RESET}"
echo -e "  Backend   →  http://localhost:8000"
echo -e "  Frontend  →  http://localhost:5173"
echo -e "  API docs  →  http://localhost:8000/docs"
echo ""
echo -e "Stop with: ${CYAN}./stop.sh${RESET}"
