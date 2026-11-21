# 画布浮层逐层关闭：空白点击与 Escape 保持节点选中与配置面板可见

## 背景

在工作流无限画布（`omnimux-workflow`）中，单选生成节点时底部展示配置/输入框面板（`ConfigPanel`），其可见性单一绑定到节点选中态（`isConfigPanelVisible`）。用户在面板内打开三列模型选择器（`ModelCascadeMenu`）或参数浮层（`VideoParamPopover` / `ImageParamPopover` / `CustomSelect` / `@` 引用菜单）后，习惯点击画布空白区域收起浮层、继续编写提示词或点击生成。

当前实现中，浮层仅在 `mousedown` 回调里关闭自身，没有与 ReactFlow 画布空白面（`.react-flow__pane`）的指针生命周期或画布级 `Escape` 快捷键协调：
1. 默认框选模式（`selectionOnDrag={true}`）下，`@xyflow/react` `Pane` 在 `pointerdown`（早于 `mousedown`）就启动选区并在 `pointerup`（或轻微抖动触发 `pointermove`）执行 `resetSelectedElements()`；
2. 抓手平移模式（`selectionOnDrag={false}`）下，`Pane` 在 `click` 执行 `resetSelectedElements()`；
3. 按 `Escape` 时，多数浮层在冒泡阶段关闭且未阻断传播，`useKeyboardShortcuts` 同一次按键顺带执行 `clearSelection()`。

结果是：一次空白点击或一次 `Escape` 同时关掉浮层并取消节点选中，导致底部输入框面板立刻隐藏，用户必须重新点击节点才能恢复输入。该问题在画布上全部 15+ 个瞬态浮层/菜单（节点顶部「更多」菜单、分组调色盘、多选排版菜单、右键菜单、连线动作菜单、页面切换菜单、底栏添加节点/模板面板、资产抽屉筛选与右键菜单等）均存在不一致或连带失选现象。

## 目标

1. **逐层退栈（One Gesture = One Layer Dismiss）**：画布存在任意打开的点击收起型瞬态浮层/菜单时，首次左键点击画布空白面只收起对应浮层，保持当前节点选中与 `ConfigPanel` / 顶部悬浮胶囊 / 多选工具条可见；再次点击画布空白面再正常取消选中。
2. **Escape 严格 LIFO 逐层关闭**：按 `Escape` 仅关闭当前栈顶单层浮层并阻断传播，不连带触发画布 `clearSelection()` 或关闭外层容器（如资产抽屉 / 嵌套外层浮层）。
3. **非空白目标一次直达（零双点税）**：浮层打开时直接点击同一 `ConfigPanel` 内的提示词输入框、另一触发胶囊（如模型切换直点参数胶囊）、生成按钮、其他节点、工具栏或画布外聊天区，浮层收起的同时目标点击直接生效，不额外增加点击次数。
4. **全局一致且低维护成本**：收敛为单一轻量协调器 `canvasDismissLayer`（纯逻辑 + `useCanvasDismissLayer` Hook），替代各浮层分散复制的 `mousedown` / `keydown` 样板代码。

## 非目标

- 不引入 `panelDismissed` 或任何脱离节点选中态的 `ConfigPanel` 独立显隐状态（保持 `configPanelSelectionLock` 单一真源）。
- 不为非模态浮层增加全屏透明遮罩（避免阻断同面板直达输入/切换、滚轮缩放与画布外交互）。
- 不改变常驻工具面板（`AssetsDrawer`、`ExecutionQueuePanel`、`MiniMap`）的显隐机制，也不把被动悬停预览（`SlotHoverPreview`）纳入空白点击拦截，避免悬停移出后 180ms 内点击空白处失灵。
- 不修改 `@xyflow/react` 依赖或宿主壳代码。

## 研究依据

