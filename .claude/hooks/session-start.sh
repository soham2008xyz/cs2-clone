#!/bin/bash
set -euo pipefail

# Only run in Claude Code cloud sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installs all workspaces (shared, server, client). --include=dev keeps the
# test/typecheck/build tooling even if the environment sets NODE_ENV=production.
# `npm install` (not `npm ci`) so the cached container state is reused.
# --ignore-scripts matches CI: the only lifecycle script is esbuild's optional
# postinstall check, and esbuild works from its platform binary alone.
npm install --include=dev --ignore-scripts --no-audit --no-fund
