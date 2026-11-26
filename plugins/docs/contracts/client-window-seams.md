---
title: "客户端 window.__omnimux* 跨插件全局接缝契约"
id: "contract-client-window-seams"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-26"
updated: "2026-11-26"
---

# 客户端 `window.__omnimux*` 跨插件全局接缝契约

OmniMux 客户端插件分别独立打包为单文件 `lib/client.js`（由宿主 `window.__ModuleLoader__.load` 加载）。垂直插件不得通过相对路径跨包导入 Hub 内部模块（由 `plugins/scripts/verify-plugin-boundaries.mjs` 门禁约束），因此跨插件协作统一通过窄接口挂载到浏览器 `window.__omnimux*`（或经 `dsh-ui-kit` 封装消费）。

本文档是全仓生产态 `window.__omnimux*` 全局接缝的**唯一权威索引**（覆盖全部 43 个运行态标识），标明每个接缝的唯一生产者、消费方、契约形态与生命周期状态。

## 治理硬约束

1. **单一生产者与卸载清理**：每个 `window.__omnimux*` 必须归属唯一插件模块负责安装，并在 `ctx.effect` 卸载回调中通过身份校验（`if (window.__omnimuxX === api) delete window.__omnimuxX`）回收，禁止热重载后残留悬空句柄。
2. **优先消费共享封装**：侧栏入口统一调用 `dsh-ui-kit` 的 `createWorkbenchSidebarEntry` / `createWorkbenchStageStore`，额度预检统一调用 `dsh-ui-kit/quota-request`，原生文件选择统一调用 `dsh-ui-kit/native-file-picker`，不得在垂直插件内重复复制轮询垫片。
3. **新增或退役必须同步建档**：新增、改名或移除 `window.__omnimux*` 接缝时，须在同 PR 更新本文档；禁止为规避打包边界而私自透出未登记的内部 Store。

## 易混淆与语义重叠命名对照

| 易混淆组合 | 真实分工与推荐口径 |
|---|---|
| `__omnimuxWorkbench` vs `__omnimuxStage` | `__omnimuxWorkbench` 是当前唯一工作台右栏 Tab 权威入口（`open`、`closeTab`、`isActive`、`createSidebarStore` 等）；`__omnimuxStage` 仅为历史全屏 overlay 兼容层，禁止新一级页面调用 `__omnimuxStage.claim`，`workbench` 打开 Tab 时会主动释放遗留 Stage。 |
| `__omnimuxSidebar` vs `__omnimuxBetterSidebar` | `__omnimuxSidebar` 是 Hub 左侧栏入口协调器（按 `rank` 统一挂载按钮，供 `dsh-ui-kit` 调用）；`__omnimuxBetterSidebar` 是 `omnimux-workflow` 缓存的宿主右侧栏 `betterSidebar` 服务引用，供 `open-app` 与发布向导回落打开 Tab。 |
| `__omnimuxComposerMode` vs `__omnimuxComposerModeStore` | 二者均由 `omnimux/src/client/composer-mode/composer-mode-store.js` 发布：`__omnimuxComposerMode` 暴露当前模式值快照，`__omnimuxComposerModeStore` 暴露带订阅能力的完整 Store。新消费者优先读 Store，勿新增平行模式变量。 |
| `__omnimuxSessions` / `__omnimuxWorkspaces` / `__omnimuxRemote` | 仅作老壳或独立验证环境的只读兜底通道；垂直插件应优先通过 Cordis `ctx.inject` 注入官方 `sessions` / `workspaces` / `remote` 服务。 |

---

## 一、核心工作台与宿主壳接缝（8 项）

