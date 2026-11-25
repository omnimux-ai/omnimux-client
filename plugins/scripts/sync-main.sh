#!/usr/bin/env bash
# Shared, read-only source gate for every materialization entrypoint.

# ---------------------------------------------------------------------------
# 主检出洁净度口径（单一真源）
#
# 「哪些本地路径会阻断插件物化」只在这里定义一次：物化硬门禁
# （assert_omnimux_sync_main）与 worktree.sh 的收尾预检共用同一组判定，
# 避免两边各写一份 allowlist 后漂移——子模块指针偏移或演示/证据草稿
# 不该再让 worktree.sh 静默跳过自动物化。
# ---------------------------------------------------------------------------

# 允许存在的未跟踪草稿/证据/归档：它们不会进入插件物化产物。
OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE='^(specs|docs|ui-demo|tmp|\.tmp|\.workbuddy|\.agent-backups|\.worktrees|\.agent-reports|plugins/(docs/evidence|\.agent-reports))/'

# 已跟踪改动（porcelain 原文，忽略 submodule 指针与内部脏状态）。
# 失败返回非零，调用方必须显式处理，不能把读不到状态当成「干净」。
omnimux_primary_tracked_changes() {
  local root="${1:-}"
  [ -n "$root" ] || return 2
  git -C "$root" status --porcelain --untracked-files=no --ignore-submodules=all 2>/dev/null
}

# 会进入物化产物的未跟踪文件（每行一个路径）。失败返回非零。
omnimux_primary_blocking_untracked() {
  local root="${1:-}" untracked
  [ -n "$root" ] || return 2
  untracked=$(git -C "$root" ls-files --others --exclude-standard 2>/dev/null) || return 2
  [ -n "$untracked" ] || return 0
  local status=0
  printf '%s\n' "$untracked" | grep -Ev "$OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE" || status=$?
  [ "$status" -le 1 ] || return 2
}

# 统一判定：0 = 可直接物化，1 = 有阻断路径，2 = 状态不可读。
omnimux_primary_is_clean() {
  local root="${1:-}" tracked blocking
  tracked=$(omnimux_primary_tracked_changes "$root") || return 2
  blocking=$(omnimux_primary_blocking_untracked "$root") || return 2
  [ -z "$tracked" ] && [ -z "$blocking" ]
}

assert_omnimux_sync_main() (
  local root="$1" variable top branch dirty head upstream
  # An inherited Git worktree/index override must not attest another checkout.
  for variable in ${!GIT_@}; do unset "$variable"; done
  top=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null) || {
    echo '❌ sync: 非 git 工作区，Git 源码身份无法证明。' >&2; return 1;
  }
  if [ "$(cd "$top" && pwd -P)" != "$(cd "$root" && pwd -P)" ]; then
    echo '❌ sync: 源目录必须是 Git 仓库根目录。' >&2; return 1
  fi
  # 主检出（非 linked worktree，.git 为目录）严格要求分支名必须为 main；
  # linked worktree（.git 为文件）不以分支名称代替已合并身份，放行精确对齐最新 origin/main 的干净树。
  if [ -d "$root/.git" ]; then
    branch=$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null) || branch='detached'
    if [ "$branch" != 'main' ]; then
      echo "❌ sync: 当前分支是 [$branch]，物化只允许在已合并且对齐 origin/main 的 main 上执行。" >&2
      return 1
    fi
  fi
  # 只拦截「会影响物化产物」的未提交改动；判定口径统一由上方 helper 提供：
  #   - 已跟踪文件的任何改动：必然属于源码 → 一律拦截（忽略无关 git submodule 如 app/deepseek-harness，
  #     子模块一致性由 scripts/dsh-version.mjs 与 app/ 检查独立守护）；
  #   - 未跟踪文件：仅当落在会进入产物的路径时才拦截；规格/调查/记录/归档等草稿目录放行，
  #     包含单仓下 plugins/docs/evidence/ 与 plugins/.agent-reports/，避免与「规格门禁」和冒烟脚本打架。
  tracked=$(omnimux_primary_tracked_changes "$root") || {
    echo '❌ sync: 无法读取工作区状态，拒绝物化。' >&2; return 1;
  }
  if [ -n "$tracked" ]; then
    echo '❌ sync: 工作区存在已跟踪文件的未提交改动，拒绝物化。' >&2
    printf '%s\n' "$tracked" >&2
    return 1
  fi
  blocking=$(omnimux_primary_blocking_untracked "$root") || {
    echo '❌ sync: 无法读取未跟踪文件清单，拒绝物化。' >&2; return 1;
  }
  if [ -n "$blocking" ]; then
    echo '❌ sync: 工作区存在会进入物化产物的未跟踪文件，拒绝物化。' >&2
    printf '%s\n' "$blocking" >&2
    return 1
  fi
  if git -C "$root" remote | grep -qx 'origin'; then
    git -C "$root" fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main' 2>/dev/null || {
      echo '❌ sync: 无法 fetch 最新 origin/main，拒绝物化。' >&2
      return 1
    }
  else
    echo '❌ sync: 无法 fetch 最新 origin/main，拒绝物化。' >&2
    return 1
  fi
  head=$(git -C "$root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null) || return 1
  upstream=$(git -C "$root" rev-parse --verify 'refs/remotes/origin/main^{commit}' 2>/dev/null) || {
    echo '❌ sync: origin/main 不可用，拒绝物化。' >&2; return 1;
  }
  if [ "$head" != "$upstream" ]; then
    echo "❌ sync: HEAD [$head] 不等于最新 origin/main [$upstream]；领先、落后或未合并 tip 均禁止物化。" >&2
    echo "   请在 PR MERGED 后使用精确对齐最新 origin/main 的干净工作树。" >&2
    return 1
  fi
)

assert_omnimux_sync_plugins() {
  local root="$1" plugins="$2" expected actual
  expected="$(cd "$root" && pwd -P)/plugins"
  actual=$(cd "$plugins" && pwd -P) || return 1
  if [ "$actual" != "$expected" ]; then
    echo '❌ sync: 插件源必须是已对齐 main 的 ROOT/plugins，不允许覆盖为外部源码。' >&2
    return 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  assert_omnimux_sync_main "$1"
fi
