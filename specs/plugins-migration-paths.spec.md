# Spec: plugins 子树迁移路径收尾（PR #26）

- 任务：`plugins-migration-paths`
- 日期：2026-11-15
- 风险：R2（迁移路径/脚本与发布范围）
- 关联：omnimux-client 单仓迁移收尾；不改运行时产品功能。

## 目标
把 `plugins/` 子树里仍指向已冻结旧仓（`omnimux-desktop-fork` / `omnimux-dsh`）的脚本、路径、命令示例与历史残留，统一改到 `omnimux-client` 单仓口径；同时清掉新仓已不存在的旧包生命周期与 workspace 入口，保留真实的历史归属说明。

## 范围
- `plugins/scripts/omnimux.mjs`：`forkRoot` 指向本仓 `app/`，同步清理旧仓路径文案。
- `plugins/` 下各 README、脚本注释、`sidebar-support-identity.json`、`patch-asar-agent-presets.mjs`、`test-env-bootstrap.mjs`、`RUN-IN-OMNIMUX.md`、`omnimux-market` 文案与重建 `lib/local-api.js`。
- `plugin-lifecycle.json`：移除未迁入新仓的 `omnimux-avatar`、`omnimux-studio`。
- `pnpm-workspace.yaml`：移除不存在的 `plugins/omnimux-browser/extension` glob。
- `README.md:145-146`：`omnimux-browser` / `omnimux-viewer` 保留为历史归属，不表述为可构建/内置。

## 验收（AC）
- `node plugins/scripts/omnimux.mjs path` 输出 `fork: <repo>/app`，`plugins: <repo>/plugins/plugins`。
- `grep -R 'omnimux-desktop-fork' plugins` 除 `plugins/ACKNOWLEDGEMENTS.md` 历史归属外无残留。
- `plugin-lifecycle.json` 无 `omnimux-avatar` / `omnimux-studio`；`pnpm-workspace.yaml` 无 `plugins/omnimux-browser/extension`。
- `pnpm install --frozen-lockfile` 与相关单测通过；`verify-test-standard-declarations` 对本次既有测试标准变更全部通过。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `侧栏全局 seam 暴露 Alpha 判定与统一说明，供插件自注册菜单复用`
  - 原断言：`assert.equal(api.isAlphaEntry('omnimux-avatar-entry'), true, 'avatar 已在 lifecycle 列为 Alpha')`
  - 必须改的理由：`omnimux-avatar` / `omnimux-studio` 是旧树包，未迁入新仓 `plugins/plugins`；从 `plugin-lifecycle.json` 移除后不能再把 `omnimux-avatar-entry` 当作 Alpha 样例。改用新仓真实存在的 `omnimux-accounts-entry` 验证同一 seam 语义。
  - 新期望证据：`api.isAlphaEntry('omnimux-accounts-entry') === true`；`api.isAlphaEntry('omnimux-workflow-entry') === false`；`api.alphaDescription === ALPHA_DESCRIPTION` 不变。

- `plugins/scripts/sync-release-policy.test.mjs` :: `uses the lifecycle registry as the exact Alpha plugin and tool-prefix source`
  - 原断言：`alphaPluginIds` 包含 `omnimux-avatar`、`omnimux-studio`，`alphaToolPrefixes` 包含 `avatar_`。
  - 必须改的理由：发布策略以 `plugin-lifecycle.json` 为唯一真源；旧树包未迁入新仓、已从生命周期清单移除，策略测试必须按真实清单断言，不能保留旧包为“可构建/可发布”的期望。
  - 新期望证据：`alphaPluginIds` 精确等于 `omnimux-accounts`、`omnimux-publish`、`omnimux-analytics`、`omnimux-forms`；`alphaToolPrefixes` 精确等于 `omnimux_accounts_`、`omnimux_publish_`、`omnimux_analytics_`。

## 边界
只改 `plugins/`；worktree 开发；PR 到 omnimux-client，不自行合并；公开仓红线；不改 `app/`、不改 Dev/Prod。
