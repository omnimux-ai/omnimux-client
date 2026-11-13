#!/usr/bin/env bash
# omnimux-prod-reset.sh — 清空本机 OmniMux「正式版」安装，方便反复做用户场景测试。
#
# 标准清空范围：
#   · 退出 /Applications/OmniMux.app 进程
#   · 删除 App 本体
#   · 删除 ~/.omnimux（会话 / 配置 / electron-user-data）
#   · 删除 Application Support/OmniMux 与旧残留 omnimux-desktop
#   · 删除正式版偏好设置与相关崩溃报告
#   · 弹出正式版安装盘 / 幽灵挂载（Downloads 里的 OmniMux-arm64*.dmg）
#
# 永不触碰：
#   · OmniMux Dev.app / ~/.omnimux-dev / OmniMux-Dev 支持目录 / Dev 偏好
#   · 钥匙串、npm @omnimux/cli、源码仓、~/.local/bin/omnimux-password
#   · ~/.omnimux/personal 若为软链，只删链、不删目标目录
#
# 用法：
#   yarn omnimux:prod-reset              # 默认 dry-run，只打印将要做什么
#   yarn omnimux:prod-reset --yes        # 真正执行
#   ./scripts/omnimux-prod-reset.sh --yes
#
# Agent / CI 额外闸：除 --yes 外还需 OMNIMUX_ALLOW_PROD_RESET=1

set -euo pipefail

PROD_APP="/Applications/OmniMux.app"
DEV_APP="/Applications/OmniMux Dev.app"
PROD_HOME="${HOME}/.omnimux"
DEV_HOME="${HOME}/.omnimux-dev"
PROD_SUPPORT="${HOME}/Library/Application Support/OmniMux"
PROD_SUPPORT_LEGACY="${HOME}/Library/Application Support/omnimux-desktop"
DEV_SUPPORT="${HOME}/Library/Application Support/OmniMux-Dev"
PROD_PREF="${HOME}/Library/Preferences/ai.omnimux.desktop.plist"
DEV_PREF="${HOME}/Library/Preferences/ai.omnimux.desktop.dev.plist"
CRASH_DIR="${HOME}/Library/Application Support/CrashReporter"
DIAG_DIR="${HOME}/Library/Logs/DiagnosticReports"

DRY_RUN=1
ALLOW_AGENT=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
act()  { printf '  → %s\n' "$*"; }

usage() {
  cat <<'EOF'
清空本机 OmniMux 正式版（用户场景复测用）。默认 dry-run。

Usage:
  yarn omnimux:prod-reset [--dry-run]
  yarn omnimux:prod-reset --yes
  ./scripts/omnimux-prod-reset.sh --yes

Options:
  --dry-run, -n   只打印计划（默认）
  --yes, -y       真正删除 / 退出进程 / 弹出安装盘
  -h, --help      帮助

Safety:
  永不碰 OmniMux Dev、钥匙串、CLI、源码。
  Agent/CI 环境执行 --yes 时还需：OMNIMUX_ALLOW_PROD_RESET=1
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) DRY_RUN=0; shift ;;
    --dry-run|-n) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数: $1"; usage; exit 2 ;;
  esac
done

if [ "$DRY_RUN" -eq 0 ]; then
  if [ -n "${DSH_AGENT_SESSION:-}${AGENT_ROLE:-}${CI:-}" ] && [ "${OMNIMUX_ALLOW_PROD_RESET:-}" != "1" ]; then
    err "检测到 Agent/CI 环境：拒绝执行破坏性清空。"
    err "人工确认后设置 OMNIMUX_ALLOW_PROD_RESET=1 并加上 --yes。"
    exit 3
  fi
fi

# 路径防呆：正式版目标绝不能等于 Dev
assert_not_dev() {
  local path="$1"
  local label="$2"
  case "$path" in
    *'OmniMux Dev'*|*omnimux-dev*|*OmniMux-Dev*|*.desktop.dev*)
      err "拒绝操作疑似 Dev 路径（${label}）: $path"
      exit 4
      ;;
  esac
  if [ "$path" = "$DEV_APP" ] || [ "$path" = "$DEV_HOME" ] || [ "$path" = "$DEV_SUPPORT" ] || [ "$path" = "$DEV_PREF" ]; then
    err "拒绝操作 Dev 保护路径（${label}）: $path"
    exit 4
  fi
}

