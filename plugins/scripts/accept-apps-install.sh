#!/usr/bin/env bash
# Isolated official-row install/remove. Does not touch ~/.dsh/profiles/omnimux.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd -P)"
pkg="$root/plugins/omnimux-accounts"
home="$(mktemp -d "${TMPDIR:-/tmp}/omnimux-apps-accept.XXXXXX")"
cleanup() { rm -rf "$home"; }
trap cleanup EXIT

dsh_cmd=()
if command -v dsh >/dev/null 2>&1; then
  dsh_cmd=(dsh)
elif [[ -n "${DSH_SRC:-}" && -f "${DSH_SRC}/package.json" ]]; then
  dsh_cmd=(pnpm --dir "$DSH_SRC" dsh)
else
  echo "accept: dsh CLI not found (set DSH_SRC or install dsh). skip live add/remove"
  exit 0
fi

export DSH_HOME="$home"
profile=apps-accept
echo "accept: DSH_HOME=$DSH_HOME profile=$profile"
"${dsh_cmd[@]}" plugin --profile "$profile" add "$pkg"
python3 - "$home" "$profile" <<'PY'
import json, sys
from pathlib import Path
home, profile = sys.argv[1], sys.argv[2]
manifest = json.loads((Path(home) / 'profiles' / profile / 'package.json').read_text())
bundles = manifest['dsh']['profile']['bundles']
assert 'omnimux-accounts' in bundles, bundles
pkg = Path(home) / 'profiles' / profile / 'node_modules' / 'omnimux-accounts' / 'package.json'
assert pkg.is_file(), pkg
print('accept: installed', json.loads(pkg.read_text())['version'])
PY
"${dsh_cmd[@]}" plugin --profile "$profile" remove omnimux-accounts
python3 - "$home" "$profile" <<'PY'
import json, sys
from pathlib import Path
home, profile = sys.argv[1], sys.argv[2]
manifest = json.loads((Path(home) / 'profiles' / profile / 'package.json').read_text())
bundles = manifest['dsh']['profile']['bundles']
assert 'omnimux-accounts' not in bundles, bundles
print('accept: removed')
PY
echo "accept: official accounts row add/remove passed"
