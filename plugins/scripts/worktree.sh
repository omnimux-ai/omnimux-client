#!/usr/bin/env bash
# ==============================================================================
# worktree.sh — Universal Git worktree lifecycle management tool.
# Enhanced for OmniMux DSH Plugin & Multi-Agent Collaboration.
#
# Implements standardized worktree contracts:
#   1. Primary checkout stays clean on default branch (main/master/omnimux).
#   2. Task work lives strictly in <repo>/.worktrees/<task>.
#   3. Remove task worktrees only after merge and applicable acceptance, or abandon.
#   4. Worktrees MUST NOT be created as repository siblings or long-lived in /tmp.
#   5. Task naming strictly conforms to ASCII kebab-case (^[a-z0-9][a-z0-9-]*$).
#
# Enhanced Features:
#   - Full worktree-ops compatibility (init, new, list, ship, remove, clean, prune).
#   - GitHub Issue & PR integration (--issue <id>, --pr <number>, auto-new <id>).
#   - Safe PR-First guard (verifies PR MERGED before destruction).
#   - Backward-compatible detection for legacy sibling worktrees (../*-wt-*).
# ==============================================================================

set -euo pipefail

_WORKTREE_SRC="${BASH_SOURCE[0]}"
while [ -L "${_WORKTREE_SRC}" ]; do
  _WORKTREE_DIR="$(cd -P "$(dirname "${_WORKTREE_SRC}")" >/dev/null 2>&1 && pwd -P)"
  _WORKTREE_TARGET="$(readlink "${_WORKTREE_SRC}")"
  case "${_WORKTREE_TARGET}" in
    /*) _WORKTREE_SRC="${_WORKTREE_TARGET}" ;;
    *) _WORKTREE_SRC="${_WORKTREE_DIR}/${_WORKTREE_TARGET}" ;;
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "${_WORKTREE_SRC}")" >/dev/null 2>&1 && pwd -P)"
unset _WORKTREE_SRC _WORKTREE_DIR _WORKTREE_TARGET
# 主检出洁净度口径与物化门禁同源：直接复用 sync-main.sh 的判定函数，
# 避免两边各写一份 allowlist 后漂移（子模块指针 / 演示证据草稿的放行规则必须一致）。
if [ -f "${SCRIPT_DIR}/sync-main.sh" ]; then
  # shellcheck source=sync-main.sh
  source "${SCRIPT_DIR}/sync-main.sh"
  for fn in omnimux_primary_tracked_changes omnimux_primary_blocking_untracked omnimux_primary_is_clean; do
    declare -F "$fn" >/dev/null || {
      echo "worktree.sh: ❌ scripts/sync-main.sh 缺少 ${fn}（契约过期），拒绝在口径不明时收尾。" >&2
      exit 2
    }
  done
else
  # 只有 worktree.sh 的裸拷贝/外部检出没有契约文件。这里保留同一口径的最小实现，
  # 确保收尾入口不会退回旧判定；仓库内始终走上图的同源实现。两份判定的一致性由
  # worktree-primary-cleanliness.test.mjs 的「有无契约文件」对照用例守护。
  OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE='^(specs|docs|ui-demo|tmp|\.tmp|\.workbuddy|\.agent-backups|\.worktrees|\.agent-reports|plugins/(docs/evidence|\.agent-reports))/'

  omnimux_primary_tracked_changes() {
    local root="${1:-}"
    [ -n "$root" ] || return 2
    git -C "$root" -c core.quotepath=false status --porcelain --untracked-files=no --ignore-submodules=all 2>/dev/null
  }

  omnimux_primary_blocking_untracked() {
    local root="${1:-}" untracked
    [ -n "$root" ] || return 2
    untracked=$(git -C "$root" -c core.quotepath=false ls-files --others --exclude-standard 2>/dev/null) || return 2
    [ -n "$untracked" ] || return 0
    local status=0
    printf '%s\n' "$untracked" | grep -Ev "$OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE" || status=$?
    [ "$status" -le 1 ] || return 2
  }

  omnimux_primary_is_clean() {
    local root="${1:-}" tracked blocking
    tracked=$(omnimux_primary_tracked_changes "$root") || return 2
    blocking=$(omnimux_primary_blocking_untracked "$root") || return 2
    [ -z "$tracked" ] && [ -z "$blocking" ]
  }
fi
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${ROOT}" ]; then
  echo "worktree.sh: not inside a git work tree" >&2
  exit 2
fi

# 主检出根：从任意 worktree 里调用时，--show-toplevel 返回的是那个 worktree 自己，
# 而巡检必须看主检出的 .worktrees/。git-common-dir 在所有 worktree 里都指向同一份 .git。
GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo "${ROOT}/.git")"
case "${GIT_COMMON_DIR}" in
  /*) : ;;
  *) GIT_COMMON_DIR="${ROOT}/${GIT_COMMON_DIR}" ;;
esac
PRIMARY_ROOT="$(cd "$(dirname "${GIT_COMMON_DIR}")" 2>/dev/null && pwd || echo "${ROOT}")"

WT_DIR="${ROOT}/.worktrees"
PRIMARY_WT_DIR="${PRIMARY_ROOT}/.worktrees"
TASK_RE='^[a-z0-9][a-z0-9-]*$'

die() { echo "worktree.sh: ❌ $*" >&2; exit 1; }
say() { echo "==> $*"; }

# -----------------------------------------------------------------------------
# Worktree evidence archive (#3820)
# -----------------------------------------------------------------------------

# Fixed destination for evidence taken from a worktree right before it is removed.
# Kept inside the repo's .tmp/ (an existing scratch allowlist) so the data survives
# the task and can be inspected later.
ARCHIVE_ROOT="${ROOT}/.tmp/worktree-archive"

# Copy a worktree's task-owned, never-committed evidence somewhere durable before
# the directory disappears. Only the task's own untracked specs and its tracked diff
# are kept — never the whole specs/ tree, which every worktree carries from main.
# Failure is reported loudly but does not block removal: losing the archive is worse
# than a noisy line, but blocking delivery on it would be worse still.
archive_worktree_evidence() {
  local wt="$1" task="$2"
  [ -d "${wt}" ] || return 0
  local dest="${ARCHIVE_ROOT}/${task}"
  local specs tracked
  specs=$(git -C "${wt}" status --porcelain -uall 2>/dev/null \
    | awk '$1=="??"{print $2}' | grep -E '^specs/.*\.md$' || true)
  tracked=$(git -C "${wt}" diff --stat 2>/dev/null | tail -1)
  if [ -z "${specs}" ] && [ -z "${tracked}" ]; then
    return 0
  fi
  mkdir -p "${dest}" 2>/dev/null || {
    echo "worktree.sh: ⚠️  无法创建证据归档目录 ${dest}；继续删除 worktree，未归档内容将丢失。" >&2
    return 0
  }
  local f
  for f in ${specs}; do
    local base
    base=$(basename "${f}")
    cp "${wt}/${f}" "${dest}/${base}" 2>/dev/null \
      || echo "worktree.sh: ⚠️  归档失败 ${f}" >&2
  done
  git -C "${wt}" diff > "${dest}/tracked-changes.patch" 2>/dev/null || true
  printf '%s\n' "${tracked}" > "${dest}/tracked-changes.summary" 2>/dev/null || true
  say "已归档本任务证据 → ${dest} ($(ls -1 "${dest}" 2>/dev/null | wc -l | tr -d ' ') 个文件)"
}

# -----------------------------------------------------------------------------
# 可选：SAG 语义索引随任务工作树清理（#4060）
# -----------------------------------------------------------------------------
# 本仓的开发都在 .worktrees/<task> 里进行，而 SAG 的根是「父目录吸收子目录」，
# 且以仓根为根扫描时会硬跳过点开头目录（.sagignore 写 !.worktrees/ 也救不回来）。
# 所以工作树不能并入共享知识库，而是由 sag-worktree 各自持有隔离的 SAG_DATA_DIR，
# 索引按需在第一次 search 时惰性建立（本脚本不在建树时同步索引，否则建树要等几分钟）。
#
# 这里只负责收尾：工作树被删掉时停掉并清掉它那份索引，否则孤儿索引会一直占着磁盘。
# 全部 best-effort：本机没有 sag-worktree 就静默跳过；失败只警告，绝不影响交付。
SAG_CMD=()

# 解析顺序：显式 SAG_WORKTREE_BIN > 仓内 scripts/sag-worktree.mjs > PATH 里的 sag-worktree。
# 仓内实现把数据目录命名成「文件夹名 + 路径哈希」，不会和别的仓同名任务撞车（#4068）；
# 家目录里的旧脚本仍可作为兜底，但不再是默认依赖。
sag_available() {
  [ "${OMNIMUX_SAG_INDEX:-1}" = "0" ] && return 1
  if [ -n "${SAG_WORKTREE_BIN:-}" ]; then
    command -v "${SAG_WORKTREE_BIN}" >/dev/null 2>&1 || return 1
    SAG_CMD=("${SAG_WORKTREE_BIN}")
    return 0
  fi
  if [ -f "${SCRIPT_DIR}/sag-worktree.mjs" ] && command -v node >/dev/null 2>&1; then
    SAG_CMD=(node "${SCRIPT_DIR}/sag-worktree.mjs")
    return 0
  fi
  command -v sag-worktree >/dev/null 2>&1 || return 1
  SAG_CMD=(sag-worktree)
  return 0
}

sag_forget_worktree() {
  local wt="$1" status=0
  sag_available || return 0
  "${SAG_CMD[@]}" remove "${wt}" >/dev/null 2>&1 || status=$?
  case "${status}" in
    0) say "SAG: 已清理该工作树的隔离索引 ${wt#${ROOT}/}" ;;
    # 2 = 该数据目录记的是另一个同名路径，工具拒绝删除。这既不是成功也不是失败：
    # 照旧报「已清理」就是假成功，报失败又会在每次无关任务上刷警告。
    2) say "SAG: 跳过清理 ${wt#${ROOT}/}（本机同名索引不属于该路径）" ;;
    # 3 = 本机没有安装 sag。这属于「能力不存在」而不是「清理出错」，按静默跳过处理：
    # 没有索引可清，就不该在每次删工作树时刷一行警告。
    3) : ;;
    *) echo "worktree.sh: ⚠️  SAG 索引清理失败（退出码 ${status}，不影响工作树）：${SAG_CMD[*]} remove ${wt}" >&2 ;;
  esac
  return 0
}

sag_collect_orphans() {
  # gc 会跨本机所有工作树删除孤儿索引（全局且不可逆），默认不跑：交付收尾不该
  # 顺手动到别的任务的数据。需要时显式 OMNIMUX_SAG_GC=1 打开。
  [ "${OMNIMUX_SAG_GC:-0}" = "1" ] || return 0
  sag_available || return 0
  if ! "${SAG_CMD[@]}" gc >/dev/null 2>&1; then
    # 与清理同一条原则：失败要能看见，但不能把交付带崩。
    echo "worktree.sh: ⚠️  SAG 孤儿索引回收失败（不影响交付）：${SAG_CMD[*]} gc" >&2
  fi
  return 0
}

# List worktrees whose branch is fully merged and has no unmerged commits, so a human
# can clean them without guessing. Read-only: never removes anything.
audit_worktrees() {
  local remote_branch="${REMOTE}/${DEFAULT_BRANCH}"
  say "巡检 worktree（基线 ${remote_branch}）"
  local name wt branch ahead tracked untracked verdict
  for wt in "${PRIMARY_WT_DIR}"/*; do
    [ -d "${wt}" ] || continue
    name=$(basename "${wt}")
    branch=$(git -C "${wt}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    [ -n "${branch}" ] || continue
    # ahead 只覆盖已提交差异；本仓允许改动以未提交形式留在 worktree，
    # 所以还要看工作区本身，否则会把「做了一半、没提交」的任务判成可清理（#3829）。
    # 注意 `grep -vE` 无匹配时退出码为 1，pipefail 下会中断整个脚本，故加 `|| true`。
    tracked=$(git -C "${wt}" diff --name-only 2>/dev/null | wc -l | tr -d ' ' || true)
    untracked=$(git -C "${wt}" status --porcelain -uall 2>/dev/null \
      | awk '$1=="??"{print $2}' | grep -vE '^specs/.*\.md$' | wc -l | tr -d ' ' || true)
    tracked=${tracked:-0}
    untracked=${untracked:-0}
    if [ "${branch}" = "${DEFAULT_BRANCH}" ]; then
      verdict="保留：分支是 ${DEFAULT_BRANCH}，需人工判断"
    elif [ "${wt}" = "${ROOT}" ]; then
      # 当前所在的 worktree 还没提交时 ahead 也是 0，不能据此判可清理。
      verdict="保留：这是当前所在 worktree"
    elif [ "${tracked}" -gt 0 ] || [ "${untracked}" -gt 0 ]; then
      # 已跟踪文件被改 = 真实未交付工作；未跟踪的非 spec 文件同样保守保留。
      # 只有未跟踪的 specs/*.md 不算「有活」——那是契约要求的常态，ship 会归档。
      verdict="保留：有未提交改动（tracked=${tracked} untracked=${untracked}）"
    else
      ahead=$(git -C "${PRIMARY_ROOT}" rev-list --count "${remote_branch}..${branch}" 2>/dev/null || echo "?")
      if [ "${ahead}" = "0" ]; then
        verdict="可清理"
      else
        verdict="保留：ahead=${ahead}"
      fi
    fi
    printf '%-46s %-46s %s\n' "${name}" "${branch}" "${verdict}"
    if [ "${verdict}" = "可清理" ]; then
      printf '    清理: bash scripts/worktree.sh remove %s --pr <n>\n' "${name}"
    fi
  done
}

# -----------------------------------------------------------------------------
# Remote & Branch Detection
# -----------------------------------------------------------------------------

detect_remote() {
  if [ -n "${WORKTREE_REMOTE:-}" ]; then
    echo "${WORKTREE_REMOTE}"
    return 0
  fi
  # Priority: origin (standard), then fork (if present)
  if git remote 2>/dev/null | grep -qx "origin"; then
    echo "origin"
    return 0
  fi
  if git remote 2>/dev/null | grep -qx "fork"; then
    echo "fork"
    return 0
  fi
  local first_remote
  first_remote="$(git remote 2>/dev/null | head -n 1 || true)"
  if [ -n "${first_remote}" ]; then
    echo "${first_remote}"
    return 0
  fi
  echo "origin"
}

REMOTE="$(detect_remote)"

detect_default_branch() {
  if [ -n "${WORKTREE_DEFAULT_BRANCH:-}" ]; then
    echo "${WORKTREE_DEFAULT_BRANCH}"
    return 0
  fi

  local current_branch
  current_branch="$(git -C "${ROOT}" symbolic-ref --short HEAD 2>/dev/null || true)"

  # 1. Detect symbolic ref of remote HEAD
  local remote_head
  remote_head="$(git symbolic-ref --short "refs/remotes/${REMOTE}/HEAD" 2>/dev/null || true)"
  if [ -n "${remote_head}" ]; then
    local target="${remote_head#"${REMOTE}/"}"
    if [ -n "${target}" ]; then
      echo "${target}"
      return 0
    fi
  fi

  # 2. Common branches: main -> master -> omnimux
  for b in "main" "master" "omnimux"; do
    if [ "${current_branch}" = "${b}" ] || \
       git show-ref --verify --quiet "refs/heads/${b}" || \
       git show-ref --verify --quiet "refs/remotes/${REMOTE}/${b}"; then
      echo "${b}"
      return 0
    fi
  done

  echo "main"
}

DEFAULT_BRANCH="$(detect_default_branch)"

# -----------------------------------------------------------------------------
# Input Validation & Resolvers
# -----------------------------------------------------------------------------

validate_task() {
  local task="$1"
  if [ -z "${task}" ]; then
    die "missing <task> (kebab-case, e.g. fix-node-runtime)"
  fi
  case "${task}" in
    main | master | omnimux | origin | fork | upstream | "${REMOTE}" | feat | fix | chore | agent | codex | merge | .git | .worktrees)
      die "reserved name: ${task}" ;;
  esac
  if ! printf '%s' "${task}" | grep -Eq "${TASK_RE}"; then
    die "task must be ASCII kebab-case (^[a-z0-9][a-z0-9-]*$): ${task}"
  fi
  if [ "${#task}" -gt 60 ]; then
    die "task too long (max 60 chars): ${task}"
  fi
}

resolve_worktree_dir() {
  local task="$1"
  # 1. Canonical path: inside .worktrees/
  if [ -d "${WT_DIR}/${task}" ]; then
    echo "${WT_DIR}/${task}"
    return 0
  fi

  # 2. Backward compatibility: check legacy sibling directories
  local parent_dir="$(cd "${ROOT}/.." && pwd)"
  local sibling_dir="${parent_dir}/$(basename "${ROOT}")-wt-${task}"
  if [ -d "${sibling_dir}" ]; then
    echo "${sibling_dir}"
    return 0
  fi

  # 3. Fuzzy prefix match in sibling directories
  local matched
  matched=$(ls -d "${parent_dir}/$(basename "${ROOT}")-wt-${task}"* 2>/dev/null | head -n 1 || true)
  if [ -n "${matched}" ] && [ -d "${matched}" ]; then
    echo "${matched}"
    return 0
  fi

  # Fallback to standard path
  echo "${WT_DIR}/${task}"
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_init() {
  say "initializing worktree infrastructure in ${ROOT}"
  mkdir -p "${WT_DIR}"
  local gi="${ROOT}/.gitignore"
  local git_common_dir
  git_common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "${ROOT}/.git")"
  case "${git_common_dir}" in
    /*) ;;
    *) git_common_dir="${ROOT}/${git_common_dir}" ;;
  esac
  local exclude="${git_common_dir}/info/exclude"

  # Ensure .worktrees/ is in .gitignore
  if [ ! -f "${gi}" ]; then
    echo ".worktrees/" > "${gi}"
    say "created .gitignore with .worktrees/"
  elif ! grep -q "^\.worktrees/\{0,1\}$" "${gi}" 2>/dev/null; then
    printf '\n# Git worktrees isolation directory\n.worktrees/\n' >> "${gi}"
    say "appended .worktrees/ to .gitignore"
  else
    say ".gitignore already ignores .worktrees/"
  fi

  # Defensive: ensure in .git/info/exclude
  if [ -f "${exclude}" ]; then
    if ! grep -q "^\.worktrees/\{0,1\}$" "${exclude}" 2>/dev/null; then
      printf '\n.worktrees/\n' >> "${exclude}"
    fi
    if ! grep -q "^node_modules/\{0,1\}$" "${exclude}" 2>/dev/null; then
      printf '\nnode_modules\n' >> "${exclude}"
    fi
  fi

  echo "✓ Initialization complete. Default remote: ${REMOTE}, default branch: ${DEFAULT_BRANCH}"
}

print_wt() {
  local wt="$1" branch="$2" rel dirty
  case "${wt}" in
    "${ROOT}") rel="(primary)" ;;
    "${ROOT}"/*) rel="${wt#${ROOT}/}" ;;
    *) rel="${wt} (legacy sibling)" ;;
  esac
  if [ -d "${wt}" ]; then
    dirty="$(git -C "${wt}" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  else
    dirty="missing"
  fi
  printf '  %-52s %-45s dirty:%s\n' "${rel}" "${branch}" "${dirty}"
}

cmd_new() {
  local task="" base="" btype="feat" issue_id=""
  
  while [ $# -gt 0 ]; do
    case "$1" in
      --type)
        shift
        [ $# -gt 0 ] || die "missing argument for --type (feat|fix|chore|agent)"
        btype="$1"
        ;;
      --issue)
        shift
        [ $# -gt 0 ] || die "missing argument for --issue"
        issue_id="$1"
        ;;
      *)
        if [ -z "${task}" ]; then
          task="$1"
        else
          base="$1"
        fi
        ;;
    esac
    shift
  done

  if [ -z "${task}" ] && [ -n "${issue_id}" ]; then
    task="issue-${issue_id}"
  fi

  validate_task "${task}"

  if ! printf '%s' "${btype}" | grep -Eq '^[a-z0-9_-]+$'; then
    die "invalid branch type: ${btype}"
  fi

  if [ -z "${base}" ]; then
    base="${REMOTE}/${DEFAULT_BRANCH}"
  fi

  local branch="${btype}/${task}"
  if [ -n "${issue_id}" ] && [[ "${task}" != *"issue-"* ]]; then
    branch="${btype}/${task}-issue-${issue_id}"
  fi

  local wt="${WT_DIR}/${task}"

  [ -e "${wt}" ] && die "worktree already exists: ${wt#${ROOT}/}"
  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    die "branch already exists: ${branch}"
  fi

  cmd_init >/dev/null 2>&1 || true

  say "fetch ${REMOTE} (refresh tracking refs)"
  git fetch "${REMOTE}" --prune 2>/dev/null || say "warning: git fetch ${REMOTE} failed, using local refs"

  if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null 2>&1; then
    if git rev-parse --verify --quiet "${DEFAULT_BRANCH}^{commit}" >/dev/null 2>&1; then
      say "base ref '${base}' not found, falling back to local '${DEFAULT_BRANCH}'"
      base="${DEFAULT_BRANCH}"
    else
      die "unknown base ref: ${base}"
    fi
  fi

  say "creating worktree in .worktrees/${task} based on ${base}"
  git worktree add -b "${branch}" "${wt}" "${base}" || die "git worktree add failed"

  echo
  echo "✅ Worktree Created Successfully:"
  echo "    Path:   ${wt#${ROOT}/}"
  echo "    Branch: ${branch}"
  echo "    Base:   ${base}"
  echo "    Next:   cd ${wt#${ROOT}/}"
}

cmd_auto_new() {
  local issue_id="${1:-}"
  [ -n "${issue_id}" ] || die "usage: worktree.sh auto-new <issue_id>"

  command -v gh >/dev/null 2>&1 || die "gh CLI is required for auto-new"

  say "fetching issue #${issue_id} metadata via gh..."
  local issue_json
  issue_json=$(gh issue view "${issue_id}" --json title,labels 2>/dev/null) || die "failed to fetch issue #${issue_id}"

  local title
  title=$(echo "${issue_json}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('title', ''))" 2>/dev/null || true)
  
  # Extract clean topic from title
  local topic
  topic=$(echo "${title}" | sed -E 's/^[a-zA-Z]+(\([^)]+\))?:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+|-+$//g' | cut -c 1-35)
  [ -n "${topic}" ] || topic="task"

  local btype="agent"
  if echo "${title}" | grep -qiE "^fix"; then
    btype="fix"
  elif echo "${title}" | grep -qiE "^feat"; then
    btype="feat"
  elif echo "${title}" | grep -qiE "^docs"; then
    btype="chore"
  fi

  local full_task="${topic}-${issue_id}"
  cmd_new "${full_task}" --type "${btype}" --issue "${issue_id}"
}

cmd_list() {
  echo "== Active Worktrees in $(basename "${ROOT}") (Standard: <repo>/.worktrees/<task>) =="
  echo
  local wt="" branch=""
  while IFS= read -r line; do
    case "${line}" in
      worktree*)
        if [ -n "${wt}" ]; then print_wt "${wt}" "${branch}"; fi
        wt="${line#worktree }"
        branch=""
        ;;
      branch*)
        branch="${line#branch refs/heads/}"
        ;;
      detached)
        branch="(detached)"
        ;;
    esac
  done < <(git worktree list --porcelain)
  if [ -n "${wt}" ]; then print_wt "${wt}" "${branch}"; fi
  echo
}

# ---------------------------------------------------------------------------
# 自动物化与实机热重载辅助函数（Post-Merge Auto-Materialize & Live Reload）
# 合并一旦确认，改到已安装插件的提交必须装进开发版。两条收尾都走这里：
# ship 在快进之后，remove 在删除之后（正式版本已拉齐时也要补上这一次）。
# ---------------------------------------------------------------------------

# 开发版里这个插件是否已经包含给定范围的最终内容。
# 范围可能跨过多次提交：必须拿目标提交的每个改动文件去比，不能只看最新一次。
# 列不出文件、对不上内容，都算未一致，交给安装。一致才跳过。
dev_plugin_matches_range() {
  local plugin="$1" base_ref="$2" target_ref="$3"
  local dev_root="${OMNIMUX_DEV_SNAPSHOT:-${HOME}/.omnimux-dev/profiles/omnimux/.materialize-snapshots/plugins/${plugin}}"
  [ -d "${dev_root}" ] || return 1
  # 逐次提交看，不能只看两端净差：同一范围里删了又加回来的文件，
  # 净差是空的，开发版却还留着旧内容。
  local commits
  commits="$(git -C "${ROOT}" rev-list --reverse "${base_ref}..${target_ref}" 2>/dev/null || true)"
  [ -n "${commits}" ] || return 1
  local commit status path old_path src dest touched=0
  while IFS= read -r commit; do
    [ -n "${commit}" ] || continue
    local changes
    changes="$(git -C "${ROOT}" diff-tree --no-commit-id --name-status --find-renames -r -m --first-parent "${commit}" -- "plugins/${plugin}" 2>/dev/null || true)"
    [ -n "${changes}" ] || continue
    while IFS=$'\t' read -r status path old_path; do
      [ -n "${status}" ] || continue
      # This versioned entry is a package-test runner, not a shipped runtime input.
      if [ "${path}" = "plugins/omnimux/scripts/run-tests.mjs" ]; then
        case "${status}" in
          R[0-9]*|C[0-9]*) [ "${old_path}" = "${path}" ] && continue ;;
          *) continue ;;
        esac
      fi
      touched=1
      case "${status}" in
        R[0-9]*|C[0-9]*) ;;
        *) old_path="" ;;
      esac
      [ -n "${path}" ] || return 1
      src="${path#plugins/${plugin}/}"
      dest="${dev_root}/${src}"
      if git -C "${ROOT}" cat-file -e "${target_ref}:${path}" 2>/dev/null; then
        [ -f "${dest}" ] || return 1
        git -C "${ROOT}" show "${target_ref}:${path}" 2>/dev/null | cmp -s - "${dest}" || return 1
      else
        # 目标提交里已删除的文件，开发版里也不该还在。
        [ -e "${dest}" ] && return 1
      fi
      case "${status}" in
        R[0-9]*|C[0-9]*)
          [ -n "${old_path}" ] || return 1
          [ -e "${dev_root}/${old_path#plugins/${plugin}/}" ] && return 1
          ;;
      esac
    done <<< "${changes}"
  done <<< "${commits}"
  [ "${touched}" -eq 1 ] || return 1
  return 0
}

# Dev 物化结果。收尾横幅只能复述这里的事实，不得无条件宣称「已物化」。
# 取值：ok | already-current | not-needed | failed | unknown
MATERIALIZE_STATUS="unknown"

# 把 MATERIALIZE_STATUS 翻译成横幅里的开发版分句。
materialize_dev_state() {
  case "${MATERIALIZE_STATUS}" in
    ok) echo "开发版已物化" ;;
    already-current) echo "开发版已是最新（本次无需重复安装）" ;;
    not-needed) echo "开发版无需物化（本次合入未包含插件源码变更）" ;;
    failed) echo "开发版未更新（物化失败，见上方提示）" ;;
    pipeline-absent) echo "开发版未更新（本检出没有安装脚本，不属于本仓交付管线）" ;;
    *) echo "开发版物化状态未知" ;;
  esac
}

auto_materialize_and_reload() {
  local base_ref="${1:-HEAD~1}"
  local target_ref="${2:-HEAD}"
  # 只有 ship 允许「刷新 shared kit 后重试」；remove 是清理动作，不额外做全量同步与重启。
  local kit_refresh_allowed="${3:-0}"

  if [ ! -f "${SCRIPT_DIR}/sync-to-app.sh" ]; then
    # 本检出没有交付管线（外来/不完整检出）：开发版不会更新，但也没有「本仓管线失败」可言，
    # 因此不套用退出码 3；横幅按 pipeline-absent 如实说明。
    MATERIALIZE_STATUS="pipeline-absent"
    say "⚠️ 缺少安装脚本，开发版未更新。请在主检出运行: plugins/scripts/sync-to-app.sh"
    return 0
  fi

  # 只认插件目录。文档、流程、脚本、测试夹具不进开发版。
  # 逐次提交收集：同一范围里先改后还原的文件，两端净差是空的，不能因此跳过。
  local changed_paths changed_plugins=() pending=()
  changed_paths="$(git -C "${ROOT}" log --no-renames --name-only --diff-merges=first-parent --pretty=format: "${base_ref}..${target_ref}" -- plugins pnpm-lock.yaml 2>/dev/null | grep -E '^(plugins/|pnpm-lock\.yaml$)' | sort -u || true)"
  # 插件根目录的 *.md（AGENTS.md / README*.md / PRD.md …）与 plugins/<name>/docs/ 只给人和 Agent 读，
  # 运行时不加载；测试文件（*.test.* 与 tests/、test/、test-support/、__tests__/）同样不进开发版运行时，
  # 两类改动都不物化也不触发重启。skills/、catalog/ 等运行时读取的 Markdown 不在此列。
  local source_paths
  source_paths="$(printf '%s\n' "${changed_paths}" | grep -vE '^plugins/omnimux/scripts/run-tests\.mjs$|^(plugins/plugins/[^/]+|plugins/[^/]+)/[^/]+\.md$|^(plugins/plugins/[^/]+|plugins/[^/]+)/(docs|tests?|test-support|__tests__)/|\.test\.(js|mjs|ts|jsx|tsx|cjs)$' || true)"
  if [ -n "${changed_paths}" ] && [ -z "${source_paths}" ]; then
    MATERIALIZE_STATUS="not-needed"
    say "ℹ️ 本次合入只改了插件文档或测试文件，无需物化。"
    return 0
  fi
  changed_paths="${source_paths}"
  # 只有 plugins/plugins/<name>/ 下的路径才是可物化插件。plugins/ 根下的 package.json、
  # scripts/、packages/、docs/、presets/ 与 plugins.registry.json 属于工作区/工具链，不能
  # 被当成插件名（否则会去同步 plugins/plugins/package.json 这类不存在的目录）。
  # 共享包（plugins/packages/*）改动无法按单插件增量安装，必须走完整同步重建 kit。
  local full_sync=0
  if printf '%s\n' "${changed_paths}" | grep -qE '^plugins/packages/|^plugins/package\.json$|^pnpm-lock\.yaml$'; then
    full_sync=1
  fi
  while IFS= read -r p; do
    [ -n "${p}" ] || continue
    case "${p}" in
      scripts|packages|docs|presets|node_modules|plugins|tests|test-support|fixtures|.*) continue ;;
    esac
    # 单仓真实布局是 plugins/plugins/<name>；只认带 package.json 的插件包，避免把
    # plugins/.agents、plugins/.dsh、plugins/fixtures 这类工作区目录当成插件。
    if [ -d "${ROOT}/plugins/plugins" ]; then
      [ -f "${ROOT}/plugins/plugins/${p}/package.json" ] || continue
    else
      # 隔离夹具/扁平布局是 plugins/<name>。
      [ -d "${ROOT}/plugins/${p}" ] || continue
    fi
    changed_plugins+=("${p}")
  done < <(printf '%s\n' "${changed_paths}" | sed -n -e 's|^plugins/plugins/\([^/]*\)/.*|\1|p' -e 's|^plugins/\([^/]*\)/.*|\1|p' | sort -u)

  if [ "${#changed_plugins[@]}" -eq 0 ] && [ "${full_sync}" -eq 0 ]; then
    MATERIALIZE_STATUS="not-needed"
    say "ℹ️ 本次合入未包含可物化的插件源码变更，无需物化。"
    return 0
  fi

  if [ "${full_sync}" -eq 0 ]; then
    # 开发版已经包含整段范围的插件不再装第二遍。
    local plugin
    for plugin in "${changed_plugins[@]}"; do
      if dev_plugin_matches_range "${plugin}" "${base_ref}" "${target_ref}"; then
        say "ℹ️ ${plugin} 已包含 ${base_ref}..${target_ref}，跳过重复安装。"
      else
        pending+=("${plugin}")
      fi
    done
    if [ "${#pending[@]}" -eq 0 ]; then
      MATERIALIZE_STATUS="already-current"
      say "✅ 开发版已包含本次合入，无需重复安装。"
      return 0
    fi
    changed_plugins=("${pending[@]}")
  fi

  # Client 产物由 Web 服务按请求从磁盘读取，刷新页面即取得新版；其余插件文件（宿主路由、
  # 清单、构建期入口）只有宿主进程重新加载后才生效，必须走受控重启，否则会留下新旧混装。
  local needs_restart=0
  if printf '%s\n' "${changed_paths}" | grep -qvE '^(plugins/plugins/[^/]+|plugins/[^/]+)/src/client/'; then
    needs_restart=1
  fi

  if [ "${full_sync}" -eq 1 ]; then
    say "🔄 自动物化：合并已确认，共享依赖改动需要完整同步 (~/.omnimux-dev)，不写正式版..."
  else
    say "🔄 自动物化：合并已确认，变更插件 [${changed_plugins[*]}] 开始装进开发版 (~/.omnimux-dev)，不写正式版..."
  fi
  # 单插件同步拒绝覆盖 shared kit（避免共享依赖被单个插件顺带改掉）。失败后的兜底必须是
  # 「先刷新 shared kit，再重试本次插件」：只跑无参数完整同步会漏掉不在默认清单里的插件
  # （omnimux-studio / device / intercept 等），那会造出「本次插件没进开发版却报成功」的新假闭环。
  local sync_ok=0 sync_mode="incremental"
  if [ "${full_sync}" -eq 1 ]; then
    sync_mode="full"
    if (cd "${ROOT}" && bash "${SCRIPT_DIR}/sync-to-app.sh"); then
      sync_ok=1
      if [ "${#changed_plugins[@]}" -gt 0 ]; then
        # 完整同步只覆盖默认插件清单；同一范围里的具名插件（含不在默认清单的新插件）必须再装一次。
        sync_mode="full+named"
        if ! (cd "${ROOT}" && bash "${SCRIPT_DIR}/sync-to-app.sh" "${changed_plugins[@]}"); then
          sync_ok=0
          say "⚠️ 完整同步成功，但本次插件 [${changed_plugins[*]}] 安装失败。"
        fi
      fi
    fi
  elif (cd "${ROOT}" && bash "${SCRIPT_DIR}/sync-to-app.sh" "${changed_plugins[@]}"); then
    sync_ok=1
  elif [ "${kit_refresh_allowed}" -eq 1 ] && [ "${OMNIMUX_SHIP_NO_FULL_SYNC:-0}" != "1" ]; then
    say "⚠️ 增量物化失败（常见原因：shared kit 漂移）。先刷新 shared kit，再重试本次插件..."
    if (cd "${ROOT}" && bash "${SCRIPT_DIR}/sync-to-app.sh"); then
      sync_mode="kit-refresh+retry"
      if (cd "${ROOT}" && bash "${SCRIPT_DIR}/sync-to-app.sh" "${changed_plugins[@]}"); then
        sync_ok=1
      else
        say "⚠️ shared kit 已刷新，但本次插件仍安装失败。"
      fi
    else
      say "⚠️ 刷新 shared kit 的完整同步也失败。"
    fi
  else
    say "⚠️ 增量物化失败（OMNIMUX_SHIP_NO_FULL_SYNC=1，不做 shared kit 刷新与重试）。"
  fi
  if [ "${sync_ok}" -eq 1 ]; then
    MATERIALIZE_STATUS="ok"
    if [ "${sync_mode}" = "kit-refresh+retry" ]; then
      say "✅ 物化成功（本次增量先失败，刷新 shared kit 后重试成功）。"
      # shared kit 刷新属于宿主侧变更，需要受控重启。
      needs_restart=1
    elif [ "${sync_mode}" = "full" ]; then
      say "✅ 物化成功（完整同步已完成）。"
      # 工作区/共享包变更属于宿主侧改动，需要受控重启。
      needs_restart=1
    elif [ "${sync_mode}" = "full+named" ]; then
      say "✅ 物化成功（完整同步 + 具名插件已完成）。"
      needs_restart=1
    else
      say "✅ 增量物化成功！"
    fi
    # 自动探测 Dev App：宿主侧变更受控重启，纯 Client 变更刷新页面
    if [ -f "${SCRIPT_DIR}/reload-dev-app.mjs" ]; then
      if [ "${needs_restart}" -eq 1 ]; then
        node "${SCRIPT_DIR}/reload-dev-app.mjs" --restart 2>/dev/null || true
      else
        node "${SCRIPT_DIR}/reload-dev-app.mjs" 2>/dev/null || true
      fi
    fi
    # 物化后冒烟：验证 Dev 窗口可达 + 版本生效；失败/待重启如实报告，不阻断 ship。
    if [ -f "${SCRIPT_DIR}/dev-smoke.mjs" ]; then
      local plugins_csv=""
      if [ "${#changed_plugins[@]}" -gt 0 ]; then
        plugins_csv="$(IFS=,; echo "${changed_plugins[*]}")"
      fi
      if [ -n "${plugins_csv}" ]; then
        if ! node "${SCRIPT_DIR}/dev-smoke.mjs" --plugins "${plugins_csv}" ${needs_restart:+--expect-restart}; then
          say "⚠️ dev-smoke 未通过：请查看 ${ROOT}/.workbuddy/evidence/dev-smoke/dev-smoke-report.json"
        fi
      elif ! node "${SCRIPT_DIR}/dev-smoke.mjs" ${needs_restart:+--expect-restart}; then
        say "⚠️ dev-smoke 未通过：请查看 ${ROOT}/.workbuddy/evidence/dev-smoke/dev-smoke-report.json"
      fi
    fi
  else
    MATERIALIZE_STATUS="failed"
    if [ "${sync_mode}" = "full+named" ]; then
      say "⚠️ 自动物化未成功（完整同步成功，但具名插件安装失败）。"
    elif [ "${sync_mode}" = "full" ]; then
      say "⚠️ 自动物化未成功（完整同步失败）。"
    else
      say "⚠️ 自动物化未成功（增量与完整同步都失败）。"
    fi
    say "   补救：在主检出运行 plugins/scripts/sync-to-app.sh（无插件参数=完整同步，可覆盖 shared kit），完成后自行确认开发版版本。"
  fi
}

cmd_ship() {
  local task="$1"
  shift || true
  local pr_number="" keep_worktree=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --pr) shift; pr_number="${1:-}" ;;
      --keep-worktree) keep_worktree=1 ;;
      *) die "unknown flag: $1" ;;
    esac
    shift
  done
  [[ "${pr_number}" =~ ^[0-9]+$ ]] || die "ship requires --pr <merged-pr-number>; merge through GitHub Merge Queue first"
  command -v gh >/dev/null 2>&1 || die "gh is required to verify the merged PR"

  local wt
  wt="$(resolve_worktree_dir "${task}")"
  [ -d "${wt}" ] || die "no worktree found for task: ${task}"

  local branch
  branch="$(git -C "${wt}" symbolic-ref --short HEAD 2>/dev/null || true)"
  [ -n "${branch}" ] || die "worktree is in detached HEAD state; cannot ship automatically"

  if [ -n "$(git -C "${wt}" status --porcelain 2>/dev/null)" ]; then
    die "worktree has uncommitted changes; commit or stash them first"
  fi

  # Primary checkout check
  local primary_branch
  primary_branch="$(git -C "${ROOT}" symbolic-ref --short HEAD 2>/dev/null || true)"
  if [ "${primary_branch}" != "${DEFAULT_BRANCH}" ]; then
    die "primary checkout is not on default branch (${DEFAULT_BRANCH}); got: ${primary_branch}"
  fi
  # 与物化门禁同一口径：子模块指针漂移、demo/证据草稿不阻塞；真正会进产物的
  # 已跟踪改动与未跟踪文件在这里提前拦住，避免走到 sync-to-app.sh 才失败。
  local primary_state=0
  omnimux_primary_is_clean "${ROOT}" || primary_state=$?
  if [ "${primary_state}" -eq 2 ]; then
    die "cannot read primary checkout status; refusing to ship"
  fi
  if [ "${primary_state}" -ne 0 ]; then
    { omnimux_primary_tracked_changes "${ROOT}"; omnimux_primary_blocking_untracked "${ROOT}"; } | sed 's/^/    /' >&2 || true
    die "primary checkout is not clean for materialization (paths above); run: bash plugins/scripts/worktree.sh rescue-primary to move them into an isolated worktree before shipping"
  fi

  say "verifying GitHub PR #${pr_number} merge state and task revision..."
  local pr_info pr_state pr_branch pr_head pr_base pr_merge
  pr_info=$(gh pr view "${pr_number}" --json state,headRefName,headRefOid,baseRefName,mergeCommit \
    -q '[.state, .headRefName, .headRefOid, .baseRefName, (.mergeCommit.oid // "")] | @tsv') || die "cannot read PR #${pr_number}"
  IFS=$'\t' read -r pr_state pr_branch pr_head pr_base pr_merge <<< "${pr_info}"
  [ "${pr_state}" = "MERGED" ] || die "PR #${pr_number} is [${pr_state}], not MERGED"
  [ "${pr_branch}" = "${branch}" ] && [ "${pr_head}" = "$(git -C "${wt}" rev-parse HEAD)" ] \
    && [ "${pr_base}" = "${DEFAULT_BRANCH}" ] || die "PR #${pr_number} does not match this task branch, HEAD and base"
  [ -n "${pr_merge}" ] || die "PR #${pr_number} has no merge commit; cannot determine the materialization range (rebase-merge is not supported here)"
  git -C "${ROOT}" pull --ff-only "${REMOTE}" "${DEFAULT_BRANCH}"
  git -C "${ROOT}" merge-base --is-ancestor "${pr_merge}" "${REMOTE}/${DEFAULT_BRANCH}" \
    || die "merge commit ${pr_merge} of PR #${pr_number} is not an ancestor of ${REMOTE}/${DEFAULT_BRANCH}"

  # 物化范围必须跟随本 PR 的合并提交，且只取相对第一父提交的差异：同一次 Merge
  # Queue 批次可能合入多个 PR，后 ship 较早的 PR 时 HEAD~1..HEAD 只剩最后一个 PR，
  # 会漏掉本次的插件改动/删除；而 merge-base(^1,^2) 会把分叉后 main 上其他 PR 的
  # 改动也纳入。squash 提交与 merge 提交的 ^1..merge 都恰好是本 PR 的增量。
  auto_materialize_and_reload "${pr_merge}^1" "${pr_merge}" 1

  if [ "${keep_worktree}" -eq 1 ]; then
    if [ "${MATERIALIZE_STATUS}" = "failed" ]; then
      say "⚠️ 交付未闭环：PR 已合入、主干已同步、工作树按 --keep-worktree 保留在 ${wt}，但$(materialize_dev_state)。[materialize=failed]"
    else
      say "PR MERGED; Dev materialization status: ${MATERIALIZE_STATUS} ($(materialize_dev_state)). Worktree retained (--keep-worktree): ${wt}"
    fi
  else
    # 规格草稿按契约留在任务 worktree、不进提交，所以交付时 worktree 必然是脏的；
    # `git worktree remove` 会以 "contains modified or untracked files" 直接拒绝，
    # 旧写法只靠 `|| rm -rf` 兜底，一旦没跑 ship 或兜底未生效就会永久堆积（#3820）。
    # 先归档本任务证据，再 force 删除。
    archive_worktree_evidence "${wt}" "${task}"
    say "git worktree remove --force ${wt}"
    git worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
    if [ -n "${branch}" ] && git show-ref --verify --quiet "refs/heads/${branch}"; then
      git branch -d "${branch}" 2>/dev/null || git branch -D "${branch}" 2>/dev/null || true
    fi
    git worktree prune
    sag_forget_worktree "${wt}"
    if [ "${MATERIALIZE_STATUS}" = "failed" ]; then
      # 合并与清理确实完成了，但开发版没更新——不能宣告「交付闭环完成」。
      say "⚠️ 交付未闭环：PR 已合入、主干已同步、临时工作树 [${task}] 与分支已清理，但$(materialize_dev_state)。[materialize=failed]"
    else
      say "✅ 交付全链路闭环完成：PR 已合入、主干已同步、$(materialize_dev_state)、临时工作树 [${task}] 与分支已清理。[materialize=${MATERIALIZE_STATUS}]"
    fi
  fi
  if [ "${MATERIALIZE_STATUS}" = "failed" ]; then
    say "⚠️ 开发版仍是旧版本：请按上面的补救命令同步后自行确认版本；退出码 3 = 已合入但未物化（1 = 硬失败）。"
    exit 3
  fi
}

cmd_remove() {
  local task="$1"
  shift || true
  local discard=0 abandon=0 pr_number="" force=0 flags=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --discard) discard=1 ;;
      --abandon) abandon=1 ;;
      --force) force=1; discard=1; abandon=1 ;;
      --pr) shift; pr_number="${1:-}" ;;
      *) die "unknown flag: $1" ;;
    esac
    shift
  done

  local wt
  wt="$(resolve_worktree_dir "${task}")"
  [ -d "${wt}" ] || die "no worktree found for task: ${task}"

  local branch
  branch="$(git -C "${wt}" symbolic-ref --short HEAD 2>/dev/null || true)"

  # PR guard check if specified
  if [ -n "${pr_number}" ] && command -v gh >/dev/null 2>&1 && [ "${force}" -ne 1 ]; then
    say "verifying PR #${pr_number} merge state..."
    local pr_state
    pr_state=$(gh pr view "${pr_number}" --json state -q '.state' 2>/dev/null || true)
    if [ "${pr_state}" != "MERGED" ]; then
      die "PR #${pr_number} is [${pr_state}], not MERGED. Worktree deletion blocked to protect unmerged work."
    fi
    say "PR #${pr_number} confirmed MERGED."
  fi

  if [ -n "$(git -C "${wt}" status --porcelain 2>/dev/null)" ]; then
    if [ "${discard}" -eq 1 ]; then
      say "discarding uncommitted changes in ${wt}"
    else
      die "worktree has uncommitted changes; use --discard to force remove"
    fi
  fi

  # Merge check if not abandoned/forced
  if [ -n "${branch}" ] && [ "${abandon}" -ne 1 ] && [ "${force}" -ne 1 ]; then
    git fetch "${REMOTE}" --prune 2>/dev/null || true
    local merged=""
    merged="$(git for-each-ref --merged="${REMOTE}/${DEFAULT_BRANCH}" --format='%(refname:short)' refs/heads 2>/dev/null | grep -x "${branch}" || true)"
    if [ -z "${merged}" ] && git rev-parse --verify --quiet "${DEFAULT_BRANCH}" >/dev/null 2>&1; then
      merged="$(git for-each-ref --merged="${DEFAULT_BRANCH}" --format='%(refname:short)' refs/heads 2>/dev/null | grep -x "${branch}" || true)"
    fi
    if [ -z "${merged}" ] && [ -z "${pr_number}" ]; then
      die "branch ${branch} is not merged into ${DEFAULT_BRANCH}; use --abandon to drop"
    fi
  fi

  [ "${discard}" -eq 1 ] && flags="--force"
  say "git worktree remove ${flags} ${wt}"
  git worktree remove ${flags} "${wt}" 2>/dev/null || rm -rf "${wt}"

  if [ -n "${branch}" ] && git show-ref --verify --quiet "refs/heads/${branch}"; then
    if [ "${abandon}" -eq 1 ] || [ "${force}" -eq 1 ]; then
      git branch -D "${branch}" 2>/dev/null || true
    else
      git branch -d "${branch}" 2>/dev/null || git branch -D "${branch}" 2>/dev/null || true
    fi
  fi

  git worktree prune
  sag_forget_worktree "${wt}"
  say "done: ${task} removed"

  # 合并确认后必装开发版。正式版本落后时先快进再装这次拉进来的范围；
  # 已经拉齐时也不能跳过——这次合并可能走了别的收尾，开发版还停在上一版。
  # 洁净度与物化门禁同一口径：只有「会进产物的改动」才跳过，并且必须说清原因与路径。
  local primary_state=2
  if [ -n "${pr_number}" ]; then
    primary_state=0
    omnimux_primary_is_clean "${ROOT}" || primary_state=$?
    if [ "${primary_state}" -eq 2 ]; then
      say "ℹ️ 无法读取主检出状态，跳过自动物化；请手动运行: plugins/scripts/sync-to-app.sh"
    elif [ "${primary_state}" -ne 0 ]; then
      say "ℹ️ 主检出存在未提交改动或未跟踪产物，跳过自动物化；可运行 worktree.sh rescue-primary 迁出并疏通后，再运行: plugins/scripts/sync-to-app.sh"
      { omnimux_primary_tracked_changes "${ROOT}"; omnimux_primary_blocking_untracked "${ROOT}"; } | sed 's/^/    /' >&2 || true
    fi
  fi
  if [ "${primary_state}" -eq 0 ]; then
    local cur_branch
    cur_branch="$(git -C "${ROOT}" symbolic-ref --short HEAD 2>/dev/null || true)"
    if [ "${cur_branch}" = "${DEFAULT_BRANCH}" ]; then
      git -C "${ROOT}" fetch "${REMOTE}" "${DEFAULT_BRANCH}" 2>/dev/null || true
      local local_head remote_head
      local_head="$(git -C "${ROOT}" rev-parse HEAD 2>/dev/null || true)"
      remote_head="$(git -C "${ROOT}" rev-parse "${REMOTE}/${DEFAULT_BRANCH}" 2>/dev/null || true)"
      if [ -n "${local_head}" ] && [ -n "${remote_head}" ] && [ "${local_head}" != "${remote_head}" ]; then
        say "🔄 自动同步：主工作区落后于远端主干，正在自动拉取最新代码并物化..."
        if git -C "${ROOT}" pull --ff-only "${REMOTE}" "${DEFAULT_BRANCH}" 2>/dev/null; then
          auto_materialize_and_reload "${local_head}" "HEAD"
        fi
      elif [ -n "${remote_head}" ]; then
        local first_parent
        first_parent="$(git -C "${ROOT}" rev-parse "${remote_head}^1" 2>/dev/null || true)"
        if [ -n "${first_parent}" ]; then
          auto_materialize_and_reload "${first_parent}" "${remote_head}"
        else
          MATERIALIZE_STATUS="failed"
          say "⚠️ 无法确定本次合并的起点，开发版未更新。请在主检出运行: plugins/scripts/sync-to-app.sh"
        fi
      fi
    fi
  fi
}

cmd_prune() {
  say "git worktree prune"
  git worktree prune
  sag_collect_orphans
  echo
  echo "local branches merged into ${DEFAULT_BRANCH} (safe to delete):"
  if git rev-parse --verify --quiet "${DEFAULT_BRANCH}" >/dev/null 2>&1; then
    git for-each-ref --merged="${DEFAULT_BRANCH}" --format='%(refname:short)' \
      refs/heads/feat refs/heads/fix refs/heads/chore refs/heads/agent refs/heads/codex 2>/dev/null \
      | sed 's/^/  - /' || echo "  (none)"
  fi
  echo
  cmd_list
}

cmd_clean() {
  local force=0 pr_number=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=1 ;;
      --pr) shift; pr_number="${1:-}" ;;
    esac
    shift
  done

  say "fetch ${REMOTE} (sweep against default branch: ${DEFAULT_BRANCH})"
  git fetch "${REMOTE}" --prune 2>/dev/null || true

  local merged=""
  if git rev-parse --verify --quiet "${REMOTE}/${DEFAULT_BRANCH}" >/dev/null 2>&1; then
    merged="$(git for-each-ref --merged="${REMOTE}/${DEFAULT_BRANCH}" --format='%(refname:short)' refs/heads)"
  elif git rev-parse --verify --quiet "${DEFAULT_BRANCH}" >/dev/null 2>&1; then
    merged="$(git for-each-ref --merged="${DEFAULT_BRANCH}" --format='%(refname:short)' refs/heads)"
  else
    die "cannot resolve default branch: ${DEFAULT_BRANCH}"
  fi

  local wt="" branch=""
  while IFS= read -r line; do
    case "${line}" in
      worktree*)
        if [ -n "${wt}" ]; then clean_one "${wt}" "${branch}" "${merged}"; fi
        wt="${line#worktree }"
        branch=""
        ;;
      branch*)
        branch="${line#branch refs/heads/}"
        ;;
      detached)
        branch=""
        ;;
    esac
  done < <(git worktree list --porcelain)
  if [ -n "${wt}" ]; then clean_one "${wt}" "${branch}" "${merged}"; fi

  # Check orphans in .worktrees
  local registered="" orphans=0
  if [ -d "${WT_DIR}" ]; then
    while IFS= read -r line; do
      case "${line}" in
        worktree*) registered="${registered}${line#worktree }
" ;;
      esac
    done < <(git worktree list --porcelain)
    for d in "${WT_DIR}"/*; do
      [ -e "${d}" ] || continue
      if ! printf '%s\n' "${registered}" | grep -Fqx "${d}"; then
        echo "  - orphan directory: ${d#${ROOT}/}"
        orphans=$((orphans+1))
      fi
    done
  fi

  git worktree prune
  sag_collect_orphans
  say "clean sweep finished. Orphan directories: ${orphans}"
}

clean_one() {
  local wt="$1" branch="$2" merged_list="$3"
  if [ "${wt}" = "${ROOT}" ]; then return 0; fi

  # Clean inside .worktrees/ OR legacy sibling directories
  local is_canonical=0
  case "${wt}" in
    "${WT_DIR}"/*) is_canonical=1 ;;
    *"$(basename "${ROOT}")-wt-"*) is_canonical=0 ;;
    *) return 0 ;;
  esac

  if [ -z "${branch}" ]; then return 0; fi

  if ! printf '%s\n' "${merged_list}" | grep -qx "${branch}"; then
    return 0
  fi

  if [ -n "$(git -C "${wt}" status --porcelain 2>/dev/null)" ]; then
    say "skip ${wt}: uncommitted changes (use: worktree.sh remove <task> --discard)"
    return 0
  fi

  say "removing merged worktree: ${wt} (branch: ${branch})"
  git worktree remove "${wt}" 2>/dev/null || rm -rf "${wt}"
  git branch -d "${branch}" 2>/dev/null || true
  sag_forget_worktree "${wt}"
}

cmd_rescue_primary() {
  local task="" do_sync=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --task)
        shift
        [ $# -gt 0 ] || die "missing argument for --task"
        task="$1"
        ;;
      --task=*)
        task="${1#--task=}"
        [ -n "${task}" ] || die "missing argument for --task"
        ;;
      --no-sync)
        do_sync=0
        ;;
      --discard | --force | --abandon)
        die "rescue-primary never drops changes; refusing destructive flag: $1"
        ;;
      *)
        die "unknown flag for rescue-primary: $1"
        ;;
    esac
    shift
  done

  command -v node >/dev/null 2>&1 || die "node is required for rescue-primary"

  # 清洗可能污染主检出判断的环境变量（与 sync-main.sh 口径一致），并拒绝通过
  # WORKTREE_REMOTE / WORKTREE_DEFAULT_BRANCH 绕过远端与默认分支校验。
  local _git_var
  for _git_var in $(env | awk -F= '/^GIT_/{print $1}'); do
    unset "${_git_var}"
  done
  unset WORKTREE_REMOTE WORKTREE_DEFAULT_BRANCH

  local rescue_root rescue_git_common rescue_primary_root rescue_wt_dir
  rescue_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "${rescue_root}" ] || die "rescue-primary must run inside a git work tree"
  rescue_git_common="$(git -C "${rescue_root}" rev-parse --git-common-dir 2>/dev/null || echo "${rescue_root}/.git")"
  case "${rescue_git_common}" in
    /*) : ;;
    *) rescue_git_common="${rescue_root}/${rescue_git_common}" ;;
  esac
  rescue_primary_root="$(cd -P "$(dirname "${rescue_git_common}")" 2>/dev/null && pwd -P || echo "${rescue_root}")"
  rescue_wt_dir="${rescue_primary_root}/.worktrees"

  local rescue_remote rescue_default_branch
  rescue_remote="$(cd "${rescue_primary_root}" && detect_remote)"
  rescue_default_branch="$(cd "${rescue_primary_root}" && REMOTE="${rescue_remote}" ROOT="${rescue_primary_root}" detect_default_branch)"

  local primary_branch
  primary_branch="$(git -C "${rescue_primary_root}" symbolic-ref --short HEAD 2>/dev/null || true)"
  if [ "${primary_branch}" != "${rescue_default_branch}" ]; then
    die "primary checkout must be on default branch (${rescue_default_branch}) for rescue-primary; got: ${primary_branch:-detached}"
  fi

  local primary_git_dir
  primary_git_dir="$(git -C "${rescue_primary_root}" rev-parse --git-dir 2>/dev/null || true)"
  [ -n "${primary_git_dir}" ] || die "cannot resolve primary .git directory"
  case "${primary_git_dir}" in
    /*) : ;;
    *) primary_git_dir="${rescue_primary_root}/${primary_git_dir}" ;;
  esac

  local sentinel
  for sentinel in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG rebase-merge rebase-apply; do
    if [ -e "${primary_git_dir}/${sentinel}" ]; then
      die "primary checkout has an in-progress git operation (${sentinel}); resolve manually before rescuing"
    fi
  done

  if [ -n "$(git -C "${rescue_primary_root}" ls-files -u 2>/dev/null || true)" ]; then
    die "primary checkout has unmerged conflict entries; resolve manually before rescuing"
  fi

  local has_remote=0
  if git -C "${rescue_primary_root}" remote 2>/dev/null | grep -Fqx "${rescue_remote}"; then
    has_remote=1
    if ! git -C "${rescue_primary_root}" fetch --no-tags "${rescue_remote}" "${rescue_default_branch}" 2>/dev/null; then
      if [ "${do_sync}" -eq 1 ]; then
        die "cannot fetch ${rescue_remote}/${rescue_default_branch}; refusing to rescue and sync primary checkout"
      fi
      say "warning: git fetch ${rescue_remote} ${rescue_default_branch} failed; continuing with --no-sync"
    fi
  fi

  if [ "${has_remote}" -eq 1 ] && git -C "${rescue_primary_root}" rev-parse --verify --quiet "refs/remotes/${rescue_remote}/${rescue_default_branch}^{commit}" >/dev/null 2>&1; then
    local ahead_count
    ahead_count="$(git -C "${rescue_primary_root}" rev-list --count "refs/remotes/${rescue_remote}/${rescue_default_branch}..HEAD" 2>/dev/null || echo "")"
    if [ -z "${ahead_count}" ]; then
      die "cannot determine ahead commit count against ${rescue_remote}/${rescue_default_branch}; refusing to touch primary"
    fi
    if [ "${ahead_count}" -gt 0 ]; then
      die "primary checkout has ${ahead_count} unpushed local commit(s) ahead of ${rescue_remote}/${rescue_default_branch}; refusing to rescue"
    fi
  fi

  local primary_state=0
  omnimux_primary_is_clean "${rescue_primary_root}" || primary_state=$?
  if [ "${primary_state}" -eq 2 ]; then
    die "cannot read primary checkout status; refusing to rescue"
  fi
  if [ "${primary_state}" -eq 0 ]; then
    if [ "${do_sync}" -eq 1 ] && [ "${has_remote}" -eq 1 ] && git -C "${rescue_primary_root}" rev-parse --verify --quiet "refs/remotes/${rescue_remote}/${rescue_default_branch}^{commit}" >/dev/null 2>&1; then
      git -C "${rescue_primary_root}" merge --ff-only "refs/remotes/${rescue_remote}/${rescue_default_branch}"
    fi
    local clean_head
    clean_head="$(git -C "${rescue_primary_root}" rev-parse HEAD)"
    say "primary checkout is already clean (no blocking dirty changes to rescue)."
    echo "RESCUE_STATUS=already-clean"
    echo "PRIMARY_HEAD=${clean_head}"
    return 0
  fi

  if [ -z "${task}" ]; then
    local stamp suffix=0 candidate
    stamp="rescue-primary-$(date +%Y%m%d-%H%M%S)"
    candidate="${stamp}"
    while [ -e "${rescue_wt_dir}/${candidate}" ] || git -C "${rescue_primary_root}" show-ref --verify --quiet "refs/heads/chore/${candidate}"; do
      suffix=$((suffix + 1))
      candidate="${stamp}-${suffix}"
      [ "${suffix}" -lt 100 ] || die "cannot allocate unique rescue task name for ${stamp}"
    done
    task="${candidate}"
  fi
  validate_task "${task}"

  local branch="chore/${task}"
  local wt="${rescue_wt_dir}/${task}"
  [ -e "${wt}" ] && die "rescue worktree already exists: ${wt#${rescue_primary_root}/}"
  if git -C "${rescue_primary_root}" show-ref --verify --quiet "refs/heads/${branch}"; then
    die "rescue branch already exists: ${branch}"
  fi

  local primary_head
  primary_head="$(git -C "${rescue_primary_root}" rev-parse HEAD)"
  mkdir -p "${rescue_wt_dir}"

  say "creating isolated rescue worktree .worktrees/${task} from primary HEAD (${primary_head:0:8})"
  git -C "${rescue_primary_root}" worktree add -b "${branch}" "${wt}" "${primary_head}" || die "git worktree add failed for rescue-primary"

  local rescue_meta=""
  if ! rescue_meta="$(OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE="${OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE}" node -e '
    const { execFileSync } = require("node:child_process")
    const { createHash } = require("node:crypto")
    const {
      copyFileSync,
      lstatSync,
      mkdirSync,
      readdirSync,
      readFileSync,
      readlinkSync,
      rmSync,
      rmdirSync,
      symlinkSync,
      unlinkSync,
      writeFileSync,
      chmodSync,
    } = require("node:fs")
    const { dirname, join, resolve, sep } = require("node:path")

    const [primaryRoot, wtRoot, primaryHead] = process.argv.slice(1)
    const allowedUntrackedRe = new RegExp(process.env.OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE || "^$")

    function cleanGitEnv(baseEnv = process.env) {
      const env = {}
      for (const [k, v] of Object.entries(baseEnv)) {
        if (k.startsWith("GIT_")) continue
        env[k] = v
      }
      return env
    }

    function git(cwd, args, opts = {}) {
      return execFileSync("git", ["-C", cwd, ...args], {
        encoding: opts.buffer ? undefined : "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: opts.env || cleanGitEnv(),
      })
    }

    function gitOk(cwd, args) {
      try {
        execFileSync("git", ["-C", cwd, ...args], {
          stdio: "ignore",
          env: cleanGitEnv(),
        })
        return true
      } catch {
        return false
      }
    }

    function safeTargetPath(baseDir, relPath) {
      const rootAbs = resolve(baseDir)
      const abs = resolve(rootAbs, relPath)
      if (!abs.startsWith(rootAbs + sep)) {
        throw new Error(`unsafe relative path escaping worktree root: ${relPath}`)
      }
      return { rootAbs, abs }
    }

    function collectDirtyState() {
      const statusRaw = git(primaryRoot, [
        "-c", "core.quotepath=false",
        "status", "--porcelain=v1", "-z",
        "--untracked-files=no",
        "--ignore-submodules=all",
      ], { buffer: true })

      const entries = statusRaw.toString("utf8").split("\0")
      const trackedSet = new Set()
      const stagedEntries = []
      let hasStaged = false
      let hasUnstaged = false

      for (let i = 0; i < entries.length; i += 1) {
        const rec = entries[i]
        if (!rec) continue
        const x = rec[0] || " "
        const y = rec[1] || " "
        const p1 = rec.slice(3)
        if (!p1) continue
        if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
          throw new Error(`unmerged conflict entry detected: ${p1}`)
        }
        let p2 = null
        if (x === "R" || x === "C" || y === "R" || y === "C") {
          p2 = entries[i + 1] || ""
          i += 1
        }
        trackedSet.add(p1)
        if (p2) trackedSet.add(p2)
        if (x !== " " && x !== "?") {
          hasStaged = true
          stagedEntries.push({ x, y, p1, p2 })
        }
        if (y !== " " && y !== "?") {
          hasUnstaged = true
        }
      }

      const untrackedRaw = git(primaryRoot, [
        "-c", "core.quotepath=false",
        "ls-files", "--others", "--exclude-standard", "-z",
      ], { buffer: true })
      const blockingUntrackedSet = new Set()
      for (const rel of untrackedRaw.toString("utf8").split("\0")) {
        if (!rel) continue
        if (allowedUntrackedRe.test(rel)) continue
        blockingUntrackedSet.add(rel)
      }

      const indexRaw = git(primaryRoot, [
        "diff", "--cached", "--raw", "-z", "--ignore-submodules=all",
      ], { buffer: true })
      const indexHash = createHash("sha256").update(indexRaw).digest("hex")

      const allPaths = Array.from(new Set([...trackedSet, ...blockingUntrackedSet])).sort()
      return {
        trackedPaths: Array.from(trackedSet).sort(),
        blockingUntrackedPaths: Array.from(blockingUntrackedSet).sort(),
        allPaths,
        stagedEntries,
        hasStaged,
        hasUnstaged,
        indexHash,
      }
    }

    function fingerprintPath(baseDir, relPath, { allowReplacedByDir = false } = {}) {
      const { abs } = safeTargetPath(baseDir, relPath)
      let st
      try {
        st = lstatSync(abs)
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return { kind: "absent" }
        throw err
      }
      if (st.isSymbolicLink()) {
        return { kind: "symlink", target: readlinkSync(abs) }
      }
      if (st.isDirectory()) {
        // When a previously tracked file was replaced by a regular directory (file -> dir swap),
        // treat the old file path as absent while its child files are captured individually;
        // still refuse nested git repositories (presence of .git) or untracked directory entries.
        let hasNestedGit = false
        try {
          lstatSync(join(abs, ".git"))
          hasNestedGit = true
        } catch {}
        if (allowReplacedByDir && !hasNestedGit) {
          return { kind: "absent" }
        }
        throw new Error(`refusing to rescue directory entry directly (possible nested repo): ${relPath}`)
      }
      if (!st.isFile()) {
        throw new Error(`unsupported special file type at: ${relPath}`)
      }
      const data = readFileSync(abs)
      const sha256 = createHash("sha256").update(data).digest("hex")
      const execBit = (st.mode & 0o100) !== 0 ? 1 : 0
      return { kind: "file", execBit, sha256 }
    }

    function snapshotPaths(baseDir, paths, trackedPathSet) {
      const map = {}
      for (const rel of paths) {
        map[rel] = fingerprintPath(baseDir, rel, {
          allowReplacedByDir: trackedPathSet ? trackedPathSet.has(rel) : false,
        })
      }
      return map
    }

    function snapshotsEqual(a, b, paths) {
      for (const rel of paths) {
        const fa = a[rel]
        const fb = b[rel]
        if (!fa || !fb || fa.kind !== fb.kind) return false
        if (fa.kind === "symlink" && fa.target !== fb.target) return false
        if (fa.kind === "file" && (fa.execBit !== fb.execBit || fa.sha256 !== fb.sha256)) return false
      }
      return true
    }

    function removeFileAndEmptyParents(baseDir, relPath) {
      const { rootAbs, abs } = safeTargetPath(baseDir, relPath)
      try {
        const st = lstatSync(abs)
        if (st.isDirectory()) {
          rmSync(abs, { recursive: true, force: true })
        } else {
          unlinkSync(abs)
        }
      } catch (err) {
        if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) throw err
      }
      let dir = dirname(abs)
      while (dir !== rootAbs && dir.startsWith(rootAbs + sep)) {
        try {
          if (readdirSync(dir).length === 0) {
            rmdirSync(dir)
            dir = dirname(dir)
          } else {
            break
          }
        } catch {
          break
        }
      }
    }

    function prepareWriteTarget(baseDir, relPath) {
      const { rootAbs, abs } = safeTargetPath(baseDir, relPath)
      // If any ancestor component is currently a regular file or symlink (file -> dir replacement), remove it first.
      const parts = relPath.split("/").filter(Boolean)
      let cur = rootAbs
      for (let i = 0; i < parts.length - 1; i += 1) {
        cur = join(cur, parts[i])
        try {
          const st = lstatSync(cur)
          if (!st.isDirectory()) unlinkSync(cur)
        } catch (err) {
          if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) throw err
        }
      }
      mkdirSync(dirname(abs), { recursive: true })
      try {
        const st = lstatSync(abs)
        if (st.isDirectory()) {
          rmSync(abs, { recursive: true, force: true })
        } else {
          unlinkSync(abs)
        }
      } catch (err) {
        if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) throw err
      }
      return abs
    }

    function writeFileFromPrimary(relPath) {
      const { abs: src } = safeTargetPath(primaryRoot, relPath)
      const st = lstatSync(src)
      const dst = prepareWriteTarget(wtRoot, relPath)
      if (st.isSymbolicLink()) {
        symlinkSync(readlinkSync(src), dst)
      } else {
        copyFileSync(src, dst)
        chmodSync(dst, (st.mode & 0o100) !== 0 ? 0o755 : 0o644)
      }
    }

    function commitEnvFor(cwd) {
      const env = cleanGitEnv()
      const hasName = gitOk(cwd, ["config", "--get", "user.name"])
      const hasEmail = gitOk(cwd, ["config", "--get", "user.email"])
      if (!hasName) {
        env.GIT_AUTHOR_NAME = env.GIT_AUTHOR_NAME || "omnimux-rescue"
        env.GIT_COMMITTER_NAME = env.GIT_COMMITTER_NAME || "omnimux-rescue"
      }
      if (!hasEmail) {
        env.GIT_AUTHOR_EMAIL = env.GIT_AUTHOR_EMAIL || "rescue@omnimux.local"
        env.GIT_COMMITTER_EMAIL = env.GIT_COMMITTER_EMAIL || "rescue@omnimux.local"
      }
      return env
    }

    function stageAndCommitIfNeeded(paths, message) {
      if (paths.length === 0) return false
      const actionPaths = paths.filter((rel) => {
        try {
          lstatSync(safeTargetPath(wtRoot, rel).abs)
          return true
        } catch {
          return gitOk(wtRoot, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", rel])
        }
      })
      if (actionPaths.length === 0) return false
      git(wtRoot, ["--literal-pathspecs", "add", "-f", "-A", "--", ...actionPaths])
      const hasCached = !gitOk(wtRoot, ["diff", "--cached", "--quiet", "--ignore-submodules=all"])
      if (!hasCached) return false
      git(wtRoot, [
        "-c", "commit.gpgsign=false",
        "-c", "core.hooksPath=/dev/null",
        "commit", "--no-verify", "-m", message,
      ], { env: commitEnvFor(wtRoot) })
      return true
    }

    const initial = collectDirtyState()
    if (initial.allPaths.length === 0) {
      throw new Error("no blocking dirty paths found during rescue snapshot")
    }
    const trackedPathSet = new Set(initial.trackedPaths)
    const snap1 = snapshotPaths(primaryRoot, initial.allPaths, trackedPathSet)

    let commitCount = 0
    // Always capture staged index state first whenever any staged entry exists.
    // Two-pass replay (deletions then writes) avoids chained-rename collisions and file<->dir EISDIR.
    // If working tree matches index identically, the second commit step becomes a no-op (1 commit total).
    if (initial.hasStaged) {
      const stagedPaths = new Set()
      for (const entry of initial.stagedEntries) {
        stagedPaths.add(entry.p1)
        if (entry.p2) stagedPaths.add(entry.p2)
      }
      // Pass 1: deletions (D entries and R source paths)
      for (const entry of initial.stagedEntries) {
        if (entry.p2 && entry.x === "R") {
          removeFileAndEmptyParents(wtRoot, entry.p2)
        }
        if (entry.x === "D") {
          removeFileAndEmptyParents(wtRoot, entry.p1)
        }
      }
      // Pass 2: writes from primary index (:0:<path>)
      for (const entry of initial.stagedEntries) {
        if (entry.x === "D") continue
        const lsOut = git(primaryRoot, ["--literal-pathspecs", "ls-files", "--stage", "--", entry.p1]).trim()
        const firstLine = lsOut.split("\n")[0] || ""
        const mode = firstLine.split(/\s+/)[0] || "100644"
        const blob = git(primaryRoot, ["show", `:0:${entry.p1}`], { buffer: true })
        const dst = prepareWriteTarget(wtRoot, entry.p1)
        if (mode === "120000") {
          symlinkSync(blob.toString("utf8"), dst)
        } else {
          writeFileSync(dst, blob)
          chmodSync(dst, mode === "100755" ? 0o755 : 0o644)
        }
      }
      if (stageAndCommitIfNeeded(Array.from(stagedPaths).sort(), "chore(rescue): capture staged primary checkout changes")) {
        commitCount += 1
      }
    }

    // Two-pass working-tree replay: Pass 1 deletions, Pass 2 writes.
    for (const rel of initial.allPaths) {
      if (snap1[rel].kind === "absent") {
        removeFileAndEmptyParents(wtRoot, rel)
      }
    }
    for (const rel of initial.allPaths) {
      if (snap1[rel].kind !== "absent") {
        writeFileFromPrimary(rel)
      }
    }
    if (stageAndCommitIfNeeded(initial.allPaths, commitCount > 0
      ? "chore(rescue): capture working-tree primary checkout changes"
      : "chore(rescue): capture uncommitted primary checkout changes")) {
      commitCount += 1
    }

    if (commitCount === 0) {
      throw new Error("rescue worktree produced zero commits; refusing to clean primary checkout")
    }

    // Verification 1: rescued worktree matches Snapshot 1 byte-for-byte (including mode & symlink)
    const wtSnap = snapshotPaths(wtRoot, initial.allPaths, trackedPathSet)
    if (!snapshotsEqual(snap1, wtSnap, initial.allPaths)) {
      throw new Error("post-copy checksum mismatch between primary snapshot and rescue worktree; aborting cleanup")
    }

    // Verification 2: rescued worktree has zero uncommitted/untracked remnants
    const wtStatus = git(wtRoot, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=all"]).trim()
    if (wtStatus) {
      throw new Error(`rescue worktree is not clean after commit (${wtStatus}); aborting cleanup`)
    }

    // Verification 3: primary checkout had zero concurrent HEAD, index, or file edits during rescue
    const currentHead = git(primaryRoot, ["rev-parse", "HEAD"]).trim()
    if (currentHead !== primaryHead) {
      throw new Error(`primary checkout HEAD moved concurrently (${primaryHead} -> ${currentHead}); aborting cleanup`)
    }
    const after = collectDirtyState()
    if (after.indexHash !== initial.indexHash) {
      throw new Error("primary checkout staged index changed concurrently during rescue; aborting cleanup")
    }
    if (
      after.allPaths.length !== initial.allPaths.length ||
      after.allPaths.some((p, idx) => p !== initial.allPaths[idx])
    ) {
      throw new Error("primary checkout dirty file set changed concurrently during rescue; aborting cleanup")
    }
    const snap2 = snapshotPaths(primaryRoot, initial.allPaths, trackedPathSet)
    if (!snapshotsEqual(snap1, snap2, initial.allPaths)) {
      throw new Error("primary checkout file contents changed concurrently during rescue; aborting cleanup")
    }

    // Cleanup primary checkout strictly for the verified rescued paths.
    // Remove newly added/untracked paths before `git checkout HEAD` so file<->dir replacements succeed cleanly.
    const inHead = []
    const notInHead = []
    if (initial.trackedPaths.length > 0) {
      git(primaryRoot, ["--literal-pathspecs", "reset", "-q", "HEAD", "--", ...initial.trackedPaths])
      for (const rel of initial.trackedPaths) {
        if (gitOk(primaryRoot, ["cat-file", "-e", `${primaryHead}:${rel}`])) {
          inHead.push(rel)
        } else {
          notInHead.push(rel)
        }
      }
      for (const rel of notInHead) {
        removeFileAndEmptyParents(primaryRoot, rel)
      }
    }
    for (const rel of initial.blockingUntrackedPaths) {
      if (trackedPathSet.has(rel)) continue
      removeFileAndEmptyParents(primaryRoot, rel)
    }
    if (inHead.length > 0) {
      git(primaryRoot, ["--literal-pathspecs", "checkout", "-q", "HEAD", "--", ...inHead])
    }

    const rescueCommit = git(wtRoot, ["rev-parse", "HEAD"]).trim()
    process.stdout.write(JSON.stringify({
      rescueCommit,
      commitCount,
      files: initial.allPaths,
    }))
  ' "${rescue_primary_root}" "${wt}" "${primary_head}")"; then
    # If aborted before producing any rescue commit and worktree is empty, remove the empty shell cleanly.
    if [ -d "${wt}" ]; then
      local wt_head wt_dirty
      wt_head="$(git -C "${wt}" rev-parse HEAD 2>/dev/null || true)"
      wt_dirty="$(git -C "${wt}" status --porcelain 2>/dev/null || true)"
      if [ "${wt_head}" = "${primary_head}" ] && [ -z "${wt_dirty}" ]; then
        git -C "${rescue_primary_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
        git -C "${rescue_primary_root}" branch -D "${branch}" 2>/dev/null || true
        git -C "${rescue_primary_root}" worktree prune 2>/dev/null || true
        die "rescue-primary aborted before cleaning primary checkout (cleaned empty shell worktree)"
      fi
    fi
    die "rescue-primary aborted before cleaning primary checkout; inspect preserved worktree at ${wt#${rescue_primary_root}/}"
  fi

  local post_state=0
  omnimux_primary_is_clean "${rescue_primary_root}" || post_state=$?
  if [ "${post_state}" -ne 0 ]; then
    die "primary checkout is still not clean after rescue-primary cleanup; inspect ${rescue_primary_root} and ${wt#${rescue_primary_root}/}"
  fi

  local sync_status=0
  if [ "${do_sync}" -eq 1 ] && [ "${has_remote}" -eq 1 ] && git -C "${rescue_primary_root}" rev-parse --verify --quiet "refs/remotes/${rescue_remote}/${rescue_default_branch}^{commit}" >/dev/null 2>&1; then
    say "fast-forwarding primary ${rescue_default_branch} to ${rescue_remote}/${rescue_default_branch}..."
    git -C "${rescue_primary_root}" merge --ff-only "refs/remotes/${rescue_remote}/${rescue_default_branch}" || sync_status=$?
  fi

  local new_primary_head
  new_primary_head="$(git -C "${rescue_primary_root}" rev-parse HEAD)"

  local summary
  summary="$(node -e '
    const { execFileSync } = require("node:child_process")
    const [primaryRoot, remoteRef, metaJson] = process.argv.slice(1)
    const meta = JSON.parse(metaJson)
    let triageHint = "inspect-required"
    if (remoteRef && meta.commitCount === 1) {
      try {
        execFileSync("git", ["-C", primaryRoot, "rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`], { stdio: "ignore" })
        try {
          execFileSync("git", ["-C", primaryRoot, "--literal-pathspecs", "diff", "--quiet", meta.rescueCommit, remoteRef, "--", ...meta.files], { stdio: "ignore" })
          triageHint = "type-0-identical-to-origin-main"
        } catch {
          triageHint = "inspect-required"
        }
      } catch {
        triageHint = "inspect-required"
      }
    }
    console.log(`RESCUE_COMMIT=${meta.rescueCommit}`)
    console.log(`RESCUE_COMMITS=${meta.commitCount}`)
    console.log(`RESCUE_FILES=${meta.files.length}`)
    console.log(`TRIAGE_HINT=${triageHint}`)
    for (const f of meta.files) console.log(`RESCUE_FILE=${f}`)
  ' "${rescue_primary_root}" "$([ "${has_remote}" -eq 1 ] && echo "refs/remotes/${rescue_remote}/${rescue_default_branch}" || echo "")" "${rescue_meta}")"

  if [ "${sync_status}" -ne 0 ]; then
    say "⚠️ 主检出脏改动已安全迁出并清理，但 ff-only 同步失败（可能存在未跟踪草稿与远端新增文件碰撞）；迁出结果如下："
  else
    say "✅ 主检出阻断性脏改动已原子迁出并校验一致，主目录已清理并恢复干净。"
  fi
  echo "RESCUE_STATUS=$([ "${sync_status}" -eq 0 ] && echo "rescued" || echo "rescued-sync-failed")"
  echo "RESCUE_WORKTREE=.worktrees/${task}"
  echo "RESCUE_BRANCH=${branch}"
  echo "RESCUE_BASE=${primary_head}"
  echo "PRIMARY_HEAD=${new_primary_head}"
  printf '%s\n' "${summary}"
  [ "${sync_status}" -eq 0 ] || return "${sync_status}"
}

usage() {
  cat <<EOF
worktree.sh — Universal Git worktree lifecycle management.
Enhanced for OmniMux DSH Plugin & Multi-Agent Collaboration.

Remote:         ${REMOTE}
Default Branch: ${DEFAULT_BRANCH}

Usage:
  worktree.sh init                           create .worktrees/ and configure .gitignore
  worktree.sh new <task> [base] [--type ...] create .worktrees/<task>
  worktree.sh auto-new <issue_id>            fetch GitHub Issue and create worktree automatically
  worktree.sh list                           show active worktrees and dirty counts
  worktree.sh audit                          list merged worktrees safe to clean (read-only)
  worktree.sh rescue-primary [--task <name>] [--no-sync] atomically move blocking primary dirty changes into an isolated worktree, verify, clean primary, and ff-only sync
  worktree.sh ship <task> --pr <num> [--keep-worktree] verify matching PR MERGED, sync ${DEFAULT_BRANCH}, materialize Dev, and clean worktree
  worktree.sh remove <task> [flags]          safely remove worktree (--discard, --abandon, --pr <num>)
  worktree.sh prune                          drop stale worktree records & list safe-to-delete branches
  worktree.sh clean                          batch clean merged & clean worktrees
  worktree.sh help

Flags (rescue-primary):
  --task <name>    explicit ASCII kebab-case task name for .worktrees/<name>
  --no-sync        skip trailing git pull --ff-only after rescuing and cleaning primary

Flags (ship):
  --keep-worktree  preserve worktree directory and branch after successful merge and materialization

Flags (remove / clean):
  --discard   drop uncommitted dirty changes
  --abandon   drop unmerged branch
  --force     combine --discard and --abandon
  --pr <num>  verify GitHub PR is MERGED before removal
EOF
}

# -----------------------------------------------------------------------------
# Dispatcher
# -----------------------------------------------------------------------------

cmd="${1:-}"
shift || true
case "${cmd}" in
  init)           cmd_init ;;
  new)            [ "$#" -ge 1 ] || die "usage: worktree.sh new <task> [base] [--type feat|fix|chore|agent] [--issue <id>]"; cmd_new "$@" ;;
  auto-new)       [ "$#" -ge 1 ] || die "usage: worktree.sh auto-new <issue_id>"; cmd_auto_new "$@" ;;
  list)           cmd_list ;;
  audit)          audit_worktrees ;;
  rescue-primary) cmd_rescue_primary "$@" ;;
  ship)           [ "$#" -ge 1 ] || die "usage: worktree.sh ship <task> --pr <num> [--keep-worktree]"; cmd_ship "$@" ;;
  finish)         [ "$#" -ge 1 ] || die "usage: worktree.sh ship <task> --pr <num> [--keep-worktree]"; cmd_ship "$@" ;;
  remove)         [ "$#" -ge 1 ] || die "usage: worktree.sh remove <task> [--discard] [--abandon] [--pr <num>]"; cmd_remove "$@" ;;
  prune)          cmd_prune ;;
  clean)          cmd_clean "$@" ;;
  help | -h | --help) usage ;;
  "")             usage; exit 1 ;;
  *)              die "unknown command: ${cmd} (see: worktree.sh help)" ;;
esac
