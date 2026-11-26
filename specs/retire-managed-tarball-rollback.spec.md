# Spec: 退役 `--managed-tarball` 事务备份链与 `materialize-with-rollback.sh`（Wave 2）

- 任务：`retire-managed-tarball-rollback`
- 关联 Issue：`#351`
- 日期：2026-11-26
- 风险：中（重构并精简同步/测试脚本依赖的锁、锚定目录隔离与 `pnpm` 隔离运行原语，同时硬退役已停用的 `--managed-tarball` 事务备份发布流及外部恢复点包装脚本）

## 背景

Wave 1（PR #364）清理了插件层死代码、退役索引与失效 CLI 入口。本仓 `plugins/scripts/` 仍遗留两条高维护成本的历史链路：

1. **已退役的 `--managed-tarball` 事务备份发布流**：`managed-tarball.mjs`、`managed-tarball-archive.py`、`materialize-cache.mjs`、`materialize-graph.mjs` 及 7 个仅为其服务的测试文件实现了一套复杂的四路径事务日志、`safeMove`、`probeRecovery`、`pending` 与外部 `agent-backup` 双写恢复链路，目前 Dev 与 Prod 同步均已统一采用常规插件物化流程，外部调用 `--managed-tarball` / `--expect-*` / `--recover-managed-tarball` 已停用。
2. **过度工程的回滚包装脚本**：`materialize-with-rollback.sh` 及其 `issue-839-*` 验收测试包裹 `sync-to-app.sh` 并保存 `node_modules` 与快照回滚副本；`auto-pipeline-worktree.mjs` 已可直接调用 `sync-to-app.sh`。
3. **精简抽离活跃原语**：活跃脚本 `sync-to-app.sh`、`sync-stable.sh`、`test-env-bootstrap.mjs` 与 `task-runtime-install.mjs` 仅需其中的合作式 profile `flock` 文件锁、`DirectoryAnchor` 安全读写与严格 JSON 检查、受限 tar.gz 归档解包检查，以及无外泄环境变量的 `isolated-pnpm` 运行器。

## 目标

1. 新增精简 helper `plugins/scripts/profile-lock-archive.py` 与 `plugins/scripts/isolated-pnpm.mjs`（配单元测试 `plugins/scripts/isolated-pnpm.test.mjs`），承接全部活跃的 profile 锁、安全文件操作、归档只读校验与隔离 `pnpm` 执行能力。
2. 迁移 `test-env-bootstrap.mjs`、`task-runtime-install.mjs`、`task-runtime-install.test.mjs`、`director-acceptance-3289.mjs` 与 `auto-pipeline-worktree.mjs` 至新 helper 与直连 `sync-to-app.sh`。
3. `sync-to-app.sh` 与 `sync-stable.sh` 保留 `--isolated` 混用拦截，并在收到 `--managed-tarball*` / `--expect-*` / `--recover-managed-tarball*` 时明确以退出码 `2` 与「已退役」提示硬失败；移除 `guard-worktree.mjs` 对已删除 `materialize-with-rollback.sh` 的脚本名匹配，同时保留 `hasManagedConflict` 纵深防御拦截。
4. 移除 13 个已退役脚本与测试文件，更新 `plugins/package.json`（`test:isolated-pnpm`）、`.github/workflows/quality-gate.yml` 与 `plugins/scripts/governance-manifest.json`。

## 非目标

- 不触碰 `plugins/scripts/worktree.sh` 与 `plugins/scripts/sag-worktree.mjs`。
- 不修改活跃插件 UI、业务代码或 `bundle.lock.json` 内容哈希。
- 本次不含 UI 改动，不适用 HTML UI 演示。

## 验收标准

