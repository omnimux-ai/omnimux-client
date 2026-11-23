# Spec: 清理 worktree 工具中的 omnimux-dsh 残留路径

- 任务：`cleanup-legacy-worktree-paths`
- 日期：2026-11-24
- 风险：低（仅开发期 worktree 工具与守卫；不改变产品运行时）

## 背景

`omnimux-client` 已合并为客户端单仓，但 `plugins/scripts/git-wt.sh` 仍按旧单产品仓习惯把 worktree 创建为 `<repo>/omnimux-dsh-wt-<task>`，`plugins/scripts/guard-worktree.mjs` 也仍以 `/omnimux-dsh/` 作为主仓路径标记。两者都会在单仓下产生错误的路径语义，前者还会污染仓根目录。

## 目标

1. `git-wt.sh` 统一在 `<repo>/.worktrees/<task>` 创建、定位和清理 worktree，不再拼接 `omnimux-dsh-wt-*`。
2. `guard-worktree.mjs` 的路径标记改为 `omnimux-client`，并保留既有 worktree 元数据校验和主检出保护行为。
3. 更新对应测试夹具与断言，覆盖新的 worktree 目录布局。

## 非目标

- 不改 `worktree.sh` 的现有行为。
- 不改产品插件、桌面壳或运行时产物；不涉及 Dev 物化。

## 研究依据

- 仓库规则要求任务 worktree 位于 `<repo>/.worktrees/<task>`（根 `AGENTS.md` 硬约束 1）。
- `plugins/scripts/worktree.sh` 已是该布局的规范入口；`git-wt.sh` 是其遗留的并行入口。
- `plugins/scripts/guard-worktree.mjs` 的 `isWorktreePath()` 已按 Git worktree 元数据判断目录，不依赖目录名；仅路径标记字符串仍残留旧仓名。

## 验收标准

- `git-wt.sh start` 在 `<repo>/.worktrees/<task>` 创建 worktree；`finish`/`clean` 能从同一路径定位并清理。
- `git-wt.sh` 与 `guard-worktree.mjs` 中不再出现 `omnimux-dsh` 路径片段。
- `node --test plugins/scripts/git-wt.test.mjs plugins/scripts/guard-worktree.test.mjs plugins/scripts/guard-worktree.qa.test.mjs` 全部通过。
- `bash -n plugins/scripts/git-wt.sh` 与 `node --check plugins/scripts/guard-worktree.mjs` 通过。

## 假设

- 现有调用方都从仓库内运行 `git-wt.sh`，因此 `git rev-parse --show-toplevel` 能稳定得到仓库根。
- 测试中的临时仓库会像真实仓库一样把 `.worktrees/` 加入 `.gitignore`，避免自身被当成主仓脏改动。

## 证伪方式

- 在临时仓库执行 `git-wt.sh start`，若 worktree 路径不是 `<repo>/.worktrees/<task>` 即失败。
- 全文检索两个目标脚本，若仍含 `omnimux-dsh` 即失败。
- 回退目标改动后，更新后的测试应因路径断言失败；恢复后应全绿。

## 旧标准变更

- `plugins/scripts/git-wt.test.mjs` :: `exists and is executable`
  - 原断言：脚本内容包含 `omnimux-dsh-wt-`。
  - 必须改的理由：worktree 根目录契约改为 `<repo>/.worktrees/<task>`，旧字符串必须消失。
  - 新期望证据：脚本包含 `worktree_dir` 与 `/.worktrees/`，测试通过。
- `plugins/scripts/git-wt.test.mjs` :: `aborts finish when worktree has uncommitted dirty changes`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。
- `plugins/scripts/git-wt.test.mjs` :: `aborts finish when gate test fails, keeping worktree intact for debugging`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。
- `plugins/scripts/git-wt.test.mjs` :: `pushes the feature branch only — never merges into local main or deletes the worktree before MERGED`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。
- `plugins/scripts/git-wt.test.mjs` :: `supports finish flags (--skip-test, --skip-sync, --skip-push) without merging or destroying the sandbox`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。
- `plugins/scripts/git-wt.test.mjs` :: `finish retains a merged task for post-merge Dev acceptance`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。
- `plugins/scripts/git-wt.test.mjs` :: `clean honors --force even without an issue_id (arg parsing regression)`
  - 原断言：worktree 目录为 `join(testRoot, 'omnimux-dsh-wt-<task>')`。
  - 必须改的理由：目录改为 `join(mainRepo, '.worktrees', '<task>')`，否则测试仍验证旧路径。
  - 新期望证据：按新路径通过。

## 验证

- `bash -n plugins/scripts/git-wt.sh`
- `node --check plugins/scripts/guard-worktree.mjs`
- `node --test plugins/scripts/git-wt.test.mjs plugins/scripts/guard-worktree.test.mjs plugins/scripts/guard-worktree.qa.test.mjs`

## 文档影响

- 仅工具脚本与测试；无产品文档变化。
