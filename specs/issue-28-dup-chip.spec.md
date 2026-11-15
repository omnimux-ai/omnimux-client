# Spec: 图片节点单个文本输入重复显示 chip（Issue #28）

- 任务：`issue-28-dup-chip`
- 日期：2026-11-15
- 风险：R2（画布输入槽渲染与 composition 装填）
- 关联：omnimux-ai/omnimux-client#28

## 目标
图片节点只连接 1 个上游文本节点时只显示 1 个文本 chip；多个不同文本输入各显示 1 个且顺序稳定；重渲染/重连/刷新不重复；删除上游同步移除；原有图片/文件输入不回归。

## 范围
- 渲染去重：`ConfigPanel` 的 `textOnlySources` 排除已由 `SlotWells` text slot record 渲染的 `edgeId`，消除同一 source 两条渲染路径的重复 chip。
- composition 装填：`autoFillSlots` 对 `type='text' && composition` 的槽位允许多来源按 feed 顺序追加，不因 `max=1` 截断。
- 重算：`canvasSlotRecompute` 对 V1 新接入的文本边追加到 composition 文本槽；legacy composition 同样追加而非 `max===1` 替换。
- 不包含：图片/文件槽位的容量规则、非文本 media slot 的自动装填策略。

## 验收（AC）
- 1 个上游文本输入只显示 1 个 chip。
- 2 个不同文本输入各显示 1 个，顺序与连接顺序一致。
- 重复 render、重连、刷新不产生重复 chip。
- 删除上游文本节点后对应 chip 消失。
- 图片/文件输入仍正常显示和消费。

## 测试
- `src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs`：单文本、多文本、重复 render、删除、图片/文件回归的 ConfigPanel DOM 计数。
- `src/shared/graph/compositionTextSources.test.mjs`：`autoFillSlots` 多来源保序；`recomputeCanvasSlots` 自愈装填与新文本边追加。
- `src/shared/graph/feedSlot/feedSlotKernel.test.mjs` / `canvasSlotRecompute.supplyMode.test.mjs` / `slotSubmissionConsistency.test.mjs`：既有槽位/显式空绑定/提交一致性回归。

## 旧标准变更
无。只新增用例与调整测试 harness 的 store double（补充 `nodes: []`），不删除或改写既有标准断言。

## 边界
worktree 开发，只改 `plugins/plugins/omnimux-workflow` 与 `specs/`；不合并、不碰 Dev/Prod；公开仓红线；i18n 走仓库字典。
