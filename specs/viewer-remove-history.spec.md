# 图像生成（媒体查看器）移除右侧历史栏

## 背景与目标

图像生成视图右侧的「历史」栏与左侧缩略图栏呈现的是同一批素材，功能重复、占用画布宽度。
移除右侧历史栏（历史记录面板、窄屏抽屉、顶部「历史」触发按钮），让左侧缩略图栏作为唯一历史导航；保留成本预估行与其余顶栏控件。

## 范围

- `plugins/plugins/omnimux-viewer/src/media-viewer/MediaViewerTab.jsx`：删除 `HistoryPanel` 渲染、历史抽屉/遮罩、`historyOpen` 状态、相关键盘分支与 `data-history-*` 属性。
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment-styles.js`：删除历史栏/抽屉 CSS，保留 `.omx-mv-cost`。
- 测试：更新 `flow-alignment.dom.test.js`（断言右侧历史栏与触发按钮均不存在、左侧缩略图仍在、成本行仍显示、↑/↓ 仍切换）；删除仅覆盖历史栏的 `flow-alignment.e2e.test.js`。

## 假设

- 假设：左侧缩略图栏已覆盖同一会话的全部已完成素材并按时间倒序展示，足以承担历史切换；用户不需要历史卡上的「复用提示词/下载」聚合视图。
- 假设：宽、窄容器下移除右侧 260px 侧栏后，主舞台 `flex:1` 自动撑满，不产生空白或布局跳动。

## 证伪方式

- 若某会话存在左侧缩略图栏未覆盖、只能从右侧历史卡触达的素材或操作（复用提示词/批量下载），则本移除会丢失入口，需保留或迁移该能力。
- 若在 1280 宽与 640 窄容器实测中，移除侧栏后主舞台未撑满、出现空白条或缩略图栏被挤压，则布局假设不成立，需调整 `omx-mv-stage-wrapper` 布局。

## 验收

- 图像生成视图右侧不再渲染 `.omx-mv-history` / `.omx-mv-history-toggle` / `.omx-mv-history-scrim`，根节点无 `data-history-*`。
- 左侧缩略图栏仍可点击切换素材，↑/↓ 切换保留，成本预估 `.omx-mv-cost` 仍按图像/视频模式显示或隐藏。
- `omnimux-viewer` 包测试 `node scripts/run-tests.mjs` 全绿。

## 旧标准变更

移除右侧历史栏后，原先专门断言历史栏的测试用例已不再适用（历史栏被整体删除，功能由左侧缩略图承担）。以下用例被删除或重命名，原断言均围绕 `.omx-mv-history*` / 历史抽屉 / 历史卡操作，新期望由 `右侧历史栏已移除，左侧缩略图栏仍保留` 与保留的成本/切换用例覆盖。

- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `历史栏渲染分组卡片、当前项与提示词快照`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `点击历史卡切换舞台素材`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `复用提示只写入 composer 预填队列，不提交生成`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `视频记录的历史缩略图使用 video 元素`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `批量中的非 primary 项选中时卡片仍高亮`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `空会话显示历史空态且不聚合其他会话`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `无会话时不聚合其他会话的历史`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `抽屉打开时方向键不切换背后舞台，关闭按钮可收起`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `下载历史卡触发对应素材的 anchor 且使用记录标题`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `抽屉状态与 Esc 关闭`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.dom.test.js` :: `↑/↓ 在单图模式切换历史素材，输入框聚焦时不拦截`
- `plugins/plugins/omnimux-viewer/src/media-viewer/flow-alignment.e2e.test.js` :: `*`

原断言：右侧历史栏渲染分组卡片/当前项/提示词、点击历史卡切换舞台、历史卡复用提示词与下载、历史抽屉打开与 Esc 关闭、↑/↓ 切换历史素材、空态文案「暂无历史」。
必须改的理由：右侧历史栏被产品决定整体移除，相关 DOM（`.omx-mv-history*`、`omx-mv-history-toggle`）不再存在，这些用例无法也不应继续通过。
新期望证据：`flow-alignment.dom.test.js` 新增 `右侧历史栏已移除，左侧缩略图栏仍保留`（断言无历史 DOM、无 data-history-*、缩略图 6 项），并保留成本预估与 ↑/↓ 切换（用例名改为 `↑/↓ 在单图模式切换素材，输入框聚焦时不拦截`）。
