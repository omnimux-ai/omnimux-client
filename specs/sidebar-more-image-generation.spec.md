# 左侧边栏「更多」菜单增加图像生成入口

## 背景

图像生成工作台 Tab 已由 `omnimux-viewer` 注册（`omnimux:media-viewer`），但左侧边栏没有可发现的入口。官方 host 的左侧栏 panel list 自带「更多」菜单，hub 的探索入口注册点是 `sidebar.panellist.actions`，当前白名单中没有图像生成。

## 目标

1. 在左侧边栏「更多」菜单内增加一条「图像生成」入口，位于「应用」之后、「视频剪辑」之前。
2. 点击后用既有 `window.__omnimuxWorkbench.open({ tabId: 'omnimux:media-viewer', title: '图像生成' })` 打开图像生成 Tab；不新增第二套导航状态。
3. 图标沿用菜单的 14×14 纯矢量 SVG 规范，不引入 Emoji、徽章或副标题。

## 非目标

- 不改变侧栏常驻行、收起逻辑或官方「更多」按钮的布局。
- 不修改 `omnimux-viewer` 插件的 Tab 注册、生成执行或模型目录。
- 不新增独立的侧栏一级页。

## 研究依据

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`：`EXPLORE_MENU_ITEMS` 是「更多」菜单的唯一清单真源；`activateExploreItem()` 对无 `action` 的条目走 `tabId` + `window.__omnimuxWorkbench.open` 兜底。
- `plugins/plugins/omnimux/src/client/explore-more-menu.jsx`：所有清单项直接渲染为官方 `MenuItemButton`，顺序和图标均来自该真源。
- `plugins/plugins/omnimux/src/workbench/tools.js` 与 `focus-state.js`：`omnimux:media-viewer` 的中文标题为「图像生成」。
- 演示：`ui-demo/sidebar-more-image-generation-demo.html`，修改前后并列，覆盖亮/暗主题与窄屏。

## 验收标准

- 开发版「更多」菜单顺序为：应用、图像生成、视频剪辑、发布、账号、手机管理、数据分析、任务表单、社交采收。
- 正式版按 Alpha 过滤后仍保留「图像生成」（该入口不是 Alpha）。
- 点击「图像生成」会调用 workbench 的 `open`，参数为 `{ tabId: 'omnimux:media-viewer', title: '图像生成' }`。
- 菜单行图标为纯矢量 SVG，无 Emoji。
- 修改前后演示可直接打开，覆盖亮/暗主题、打开态菜单与窄屏。

## 实施边界

只改 `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`、`index.js` 注释、`sidebar-coordinator.test.js` 及演示页；不触碰 `omnimux-viewer` 插件源码、路由、存储或权限。

## 验证

- `pnpm --filter omnimux test`
- `pnpm --dir plugins run build:all`
- 浏览器检查演示页与 Dev 侧栏打开态（亮/暗、窄屏），记录截图；本轮不发起真实模型请求。