- **本仓事实与源码核验**：
  - `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/nodeVisualMath.ts` 与 `configPanelSelectionLock.test.mjs`：`ConfigPanel` 显隐严格等价于单选生成节点 `selected === true`（禁止与选中态分叉）。
  - `@xyflow/react@12.11.3` `Pane` 实测实现：`selectionOnDrag={true}` 时 `onPointerDownCapture` 创建 `userSelectionRect`，`onPointerMove` 在位移超过 `paneClickDistance`（默认 `0`）即调用 `resetSelectedElements()`，`onPointerUp` 调用 `onPaneClick` 后无条件调用 `resetSelectedElements()`；`selectionOnDrag={false}` 时 `onClick` 无条件调用 `resetSelectedElements()`；同时 `d3-zoom` 绑定 `dblclick.zoom`（`zoomOnDoubleClick` 默认开启）。
  - `plugins/plugins/omnimux-workflow/src/canvas/ui/CustomModal.tsx` 与 `voicePickerUiPolish3058.test.mjs`（Issue #3058 FE-02）：既有历史修复已证明 `Escape` 透传导致画布节点失选是同类系统性问题，此前仅对 `CustomModal` + `CustomSelect` 做了特例补丁。
  - 外部参考说明：本机未安装本地 MiniMax Design 桌面应用，因此本次交互判定基于本仓可复现行为、`@xyflow/react@12.11.3` 源码机制、W3C Pointer Events / Light-Dismiss 分层约定及前序 Issue #3058 证据。
- **操作基线对比（本仓实测路径）**：
  - 改前（模型选完后点空白收起再继续写提示词）：打开模型面板 → 点空白（误关输入框）→ 重选节点（恢复输入框）→ 点输入框输入（**含 1 次误失选与 1 次额外重选**）。
  - 改后：打开模型面板 → 点空白仅收起模型面板、输入框保持可见（或直接点输入框一步聚焦），第二次点空白才取消选中（**0 次误失选**）。
- **二阶与三阶影响推演与方案取舍**：
  - **否决全屏透明遮罩**：遮罩虽能挡住空白点击，但二阶后果是把提示词聚焦、模型↔参数胶囊切换、直接点生成、切选其他节点与画布外侧聊天输入全部变成「双点税」，且破坏滚轮缩放与多 Portal z-index 秩序。
  - **二阶影响 1 — 手抖微位移误触框选失选**：`selectionOnDrag` 模式下默认 `paneClickDistance = 0`，若仅拦截 `click` 而不拦截空白面上的 `pointerdown`，1px 手抖即可触发 `resetSelectedElements()`。因此必须在 `window` 捕获阶段拦截空白面主键 `pointerdown` 并吞掉该次手势配对的 `mousedown`/`pointerup`/`mouseup`/`click`。
  - **二阶影响 2 — 编组内部空白背景**：节点位于展开的分组（`.wf-group-node` 且非 `.wf-group-node--collapsed`）内时，视觉空白区域属于分组底板；若不纳入空白面判定，组内节点点空白会切选分组并隐藏子节点输入框。将未折叠 `.wf-group-node` 自身底板纳入空白面判定（折叠态分组胶囊除外）可保证组内外一致。
  - **二阶影响 3 — 中键/右键平移与右键菜单**：仅对主键（`button === 0`）执行空白面手势吸收；中键平移与右键唤起菜单仍收起旧浮层并直接透传，不打断平移与右键操作。
  - **二阶影响 4 — 手势中断/拖离窗口防卡死**：若用户按下空白面后拖离窗口或触发 `pointercancel` / `blur` 未产生 `click`，手势锁必须随 `pointerup` 兜底计时、`pointercancel`、`blur` 以及任意新 `pointerdown` 自动释放，确保绝不误吞下一次正常空白点击。
  - **三阶影响 1 — 连点两下触发双击缩放（`dblclick.zoom`）**：用户习惯性「点一次关菜单 → 紧接着再点一次取消选中」间隔常在 150–400ms，会合成浏览器 `dblclick` 触发 `d3-zoom` 意外放大画布。空白收起后短窗口（500ms）内吞掉空白面 `dblclick` 并在生效后立即清零，既消除连点误放大，又不影响正常双击缩放。
  - **三阶影响 2 — 嵌套浮层与局部输入**：`VideoParamPopover` 内嵌 `CustomSelect`、`CustomModal` 内嵌 `CustomSelect`、`CanvasPageHeader` 内联重命名输入框及 IME 组字态按 `Escape` 时，按 LIFO 顺序严格每次退一层（组字/重命名 → 子下拉 → 外层浮层/弹窗 → 节点选中）。
  - **三阶影响 3 — 维护成本收敛**：所有 15+ 画布瞬态浮层共用同一个 `useCanvasDismissLayer` 钩子（替代分散的 `document/window` `mousedown`+`keydown` 样板与常驻未卸载监听如 `GroupTopBar`），新增浮层只需 1 行接入即自动获得空白护盾、LIFO `Escape` 与连点防误缩放能力。
