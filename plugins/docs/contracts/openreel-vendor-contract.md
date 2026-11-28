---
title: "OpenReel 剪辑工坊引入契约"
id: "contract-openreel-vendor"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-21"
updated: "2026-11-23"
---

# OpenReel 剪辑工坊引入契约

剪辑工坊在 OmniMux 工作台中嵌入 OpenReel 的编辑器和渲染管线。该入口和画布合成节点使用同一套剪辑界面。固定上游版本见 [UPSTREAM_SHA](../../plugins/omnimux-clip/src/client/openreel/UPSTREAM_SHA)，许可与随包素材见 [第三方声明](../../plugins/omnimux-clip/THIRD_PARTY_NOTICES.md)。

## 1. 同步范围

更新上游时以固定提交对比上游旧版、上游新版和 OmniMux 实际改动。逐项核查本地安全补丁、画布桥、打包、项目兼容和应用内语言。上游布局和入口变动按当前工单的验收项处理。

工程导入、加载和恢复清空自定义表达式的执行授权。代码表达式的审批属于当前工程。独立 Motion Creator 随上游 1.0 退出工作区，现有工程的表达式计算沿用审批规则。

## 2. 宿主接口

Clip 路由保存在编辑器内部。构建脚本将导入的样式限定在 `.openreel-studio-root`。宿主提供主题和语言，菜单和浮层使用 Clip 内部容器。用户编写的内容和文件格式标准名保留原文。

画布合成通过宿主预约版本化 MP4，用浏览器支持的编码选项保留 seek 和 truncate，再上传原始字节。宿主校验并保存成片后按固定画布绑定提交下游。手工和 Agent 共用导出世代与任务顺序。手工导出可显式取消上传和 Host 任务，退出 Portal 后已预约的任务可继续。旧 `/save-export` 继续服务兼容调用。独立剪辑工坊提供各编码器支持的文件导出选项。[阶段 2 的 MP4 契约](clip-live-control.md#mp4-与画布提交)

供应商请求、密钥和模型路由由执行中心负责。OmniMux 宿主禁用上游浏览器剪辑对话、自备密钥直连、第三方生成提交与轮询，以及外部协作邀请和房间。旧设置迁移移除连接字段，旧生成占位素材按 Host `mediaResolver` 恢复，缺少源文件时在画布模式优先通过薄注入打开 OmniMux 画布同步与重连面板（`CanvasRelinkDialog.tsx`，复用 `dsh-ui-kit` 与语义 Token），替换缩短素材时由 `media-slice.ts` 收敛引用片段的入出点；`media-import-service.ts` 在 `mediabunny` 已读出音频轨数且本地/内存无快探测时跳过冷拉取远端 `ffmpeg-core.wasm` 的二次音轨计数；独立工坊继续保留本地目录重连回退。现有本地编辑、浏览器端媒体处理和宿主 Clip 工具继续通过原入口工作。

## 3. Vendor 根

上游实现位于 `plugins/omnimux-clip/src/client/openreel/`（相对插件工作区）。已清理的旧版 `src/client/engine/openreel/` 目录已从源码树移除，[插件静态扫描](../../scripts/auto-qa-scan.mjs)仍保留对这两条路径的识别规则以向后兼容既有扫描用例。宿主桥、应用入口和宿主 token 映射仍按产品规则检查。

### 3.1 简易模式 (`data-clip-ui-mode`) 五处声明式接缝

桌面独立工坊与工作流画布共用一套正交双轴契约：入口轴 `data-clip-mode="standalone" | "canvas"`，复杂度轴 `data-clip-ui-mode="simple" | "pro"`（默认 `simple`，持久化键 `omnimux.clip.uiMode`）。状态、持久化、专业态收敛 (`reconcileSimpleModeState`) 与样式全部位于 `openreel/` 外部适配器 `src/client/simple-mode/`（`uiModeStore.js`、`ClipModeToggle.jsx`、`ClipDrawerToggle.jsx`、`SimpleInspectorChrome.jsx`、`simple-mode.css`），入口壳 `OpenReelStudioTab.jsx` 与 `ClipStage.jsx` 同步挂载 `data-clip-ui-mode`。

`openreel/web/components/editor/` 仅保留以下 5 处最小声明式接缝，升级上游 `UPSTREAM_SHA` 时只需对照清单与 `simple-mode-contract.test.js` 逐项复核：

1. **布局壳层 (`EditorInterface.tsx`、`tour/useTour.ts`)**：订阅 `useClipUiMode()`，在 `!compact && isSimple` 时将左抽屉四项导航横置于 38px 顶部栏并支持折叠、无选区自动折叠右侧属性栏、隐藏底栏 (`data-clip-pro-only="true"`)，同时向 `registerSimpleModeStores` 注册实时 store 以便从 `pro` 切回 `simple` 时收敛状态（切模式不卸载 `<OpenReelApp />`）；`tour/useTour.ts` (`shouldAutoStartTour`) 在 `uiMode === "simple"` 时跳过自动弹出被动引导弹窗。
2. **顶栏 (`Toolbar.tsx`)**：外置 `<ClipDrawerToggle />`，给仅专业菜单/切换器/规格/队列/备份打上 `data-clip-pro-only="true"` 与 `.openreel-toolbar-brand-block`，并在右段 `<EditorExportControl>` 前接入 `<ClipModeToggle />`（严格保持画布导出与纯文本退出按钮契约）。
3. **左侧导航 (`EditorActionRail.tsx`)**：按 `SIMPLE_RAIL_SECTIONS` 为四项核心分区（`media` / `text` / `recipes` / `versions`）渲染 `.clip-rail-label` 并加 `data-clip-section`，其余分区打 `data-clip-pro-only="true"`。
4. **预览监看 (`Preview.tsx`、`PreviewTransportControls.tsx`、`preview/ProgramMonitorOverlays.tsx`)**：隐藏扩展头部栏、技术信息条、逐帧/出入点、循环钮与虚假色叠加触发器 (`data-clip-pro-only="true"`)。
5. **时间轴、素材与属性 (`Timeline.tsx`、`timeline/TrackHeader.tsx`、`AssetsPanel.tsx`、`InspectorPanel.tsx`、`inspector/shell/InspectorClipHeader.tsx`)**：时间轴保留 6 项核心操作并将扩展工具/序列Tab/声道表标记为 `data-clip-pro-only`；轨道头保留编号/名称与显隐或静音；素材面板在 `missingAssetsCount === 0` 时折叠顶部排序/代理/序列区、存在断链时继续透出重连；属性面板接入 `<SimpleInspectorCloseButton />` 与 `<SimpleInspectorFooter />`。

上游同步核对命令：`corepack pnpm --dir plugins --filter omnimux-clip test`、`corepack pnpm --dir plugins run verify:dsw-tokens`、`node scripts/workspace-check.mjs --check`。

## 4. 验收

合入前以工作树候选构建验证宿主样式、亮暗菜单和弹窗、窄屏、中英文切换、旧工程加载、空时间轴首个视频入轨和画布导出。时间轴调整、拖动和修剪期间检查宿主 `body` 的内联样式。画布分别核对源流重封装和逐帧编码输出，检查浏览器播放、`moov`、回执及关联节点。真实浏览器结果、构建和单测分别记录。[插件开发与交付](../../README.md#本地开发与交付)
