#!/bin/bash
set -euo pipefail

# Only run in Claude Code cloud sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installs all workspaces (shared, server, client), including devDependencies.
# `npm install` (not `npm ci`) so the cached container state is reused.
# --ignore-scripts matches CI: the only lifecycle script is esbuild's optional
# postinstall check, and esbuild works from its platform binary alone.
npm install --ignore-scripts --no-audit --no-fund
