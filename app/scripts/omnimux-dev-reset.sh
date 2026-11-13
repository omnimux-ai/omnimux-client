#!/usr/bin/env bash
# omnimux-dev-reset.sh — 把 OmniMux Dev 重置到「首次运行」状态，便于反复走引导。
#
# 只处理 Dev：~/.omnimux-dev/profiles/omnimux/cordis.patch.yml
# 清空：运行方式标记、本机 Agent 选择、BYOK provider/场景绑定、媒体渠道标记。
# 保留：默认模型、工具模型、账号登录态、会话、其它插件配置。
# 每次执行前自动备份 cordis.patch.yml，输出回滚路径。
#
# 用法：
#   yarn omnimux:dev-reset                 # 直接重置（自动备份）
#   yarn omnimux:dev-reset --dry-run       # 只预览
#   yarn omnimux:dev-reset --restart       # 重置后打开 OmniMux Dev
#   ./scripts/omnimux-dev-reset.sh --help

set -euo pipefail

HOME_DIR="${HOME:-}"
DEV_HOME="${HOME_DIR}/.omnimux-dev"
PROFILE_DIR="${DEV_HOME}/profiles/omnimux"
CONFIG_FILE="${PROFILE_DIR}/cordis.patch.yml"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${CONFIG_FILE}.bak-before-dev-reset-${STAMP}"

DRY_RUN=0
RESTART=0

say() { printf '%s\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
把 OmniMux Dev 重置到首次运行状态（保留会话与默认模型）。

Usage:
  yarn omnimux:dev-reset [--dry-run] [--restart]
  ./scripts/omnimux-dev-reset.sh [--dry-run] [--restart]

Options:
  --dry-run, -n   只打印将要清理的内容
  --restart       先退出正在运行的 Dev，重置后重新打开
  -h, --help      帮助

清理字段（仅 omnimux 插件 config 内）：
  runtimeMode / runtimeAgent* / runtimeKey* / runtimeMedia* / byokProviders / scenarioBindings
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1; shift ;;
    --restart) RESTART=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数：$1"; usage; exit 2 ;;
  esac
done

[ -n "$HOME_DIR" ] || { err "HOME 未设置，拒绝继续"; exit 2; }
[ -f "$CONFIG_FILE" ] || { err "找不到 Dev 配置：$CONFIG_FILE（先启动一次 OmniMux Dev 生成 profile）"; exit 2; }

# 路径防呆：只允许 Dev profile
case "$PROFILE_DIR" in
  *"/.omnimux-dev/"*) ;;
  *) err "拒绝操作非 Dev 路径：$PROFILE_DIR"; exit 4 ;;
esac

say "── OmniMux Dev 首次运行重置 ──"
say "目标：$CONFIG_FILE"
if [ "$DRY_RUN" -eq 1 ]; then
  say "模式：DRY-RUN（不写盘）"
else
  say "模式：EXECUTE（自动备份）"
fi

dev_running() {
  pgrep -f '/Applications/OmniMux Dev.app/Contents/MacOS' >/dev/null 2>&1
}

if dev_running; then
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "OmniMux Dev 正在运行；执行时必须先退出（或加 --restart）"
  elif [ "$RESTART" -eq 1 ]; then
    say "退出正在运行的 OmniMux Dev…"
    osascript -e 'tell application "OmniMux Dev" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      dev_running || break
      sleep 0.5
    done
    if dev_running; then
      # AppleScript quit can miss when the app name is localized / app is busy;
      # fall back to the exact Dev bundle process only (never production).
      pkill -f '/Applications/OmniMux Dev.app/Contents/MacOS' >/dev/null 2>&1 || true
      for _ in $(seq 1 20); do
        dev_running || break
        sleep 0.5
      done
    fi
    if dev_running; then
      err "OmniMux Dev 仍在运行，拒绝在运行中重置（避免被进程回写覆盖）。"
      exit 3
    fi
    ok "OmniMux Dev 已退出"
  else
    err "OmniMux Dev 正在运行，运行中的进程会把配置回写覆盖重置结果。"
    err "请先退出 Dev，或使用：yarn omnimux:dev-reset --restart"
    exit 3
  fi
fi

