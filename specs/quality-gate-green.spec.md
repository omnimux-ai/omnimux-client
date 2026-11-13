# Plugin quality gate green (real CI) — 旧标准变更声明

本 PR 为让移植后的插件 quality gate 在 client 单仓（12 包）真实 CI 变绿，按 client
口径重基线了跨插件模型对齐的上限金丝雀（非 ship 的 omnimux-apps 模板不再参与扫描）。

## 旧标准变更

- `plugins/scripts/verify-cross-plugin-model-alignment.test.mjs` :: `baseline repository contracts pass cross-plugin model alignment verification`
  - 理由：omnimux-client 只 ship 12 个包，下游模板包 `omnimux-apps` 未导入；`templateModelSources` 现按「包目录不存在即跳过」保留其它来源仍强校验，故 `templateModelsChecked` 从旧仓的 4（workflow+apps）收敛为 client 的 2（仅 workflow），金丝雀同步按 client 口径更新，非放宽真值断言（`report.ok`/`issues` 仍断言为空）。
