# 主检出根目录默认拒绝（Default-Deny）、测试零自污染与隔离物化加固

## 背景与目标

多 Agent 并发协作时，主检出（primary checkout）必须保持干净的 `origin/main` 只读镜像，以便随时 `git pull --ff-only` 与执行物化同步。既有防线暴露了四类根因漏洞：

1. **黑名单结构漂移**：`plugins/scripts/guard-worktree.mjs` 通过 `PROTECTED_DIR_PREFIXES` 与 `PROTECTED_ROOT_FILES` 枚举受保护目录，漏掉仓库根下大量已跟踪目录（如 `app/`、`specs/`、`ui-demo/`、`bundle.lock.json`、`dsh-version.json`）以及未来新增目录；同时放行 `ephemeral` 与 `gitignored` 路径，导致 `.tmp/`、`.agent-reports/`、`dist/` 等副产物在主检出持续堆积。
2. **执行器绕过与只读误杀**：`unwrapExecutionWrapper` 未解包 `corepack`、`env` 与前缀环境变量，`build:*`/`compile:*`/`bundle:*`/`package:*` 未被识别，且 `isFrozenInstall` 漏认 Yarn 4 `--immutable`；同时 `isMaterializationCommand` 仅按整条命令首词豁免只读工具，导致多行命令中的 `grep ... sync-to-app.sh` 被误杀为物化命令。
3. **测试自写仓内与 CI 缺禁跟踪门禁**：除 PR #247 已修复的 `chat-media-gallery-rail-height.e2e.test.js` 与 `dev-smoke.mjs` 外，仓库内仍有 9 个测试直接向 `.agent-reports/`、`docs/evidence/` 或 `.tmp/` 写文件/建空目录，且 CI 门禁 `check-tracked-artifacts.mjs` 尚未拦截 `.agent-reports/**` 与 `docs/evidence/dev-smoke*` 入库。
4. **物化与主检出单点耦合**：`sync-to-app.sh` 直接在当前检出构建物化，主检出一旦出现异常就会卡死所有并发会话的交付。

本改动通过四项协同加固完成闭环：
- 主检出写入守卫翻转为 **Default-Deny 根目录（仅白名单放行 linked worktree 与 `.workbuddy/`）**；
- 修复 `isMaterializationCommand` 多段只读误杀并补齐 `corepack`/`env`/`build:*`/`--immutable` 判定；
- 全量收敛剩余 9 个仓内直写测试默认使用 `os.tmpdir()` 并自动清理（`OMNIMUX_WRITE_EVIDENCE=1` 显式留证），并扩展 `check-tracked-artifacts.mjs` CI 门禁禁止跟踪运行期报告与冒烟产物；
- 为 `sync-to-app.sh` 增加 `--isolated` 隔离物化模式，自动从最新 `origin/main` 签出临时 detached worktree 完成构建与物化并退出自动拆除。

## 变更范围

1. `plugins/scripts/guard-worktree.mjs` 与 `plugins/scripts/guard-worktree.test.mjs`：
   - 移除易漂移的 `PROTECTED_DIR_PREFIXES` / `PROTECTED_ROOT_FILES` 黑名单；引入 `PRIMARY_RUNTIME_ALLOWLIST_PREFIXES = ['.workbuddy/']` 与 `isAllowedPrimaryRuntimePath()`，`decideWrite` 与 `isForbiddenMainCheckoutWriteTarget` 对主检出根目录默认拒绝（仅放行真实 linked worktree 与 `.workbuddy/`，非 Git 路径放行、Git 读取错误仍 fail-closed）。
   - 重构 `isMaterializationCommand` 为逐命令段/管道段词法判定，仅在真实执行物化脚本或 `omnimux:sync` 时命中，放行多行命令中的 `grep`/`cat`/`sed`/`git` 与 `bash -n`，并支持 `--isolated` 隔离物化豁免。
   - 扩展 `unwrapExecutionWrapper`（支持 `KEY=VAL`、`env`、`corepack`）、`isFrozenInstall`（支持 Yarn 4 `--immutable`）与 `decideMainCheckoutBuildCommand`（拦截 `build:*`/`compile:*`/`bundle:*`/`package:*`/`plugins:build`）。
2. 全仓 9 个直写仓内的测试文件（默认写入 `os.tmpdir()` 并在 `t.after`/`finally` 自动清理；E2E 证据测试保留 `OMNIMUX_WRITE_EVIDENCE=1` 显式落盘开关）：
   - `plugins/plugins/omnimux/tests/e2e/generation-feedback.e2e.test.js`
   - `plugins/plugins/omnimux/tests/e2e/comment-native.e2e.test.js`
   - `plugins/plugins/omnimux-viewer/src/media-viewer/image-preview-redesign.e2e.test.js`
   - `plugins/plugins/omnimux-clip/test/e2e/expression-consent.spec.mjs`
   - `plugins/scripts/explore-template-media.test.mjs`
   - `plugins/plugins/omnimux-viewer/tests/e2e/media-generation-3054.e2e.test.js`
   - `plugins/plugins/omnimux-workflow/tests/e2e/slot-hover-preview-layout.e2e.test.mjs`
   - `plugins/scripts/composer-inline-bootstrap.test.mjs`
   - `plugins/scripts/package-preparation.test.mjs`
