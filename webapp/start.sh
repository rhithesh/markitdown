#!/usr/bin/env bash
#
# Start (or restart) the MarkItDown web app: FastAPI backend + Vite frontend.
# Cleanly kills anything already listening on the two ports, then relaunches
# both. Ctrl-C stops both again.
#
set -euo pipefail

BACKEND_PORT=8000
FRONTEND_PORT=5173

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"

# --- kill whatever holds a port -------------------------------------------------
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Killing existing process(es) on port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    # give them a moment, then force
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
      [ -z "$pids" ] && break
      sleep 0.3
    done
    pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "Force killing on port $port: $pids"
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

BACKEND_PID=""
FRONTEND_PID=""
TAIL_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  kill_port "$FRONTEND_PORT"
  kill_port "$BACKEND_PORT"
  echo "Done."
}
trap cleanup EXIT INT TERM

kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

# --- backend ------------------------------------------------------------------
if [ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]; then
  echo "error: $BACKEND_DIR/.venv not set up. See webapp/README.md." >&2
  exit 1
fi
echo "Starting backend on :$BACKEND_PORT  (logs: $LOG_DIR/backend.log)"
(
  cd "$BACKEND_DIR"
  exec .venv/bin/uvicorn main:app --reload --port "$BACKEND_PORT"
) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# --- frontend ----------------------------------------------------------------
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing frontend deps..."
  (cd "$FRONTEND_DIR" && npm install)
fi
echo "Starting frontend on :$FRONTEND_PORT (logs: $LOG_DIR/frontend.log)"
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --port "$FRONTEND_PORT" --strictPort
) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo ""
echo "Backend  PID $BACKEND_PID  -> http://localhost:$BACKEND_PORT"
echo "Frontend PID $FRONTEND_PID -> http://localhost:$FRONTEND_PORT"
echo "Press Ctrl-C to stop both."
echo ""
echo "---- streaming logs ($LOG_DIR) — [B]=backend [F]=frontend ----"

# Make sure the files exist before tailing, then stream both with a prefix.
: >>"$LOG_DIR/backend.log"
: >>"$LOG_DIR/frontend.log"
(
  tail -n +1 -F "$LOG_DIR/backend.log"  | awk '{ print "[B] " $0; fflush() }' &
  tail -n +1 -F "$LOG_DIR/frontend.log" | awk '{ print "[F] " $0; fflush() }' &
  wait
) &
TAIL_PID=$!

# Exit (and trigger cleanup) as soon as either process dies.
# (`wait -n` needs bash 4.3+; macOS ships 3.2, so poll instead.)
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
echo ""
echo "One process exited; stopping the other."
