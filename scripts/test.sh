#!/usr/bin/env bash
#
# Run unit tests (vitest).
#
# Usage:
#   scripts/test.sh            # run all unit tests
#   scripts/test.sh --watch    # pass through any vitest arguments
#
set -euo pipefail

# Switch to the repo root (this script lives under scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Install dependencies automatically on first run
if [[ ! -d node_modules ]]; then
  echo "==> node_modules not found, running npm install ..."
  npm install
fi

echo "==> Running unit tests (vitest run) ..."
npm test -- "$@"
