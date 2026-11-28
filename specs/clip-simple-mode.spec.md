# OmniMux Clip 简易模式规格（默认开启，可切换专业模式）

> 关联工单：`#461`，边界：独立剪辑工坊 (`standalone`) 与工作流画布节点 (`canvas`) 共用。

## 问题与设计目标

`omnimux-clip` 完整工作区默认暴露左侧 10 余项竖栏入口、双层顶部栏（宿主栏与编辑器菜单）、预览监看扩展控件与 20+ 时间轴编辑工具，面向日常短视频与画布素材剪辑时操作链路过长。

参照 OpenMotion 公开剪辑器的清晰信息密度与分层交互结构，本特性采用「默认简易模式、原地切换专业模式」策略：

1. **正交双轴契约**：保留既有入口模式轴 `data-clip-mode="standalone" | "canvas"`，新增界面复杂度轴 `data-clip-ui-mode="simple" | "pro"`（默认 `"simple"`，持久化键 `omnimux.clip.uiMode`，Standalone 与 Canvas 实时同步）。
2. **原地切换与状态保留**：在 `simple` 与 `pro` 之间切换仅变更 UI 模式状态与属性标记，绝不卸载重挂 `<OpenReelApp />`，保持播放头、时间轴编辑、选区与撤销栈连续。
3. **四项顶部横排抽屉导航**：简易模式下移除 53px 左侧竖栏，将 `素材`（`media`）、`文字`（`text`）、`模板`（`recipes`）、`版本`（`versions`）以 38px 纯文字横排 Tab 置于左抽屉顶部，释放预览区水平空间，并支持顶部一键折叠/展开左抽屉。
4. **无选区自动折叠右侧属性栏**：未选中片段时隐藏右侧属性栏与分栏拖拽条，将空间让给居中预览区；选中任意片段后自动展开属性，并提供关闭按钮与底部“展开专业参数”一键进入专业模式。
5. **画布兼容不妥协**：保留画布右侧工具栏（`[简易|专业] [AI 剪辑] [导出 MP4] [退出编辑]`）、资源库/画布导入及离线素材 `缺失/重连` 提示，同步保障既有的 `canvas-toolbar-mode` 与 CSS 隔离契约。
6. **低摩擦上游同步架构**：95% 逻辑、状态收敛与样式集中在 `openreel/` 外部适配器 `src/client/simple-mode/`；`openreel/` 仅保留 5 处声明式属性与轻量槽位接缝，并登记于 `plugins/docs/contracts/openreel-vendor-contract.md`。

## 假设

1. 将日常高频入口收敛为「顶部单行工具栏 + 左抽屉横排四 Tab（素材/文字/模板/版本）+ 无选区自动收起属性 + 6 工具时间轴」的默认简易模式，能够覆盖多数快速剪辑与画布成片交付场景，同时通过顶栏分段开关保留完整专业能力且切换过程不丢失编辑现场。
2. 通过外部适配器 `src/client/simple-mode/` 管理状态持久化和专业态收敛逻辑（`reconcileSimpleModeState`），配合 `openreel/` 内 5 处最小声明式接缝（`data-clip-pro-only` / `data-clip-section` / `data-clip-simple-only`）与作用域隔离 CSS，能够在不干扰上游渲染管线的前提下维持 Standalone 与 Canvas 双模式外观及功能一致。

## 证伪方式

以下任一可观测结果出现即证明上述假设不成立，必须修正设计或回退后再合入：

1. **模式默认值或切回收敛失效**：首次打开工作区（无存储值）时 `data-clip-ui-mode` 不为 `"simple"`，或从专业模式切回简易模式后仍停留在仅专业分组（如特效/调音台/虚假色），或切换期间播放头/选中态被重置。
2. **双入口矩阵破坏**：在 `standalone|canvas × simple|pro` 任意象限出现顶栏换行遮挡、双层顶栏冗余、`退出编辑` 按钮不可点击/缺失、画布导入与断链重连入口丢失，或任意样式选择器逃逸 `.openreel-studio-root` / 引入裸色值。
3. **验证命令**：
   - `corepack pnpm --dir plugins --filter omnimux-clip test`（覆盖 `simple-mode-contract.test.js`、`simple-mode.e2e.test.js`、`canvas-toolbar-mode.test.js`、`openreel-css-bundle.test.js`、`clip-i18n.test.js`）
   - `corepack pnpm --dir plugins run verify:dsw-tokens` 与 `corepack pnpm --dir plugins run verify:silent-catch` 与 `corepack pnpm --dir plugins run guard:popover`
   - 隔离环境真实 Chromium 运行态验证（明暗双主题、Standalone 与 Canvas 双入口、选中展开/关闭属性、窄屏响应式、简易/专业切回状态收敛）

## `2 × 2` 合同矩阵与五处接缝摘要

| 模式组合 | 顶栏展示 | 左抽屉导航 | 右侧属性栏 |
|---|---|---|---|
| `standalone` × `simple`（默认） | 隐藏宿主重复顶栏，左显折叠钮与撤销重做，中显标题与保存状态，右显模式切换、AI 剪辑、导出 | 38px 顶部横排文字 Tab（素材/文字/模板/版本） | 无选区折叠；有选区展开，带关闭与展开专业参数 |
| `standalone` × `pro` | 完整菜单、项目切换、元数据、队列、备份、模式切换、AI 剪辑、导出与底栏 | 原生 53px 左侧竖栏图标导航 | 始终展开完整属性面板 |
| `canvas` × `simple` | 隐藏菜单/项目切换/名称，左留折叠钮，右显模式切换、AI 剪辑、导出与纯文本退出编辑 | 38px 顶部横排文字 Tab，保留画布导入与断链重连 | 无选区折叠；有选区展开，带关闭与展开专业参数 |
| `canvas` × `pro` | 原生画布顶栏右段，外加模式切换开关 | 原生 53px 左侧竖栏图标导航 | 始终展开完整属性面板 |

- 高保真交互演示：`ui-demo/clip-simple-mode-demo.html`
- 外部适配器目录：`plugins/plugins/omnimux-clip/src/client/simple-mode/`
- 上游接缝登记：`plugins/docs/contracts/openreel-vendor-contract.md`