| 全局标识 | 生产者（单一真源） | 主要消费者 | 接口形态与职责 | 状态 |
|---|---|---|---|---|
| `__omnimuxWorkbench` | `plugins/plugins/omnimux/src/client/workbench.js` (`WORKBENCH_GLOBAL_KEY`) | `dsh-ui-kit` (`createWorkbenchStageStore`) 及全部业务插件客户端 | 右栏工作台总控 API：`open`、`closeTab`、`closePanel`、`isOpen`、`isActive`、`subscribe`、`bind`、`createSidebarStore`、`getCurrentSessionId`、`getFocus`、`setFocus`、`ensureConversationVisible`、`registerContextContributor` 等 | `active` |
| `__omnimuxSidebar` | `plugins/plugins/omnimux/src/client/sidebar-coordinator.js` (`SIDEBAR_GLOBAL_KEY`) | `dsh-ui-kit` (`createSidebarEntry.ts`)、`omnimux` (`auth-gate.js`)、`omnimux-workflow` (`sidebar-new-project.js`)、`omnimux-pibrowse` (`sidebar-entry.js`) | 左侧栏一级入口与「更多」菜单协调器：`register({ id, rank, styles, styleId, create }) => dispose`、`registerExploreItem(...)` | `active` |
| `__omnimuxStage` | `plugins/plugins/omnimux/src/client/stage.js` (`STAGE_GLOBAL_KEY`) | `dsh-ui-kit` (`createStageStore.ts`)、`omnimux` (`workbench/sidebar-controller.js` 释放逻辑)、`omnimux-analytics` (`stage-tracker.js`)、`omnimux-clip` | 历史全屏 Stage 协调接口（`claim` / `release` / `readBox`）；一级业务页已迁至 `__omnimuxWorkbench`，仅保留释放与分析追踪兼容 | `legacy-compat` |
| `__omnimuxAuth` | `plugins/plugins/omnimux/src/client/auth-gate.js` (`AUTH_GLOBAL_KEY`) | `dsh-ui-kit` (`createSidebarEntry.ts`)、`app/dsh-desktop-next` (`onboarding.tsx`)、`omnimux`、`omnimux-accounts`、`omnimux-analytics`、`omnimux-inspiration`、`omnimux-publish` | 统一登录门控：`isLoggedIn`、`peekCache`、`getSnapshot`、`getIdentitySnapshot`、`ensureLogin`、`subscribe` | `active` |
| `__omnimuxQuota` | `plugins/plugins/omnimux/src/client/quota-gate.js` (`QUOTA_GLOBAL_KEY`) | `dsh-ui-kit/src/quota-request.js`、`omnimux` (`quota-precheck.js`)、`omnimux-workflow` 画布节点 | 额度预检与不足提示通道，垂直插件优先经 `dsh-ui-kit/quota-request` 消费 | `active` |
| `__omnimuxHubEvents` | `plugins/plugins/omnimux/src/client/events-client.js` (`HUB_EVENTS_GLOBAL_KEY`) | `omnimux` (`ProviderConfigPanel.jsx`、`AttachmentSubmitBridge.jsx`)、`omnimux-assets`、`omnimux-clip` | 客户端 SSE / Hub 实时事件总线门面（订阅服务端资产、导出、任务等事件） | `active` |
| `__omnimuxTabViewport` | `plugins/plugins/omnimux/src/client/workbench/tab-viewport-reconciler.js` | `omnimux` (`sidebar-controller.js`)、`omnimux-workflow` (`projectCanvas.js`) | 右栏视口全屏/分栏程序化切换防抖协调器（`beginProgrammatic` / `endProgrammatic`） | `active` |
| `__omnimuxEnterRightSidebarFullscreen` | `plugins/plugins/omnimux/src/client/workbench/tab-viewport-reconciler.js` | `omnimux` (`tab-viewport-reconciler.js`)、`omnimux-workflow` (`projectCanvas.js`) | 触发宿主右侧栏进入全屏态的桥接函数 | `active` |

## 二、输入栏、附件、引用、技能与预设接缝（16 项）

