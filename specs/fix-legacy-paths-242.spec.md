# Issue #242 Batch 1：公开仓遗留路径与脚本清理

## 背景

公开仓的 `app/.github/` 嵌套目录已不再被 GitHub Actions 读取，其中仍保留过期分支与历史私有 fork 引用；另有若干开发辅助脚本仍指向已不存在的旧目录/旧分支或本机用户路径，需要按 Issue #242 Batch 1 清理并补回归验证。

## 假设

- `app/.github/` 只包含历史 workflow、issue 模板和 dependabot 配置，根 `.github/workflows/`、构建脚本与测试均不读取它，删除后不影响任何 CI 或本地构建。
- `app/scripts/sync-upstream.sh` 的同步基线应为当前仓库的 `main..origin/main`，决策日志为 `app/docs/contracts/upstream-sync-log.md`。
- 两个 cordis/smoke 脚本可从仓库根自动解析 `app/deepseek-harness`，子模块缺失时应显式报错，而不是回退到不存在的外部绝对路径。
- 两个 `ui-audit` 旧路径脚本及其一次性依赖在 CI、npm scripts 和测试中无引用，可安全移除。
- 各 worktree 守卫与文档中的旧仓名 marker 应统一为本仓名；`plugins/package.json` 的既有包名 sentinel 保持不变。

## 证伪方式

- `node --test plugins/scripts/legacy-paths-242.test.mjs`：任一文件未删除、脚本仍含旧分支/旧文档路径、仍含本机用户路径或旧仓名 marker，均会真实断言失败。
- `bash -n app/scripts/sync-upstream.sh` 与 `git rev-list --count main..origin/main`（在 `app/` 下）均须 exit 0；缺少 `origin/main` 或参数错误会转红。
- `DSH_SRC=<不存在目录> node plugins/scripts/verify-cordis-propagate.mjs` 必须 exit 1 并输出明确的缺失路径错误。
- `corepack pnpm --dir plugins run test:gates`、`node scripts/workspace-check.mjs --check`、`node scripts/bundle-lock.mjs --check`、`gitleaks` 与 `git diff --check` 全部通过；任一失败都说明 Batch 1 未收口。

## 旧标准变更

- `plugins/scripts/git-wt.test.mjs` :: `exists and is executable`
  - 原断言：sibling worktree 目录命名必须包含旧仓名前缀。
  - 必须改的理由：`plugins/scripts/git-wt.sh` 的旧仓名 marker 已统一到当前 `omnimux-client` 工作树口径，worktree 统一落到 `<repo>/.worktrees/`，测试必须跟随新命名契约。
  - 新期望证据：`content.includes('worktree_dir') && content.includes('/.worktrees/') === true`，并且同一测试仍校验 shebang、分支命名、Issue 绑定与 finish 子命令。

- `app/dsh-plugin-desktop/tests/package.spec.ts` :: `runs platform package gates before reusing native packaging outputs`
  - 原断言：从 `app/.github/workflows/ci.yml` 读取并断言历史 `desktop-windows: / desktop-macos: / macos-universal:` 三个 job。
  - 必须改的理由：该嵌套历史目录按 Issue #242 删除，GitHub Actions 从未读取它；当前发布 workflow 是根 `.github/workflows/release.yml`，只构建 `dsh-desktop-next`。
  - 新期望证据：从根 release workflow 读取 `build-win:` / `preflight-mac:`，断言 `corepack yarn workspace dsh-desktop-next dist:win`、`dist:mac-smoke`、`DSH_MAC_SMOKE_ARCH: ${{ matrix.arch }}`，且无 `desktop-linux:` job。

- `app/dsh-plugin-desktop/tests/package.spec.ts` :: `gates packaging on product changes and always runs the baseline check`
  - 原断言：额外从已删除的历史 workflow 读取 `classify-ci-changes` 调用与 `check:` job。
  - 必须改的理由：同样依赖已删除的 `app/.github/workflows/ci.yml`；当前根 workflow 不含该历史 job 结构，保留会永久 ENOENT。
  - 新期望证据：`classify-ci-changes.mjs` 的产品/打包分类断言全部保留，并新增当前 `release.yml` 的 Windows/macOS 构建步骤断言。

