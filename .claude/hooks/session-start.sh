#!/bin/bash
set -euo pipefail

# Only run in Claude Code cloud sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installs all workspaces (shared, server, client). --include=dev keeps the
# test/typecheck/build tooling even if the environment sets NODE_ENV=production.
# `npm ci` installs exactly what package-lock.json pins and never rewrites it,
# so sessions start with a clean git tree (`npm install` adds "peer" markers).
# --ignore-scripts matches CI: the only lifecycle script is esbuild's optional
# postinstall check, and esbuild works from its platform binary alone.
npm ci --include=dev --ignore-scripts --no-audit --no-fund
