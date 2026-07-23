#!/usr/bin/env bash
#
# Compile TypeScript and package into a VSIX.
#
# Usage:
#   scripts/package.sh              # run unit tests -> compile -> package vsix
#   SKIP_TESTS=1 scripts/package.sh # skip unit tests, only compile + package
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

# Run unit tests as a quality gate before packaging (skip with SKIP_TESTS=1)
if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  echo "==> Running unit tests (vitest run) ..."
  npm test
else
  echo "==> SKIP_TESTS=1 is set, skipping unit tests."
fi

echo "==> Compiling TypeScript (tsc) ..."
npm run compile

echo "==> Packaging VSIX (vsce package) ..."
npm run package

# Locate the most recently generated vsix
VSIX="$(ls -t ./*.vsix 2>/dev/null | head -n1 || true)"
if [[ -n "${VSIX:-}" ]]; then
  echo "==> Packaging complete: $VSIX"
else
  echo "!! No generated .vsix file found" >&2
  exit 1
fi