- `isolated-pnpm.test.mjs`、`sync-fixtures.test.mjs`、`sync-plugin-scope.test.mjs`、`sync-release-policy.test.mjs`、`sync-bypass.test.mjs`、`sync-targets.test.mjs`、`sync-source-identity.test.mjs`、`guard-worktree.test.mjs`、`verify-governance-registry.test.mjs` 全量通过。
- `python3 -m py_compile`、`bash -n`、`node --check`、`workspace-check.mjs --check`、`verify-test-standard-declarations.mjs`、`doc-lint.mjs` 与 `auto-qa-gate.mjs --diff` 全部通过。

## 旧标准变更

- `plugins/scripts/guard-worktree.test.mjs` :: `correctly classifies materialization scripts and commands`
  - 原断言：`assert.equal(isMaterializationCommand('bash scripts/materialize-with-rollback.sh omnimux'), true)`。
  - 理由：`materialize-with-rollback.sh` 已随 Wave 2 退役删除，`MATERIALIZATION_SCRIPT_RE` 不再匹配不存在的脚本名（保留 `sync-to-app.sh`、`sync-stable.sh`、`sync-main.sh` 及 `--isolated --managed-tarball` 纵深防御用例）。
  - 新期望与证据：`guard-worktree.test.mjs` 其余分类、纵深防御与阻断测试全绿通过。

- `plugins/scripts/sync-bypass.test.mjs` :: `rollback wrapper does not accept the obsolete unmerged flag instead of merge confirmation`
  - 原断言：复制并执行 `materialize-with-rollback.sh`，校验其拒绝 `OMNIMUX_ALLOW_UNMERGED_MATERIALIZE=1` 并要求 `OMNIMUX_MERGE_CONFIRMED`。
  - 理由：`materialize-with-rollback.sh` 已退役删除，不再作为同步入口存在；保留 `--isolated --managed-tarball` 拦截及其他绕过防护断言。
  - 新期望与证据：`sync-bypass.test.mjs` 全绿通过。

- `plugins/scripts/sync-source-identity.test.mjs` :: `managed arguments retain independent dispatch before ordinary source gate`
  - 原断言：在普通源码脏工作树上带 `--managed-tarball=fixture.tgz` 仍放行进入独立分发路由。
  - 理由：`--managed-tarball` 模式已正式退役，`sync-to-app.sh` 现应在进入普通源码门禁之前即明确失败。
  - 新期望与证据：改写为 `retired managed arguments fail loudly before ordinary source gate`，验证 `--managed-tarball=fixture.tgz` 返回退出码 `2` 且 stderr 含 `已退役` 提示，并在 `sync-source-identity.test.mjs` 全绿通过。

- `plugins/scripts/sync-targets.test.mjs` :: `restores pnpm links and transitive package resolution after a failed materialization`
  - 原断言：通过 `materialize-with-rollback.sh` 模拟同步失败后恢复 `.omnimux-dev/profiles/omnimux` 的 pnpm 依赖拓扑。
  - 理由：`materialize-with-rollback.sh` 及回滚备份包装链已在 Wave 2 退役删除，同文件内保留 `sync-to-app.sh` / `sync-stable.sh` 的全部目标选择、--dsh 退役硬失败与 lock 刷新验证。
  - 新期望与证据：`sync-targets.test.mjs` 全绿通过。

- `plugins/scripts/managed-tarball.test.mjs` :: `*`
  - 原断言：覆盖 `managed-tarball.mjs` 的 CLI 请求解析、四路径事务状态机与恢复路径。
  - 理由：`managed-tarball.mjs` 已在 Wave 2 随 `--managed-tarball` 模式一并退役删除；活跃的隔离 `pnpm` 执行能力由 `plugins/scripts/isolated-pnpm.mjs` 与 `plugins/scripts/isolated-pnpm.test.mjs` 独立覆盖。
  - 新期望与证据：`test:isolated-pnpm`（`plugins/scripts/isolated-pnpm.test.mjs`）全绿通过。

