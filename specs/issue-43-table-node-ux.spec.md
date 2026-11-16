# Spec: 表格节点列宽调节与单元格编辑态

- 任务：`issue-43-table-node-ux`
- 日期：2026-11-16
- 基线：`origin/main`（创建时 `4bbf37f271071520290106094e9b4863e48993c3`；PM 消息中的 `0e733d3` 之后仅多 PR #44 一个无关 commit）
- 风险：R2（画布表格节点交互、编辑态与持久化；不改后端/其他插件）

## 目标

- 表格节点全屏舞台 `VirtualDataGrid` 支持表头右边界拖拽调列宽，松手一次写入 `tableStore` 并由 `useTablePersistence` 持久化。
- 列宽在 100% / 200% / 400% 缩放下按实际渲染比例换算，拖拽命中与位移不漂移。
- 文本/数字单元格具备 preview → selected → editing 状态机；编辑浮层覆盖单元格、不参与布局，行高/列宽不变。
- 旧数据（缺失/非法/小于 80 的 `columns[].width`）回落默认宽度或夹到 80；不改 `.htable` 版本与既有序列化/投影/持久化结构。

## 范围

- `plugins/plugins/omnimux-workflow/src/canvas/components/table-node/stage/VirtualDataGrid.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/components/table-node/stage/tableGridMetrics.ts`（新增：缩放/列宽/编辑框高度纯函数）
- `plugins/plugins/omnimux-workflow/src/canvas/store/tableStore.ts`（新增 `resizeColumn`）
- `plugins/plugins/omnimux-workflow/src/shared/types/htable.ts`（迁移时 clamp 列宽）
- `plugins/plugins/omnimux-workflow/src/canvas/theme/table-node.css`（拖拽手柄、选中/编辑态）
- 相关单测 / DOM 测试
- 本 spec

## 交互规格

### 列宽拖拽

- 每个可见列表头右边界有 6px 透明手柄（`.wf-grid-col-resizer`），hover 显示 2px 竖向高亮线，`cursor: col-resize`。
- `pointerdown` 记录 `startClientX`、列当前宽度、网格实际渲染比例 `scale = rect.width / offsetWidth`；`pointermove` 计算 `logicalDelta = visualDelta / scale`，`nextWidth = clamp(startWidth + logicalDelta, 80, 2000)`。
- 拖拽期间只改该列 `<col>` 的本地预览宽度，不写 store；`pointerup` 调用 `resizeColumn(col.id, width)` 一次写入；`pointercancel` 恢复预览。
- 双击手柄按该列内容做 auto-fit（80–480px）；无法测量时回退 `defaultColumnWidth(type)`。
- 拖拽期间阻止表头双击重命名、行拖拽与画布 pan/zoom。

### 缩放换算

- `computeResizeWidth({ startWidth, startClientX, clientX, scale })`：视觉拖动 +100px 在 1x/2x/4x 下逻辑增量分别为 +100/+50/+25。
- `computeGridScale(rectWidth, offsetWidth)` 对非法/零值回退 1。

### 单元格状态机

- preview：显示文本，超出列宽单行省略，hover 用 `title` 显示全文。
- 单击 → selected：2px accent 内描边 + 轻微背景高亮；不弹输入框。
- 再次单击 / 双击 / Enter → editing：`textarea` 以 `absolute` 浮层覆盖单元格，宽对齐单元格，不参与表格布局。
- 失焦保存；无变化不产生 store 变更；Esc 取消并还原；Cmd/Ctrl+Enter 保存；Enter 在 textarea 内换行；IME composition 期间不误触发 Enter/Esc。
- 点击其他单元格先保存当前再选中目标；点击表格外保存并清除选中。
- 编辑框高度：1 行 = 1 行高 + 内边距；3–4 行随内容增高；最多 8 行，超过封顶且 textarea 内部滚动。
- 附件单元格保持既有交互，点击只做选中高亮，不进入文本编辑。
- 单元格选中与行选择 checkbox 独立。

### 持久化与兼容

- `resizeColumn(colId, width)`：`applyDocMutation` 写入（一次 undo 快照、L1 同步、dirty）；clamp 80–2000；非有限数忽略；未知列/宽度未变不写。
- `migrateLegacyTableDocument`：`columns[].width` 缺失/非法回落 `defaultColumnWidth(type)`；有限值 clamp 到 80–2000。
- 不修改 `tableTextSerializer` / `tableUpstreamTextProjection` / `useTablePersistence` 的输入结构。

## 验收标准

- [ ] AC1 100% 下拖拽列宽实时变化，松手写文档；min 80 / max 2000。
- [ ] AC2 2x/4x 下同一视觉距离的逻辑增量为 1x 的 1/2、1/4；手柄仍可命中。
- [ ] AC3 刷新/切换画布/重开项目后列宽保持。
- [ ] AC4 单元格单击 selected、双击/Enter editing；失焦保存、Esc 取消、Cmd/Ctrl+Enter 保存、Enter 换行。
- [ ] AC5 编辑浮层 1 行 / 3–4 行 / 8+ 行三态正确，行高与列宽不变。
- [ ] AC6 旧数据无 width 正常打开并回落默认值；非法/过小宽度不崩溃。
- [ ] AC7 `tableTextSerializer`、`tableUpstreamTextProjection` 既有测试全绿；附件、行选择、行拖拽、列重命名、添加列不回归。
- [ ] AC8 `pnpm --filter omnimux-workflow test`、`typecheck`、`build` 通过；新增测试覆盖 `computeResizeWidth`（1x/2x/4x）、`resizeColumn` clamp/持久化/旧数据默认宽度、单元格 click/dblclick/blur/Esc/Cmd+Enter/Enter/IME、浮层高度三态。

## 旧标准变更

无。仅新增测试文件/用例，不删除或改写既有测试断言。