# 预览将被移除的字段
preview=$(awk '
  /^- id: omnimux$/ { in_block=1; next }
  in_block && /^- id: / { exit }
  in_block && /^    (runtimeMode|runtimeAgentId|runtimeAgentModel|runtimeAgentVerified|runtimeKeyEndpoint|runtimeKeyModel|runtimeKeyVerified|runtimeMediaProvider|runtimeMediaImage|runtimeMediaVideo|runtimeMediaAudio|runtimeMediaImageModel|runtimeMediaVideoModel|runtimeMediaAudioModel|byokProviders|scenarioBindings):/ { print }
' "$CONFIG_FILE")
if [ -z "$preview" ]; then
  warn "当前已是首次运行状态（没有可清理字段）"
else
  say "将移除："
  printf '%s\n' "$preview" | sed 's/^/  /'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry-run 结束：未修改任何文件。"
  exit 0
fi

cp "$CONFIG_FILE" "$BACKUP_FILE"
ok "已备份：$BACKUP_FILE"

python3 - "$CONFIG_FILE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text().splitlines()
out = []
in_block = False
skip_indent = None
removed = 0
block_keys = {
    'runtimeMode', 'runtimeAgentId', 'runtimeAgentModel', 'runtimeAgentVerified',
    'runtimeKeyEndpoint', 'runtimeKeyModel', 'runtimeKeyVerified',
    'runtimeMediaProvider', 'runtimeMediaImage', 'runtimeMediaVideo', 'runtimeMediaAudio',
    'runtimeMediaImageModel', 'runtimeMediaVideoModel', 'runtimeMediaAudioModel',
    'byokProviders', 'scenarioBindings',
}

for line in lines:
    if line.startswith('- id: '):
        in_block = line.strip() == '- id: omnimux'
        skip_indent = None
        out.append(line)
        continue
    if in_block:
        indent = len(line) - len(line.lstrip(' '))
        if skip_indent is not None:
            if line.strip() == '' or indent > skip_indent:
                removed += 1
                continue
            skip_indent = None
        stripped = line.strip()
        key = stripped.split(':', 1)[0] if ':' in stripped else ''
        if indent == 4 and key in block_keys:
            value = stripped.split(':', 1)[1].strip()
            if value == '':
                skip_indent = 4
            removed += 1
            continue
    out.append(line)

path.write_text('\n'.join(out) + ('\n' if lines else ''))
print(f'removed_fields={removed}')
PY

# YAML 结构校验 + 引导可见性验证
node --input-type=module - "$CONFIG_FILE" "$PROFILE_DIR" <<'NODE'
import { readFileSync } from 'node:fs'
const [configPath, profileDir] = process.argv.slice(2)
let parse
try {
  ({ parse } = await import(`${profileDir}/node_modules/yaml/dist/index.js`))
} catch {
  console.log('skip-verify=no-yaml-package')
  process.exit(0)
}
const doc = parse(readFileSync(configPath, 'utf8'))
const row = Array.isArray(doc) ? doc.find((item) => item && item.id === 'omnimux') : null
const config = row && row.config ? row.config : {}
try {
  const { describeRuntimeGuide } = await import(`${profileDir}/node_modules/omnimux/src/client/runtime-guide-view.js`)
  const guide = describeRuntimeGuide(config)
  console.log(`guide_visible=${guide.visible}`)
  if (guide.visible !== true) process.exit(5)
} catch (error) {
  console.log(`guide_verify_skipped=${error instanceof Error ? error.message : String(error)}`)
}
NODE

ok "Dev 已重置：下次启动/刷新 OmniMux Dev 会显示「运行方式」引导"
say "回滚：cp \"$BACKUP_FILE\" \"$CONFIG_FILE\""
if [ "$RESTART" -eq 1 ]; then
  if open -n "/Applications/OmniMux Dev.app" >/dev/null 2>&1; then
    sleep 4
    if dev_running; then
      ok "已打开 OmniMux Dev"
    else
      warn "已发送打开请求，但未检测到 Dev 进程。请手动启动 /Applications/OmniMux Dev.app（若打开了正式版，先完全退出 /Applications/OmniMux.app）"
    fi
  else
    warn "未能自动打开 Dev，请手动启动 /Applications/OmniMux Dev.app"
  fi
fi
