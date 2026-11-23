<!-- reviewed-through: 08498ae0734cb860163229c8da48f3da7b33eb4f (2026-11-18) -->
# Lessons from merged work

改动源码或评审 PR 前先读本页活跃条目。本页只留可公开的工程反模式与正反例，**严禁写入密钥、内部地址、本机绝对路径或未公开信息**。

- **预算**：活跃账本上限 `200 行 / 16 KB`（由 [verify-agents-md.test.mjs](plugins/scripts/verify-agents-md.test.mjs) 在 CI 强制校验）。逐日复盘流水留在复盘 PR 正文或 commit body，不写入本页。
- **代谢**：① 能写成脚本 / CI / Hook 守卫的教训优先直接转门禁，门禁上线后从活跃区移入「已毕业」；② 无法机检的规则跨天命中 `seen ≥ 3` 后压成 1–2 句晋升 [AGENTS.md](AGENTS.md) 或 [子系统文档](docs/subsystems.md)；③ 连续 30 天未再命中的 `seen 1` 条目归档清理。

## 活跃规则

### 验证与回归测试

- **交互/提交类回归测试必须用真实非空数据形态并断言真实请求载荷，且回退修复后必红**（`seen 2` · 最近 `2026-11-18`）
  - 为什么：空夹具、未经 normalize 的 raw 字段或只断言调用次数，会让真实链路断裂时测试仍全绿。
  - 反例：#18（raw 字段夹具，回退修复后 5/5 仍绿）、#49（`occurrences: []` 空夹具漏掉 inline chips 清除）、#53（只断言调用次数，静默吞掉 preflight rejection）、#90（破坏旧任务路径 11 条单测仍全绿）。
  - 正例：#21（改用真实 `normalizeCloudAsset` 夹具，base 红 → 修后绿）、#93（回退自动模式修复，聚焦用例精准红 1 条）。

- **新增回归测试必须接入强制门禁并覆盖端到端真实路径**（`seen 1` · 最近 `2026-11-15`）
  - 为什么：只写文件不接 CI 链或只测上层 helper，回归时不会拦截真实故障。
  - 反例：#24（新测试初版未接入 `app` check 链）、#26（未登记 `governance-manifest.json` 致 CI 连红）、#31 初版 `cd4c0dc`（漏掉导入 → 槽位 → readiness 链路）。
  - 正例：#31 `3b642a8`（补端到端 `jsonDocumentExecution.test.mjs`，旧 head 5 fail → 新 head 5 pass）。

- **UI 状态与样式验收必须用 PR head 的真实渲染 `computed style` 或逐态几何测量**（`seen 1` · 最近 `2026-11-16`）
  - 为什么：源码正则断言无法反映 CSS 层叠覆盖；旧构建或同构状态替代会把真实视觉回归带入主干。
  - 反例：#45 初版 `c5d9bd3`（选中态被层叠覆盖，单测仅做源码字符串断言）、#54（合并前使用旧物化包测量）。
  - 正例：#116（同一组节点连续收起/解体/撤销，实测渲染组框与命中外框均为 `220 × 44`）。

### 打包与基线

- **打包与文件闭包过滤必须用真实产物树验证，非 workspace 包不套用任意层级 `node_modules` 裁剪**（`seen 1` · 最近 `2026-11-17`）
  - 为什么：pnpm 等包的运行时依赖位于包内 `dist/node_modules`，按目录名误裁会在用户机器报 `MODULE_NOT_FOUND`。
  - 反例：#73 旧 head `74c10c2`（误裁 `pnpm/dist/node_modules`，`node-gyp --version` 失败）。
  - 正例：#73 `6980f56`（仅过滤 workspace 包，实跑 `preparePayload` 验证运行时可执行）。

- **移植旧分支或外部基线前先确认源树测试跑绿，元数据指纹必须指向本仓真实对象**（`seen 1` · 最近 `2026-11-14`）
  - 为什么：以发布快照或未跑绿 WIP 当开发基线会把隐藏回归带入主干；悬空 commit 指纹会导致审计与复现失败。
  - 反例：#1（以精简发布导出作开发基线致测试缺失）、#13（直接搬运未跑绿 WIP 暴露 4 条回归）、#14 初版（`PROVENANCE.json` 保留旧仓 commit）。
  - 正例：#4（恢复完整开发基线）、#14 `45aa422`（用 `git cat-file -t` 核对本仓真实提交）。

## 已毕业（已转规则或门禁）

| 主题 | 落地位置 |
|---|---|
| 发布链路预演（`seen 3`） | [AGENTS.md · 发布链路预演](AGENTS.md#发布链路预演) · [verify-plugin-index.mjs](app/scripts/verify-plugin-index.mjs)（PR #97 / #130） |
| 合并前实测必验桌面交互（`seen 3`） | [AGENTS.md · 合并前实测必验桌面交互](AGENTS.md#合并前实测必验桌面交互) · [verify-desktop-acceptance.mjs](app/scripts/verify-desktop-acceptance.mjs)（PR #97 / #131） |
| `fix:` 回归测试存在性门禁 | [AGENTS.md · 一坑一测试](AGENTS.md#一坑一测试) · [verify-fix-regression-test.mjs](plugins/scripts/verify-fix-regression-test.mjs) |