3. `plugins/scripts/check-tracked-artifacts.mjs` 与 `plugins/scripts/check-tracked-artifacts.test.mjs`：
   - 禁止跟踪 `.agent-reports/**`、`plugins/.agent-reports/**`、`docs/evidence/dev-smoke*`、`plugins/docs/evidence/dev-smoke*`。
4. `plugins/scripts/sync-to-app.sh` 与 `plugins/scripts/sync-bypass.test.mjs`：
   - 新增 `--isolated` 模式，清理继承 `GIT_*` 后 fetch `origin/main`，在临时目录创建 detached worktree 指向最新 `origin/main` 完成依赖准备、构建与物化，退出时通过 `trap` 自动移除临时 worktree。

## 验收标准

- 主检出对任意未登记路径（`app/`、`specs/`、`ui-demo/`、`.tmp/`、`dist/`、`node_modules/`、`future-dir/a.js`、根草稿文件）的 `edit`/`write` 及 shell 写入均返回 `deny`；仅真实 linked worktree 与 `.workbuddy/`（且未跟踪）放行；非 Git 目标放行、Git 读取故障继续 fail-closed。
- 多行命令中的只读检视（如 `echo ok\ngrep foo plugins/scripts/sync-to-app.sh`、`bash -n plugins/scripts/sync-to-app.sh`）不被 `isMaterializationCommand` 误杀。
- `corepack pnpm --dir plugins run build:all`、`env CI=1 pnpm build:all`、`corepack pnpm install` 在主检出被拒；`corepack yarn install --immutable`、`corepack pnpm install --frozen-lockfile`、`./scripts/sync-to-app.sh --isolated` 放行。
- `check-tracked-artifacts.mjs` 拦截已跟踪的 `.agent-reports/**` 与 `docs/evidence/dev-smoke*`，对当前工作树退出码为 0。
- 运行离线单测（`composer-inline-bootstrap.test.mjs`、`package-preparation.test.mjs`、`image-preview-redesign.e2e.test.js`、`guard-worktree.test.mjs`、`guard-worktree.qa.test.mjs`、`check-tracked-artifacts.test.mjs`、`sync-bypass.test.mjs`、`sync-targets.test.mjs`）全部通过，且 `git status --short --untracked-files=all` 零新增污染（注：`explore-template-media.test.mjs` 已同步改为 `os.tmpdir()`，其对已移除文件 `featured-apps-data.js` 的既有导入报错属 `91f73454` 遗留，不在本 PR 范围内）。
- `sync-to-app.sh --isolated --skip-build` 在主检出既脏又落后于 `origin/main` 时仍能从最新 `origin/main` 通过源码身份门禁并自动拆除临时 worktree。

## 旧标准变更

- `plugins/scripts/guard-worktree.test.mjs` :: `allows gitignored plugin paths in main repo`
  - 原断言：主检出向 `plugins/omnimux/node_modules/not-a-real-pkg/index.js` 直接 `write` 返回 `allow`（reason 为 `ephemeral` 或 `gitignored`）。
  - 变更理由：主检出写保护由黑名单枚举升级为根目录 Default-Deny（仅白名单放行真实 linked worktree 与 `.workbuddy/`），不再对 `ephemeral`/`gitignored` 放行直接写盘（依赖维护仍通过 `pnpm install --frozen-lockfile` / `yarn install --immutable` / `npm ci` 在 `decideMainCheckoutBuildCommand` 放行）。
  - 新期望与证据：更名为 `denies non-allowlisted ephemeral and gitignored plugin paths in main repo under Default-Deny`，断言主检出直接 `write` `plugins/omnimux/node_modules/not-a-real-pkg/index.js` 返回 `deny`（`untracked-protected-scope`），且在 linked worktree 内写入同一路径返回 `allow`（`worktree-isolated`）。

- `plugins/scripts/guard-worktree.test.mjs` :: `allows workflow dist / dist-harness (temp build dirs)`
  - 原断言：主检出向 `plugins/omnimux-workflow/dist-harness/scratch.js` 与 `plugins/omnimux-workflow/dist/index.js` 直接 `write` 返回 `allow`（`ephemeral`）。
  - 变更理由：主检出升级为根目录 Default-Deny，防止临时构建产物与副产物在主检出堆积；所有构建与临时产物写入应在 linked worktree 或 `/tmp` 完成。
  - 新期望与证据：更名为 `denies workflow dist / dist-harness writes in main repo while allowing them in worktree`，断言主检出写入两者均返回 `deny`（`untracked-protected-scope`），在 linked worktree 内写入均返回 `allow`（`worktree-isolated`）。

