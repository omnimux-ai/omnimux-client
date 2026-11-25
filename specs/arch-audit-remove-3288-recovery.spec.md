# 清理 2026-10-13 一次性事故恢复脚本 `recover-media-build-3288`（PR #302 后续收尾）

## 背景

PR #302（`1757c8f6`）已从 `plugins/scripts/guard-worktree.mjs` 移除 2026-10-13 旧仓 `#3288` 一次性事故特权恢复旁路。待主干更新活跃 hook 后，本任务收尾删除对应的过期一次性恢复脚本、失效单测及 `plugins/scripts/governance-manifest.json` 两条 `manual` 登记，同时顺手收口 PR #302 独立评审提出的两条非阻断建议（`app/scripts/worktree.sh:350` 残留 `'ship' it` 提示文案与 `plugins/scripts/omnimux-paths.test.mjs` 对 `--filter=<pkg>` 与嵌套扩展包的覆盖）。

## 假设

1. `plugins/scripts/recover-media-build-3288.mjs` 仅服务于 2026-10-13 单次特定备份（`20261013T193643Z-1d4b7ca77db4`）的字节恢复，该备份目录在本仓已不存在，且全仓无任何构建、CI、打包或运行态路径依赖该脚本或其单测。
2. 删除该脚本与单测并同步清理 `plugins/scripts/governance-manifest.json` 后，`verify-governance-registry.test.mjs` 与 `guard-worktree.test.mjs` 保持全绿且无幽灵条目。
3. 将 `app/scripts/worktree.sh:350` 报错文案中的 `'ship' it` 替换为标准 PR 流程提示，不会影响 `worktree.sh remove` 的任何退出码或分支删除语义。

## 证伪方式

1. 恢复 `plugins/scripts/recover-media-build-3288.mjs`、`.test.mjs` 或其在 `governance-manifest.json` 中的登记后，`plugins/scripts/guard-worktree.test.mjs` 新增的 `expired one-time recover-media-build-3288 script and test files are deleted without manifest ghosts` 断言必须失败；保持删除后全绿。
2. 恢复 `app/scripts/worktree.sh:350` 的 `'ship' it` 文案后，`app/scripts/omnimux-paths.test.mjs` 新增断言必须失败；替换后全绿。
3. 本地与 CI 运行 `verify-governance-registry.test.mjs`、`guard-worktree.test.mjs`、`plugins/scripts/omnimux-paths.test.mjs`、`app/scripts/omnimux-paths.test.mjs`、`verify-fix-regression-test.mjs`、`verify-test-standard-declarations.mjs` 与 `auto-qa-gate.mjs` 全部通过。

## 旧标准变更

- `plugins/scripts/recover-media-build-3288.test.mjs` :: `合成Git仓库仅恢复指定生成物并拒绝回执路径外跳`
  - 原断言：验证 2026-10-13 一次性事故恢复脚本 `recover-media-build-3288.mjs` 按固定前后 SHA-256 替换 `plugins/omnimux/lib/video-inspect.js` 并拒绝符号链接回执外跳。
  - 变更理由：目标恢复事件（2026-10-13 旧仓 `#3288`）已彻底结束、原备份目录 `20261013T193643Z-1d4b7ca77db4` 不存在且 `video-inspect.js` 哈希早已演进，连同被测一次性脚本一起整体退役删除。
  - 新期望与证据：`plugins/scripts/guard-worktree.test.mjs` 新增用例断言 `recover-media-build-3288.mjs`、`.test.mjs` 与 `governance-manifest.json` 登记均已清除，`verify-governance-registry.test.mjs` 全绿。

- `plugins/scripts/recover-media-build-3288.test.mjs` :: `目标写入中断恢复原字节且报告回滚失败`
  - 原断言：验证已退役脚本 `recover-media-build-3288.mjs` 导出的 `replaceBytes` 写入失败回滚行为。
  - 变更理由：被测一次性恢复脚本已整体退役删除，不再有生产或开发路径调用 `replaceBytes`。
  - 新期望与证据：同上，`guard-worktree.test.mjs` 与 `verify-governance-registry.test.mjs` 确认脚本与清单条目零残留。

- `plugins/scripts/recover-media-build-3288.test.mjs` :: `限定恢复只接受当前精确单文件及已保存原字节`
  - 原断言：验证已退役脚本 `recover-media-build-3288.mjs` 导出的 `validateRecoveryState` 状态校验。
  - 变更理由：被测一次性恢复脚本已整体退役删除，不再保留死代码测试。
  - 新期望与证据：同上，`guard-worktree.test.mjs` 与 `verify-governance-registry.test.mjs` 全绿。

- `plugins/scripts/recover-media-build-3288.test.mjs` :: `恢复入口只接受唯一精确命令，不接受路径参数或串联`
  - 原断言：验证 `guard-worktree.mjs` 对 `node scripts/recover-media-build-3288.mjs --apply` 的专用特权旁路只接受固定命令。
  - 变更理由：PR #302（`1757c8f6`）已正式移除 `guard-worktree.mjs` 中的该过期特权旁路，原旁路契约已废弃。
  - 新期望与证据：`plugins/scripts/guard-worktree.test.mjs` 既有回归用例 `expired one-time recover-media-build-3288 privilege bypass is removed from guard-worktree` 断言 `decideBashCommand` 不再命中 `scoped-media-build-recovery*`，新增用例断言脚本与清单条目已删除。
