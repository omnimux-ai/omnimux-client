# Spec: 清理死代码、退役索引、失效脚本与收紧门禁基线（Wave 1）

- 任务：`cleanup-dead-code-indexes`
- 关联 Issue：`#351`
- 日期：2026-11-26
- 风险：低到中（仅移除全仓零活跃调用方的历史死代码、已退役索引/快照、断链脚本入口，以及 `omnimux-market` 未接线的旧预设包装与会话模型锁路由，无活跃功能与界面改动）

## 背景

随功能迭代，仓库内积累了三类无效负担：

1. **插件死代码与历史残留**：`omnimux-assets` 7 个旧表格/详情/缓存组件、`omnimux-accounts` 等 5 个插件残留的 12 行空壳 `stage-store.js`、`omnimux-clip` 已被 `src/client/openreel/` 替代的旧版 `src/client/engine/`（14 文件）与 `ClipBridge.js` / `openreelAdapter.js`、`omnimux-publish/src/client/views/CalendarView.jsx`、`omnimux-inspiration/src/explore/LibraryBrowser.jsx`、`omnimux-viewer/src/media-viewer/FloatingBottomComposer.jsx`、`omnimux` 3 个未接线组件与 3 个仅自测工具模块、`omnimux-market/src/presets/` 旧版创意预设弹窗包装及废弃会话模型锁（`getModelCatalog`/`getModelSelection`/`setModelSelection` + `session:selected-model`）。
2. **已退役索引与孤立目录文件**：`plugins/scripts/doc-index-gen.mjs`（`doc:index` 命令）、`omnimux-workflow` 停用主路径的历史 `projectIndexSchema` / `parseProjectIndex`、无引用方消费的 `omnimux-market/catalog/dropped.json` 与 `pending.json`。
3. **失效脚本入口**：`app/package.json` 的 `omnimux:dev`（指向不存在的 `plugins/scripts/dev-env.sh`），以及孤立脚本 `plugins/scripts/backup-shared.qa.test.py` 与 `plugins/scripts/verify-fix-modal-shot-index.mjs`。

## 目标

1. 彻底移除上述确认零生产引用方的死代码、退役索引与失效脚本入口，并保留 `omnimux` 活跃样式（`LINK_POPOVER_STYLES` 与 `DOCK_STYLES`）测试覆盖至 `promptSlotStyles.test.ts`。
2. 同步更新 `omnimux-clip` 许可声明（`LICENSE`、`THIRD_PARTY_NOTICES.md`、`plugins/scripts/license-registry.json` 与 `plugins/docs/contracts/openreel-vendor-contract.md`）。
3. 收紧 `--dsw-*` 与跨插件私有导入棘轮基线（`dsw-token-baseline.json`、`plugin-boundaries-baseline.json`），同步移除 `budget-baseline.json` 与 `governance-manifest.json` 失效条目，并在构建后刷新 `bundle.lock.json`。

## 非目标

- 不清理仍在分片架构中活跃使用的 `omnimux-assets/cloud-catalog/index.json` 与 `all/page-*.json`。
- 不触碰跨插件边界快照 `omnimux/src/client/session-guide/skills/featured-skills.json` 与 `omnimux` 被 `omnimux-assets` / `omnimux-inspiration` 复用的共享组件。
- 不删改双壳切换期受门禁保护的 `app/dsh-plugin-desktop/**`。
- 不删除 `omnimux-clip/src/client/stage-store.js` 与 `omnimux-market/src/presets/` 下实际服务活跃代码与技能的 5 个测试文件。
- `--managed-tarball` 与 `materialize-with-rollback.sh` 的退役留待 Wave 2 PR 单独交付。
- 本次不修改任何活跃产品界面样式或交互布局，不适用 HTML UI 演示。

## 研究依据

- 对全仓源码与配置检索确认，本次删除的文件/符号除清理清单显式处理的遗留测试与基线文件外无任何活跃调用方。
- `mediaUrlDetector.test.ts` 中包含仍在 `trayStyles.ts` 消费的 `LINK_POPOVER_STYLES` 与 `DOCK_STYLES` 链接胶囊断言，已在同目录下 `promptSlotStyles.test.ts` 无损承接后再删除旧文件。
- `app/scripts/omnimux.mjs` 的 `case 'dev'` 调用 `scripts/dev-env.sh`，经核查该脚本已不存在。

## 验收标准

- 所有受影响插件（`omnimux`、`omnimux-assets`、`omnimux-clip`、`omnimux-inspiration`、`omnimux-market`、`omnimux-publish`、`omnimux-viewer`、`omnimux-workflow`）构建与单测全部通过。
- `corepack pnpm --dir plugins run verify:gates`、`verify:plugin-load`、`node scripts/workspace-check.mjs --check`、`verify-test-standard-declarations.mjs`、`doc-lint.mjs`、`omnimux-paths.test.mjs` 与 `app` `typecheck` 全部通过。
- `dsw-token-baseline.json` 与 `plugin-boundaries-baseline.json` 仅做单向收紧，且 `governance-manifest.json` 无多余或缺失项。