assert_not_dev "$PROD_APP" "PROD_APP"
assert_not_dev "$PROD_HOME" "PROD_HOME"
assert_not_dev "$PROD_SUPPORT" "PROD_SUPPORT"
assert_not_dev "$PROD_SUPPORT_LEGACY" "PROD_SUPPORT_LEGACY"
assert_not_dev "$PROD_PREF" "PROD_PREF"

if [ "$DRY_RUN" -eq 1 ]; then
  say "── OmniMux 正式版清空（DRY-RUN，不加 --yes 不会改动）──"
else
  say "── OmniMux 正式版清空（EXECUTE）──"
fi

personal_target=""
if [ -L "${PROD_HOME}/personal" ]; then
  personal_target="$(readlink "${PROD_HOME}/personal" || true)"
  say "发现 ~/.omnimux/personal → ${personal_target}（只会删软链，保留目标）"
fi

run_rm() {
  local path="$1"
  assert_not_dev "$path" "rm"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then
    act "跳过（不存在）: $path"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    act "将删除: $path"
  else
    rm -rf -- "$path"
    ok "已删除: $path"
  fi
}

# ---------- 1) 退出正式版进程 ----------
say "── [1/5] 退出正式版进程 ──"
if pgrep -f '/Applications/OmniMux\.app/' >/dev/null 2>&1; then
  if [ "$DRY_RUN" -eq 1 ]; then
    act "将 SIGTERM/SIGKILL: /Applications/OmniMux.app 相关进程"
    pgrep -lf '/Applications/OmniMux\.app/' | sed 's/^/    /' || true
  else
    pkill -TERM -f '/Applications/OmniMux\.app/' 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      pgrep -f '/Applications/OmniMux\.app/' >/dev/null 2>&1 || break
      sleep 1
    done
    if pgrep -f '/Applications/OmniMux\.app/' >/dev/null 2>&1; then
      warn "仍有残留，升级 SIGKILL"
      pkill -KILL -f '/Applications/OmniMux\.app/' 2>/dev/null || true
      sleep 1
    fi
    if pgrep -f '/Applications/OmniMux\.app/' >/dev/null 2>&1; then
      err "无法退出正式版进程"
      exit 5
    fi
    ok "正式版进程已退出"
  fi
else
  ok "正式版未在运行"
fi

if pgrep -f '/Applications/OmniMux Dev\.app/' >/dev/null 2>&1; then
  ok "Dev 仍在运行（保持不动）"
fi

# ---------- 2) 删除 App + 用户数据 ----------
say "── [2/5] 删除 App 与用户数据 ──"
run_rm "$PROD_APP"
run_rm "$PROD_HOME"
run_rm "$PROD_SUPPORT"
run_rm "$PROD_SUPPORT_LEGACY"
run_rm "$PROD_PREF"

# ---------- 3) 崩溃报告（仅正式版文件名） ----------
say "── [3/5] 清理正式版崩溃报告 ──"
crash_hits=0
if [ -d "$CRASH_DIR" ]; then
  while IFS= read -r -d '' f; do
    base="$(basename "$f")"
    case "$base" in
      OmniMux\ Dev*) continue ;;
      OmniMux_*.plist|OmniMux-*.plist)
        crash_hits=$((crash_hits + 1))
        run_rm "$f"
        ;;
    esac
  done < <(find "$CRASH_DIR" -maxdepth 1 \( -name 'OmniMux_*.plist' -o -name 'OmniMux-*.plist' \) -print0 2>/dev/null || true)
fi
if [ -d "$DIAG_DIR" ]; then
  while IFS= read -r -d '' f; do
    base="$(basename "$f")"
    case "$base" in
      *Dev*|OmniMux\ Dev*) continue ;;
      OmniMux-*.ips|OmniMux_*.ips|OmniMux-*.crash|OmniMux_*.crash)
        crash_hits=$((crash_hits + 1))
        run_rm "$f"
        ;;
    esac
  done < <(find "$DIAG_DIR" -maxdepth 1 \( -name 'OmniMux-*.ips' -o -name 'OmniMux_*.ips' -o -name 'OmniMux-*.crash' -o -name 'OmniMux_*.crash' \) -print0 2>/dev/null || true)
