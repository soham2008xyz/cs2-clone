#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:${PATH}"

cd /workspace

wait_http() {
  local url="$1"
  local label="$2"
  local i=0
  while [[ $i -lt 60 ]]; do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      echo "$label ready at $url"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "$label did not become ready at $url within 60s" >&2
  return 1
}

start_tmux() {
  local name="$1"
  local cmd="$2"
  if tmux -f /exec-daemon/tmux.portal.conf has-session -t "$name" 2>/dev/null; then
    return 0
  fi
  tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$name" -c /workspace -- bash -lc "$cmd"
}

start_tmux cs2d-server "npm run dev:server 2>&1 | tee /tmp/cs2d-server.log"
start_tmux cs2d-client "npm run dev -w @cs2d/client -- --host 0.0.0.0 2>&1 | tee /tmp/cs2d-client.log"

wait_http "http://127.0.0.1:8090/rooms" "Game server"
wait_http "http://127.0.0.1:5173/" "Vite client"

echo "CS2D dev stack is up (server :8090, client :5173)"
