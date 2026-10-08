#!/bin/bash
set -euo pipefail

# Only run in Claude Code cloud sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installs all workspaces (shared, server, client), including devDependencies.
# `npm install` (not `npm ci`) so the cached container state is reused.
npm install --no-audit --no-fund
