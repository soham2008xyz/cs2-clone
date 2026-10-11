#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:${PATH}"

NODE_VERSION="24.15.0"
need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
else
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" != "24" ]]; then
    need_node=1
  fi
fi

if [[ "$need_node" -eq 1 ]]; then
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
fi

node -v
npm -v

cd /workspace
npm ci --ignore-scripts