| 全局标识 | 生产者（单一真源） | 主要消费者 | 接口形态与职责 | 状态 |
|---|---|---|---|---|
| `__omnimuxAttachments` | `plugins/plugins/omnimux/src/client/attachments/store.ts` | `omnimux`、`omnimux-assets`、`omnimux-inspiration`、`omnimux-workflow`、`omnimux-viewer` | 跨插件会话附件 Store（按会话增删查与提交绑定，防多包打包产生双实例） | `active` |
| `__omnimuxComposerActions` | `plugins/plugins/omnimux/src/client/composer-add/AttachmentSubmitBridge.jsx` | `omnimux`、`omnimux-inspiration`、`omnimux-market`、`omnimux-workflow` | 聊天输入栏操作桥（插入文本、聚焦编辑器、提交桥接） | `active` |
| `__omnimuxComposerFiles` | `plugins/plugins/omnimux/src/client/attachments/native-files-bridge.js` (`COMPOSER_FILES_GLOBAL`) | `omnimux` (`native-files-bridge.js`)、`omnimux-inspiration` (`collection-to-chat.js`) | 按 `sessionId` 索引的原生文件选择器与附件桥表 | `active` |
| `__omnimuxComposerMode` | `plugins/plugins/omnimux/src/client/composer-mode/composer-mode-store.js` | `omnimux-market` (`skill-picker.js`) | 输入栏当前模式只读快照 | `active` |
| `__omnimuxComposerModeStore` | `plugins/plugins/omnimux/src/client/composer-mode/composer-mode-store.js` | `omnimux-market` (`skill-picker.js`) | 输入栏模式 Store 单例（支持 `getSnapshot` / `subscribe`） | `active` |
| `__omnimuxComposerPrefill` | `plugins/plugins/omnimux/src/client/media-viewer/composer-prefill.js` (`STORE_KEY`) | `omnimux` (`media-viewer/composer-prefill.js`) 及经其桥接的 `omnimux-viewer` | 媒体预览器回填聊天输入栏的跨包单例 Store | `active` |
| `__omnimuxReference` | `plugins/plugins/omnimux/src/client/reference/index.ts` | `omnimux-assets` (`add-to-chat.js`)、`omnimux-products` (`reference.js`)、`omnimux-workflow` (`useAddToConversation.ts`) | 统一实体引用分发接口（资产、商品、画布节点统一送入对话） | `active` |
| `__omnimuxShadowContext` | `plugins/plugins/omnimux/src/client/reference/shadow-context.ts` | `omnimux` (`reference/shadow-context.ts`) | 引用上下文影子表单例（防止重复实例化） | `internal-guard` |
| `__omnimuxActivePreset` | `plugins/plugins/omnimux/src/client/agent-preset-enhancer.js` | `omnimux` (`isTikTokAgentPreset.js`、`expertBootstrapCatalog.js`)、`omnimux-market` (`skill-picker-logic.js`) | 当前会话激活的 Agent 预设标识，供快捷技能栏、专家首启引导条与预设绑定过滤读取 | `active` |
| `__omnimuxActiveSkill` | `plugins/plugins/omnimux/src/client/composer-add/skill-event.ts`、`omnimux-market` (`session-create.js`, `skill-picker.js`) | `omnimux`、`omnimux-market` | 当前输入栏选中的 Skill 状态与同步缓存 | `active` |
| `__omnimuxSkillLibrary` | `plugins/plugins/omnimux-market/src/client/apply.js` | `omnimux` (`ComposerQuickShortcuts.jsx`、`catalog.js`、`index.js`) | 出厂预设技能只读解析通道：`{ resolvePresetSkill(slug) }`（无会话态，严格只读） | `active` |
| `__omnimuxExpertStarters` | `plugins/plugins/omnimux-market/src/client/apply.js`（由 `skill-plaza.js` 经 `.update()` 原地刷新） | `omnimux` (`expertBootstrapCatalog.js`、`ExpertBootstrapBar.jsx`) | 专家市场 SOP 专家空白会话起手式只读通道：`{ resolveStarters(presetId), listExpertIds(), update(items) }`，卸载时由 `apply.js` 按对象身份清理 | `active` |
| `__omnimuxInstalledSkills` | 宿主/运行态按需注入（未注入时安全降级） | `omnimux` (`composer-commands-i18n.js`) | 已安装技能列表只读快照，供斜杠命令补全过滤 | `legacy-compat` |
| `__omnimuxPresetAvatars` | 宿主可选注入（`PRESET_AVATAR_HOST_KEY`） | `omnimux` (`agent-preset-enhancer.js`) | 预设头像覆盖映射表（缺失时回落确定性生成头像） | `active` |
| `__omnimuxSessionPrefill` | `plugins/plugins/omnimux/src/client/forms/mount.js` | `omnimux-inspiration` (`session-prefill.js`) | 新建或跳转会话时的一次性预填文本通道 | `active` |
| `__omnimuxLocale` | `plugins/plugins/omnimux-market/src/client/apply.js` | `omnimux` (`promptFenceGenerate.ts`、`focus-state.js`、`ExpertBootstrapBar.jsx`)、`omnimux-market` (`i18n.js`) | 当前宿主 `locale` 服务引用缓存 | `legacy-compat` |

## 三、垂直插件与工作流桥接接缝（11 项）

