#!/usr/bin/env bash
# Keyless assemble smoke check. Does not call external model APIs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$root"

echo "==> 1. Running core plugin unit tests..."
corepack pnpm --filter omnimux test
corepack pnpm --filter omnimux-accounts test
corepack pnpm --filter omnimux-analytics test

echo "==> 2. Verifying cordis propagation..."
node scripts/verify-cordis-propagate.mjs

dsh_cmd=()
if command -v dsh >/dev/null 2>&1; then
  dsh_cmd=(dsh)
elif [[ -n "${DSH_SRC:-}" && -f "${DSH_SRC}/package.json" ]]; then
  dsh_cmd=(pnpm --dir "$DSH_SRC" dsh)
fi

if [[ ${#dsh_cmd[@]} -eq 0 ]]; then
  echo "smoke: unit tests passed; dsh CLI not found (set DSH_SRC or install dsh). skip profile dump"
  exit 0
fi

echo "smoke: all smoke assertions passed."