- **演示**：`ui-demo/canvas-popover-dismiss-demo.html`，修改前后并列交互演示，支持亮/暗双主题、窄屏视口、模型/参数浮层、组内空白、连点两下与 Escape 逐层关闭。

## 假设

1. 画布上所有「点击外部自动关闭」的瞬态浮层与菜单均共享同一分层心智：空白点击优先收起浮层，非空白交互目标优先一次直达。
2. 仅基于 DOM 目标判定空白面（`.react-flow__pane`、`.react-flow__background`、未折叠 `.wf-group-node` 自身）即可在不耦合 ReactFlow 内部私有 store 的前提下稳定覆盖 Select 模式与 Pan 模式。

## 证伪方式

1. 若在真实浏览器画布运行态中，开启 `ModelCascadeMenu` / `VideoParamPopover` / `ImageParamPopover` / `MentionPopover` 后左键点击空白面（含 2–3px 轻微拖动）仍触发节点失选或隐藏 `ConfigPanel`，则本方案不成立。
2. 若在浮层收起后快速第二次点击空白面无法取消选中、或意外触发双击缩放、或点击提示词输入框/另一胶囊需要点两次、或中键平移/右键菜单被阻断，则需修正手势状态机。

## 验收标准

1. **核心场景（模型面板）**：选中生成节点 → 打开 `ModelCascadeMenu` → 左键点击画布空白处 → 模型面板关闭，节点仍保持选中，`ConfigPanel`（输入框面板）保持可见且不闪烁；再次点击画布空白处 → 节点取消选中、`ConfigPanel` 隐藏。
2. **全局一致性**：`VideoParamPopover`、`ImageParamPopover`、`CustomSelect`、`MentionPopover`、`CustomDropdown`、`FloatingTopPill` 更多菜单、`GroupTopBar` 调色盘、`FloatingSelectionToolbar` 排版菜单、`ContextMenu`、`CanvasNodeActionMenu`、`CanvasPageHeader` 创作页菜单、`Toolbar`（`AddNodeMenu` / `WorkflowTemplatePanel`）、资产抽屉筛选与右键菜单，全部接入统一 `useCanvasDismissLayer`，空白点击均保持节点选中，Escape 均严格逐层关闭。
3. **非空白一次直达**：模型面板打开时，直接点击提示词输入框立即聚焦可输入；直接点击参数胶囊立即关闭模型面板并打开参数面板；直接点击另一节点立即切换选中；中键拖拽与右键菜单不受阻断。
4. **二阶/三阶边界**：
   - Select 模式带轻微抖动点击空白不触发框选失选；Pan 模式空白点击同样保持选中；
   - 展开分组内点击分组空白底板收起浮层且不切选分组；点击折叠分组胶囊可直接选中分组；
   - 快速连点空白两次（关浮层 + 取消选中）不触发 `dblclick` 缩放；
   - `VideoParamPopover` / `CustomModal` 内嵌 `CustomSelect` 按 `Escape` 严格先关下拉、再关外层浮层/弹窗、再取消选中；IME 组字与页面内联重命名时 `Escape` 优先让位；
   - 被动悬停预览 `SlotHoverPreview` 与常驻面板 `AssetsDrawer` / `ExecutionQueuePanel` / `MiniMap` 不阻断空白点击取消选中。
5. **演示与视觉检查**：`ui-demo/canvas-popover-dismiss-demo.html` 与真实画布运行态在亮/暗双主题、打开态浮层和窄屏布局下均通过实测。

## 旧标准变更