## 假设

- 仓内所有插件及桌面壳均已完全迁移离开上述遗留文件与 API，不存在未静态引用的隐藏动态加载路径；该假设由 `verify:plugin-load`、全量构建及各插件单测直接验证。

## 证伪方式

- 在工作区执行全量插件构建、`verify:gates`、`verify:plugin-load`、`workspace-check.mjs --check` 及所有受影响插件与路径回归测试；任一环节因缺少模块或契约断言失败即证明存在未识别的活跃依赖。

## 旧标准变更

- `plugins/plugins/omnimux/src/host/loop-guard.test.js` :: `computeCallFingerprint - deterministic regardless of key order`
  - 原断言：验证无生产调用方的 `loop-guard.js` 键序无关指纹计算。
  - 必须改的理由：`loop-guard.js` 自初始化提交起零生产调用方，随 Wave 1 死代码清理一并移除。
  - 新期望证据：文件已移除，对应单测随死模块下线。
- `plugins/plugins/omnimux/src/host/loop-guard.test.js` :: `computeCallFingerprint - ignores timestamp differences`
  - 原断言：验证 `loop-guard.js` 忽略 `timestamp` 字段差异。
  - 必须改的理由：`loop-guard.js` 为零生产调用方死代码，随模块整体移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/host/loop-guard.test.js` :: `createLoopGuard - blocks on 3 identical calls in 5-call window`
  - 原断言：验证 `loop-guard.js` 重复调用阻断。
  - 必须改的理由：`loop-guard.js` 为零生产调用方死代码，随模块整体移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/host/loop-guard.test.js` :: `createLoopGuard - window slides out older calls`
  - 原断言：验证 `loop-guard.js` 滑动窗口淘汰。
  - 必须改的理由：`loop-guard.js` 为零生产调用方死代码，随模块整体移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/host/loop-guard.test.js` :: `sanitizeSubstantiveValue - removes transient fields`
  - 原断言：验证 `loop-guard.js` 过滤瞬态字段。
  - 必须改的理由：`loop-guard.js` 为零生产调用方死代码，随模块整体移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `inspiration media cache`
  - 原断言：`describe` 分组测试零生产调用方的 `inspiration-cache.js`。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随 Wave 1 死代码清理移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `matchesCondition`
  - 原断言：`describe` 分组测试 `inspiration-cache.js` 条件请求匹配。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `cacheResponseHeaders`
  - 原断言：`describe` 分组测试 `inspiration-cache.js` 缓存响应头。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `is a no-op without dataRoot`
  - 原断言：验证 `createMediaCache('')` 空根路径禁用。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `round-trips bytes and derived etag`
  - 原断言：验证 `inspiration-cache.js` 缓存读写往返。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `treats a missing bin as a miss even if meta exists`
  - 原断言：验证 `inspiration-cache.js` 缺失 `.bin` 时视为未命中。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `prunes oldest entries past the count cap`
  - 原断言：验证 `inspiration-cache.js` 超限裁剪旧条目。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `serves a stale body when allowStale is set`
  - 原断言：验证 `inspiration-cache.js` `allowStale` 返回过期数据。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `matches If-None-Match and If-Modified-Since`
  - 原断言：验证 `matchesCondition` 协商缓存头比较。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/official/inspiration-cache.test.js` :: `always emits a public max-age`
  - 原断言：验证 `cacheResponseHeaders` 输出 `Cache-Control`。
  - 必须改的理由：`inspiration-cache.js` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/client/attachments/mediaUrlDetector.test.ts` :: `isValidUrl: validates standard HTTP and HTTPS URLs`
  - 原断言：验证无生产调用方的 `mediaUrlDetector.ts` `isValidUrl`。
  - 必须改的理由：`mediaUrlDetector.ts` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除，`omnimux` 全量单测通过。
- `plugins/plugins/omnimux/src/client/attachments/mediaUrlDetector.test.ts` :: `isVideoUrl: detects video platform domains and media extensions`
  - 原断言：验证无生产调用方的 `mediaUrlDetector.ts` `isVideoUrl`。
  - 必须改的理由：`mediaUrlDetector.ts` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/client/attachments/mediaUrlDetector.test.ts` :: `resolvePlatformName: resolves clean platform or domain names without "视频" label`
  - 原断言：验证无生产调用方的 `mediaUrlDetector.ts` `resolvePlatformName`。
  - 必须改的理由：`mediaUrlDetector.ts` 零生产调用方，随模块移除。
  - 新期望证据：文件已移除。