fi
if [ "$crash_hits" -eq 0 ]; then
  act "无正式版崩溃报告"
fi

# ---------- 4) 弹出正式版安装盘 / 幽灵挂载 ----------
say "── [4/5] 弹出正式版 DMG / 幽灵挂载 ──"
detach_volume_if_prod() {
  local vol="$1"
  local name
  name="$(basename "$vol")"
  case "$name" in
    *Dev*|*'OmniMux Dev'*) return 0 ;;
    OmniMux\ *)
      if [ "$DRY_RUN" -eq 1 ]; then
        act "将弹出卷宗: $vol"
      else
        diskutil unmount "$vol" >/dev/null 2>&1 || hdiutil detach "$vol" -force >/dev/null 2>&1 || true
        ok "已弹出: $vol"
      fi
      ;;
  esac
}

for vol in /Volumes/OmniMux*; do
  [ -e "$vol" ] || continue
  detach_volume_if_prod "$vol"
done

# 解析 hdiutil info：只卸 Downloads 里的 OmniMux-arm64*.dmg，以及无挂载点的正式版映像
python3 - "$DRY_RUN" <<'PY' || warn "hdiutil 解析跳过（python/hdiutil 不可用）"
import re, subprocess, sys
dry = sys.argv[1] == "1"
try:
    out = subprocess.check_output(["hdiutil", "info"], text=True, stderr=subprocess.STDOUT)
except Exception as e:
    print(f"  → hdiutil info 失败: {e}", file=sys.stderr)
    sys.exit(0)

blocks = re.split(r"={10,}", out)
for block in blocks:
    if "image-path" not in block:
        continue
    m_path = re.search(r"image-path\s*:\s*(.+)", block)
    if not m_path:
        continue
    image_path = m_path.group(1).strip()
    # 只处理用户下载的正式版 arm64 安装盘；不动仓库 dist、Dev、x64 工程产物
    if "/Downloads/" not in image_path:
        continue
    if not re.search(r"OmniMux-arm64.*\.dmg$", image_path):
        continue
    if "Dev" in image_path:
        continue
    m_dev = re.search(r"(/dev/disk\d+)\s+GUID_partition_scheme", block)
    if not m_dev:
        m_dev = re.search(r"(/dev/disk\d+)\b", block)
    if not m_dev:
        print(f"  → 跳过（无设备节点）: {image_path}")
        continue
    dev = m_dev.group(1)
    if dry:
        print(f"  → 将 detach: {dev}  ← {image_path}")
    else:
        subprocess.run(["hdiutil", "detach", dev, "-force"], capture_output=True)
        print(f"\033[32m✓\033[0m 已 detach: {dev}  ← {image_path}")
PY

# ---------- 5) 验收 ----------
say "── [5/5] 验收 ──"
failed=0
check_gone() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      warn "仍存在（dry-run 预期）: $path"
    else
      err "仍存在: $path"
      failed=1
    fi
  else
    ok "已不存在: $path"
  fi
}

if [ "$DRY_RUN" -eq 0 ]; then
  check_gone "$PROD_APP"
  check_gone "$PROD_HOME"
  check_gone "$PROD_SUPPORT"
  check_gone "$PROD_SUPPORT_LEGACY"
  check_gone "$PROD_PREF"
  if [ -n "$personal_target" ]; then
    if [ -e "$personal_target" ]; then
      ok "personal 目标仍在: $personal_target"
    else
      err "personal 目标丢失（不应发生）: $personal_target"
      failed=1
    fi
  fi
  # Dev 保护面仍在（若原本就有）
  for p in "$DEV_APP" "$DEV_HOME" "$DEV_SUPPORT" "$DEV_PREF"; do
    if [ -e "$p" ]; then
      ok "Dev 保留: $p"
    fi
  done
  if pgrep -f '/Applications/OmniMux\.app/' >/dev/null 2>&1; then
    err "正式版进程仍在"
    failed=1
  else
    ok "无正式版进程"
  fi
else
  say "这是 dry-run。确认无误后执行："
  say "  yarn omnimux:prod-reset --yes"
fi

if [ "$failed" -ne 0 ]; then
  err "清空未完全成功"
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  ok "正式版已清空，可重新安装 DMG 做用户场景测试"
fi