以下既有源码正则契约测试原本直接断言各组件内联手写 `addEventListener('mousedown'|'keydown')` 实现细节；本改动将外部点击与 `Escape` 统一收敛到 `useCanvasDismissLayer`，同步更新对应源码契约断言并保留同等及更强的运行时行为测试：

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/audioParams/voicePickerUiPolish3058.test.mjs` :: `#3058 FE-02：Escape 先菜单后弹窗，弹窗事件与画布失选隔离`
  - 原断言：正则断言 `CustomSelect.tsx` 源码字面量含 `window.addEventListener('keydown', handleKeyDown, true)` 及内联 `stopImmediatePropagation`。
  - 变更理由：`CustomSelect` 的捕获阶段 `Escape` 拦截与 LIFO 顺序已统一迁移到 `useCanvasDismissLayer`（内部由 `canvasDismissLayer.ts` 在 `window` capture 阶段按栈顶执行 `stopImmediatePropagation`），避免各组件重复监听导致与画布空白点击/其他浮层退栈顺序漂移。
  - 新期望证据：源码断言 `CustomSelect.tsx` 接入 `useCanvasDismissLayer(`（保留 `CustomModal.tsx` 原有全部断言不变），并在 `canvasDismissLayer.test.mjs` 中通过 JSDOM 运行时验证嵌套浮层/弹窗内 `CustomSelect` 按 `Escape` 严格先关菜单再关外层。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/VideoParamPopover.test.mjs` :: `CfgPopoverShell Escape 与外部点击（捕获阶段 mousedown）关闭`
  - 原断言：用例标题及正则断言 `CfgPopoverShell.tsx` 源码内联含 `addEventListener('mousedown'` 与 `addEventListener('keydown'`。
  - 变更理由：`CfgPopoverShell` 的外部点击与 `Escape` 关闭统一收口到 `useCanvasDismissLayer`（覆盖 `pointerdown`/`mousedown`/`click`/`Escape` 全链路以保护空白点击不触发 ReactFlow 失选）。
  - 新期望证据：用例保留 `panelRef` / `triggerRef` / `.wf-custom-select-dropdown` / `onClose` 契约并断言接入 `useCanvasDismissLayer`，同时在 `canvasDismissLayer.test.mjs` 中以 JSDOM 运行时验证 `CfgPopoverShell` + `CustomSelect` 嵌套逐层关闭与外部点击行为。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `ModelCascadeMenu 支持外部点击与 Escape 关闭`
  - 原断言：检查 `ModelCascadeMenu.tsx` 源码含字面量 `event.key === 'Escape'`。
  - 变更理由：`ModelCascadeMenu` 已改由 `useCanvasDismissLayer` 统一处理 `Escape` 与空白点击逐层关闭。
  - 新期望证据：保留全部锚点、无障碍、焦点返回与关闭契约，断言接入 `useCanvasDismissLayer`，并在 `canvasDismissLayer.test.mjs` 与真实浏览器画布中验证打开/空白点击/Escape 完整行为。

## 实施边界

仅改动 `plugins/plugins/omnimux-workflow/src/canvas/` 下的浮层关闭协调器、对应浮层组件与测试，以及本任务规格与高保真 HTML 演示；不触碰桌面壳、网关、Hub 路由协议或业务执行契约。

## 影响文件

- `specs/canvas-popover-dismiss.spec.md`
- `ui-demo/canvas-popover-dismiss-demo.html`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/canvasDismissLayer.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/canvasDismissLayer.test.mjs`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/hooks/useClickOutside.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/ui/CustomSelect.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/ui/CustomDropdown.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/ui/CustomModal.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/cfg/CfgPopoverShell.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/PromptTokenEditor/MentionPopover.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/FloatingTopPill.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/FloatingSelectionToolbar.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/GroupNode/GroupTopBar.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/ContextMenu.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasNodeActionMenu.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasNodeHandle.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasPageHeader.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/WorkflowTemplatePanel.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/assets/popovers/{Type,Tag,Sort,Time}FilterPopover.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/assets/menus/{AssetItem,Folder,CanvasItem}ContextMenu.tsx`
- 同步更新契约测试：`VideoParamPopover.test.mjs`、`modelCascadeMenu.test.mjs`、`voicePickerUiPolish3058.test.mjs`

## 验证

- `pnpm --filter omnimux-workflow typecheck`
- `pnpm --filter omnimux-workflow test`
- `corepack pnpm --dir plugins run build:all`
- `git diff --check`
- 浏览器演示与真实画布运行态验收：打开 `ui-demo/canvas-popover-dismiss-demo.html` 与 worktree `canvas-harness` 画布，覆盖亮/暗双主题、窄屏、打开态模型/参数/菜单浮层、空白单点/连点/微抖动/Escape/直达切换与分组底板；本轮不涉及真实模型推理调用。