| 全局标识 | 生产者（单一真源） | 主要消费者 | 接口形态与职责 | 状态 |
|---|---|---|---|---|
| `__omnimuxWorkflow` | `plugins/plugins/omnimux-workflow/src/client/projects/workflow-global.js` (`WORKFLOW_GLOBAL_KEY`) | `omnimux-clip` (`media-handoff.js`)、`omnimux-workflow` (`CanvasTab.jsx`, `index.js`) | 工作流跨插件桥（`startReplicationProject` 及宿主 `sessions` / `workspaces` 句柄） | `active` |
| `__omnimuxWorkflowCanvas` | `plugins/plugins/omnimux-workflow/scripts/build-canvas.mjs` (`globalName`，入口 `src/canvas/index.tsx`) | `omnimux-workflow` (`CanvasBridge.jsx`) | 画布独立 IIFE 产物挂载点 | `active` |
| `__omnimuxWorkflowDirector` | `plugins/plugins/omnimux-workflow/scripts/build-director.mjs` (`globalName`) | `omnimux-workflow` (`directorLoader.ts`，负责消费与卸载清理) | 导演编排独立产物按需加载挂载点 | `active` |
| `__omnimuxClipReady` | `plugins/plugins/omnimux-clip/src/client/CanvasBridge.js` | `omnimux-workflow` (`src/canvas/App.tsx`) | 剪辑插件就绪布尔信号（`true`）；画布→剪辑交接本身通过 `OMNIMUX_CLIP_OPEN` `CustomEvent` 触发 | `active` |
| `__omnimuxClipStageStore` | `plugins/plugins/omnimux-clip/src/client/stage-store.js` | `omnimux-clip` (`stage-store.js`) | 剪辑器 StageStore 单例挂载点（防模块重复加载导致双份状态） | `internal-guard` |
| `__omnimuxForms` | `plugins/plugins/omnimux/src/client/forms/mount.js` | `omnimux-forms` (`FormsPage.jsx`) | Hub 表单运行态与草稿恢复桥接对象 | `active` |
| `__omnimuxInspirationPreview` | `plugins/plugins/omnimux-inspiration/src/client/preview-service.jsx` | `omnimux` (`TrendingDetailModal.jsx`)、`omnimux-inspiration` | 灵感详情预览弹窗跨插件调用入口 | `active` |
| `__omnimuxAssetHubNavStore` | `plugins/plugins/omnimux/src/client/workbench/asset-hub-store.js` | `omnimux` 与 `omnimux-assets`（通过 `asset-hub-store.js`） | 资产中心导航状态跨包单例，避免 `omnimux` 与 `omnimux-assets` 双份打包后状态分裂 | `deprecation-candidate` |
| `__omnimuxProductsIntent` | 历史外部/旧跳转方写入（当前仓内无活跃写入方） | `omnimux-assets` (`AssetsStage.jsx` 读取后一次性删除) | 商品库并入资产库后的历史一次性页签跳转意图兼容读取点 | `legacy-compat` |
| `__omnimuxOpenAppTab` | `plugins/plugins/omnimux-workflow/src/client/projects/projectCanvas.js` | `omnimux` (`open-app.js`)、`omnimux-workflow` (`PublishWizardModal*.tsx`) | 打开已发布应用页签的快捷桥接函数 | `active` |
| `__omnimuxBetterSidebar` | `plugins/plugins/omnimux-workflow/src/client/projects/projectCanvas.js` | `omnimux` (`open-app.js`)、`omnimux-workflow` (`PublishWizardModal.tsx`) | 缓存的宿主 `betterSidebar` 服务引用 | `legacy-compat` |

## 四、历史宿主兼容兜底与内部幂等守卫标记（5 项）

| 全局标识 | 生产者 / 宿主位置 | 消费者 | 用途说明 | 状态 |
|---|---|---|---|---|
| `__omnimuxSessions` | 仅独立验收夹具或旧壳按需注入 | `omnimux-market` (`session-create.js`, `skill-picker.js`)、`omnimux-workflow` (`CanvasTab.jsx`) | `ctx.sessions` 缺失时的只读兜底通道 | `legacy-compat` |
| `__omnimuxWorkspaces` | 仅独立验收夹具或旧壳按需注入 | `omnimux-market` (`session-create.js`)、`omnimux-workflow` (`CanvasTab.jsx`) | `ctx.workspaces` 缺失时的只读兜底通道 | `legacy-compat` |
| `__omnimuxRemote` | 仅独立验收夹具或旧壳按需注入 | `omnimux-market` (`session-create.js`) | `ctx.remote` 缺失时的只读兜底通道 | `legacy-compat` |
| `__omnimuxWorkbenchHooked` | `plugins/plugins/omnimux/src/client/workbench.js`（挂在 `service` 实例） | `omnimux` (`workbench.js`) | 防止同一 `betterSidebar` 服务被重复订阅 `subscribeState` 的幂等标记 | `internal-guard` |
| `__omnimuxRetiredTabsSweptSessions` | `plugins/plugins/omnimux/src/client/workbench/sidebar-controller.js`（挂在 `service` 实例） | `omnimux` (`sidebar-controller.js`) | 记录已完成下架 Tab 清理的 `sessionId` 集合（防重复扫描） | `internal-guard` |

## 五、浏览器扩展内容脚本私有标记（3 项）

以下标识仅存活于 `omnimux-browser` Chrome 扩展注入的网页内容脚本上下文，不参与桌面 Electron 宿主内的插件协作：

| 全局标识 | 所在文件 | 用途说明 | 状态 |
|---|---|---|---|
| `__omnimuxAccountRefreshStarted` | `plugins/plugins/omnimux-browser/extension/src/content/index.ts` | 内容脚本防重复启动账号刷新守卫标志 | `internal-guard` |
| `__omnimuxUrl` | `plugins/plugins/omnimux-browser/extension/src/content/capture/douyin-main.ts` | XHR/Fetch 拦截器在请求对象上缓存的原始请求 URL | `internal-guard` |
| `__omnimux_fab_unsubscribe` | `plugins/plugins/omnimux-browser/extension/src/content/fab-companion.ts` | 悬浮球伴随脚本重注入前的旧订阅清理函数 | `internal-guard` |
