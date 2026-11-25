# 规格：恢复创作画布配置面板跟随节点下方交互

## 1. 背景与目标

PR #190（Issue #111 P3）将 `omnimux-workflow` 创作画布中的节点配置面板（`ConfigPanelShell`）改为通过 Portal 挂载到 `.wf-canvas-editor` 并在检测到碰撞时切入底部 `dock` 停靠区，通过 CSS 将 `.react-flow` 高度压缩为 `calc(100% - var(--wf-config-dock-reserve))` 并绘制通栏横线，形成上下分栏布局；同时碰撞采样未排除 `.react-flow__node-group`，导致分组内的节点在常规空间下也持续触发上下分栏。

用户明确要求**恢复之前的输入框面板跟随节点下方的 UI 交互方式**：
1. 完整回退 PR #190 P3 的底部停靠、画布高度压缩、通栏横线、60fps `requestAnimationFrame` 碰撞轮询、`configPanelPlacement` 几何模块及 `omnimux:config-panel-position` 自定义位移同步事件；
2. 恢复 `ConfigPanelShell` 直接挂载在所属节点 DOM 内，固定于卡片正下方 12px 居中展开，并通过 `scale(1/zoom)` 反缩放保持面板屏幕宽度稳定、随节点拖拽与画布缩放同帧移动；
3. 保留 `nodrag nowheel nopan` 事件隔离与点击停止冒泡，不破坏既有选中锁定（`configPanelSelectionLock`）和逐层关闭（`canvasDismissLayer`）；
4. 完整保留 PR #190 的 P1（后经 PR #300 收敛的纯图标胶囊底栏与指针模式浮层）与 P2（节点标题对比度、悬停/单选/按住拖拽三态轮廓、`MediaPreview` 防原生拖拽）。

## 2. 边界与不做项

- 不新增「自动停靠」开关或替代性分栏模式，始终保持画布 100% 完整高度与节点下方跟随交互。
- 不改动节点业务能力、模型目录契约、`#88` 具名卡槽语义或画布保存/执行协议。
- 严格消费既有宿主语义 Token 与 `.wf-panel-shell__card` 防透底规则，不新增冗余状态提示条（Show, Don't Tell）。

## 3. 验收矩阵

1. **前后对比 HTML 演示**：交付独立可打开的前后对比演示并在 `ego-browser` 核验深/浅双主题、分组内节点、反缩放与参数浮层交互。
2. **构建、单测与门禁**：`build:all`、`omnimux-workflow` `typecheck` 与全量单测（含新增 `ConfigPanelShell.followNode.test.mjs` 与 `canvas-config-panel-follow-node.e2e.test.mjs`）、`test:gates`、`guard:popover`、`verify:dsw-tokens`、`verify-test-standard-declarations`、`verify-fix-regression-test`、`workspace-check` 与 `bundle.lock.json` 全绿；完成双向证伪。
3. **真实浏览器验证**：在任务 worktree 启动真实画布（`canvas-harness`），使用 `ego-browser` 在浅/暗双主题、宽/窄视口（`1440×900` 与 `1024×720`）下实测普通节点与分组内节点选中、缩放（`54%`/`100%`/`140%`）、节点拖拽与参数浮层打开，确认画布保持 100% 完整高度、无通栏分界线、面板紧随节点卡片正下方。

## 旧标准变更

以下既有测试因用户明确要求「恢复之前的输入框面板跟随节点下方的 UI 交互方式（移除 PR #190 P3 底部停靠与上下分栏）」而随退役模块删除或按新契约更新，已由新增真实渲染单测 `ConfigPanelShell.followNode.test.mjs` 与端到端回归测试 `canvas-config-panel-follow-node.e2e.test.mjs` 锁定新行为：

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `Issue #111 P3: configPanelPlacement`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `stays anchored when sparse layout has ample room below owner card`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `switches from anchor to dock when same-selection parameter change grows panel into adjacent node header, and restores when height shrinks`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `docks when single-node 1024x720 fitView panel collides with bottom .wf-canvas-toolbar`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `never triggers corrective auto-pan when allowAutoPan is false (user hand-pan gesture lock)`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/configPanelPlacement.test.mjs` :: `respects top overlay clearance so corrective pan never pushes a node header under top controls`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/canvasUiPolish111.test.mjs` :: `P3: ConfigPanelShell portals into .wf-canvas-editor, notifies popovers on reposition, and blank dock margin is recognized`
