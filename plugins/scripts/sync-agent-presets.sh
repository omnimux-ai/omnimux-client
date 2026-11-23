#!/usr/bin/env bash
# sync-agent-presets.sh — validate the converged OmniMux agent-preset roster (no writes).
#
# Since dsh 0.2.1-rc.3 every preset is a Loader declaration carried by the
# profile. OmniMux ships a single default product preset (`omni-agent`) beside
# DSH native Creator Mode (`cordis`, declared by `@deepseek-ai/dsh-web-app`).
# Retired preset IDs are redirected transparently at runtime by
# `plugins/omnimux/src/host/retired-presets.js` instead of shipping physical
# tombstone directories that would pollute the preset picker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/presets"
KEEP=(omni-agent)

if [ ! -d "$SRC/omni-agent" ]; then
  echo "❌ presets/ 缺少默认出厂预设 (omni-agent)" >&2
  exit 1
fi

# `--target` / OMNIMUX_SYNC_TARGETS are accepted for callers (sync-to-app.sh
# still forwards them) and deliberately ignored: the profile needs no patch.
TARGET_FLAGS=()
for argument in "$@"; do
  case "$argument" in
    --target=*|--target)
      TARGET_FLAGS+=("$argument")
      ;;
    --prod|--all|--skip-build)
      # Accepted from sync-to-app.sh; this script no longer writes anywhere.
      ;;
    *)
      echo "· 忽略未知参数: $argument" >&2
      ;;
  esac
done

missing=()
for preset in "${KEEP[@]}"; do
  if [ ! -f "$SRC/$preset/preset.yml" ] || [ ! -f "$SRC/$preset/agent.cordis.yml" ] || [ ! -f "$SRC/$preset/Agent.md" ]; then
    missing+=("$preset")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "❌ presets/ 缺少预定义文件: ${missing[*]}" >&2
  exit 1
fi

if [ "${#TARGET_FLAGS[@]}" -gt 0 ]; then
  echo "· --target 已废弃并被忽略：预设随安装包分发，不再写入目标 home" >&2
fi

echo "✅ 出厂预设清单校验通过：${#KEEP[@]} 项产品默认预设 (omni-agent) + DSH 原生创造模式 (cordis)。"
echo "ℹ️ rc.3 起预设由打包期 preset/agent-presets 与壳侧声明承担；本脚本不再写盘。"
