# Spec: 清理 license-registry.json 历史死条目、回填 omnimux-browser 上游基线并接入 CI 门禁

- 任务：`license-registry-cleanup`
- 日期：2026-11-23
- 基线：`57c3b9bd`（`origin/main`）
- 风险：R1（仅涉及许可声明清单、单测真源对齐与 CI 静态门禁接入，不修改任何产品运行时代码）

## 目标

1. 从 `plugins/scripts/license-registry.json` 移除 8 个合仓前已迁出 `plugins/plugins/` 的历史包名（`omnimux-apps`、`omnimux-avatar`、`omnimux-device`、`omnimux-intercept`、`omnimux-social-harvest`、`omnimux-studio`、`omnimux-video-preview`、`omnimux-viewer`），使登记表与当前磁盘 13 个插件（及 `bundle.lock.json`）严格一一对应。
2. 为 `omnimux-browser` 回填经 Git Blob SHA-1 双边取证确认的上游基线（`omdsh-dev/dsh-browser` `ref: "0.1.4"`、`commit: "ab6d8837b11a4e30dd5ce8c3d955339407df1a83"`），消除最后 1 条缺失基线警告。
3. 对齐 `plugins/scripts/verify-license-consistency.test.mjs` 的真实仓库断言（13 个插件：`original: 9, fork: 2, vendor: 2`，0 错误 0 警告）。
4. 将 `verify-license-consistency.mjs` 与 `verify-license-consistency.test.mjs` 接入 `.github/workflows/quality-gate.yml`，防止未来增删插件或漂移许可声明时门禁静默失效。

## 范围

- `specs/license-registry-cleanup.spec.md`
- `plugins/scripts/license-registry.json`
- `plugins/scripts/verify-license-consistency.test.mjs`
- `.github/workflows/quality-gate.yml`

## 验收标准

- [ ] AC-1 `node plugins/scripts/verify-license-consistency.mjs` 退出码为 `0`，输出 `13 个包（original 9 / fork 2 / vendor 2），0 条警告`。
- [ ] AC-2 `node --test plugins/scripts/verify-license-consistency.test.mjs` 全部用例通过，且断言当前仓库 0 错误、0 警告。
- [ ] AC-3 `.github/workflows/quality-gate.yml` 的 `Repo gate scripts` 步骤执行 `node scripts/verify-license-consistency.mjs` 与 `node --test scripts/verify-license-consistency.test.mjs`。
- [ ] AC-4 `node plugins/scripts/verify-test-standard-declarations.mjs`、`doc-lint.mjs`、`verify-governance-registry.test.mjs` 及 `gitleaks` 全部通过。

## 假设

- `plugins/plugins/` 下当前的 13 个目录（与根 `bundle.lock.json` 一致）就是 `omnimux-client` 的全部活跃产品插件；已迁出的 8 个包不再属于本仓构建与分发范围（`omnimux-viewer` 历史归属继续由 `plugins/ACKNOWLEDGEMENTS.md` 与 `plugins/README.md` 保留）。
- `omnimux-browser` 的上游基线为 `omdsh-dev/dsh-browser` 提交 `ab6d8837b11a4e30dd5ce8c3d955339407df1a83`（`2026-09-11T07:06:26Z`，0.1.4 升版）：前一提交 `b6a63e2b` 仍为 `0.1.3`，下一提交 PR #86（`50b70028`，`2026-09-13`）修改了 `actions.ts`，而本仓 10 份核心源文件与 `ab6d8837` 逐字节一致且匹配 `2026-09-12` fork 日期。
- 将许可一致性脚本接入 `quality-gate.yml` 仅耗时约 1 秒，且对所有现有活跃插件与既有测试夹具无破坏性副作用。

## 证伪方式

- 若在 `plugins/scripts/license-registry.json` 临时删除任意 1 个活跃包名或把 `omnimux-browser` 的 `commit` 改回 `null`，`node plugins/scripts/verify-license-consistency.mjs` 与 `node --test plugins/scripts/verify-license-consistency.test.mjs` 必须立即失败（报错或触发非空警告断言）；恢复后全绿。
- 若本仓仍存在未被 `license-registry.json` 覆盖的 `plugins/plugins/*/package.json`，或者 `bundle.lock.json` 与 `license-registry.json` 键集合不一致，则假设不成立，停止并核查。

## 旧标准变更

- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：22 个插件全部登记且通过`
  - 原断言：`assert.equal(onDisk.length, 22)` 及 `assert.deepEqual(result.counts, { original: 17, fork: 3, vendor: 2 })`。
  - 必须改的理由：该断言沿用合仓前独立 `omnimux-dsh` 仓库的 22 插件规模；当前 `omnimux-client` 仅包含 13 个真实插件（与 `bundle.lock.json` 一致），旧断言在当前主干必然失败。
  - 新期望证据：同步更新为 13 个真实插件（`original: 9, fork: 2, vendor: 2`），并新增 `assert.deepEqual(result.warnings, [])` 强化校验，要求 0 错误 0 警告。
- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：fork 类保持 MIT，原创类不残留 MIT`
  - 原断言：`assert.deepEqual(forks, ['omnimux-browser', 'omnimux-market', 'omnimux-viewer'])`。
  - 必须改的理由：`omnimux-viewer` 已不在本仓 `plugins/plugins/` 中构建或内置（历史归属记录在 `plugins/ACKNOWLEDGEMENTS.md`），继续登记会触发死条目错误。
  - 新期望证据：同步更新为 `['omnimux-browser', 'omnimux-market']`，继续强制全部 `fork` 类保持 `MIT` 且非 `fork` 类不得声明 `MIT`。