- `plugins/scripts/guard-worktree.test.mjs` :: `allows untracked scratch files in main repo root and .workbuddy`
  - 原断言：主检出根目录新建 `__untracked_scratch_987654.txt` 与 `.workbuddy/scratch_board.md` 均返回 `allow`。
  - 变更理由：主检出升级为根目录 Default-Deny 后，根目录任意未跟踪草稿文件与未来新增顶层目录一律拒绝，仅显式白名单 `.workbuddy/` 放行本地协作运行态写入。
  - 新期望与证据：更名为 `denies untracked scratch files in main repo root while allowing .workbuddy runtime allowlist`，断言主检出新建 `__untracked_scratch_987654.txt`（及 `ui-demo/`、`specs/`、`.tmp/`、`future-dir/`）返回 `deny`（`untracked-protected-scope`），而 `.workbuddy/scratch_board.md` 返回 `allow`（`primary-runtime-allowlist`）。

- `plugins/scripts/guard-worktree.test.mjs` :: `allows ephemeral and gitignored targets on the main checkout`
  - 原断言：主检出通过 bash 执行 `cp /tmp/bundle.js dist/app.js`、`echo "log info" > trace.log`、`cp /tmp/data.txt ignored/item.txt` 均返回 `allow`。
  - 变更理由：主检出 shell 写入目标判定同步收敛为根目录 Default-Deny（仅放行 linked worktree、仓库外路径与 `.workbuddy/`），杜绝 `.tmp/`、`.agent-reports/`、`dist/` 与忽略文件通过重定向/拷贝在主检出静默堆积。
  - 新期望与证据：更名为 `denies ephemeral and gitignored bash targets on main checkout while allowing .workbuddy and external tmp`，断言上述 3 条主检出 bash 写入均返回 `deny`，同时验证写入 `.workbuddy/report.md`、`/tmp/out.log` 与 linked worktree 内相同命令均返回 `allow`。

- `plugins/scripts/guard-worktree.test.mjs` :: `preserves ignored and ephemeral exemptions`
  - 原断言：主检出直接写入 `ignored/file.js`、`dist/file.js`、`trace.log` 返回 `allow`。
  - 变更理由：主检出升级为根目录 Default-Deny，仅放行真实 linked worktree 与 `.workbuddy/`，不再对主检出内的忽略文件或临时目录放行写入。
  - 新期望与证据：更名为 `enforces Default-Deny on ignored/ephemeral primary paths while preserving .workbuddy and worktree exemptions`，断言主检出写入上述 3 路径均返回 `deny`，而写入 `.workbuddy/state.json` 及 linked worktree 内相同路径均返回 `allow`。

- `plugins/scripts/guard-worktree.test.mjs` :: `emits allow JSON for untracked / ignored / worktree paths`
  - 原断言：通过 PreToolUse 协议对主检出写入 `dist-harness/hook-test.js` 与 `__guard_untracked_scratch__.tmp` 返回 `allow` JSON。
  - 变更理由：主检出升级为根目录 Default-Deny 后，两处路径均属于非白名单主检出路径，应当返回 `deny`；仅 `.workbuddy/` 与 linked worktree 返回 `allow`。
  - 新期望与证据：更名为 `emits allow JSON for .workbuddy and worktree paths while denying non-allowlisted primary paths`，断言 `dist-harness/hook-test.js` 与 `__guard_untracked_scratch__.tmp` 在主检出返回 `deny`，而在 `.workbuddy/hook-test.md` 与 linked worktree 路径返回 `allow`。

- `plugins/scripts/guard-worktree.test.mjs` :: `denies build and package mutation commands on the main checkout while allowing in worktree`
  - 原断言：第 982 行使用 `touch -r package.json .tmp/out.txt` 期望 `allow`（验证 `-r` 后的参考文件 `package.json` 不被误判为写入目标）。
  - 变更理由：主检出升级为 Default-Deny 后，`.tmp/out.txt` 自身属于主检出非白名单路径而被拒；改为使用白名单目标 `.workbuddy/out.txt` 与仓外目标 `/tmp/out.txt` 同样验证 `-r package.json` 解析，同时新增断言确认 `touch -r package.json .tmp/out.txt` 被拒。
  - 新期望与证据：保留原用例所有既有构建/安装断言，将 `-r` 校验改为断言 `touch -r package.json .workbuddy/out.txt` 与 `touch -r package.json /tmp/out.txt` 返回 `allow`，且 `touch -r package.json .tmp/out.txt` 返回 `deny`。
