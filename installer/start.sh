#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if [ ! -d node_modules ]; then
  npm install
fi
echo "Seal Forge is starting at http://127.0.0.1:8080"
if command -v open >/dev/null; then open http://127.0.0.1:8080; fi
if command -v xdg-open >/dev/null; then xdg-open http://127.0.0.1:8080 >/dev/null 2>&1 || true; fi
exec npm run dev
