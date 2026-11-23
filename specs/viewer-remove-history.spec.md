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