- `plugins/scripts/managed-tarball-preparation.test.mjs` :: `*`
  - 原断言：覆盖 `managed-tarball.mjs` 与 `materialize-graph.mjs` 的候选包准备、清单与 `runPnpm` 环境准备。
  - 理由：对应事务构建与发布模块已在 Wave 2 退役删除；其中仍在使用的 `prepareFiles`、`payloadManifest`、`hashFile`、`readJson`、`privatePnpmEnvironment`、`runPnpm` 与 `profile-lock-archive.py` 锚定隔离原语已由 `plugins/scripts/isolated-pnpm.test.mjs` 完整覆盖。
  - 新期望与证据：`plugins/scripts/isolated-pnpm.test.mjs` 全绿通过。

- `plugins/scripts/managed-tarball-transaction.test.mjs` :: `*`
  - 原断言：覆盖 `--managed-tarball` 事务日志提交、并发锁与四路径 `safeMove` 迁移逻辑。
  - 理由：`--managed-tarball` 事务发布链已退役删除；仍在使用的 `profile-lock-archive.py` `check-locks` / `lock` 行为已由 `plugins/scripts/isolated-pnpm.test.mjs` 与 `sync-*.test.mjs` 覆盖。
  - 新期望与证据：`isolated-pnpm.test.mjs` 与同步测试全绿通过。

- `plugins/scripts/managed-tarball-recovery.test.mjs` :: `*`
  - 原断言：覆盖 `--recover-managed-tarball` 与 `pending` / `probeRecovery` 事务恢复流。
  - 理由：事务日志恢复流与 `agent-backup` 双写恢复点已在 Wave 2 退役删除。
  - 新期望与证据：`sync-to-app.sh` 与 `sync-stable.sh` 明确以退出码 `2` 拒绝 `--recover-managed-tarball`，`sync-source-identity.test.mjs` 与 `isolated-pnpm.test.mjs` 全绿通过。

- `plugins/scripts/managed-tarball-t02.qa.test.mjs` :: `*`
  - 原断言：验证 `--managed-tarball` T02 候选签名、过渡版本号与发布日志校验。
  - 理由：`--managed-tarball` 发布流及过渡单据机制已在 Wave 2 退役删除。
  - 新期望与证据：退役后的 `--managed-tarball` / `--expect-*` 参数均硬失败拒绝。

- `plugins/scripts/materialize-cache.test.mjs` :: `*`
  - 原断言：覆盖 `materialize-cache.mjs` 的受控获取锁校验、本地代理网关与 `privatePnpmEnvironment`。
  - 理由：`materialize-cache.mjs` 已在 Wave 2 退役删除；活跃导出的 `privatePnpmEnvironment` 与环境变量白名单隔离已迁入 `isolated-pnpm.mjs` 并由 `isolated-pnpm.test.mjs` 独立覆盖。
  - 新期望与证据：`plugins/scripts/isolated-pnpm.test.mjs` 全绿通过。

- `plugins/scripts/issue-839-independent.qa.test.mjs` :: `*`
  - 原断言：验证 `materialize-with-rollback.sh` 在 Issue #839 修复下的事务回滚与独立校验。
  - 理由：`materialize-with-rollback.sh` 已在 Wave 2 退役删除。
  - 新期望与证据：`auto-pipeline-worktree.mjs` 直连 `sync-to-app.sh`，相关门禁测试全绿通过。

- `plugins/scripts/issue-839-source-verification.test.mjs` :: `*`
  - 原断言：验证 `materialize-with-rollback.sh` 与 `sync-to-app.sh` 源码级回滚前置契约。
  - 理由：`materialize-with-rollback.sh` 已在 Wave 2 退役删除，且 `sync-to-app.sh` 的核心同步契约仍由 `sync-bypass.test.mjs`、`sync-targets.test.mjs`、`sync-plugin-scope.test.mjs`、`sync-release-policy.test.mjs` 持续守护。
  - 新期望与证据：上述活跃 `sync-*.test.mjs` 全绿通过。