- `plugins/plugins/omnimux/src/client/attachments/mediaUrlDetector.test.ts` :: `LINK_POPOVER_STYLES: ensures popover card has solid background and semantic styling`
  - 原断言：验证仍在活跃的 `LINK_POPOVER_STYLES` 弹层样式。
  - 必须改的理由：`mediaUrlDetector.test.ts` 随死模块移除，避免文件名误导。
  - 新期望证据：同名等效断言已完整迁入 `plugins/plugins/omnimux/src/client/attachments/promptSlotStyles.test.ts` 继续守护。
- `plugins/plugins/omnimux/src/client/attachments/mediaUrlDetector.test.ts` :: `DOCK_STYLES: provides brand purple link icon mask for composer chip`
  - 原断言：验证仍在活跃的 `DOCK_STYLES` 链接胶囊样式。
  - 必须改的理由：`mediaUrlDetector.test.ts` 随死模块移除。
  - 新期望证据：同名等效断言已完整迁入 `plugins/plugins/omnimux/src/client/attachments/promptSlotStyles.test.ts` 继续守护。
- `plugins/plugins/omnimux/src/client/components/inspiration-picker/picker-model.test.js` :: `InspirationPickerModal remains a thin reusable adapter while composer-add opens the page browser`
  - 原断言：读取已零引用的 `InspirationPickerModal.jsx` 源码并断言包含 `InspirationPicker` / `omnimux-inspiration:library`。
  - 必须改的理由：`InspirationPickerModal.jsx` 已随死代码清理移除，原文本读取会抛 `ENOENT`。
  - 新期望证据：改为直接断言 `InspirationPickerModal.jsx` 已不存在，且 `install.js` 仍不引入 `InspirationPickerModal`。
- `plugins/plugins/omnimux/src/client/composer-mode/composer-mode.test.js` :: `ComposerMode Contract: 插槽与组件联动架构校验`
  - 原断言：读取 `omnimux-market/src/presets/ComposerPresetsTriggers.jsx` 与 `ComposerPresetsChips.jsx` 源码断言其静默返回 null。
  - 必须改的理由：该两份零引用旧包装文件已从 `omnimux-market/src/presets/` 彻底移除。
  - 新期望证据：改为断言该两文件路径均已不存在，且其余 8 项活跃架构断言保持不变。
- `plugins/plugins/omnimux-market/src/presets/composer-presets.test.js` :: `CreativeDimensionModal i18n & one-click select contract verification`
  - 原断言：读取 `omnimux-market/src/presets/CreativeDimensionModal.jsx` 源码断言弹窗标题与单击选择代码。
  - 必须改的理由：零引用的 `omnimux-market/src/presets/CreativeDimensionModal.jsx` 已随死代码清理移除。
  - 新期望证据：已删除该条失效源码正则用例，同文件其余 3 条覆盖 `omnimux/src/client/presets/*` 活跃代码的用例保持全量通过。
- `plugins/plugins/omnimux-workflow/src/projects/projects.test.mjs` :: `T0 schema：冻结版本 + title 边界 + 高版本拒绝`
  - 原断言：调用已退役的 `host.parseProjectIndex` 并断言坏结构返回 null。
  - 必须改的理由：`projectIndexSchema`、`ProjectIndex` 与 `parseProjectIndex` 已作为停用历史契约从 `schema.ts` 与 `index.ts` 移除。
  - 新期望证据：移除该单行退役接口调用，保留 `parseProject` 全部 schema 版本与标题边界断言并通过单测。
- `plugins/plugins/omnimux-publish/src/client/english-locale-views.test.js` :: `CalendarView renders English month, week controls, status tooltip and overflow without CJK`
  - 原断言：加载并渲染零调用方的 `views/CalendarView.jsx`，校验英文文案与 tooltip 无中文泄漏。
  - 必须改的理由：`views/CalendarView.jsx` 在生产代码中零调用方（`publish-tiktok-flow.e2e.test.mjs` 显式断言视口已排除它），随 Wave 1 死代码清理整体移除。
  - 新期望证据：`CalendarView.jsx` 已从 `omnimux-publish` 移除，`english-locale-views.test.js` 其余全部活跃视图测试与 `omnimux-publish` 全套单测均通过。
- `plugins/scripts/backup-shared.qa.test.py` :: `*`
  - 原断言：Python 测试脚本尝试导入仓库中已不存在的 `agent-backup` / `_shared` 等历史脚本模块。
  - 必须改的理由：该脚本所测共享备份辅助模块早已被移除，自身已为无法运行的孤儿测试脚本，随 Wave 1 一并移除。
  - 新期望证据：文件已从 `plugins/scripts/` 与 `governance-manifest.json` 移除，治理注册表门禁零报错。
