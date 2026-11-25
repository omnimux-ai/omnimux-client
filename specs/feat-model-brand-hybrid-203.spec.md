# 混合品牌标识架构（方案 C）— 收敛全端品牌图标真源并消费网关品牌语义（Issue #203）

## 背景与目标

当前客户端存在四套独立维护的模型品牌映射与 SVG 资产（`ModelPicker.jsx`、`src/brand/model-brands.js` + `assets/brands/manifest.json`、`omnimux-workflow/src/canvas/ui/ModelBrandIcon.tsx` + `modelPickerCandidates.ts`、`omnimux-browser/extension/.../AutoModelPicker.tsx`），导致同一模型在不同面板呈现不同图标；同时 `ModelPicker.jsx` 将所有未命中正则的模型静默回落为 `bytedance`，导致未知品牌或新上架品牌模型被误标为字节跳动。

本任务落地「语义真源在网关（联动 `omnimux-gateway#104` / PR #119）、视觉资产在客户端单一共享库、受限 `24×24` 单色 `<path d>` 做离线安全降级」的完整 P0 + P1 + P2 混合架构：

- **P0（真源收敛与止血）**：在 `plugins/packages/dsh-ui-kit` 新增纯零依赖共享品牌模块 `dsh-ui-kit/model-brands`（`src/model-brands.js` + `src/model-brands.d.ts`）与无 `dangerouslySetInnerHTML` 的统一视觉解析/渲染能力；四端（Composer `ModelPicker`、Workflow `ModelBrandIcon` / `modelPickerCandidates`、Hub `/omnimux/api/brands`、Browser Extension `AutoModelPicker`）全部收敛到同一真源；移除 `ModelPicker.jsx` 默认回落 `bytedance` 的错误兜底，未识别模型展示中性首字母占位标。
- **P1（消费网关品牌语义与指纹解耦）**：在 `snapshot.js` 规范化并持久化网关 `/api/pricing` 新增的 `brand_id`、`brand_name` 与顶层 `brands` 字典；在 `gateway-contract.js`、`project.js`、`list.js`、`canvasCatalog.ts`、`operationUi.ts` 透传 `brandId` / `brandName` / `brandIconPath` 与 `brands`；明确区分**执行/能力摘要（`snapshotContentDigest`、`catalog.fingerprint`、`contractFingerprint`）**与**展示更新摘要（`snapshotPresentationDigest`、`presentationFingerprint`）**，确保仅调整品牌展示名或降级路径时能够落盘刷新 UI，同时绝不触发画布 `stale_fingerprint` / `input_changed` / `reconcileCanvasForCatalog`。
- **P2（受限单色矢量降级与安全门禁）**：对网关未知 `brandId` 且提供合法 `24×24` 单色 `<path d>` 的场景，在入口解析与前端渲染双层实施 fail-closed 校验（非空、≤ 4096 字节、无首尾空白、以 `M`/`m` 开头、仅允许 ASCII 白名单 `^[MmLlHhVvCcSsQqTtAaZz0-9., \t\r\n+-]+$`），渲染纯 React `<svg><path fill="currentColor" d={...}/></svg>`；非法路径静默降级至中性占位。

## 范围

- `plugins/packages/dsh-ui-kit/`：
  - 新增 `src/model-brands.js`、`src/model-brands.d.ts`、`src/model-brands.test.js`，在 `package.json` 暴露 `./model-brands` 子路径并将 `dsh-ui-kit` 单元测试接入工作区 `test` 脚本。
  - 提供规范品牌注册表（覆盖全部网关规范品牌及历史别名归一）、`mono` / `color` 双变体结构化矢量元素、四级确定性解析 `resolveBrandVisual()`、fail-closed 校验器 `isValidBrandId()` / `sanitizeBrandIconPath()`，以及向后兼容的 `BRAND_SVGS` / `BRAND_SVGS_MONO` / `resolveModelBrand()` / `getBrandInfo()` / `getAllBrands()`。
- `plugins/plugins/omnimux/`：
  - 新增零外部依赖纯 Node 目录校验模块 `src/catalog/brand-contract.js`（由 `model-brand-hybrid.test.js` 锁死与 `dsh-ui-kit/model-brands` 的严格一致性），保持 `src/catalog/*` 独立拷贝加载能力不被 UI 包依赖破坏。
  - `src/brand/model-brands.js` 改为薄代理消费 `dsh-ui-kit/model-brands`，消除第二套 SVG 与正则副本（`/omnimux/api/brands` 保持兼容并附带规范品牌信息）。
  - `src/catalog/cloud/snapshot.js`、`store.js`、`live.js`、`current.js`：解析并持久化 `brand_id`/`brand_name`/`brands`（入口校验 `icon_path`）；`snapshotContentDigest` 排除只读展示品牌字段以稳定执行指纹，新增 `snapshotPresentationDigest` 驱动 `store.acceptRefresh` 落盘与 `omnimux:model-catalog-updated` 通知。
  - `src/catalog/gateway-contract.js`、`runtime-index.js`、`display-labels.js`、`project.js`、`list.js`：优先透传网关 `brandId`/`brandName`/`brandIconPath` 与顶层 `brands`；`gateway-contract.js:familyFor()` 与 `display-labels.js` 退居 BYOK 与旧版快照兼容层；`runtime-index` 缓存键使用 `snapshotPresentationDigest` 以避免展示更新命中陈旧缓存，同时 `catalog.fingerprint` 与 `contractFingerprint` 保持对品牌展示变更不敏感。
  - `src/client/composer-quick-shortcuts/ModelPicker.jsx`、`styles.js`、`ModelPicker.brand.test.mjs`：移除本地 `BRAND_SVGS` / 正则与 `bytedance` 兜底及裸 HTML 注入，改由 `dsh-ui-kit/model-brands` 渲染纯 React `<svg>`（支持 `mono` 变体、网关 `brandId`/`brandName`/`brandIconPath` 与中性占位标）。
- `plugins/plugins/omnimux-workflow/`：
  - `src/shared/api.ts`、`src/workflow/seam/canvasCatalog.ts`、`src/shared/validation/operationUi.ts`、`src/canvas/editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts`、`modelVisuals.tsx`、`ModelCascadeMenu.tsx`、`src/canvas/ui/ModelBrandIcon.tsx`、`src/canvas/editor/hooks/catalogCache.ts`、`src/canvas/hooks/useCanvasBoot.ts`：全链路透传 `brandId`/`brandName`/`brandIconPath`/`brands` 与 `presentationFingerprint`；`ModelBrandIcon.tsx` 与 `modelPickerCandidates.ts` 收敛到 `dsh-ui-kit/model-brands` 并去除 `dangerouslySetInnerHTML`，支持四级降级与无前缀正则的新品牌分组展示。
- `plugins/plugins/omnimux-browser/extension/`：
  - `package.json` 引入 `dsh-ui-kit`（workspace link，零额外运行时依赖）；
  - `src/panel/components/AutoModelPicker.tsx` 收敛至 `dsh-ui-kit/model-brands` 渲染 `mono` React `<svg>`，并支持透传可选 `brandId`/`brandName`/`brandIconPath`。

## 事实依据

- 客户端主干 4 处独立品牌定义与分裂现状已在 `#203` 逐行核实：`ModelPicker.jsx:11-38,128-146,467`、`src/brand/model-brands.js:8-83` + `manifest.json`、`ModelBrandIcon.tsx:8-139` + `modelPickerCandidates.ts:33-69`、`AutoModelPicker.tsx:42-68,156-179`。
- 网关侧 `omnimux-gateway#104`（PR #119，已合入主干 `359841358`）已确立 `/api/pricing` 规范字段：`data[].brand_id`、`data[].brand_name`、`data[].contract.brand_id`、`data[].contract.brand_name` 及顶层 `brands[id] = { id, name, icon_path? }`，且 `contractVersion` 与 `effective_video.version` 已排除品牌展示字段。
- 画布侧 `canvasStore.ts:239`、`canvasInputMutationGateway.ts:243,277`、`resourcePickerPolicy.ts:758` 均消费 `catalog.fingerprint`；`list.js:332` 将 `gateway.digest`（来自 `snapshotContentDigest`）写入 `fingerprintOf()`，因此必须将 `snapshotContentDigest`（执行摘要）与 `snapshotPresentationDigest`（展示更新摘要）解耦。
- `dsh-ui-kit/src/kit-export.test.js:103-120` 禁止 `dsh-ui-kit/src/**/*.{tsx,module.css}` 出现字面量 hex/rgb/rgba；将品牌数据与色彩变体放在纯 JS 模块 `dsh-ui-kit/src/model-brands.js`、UI 占位样式走 `--dsw-alias-*` Token，可天然满足设计系统门禁且兼顾 Node/React 18/React 19/Extension 打包边界。

## 假设

- 规范 `brandId` 以网关 `modelcontracts/brands.go` 发布的厂商级稳定 slug 为准（例如 `seedream-*`/`seedance-*` 归一到 `bytedance`，`nano-banana-*`/`gemini-*` 归一到 `google`，`grok-*` 归一到 `grok` 显示名 `xAI`，`indextts-2` 归一到 `indextts` 显示名 `Index TTS2`）；工作流画布既有的按模型 `family`（如 `seedream` / `seedance`）分组体验在网关未覆盖或显式分组下保持兼容，同时新增未知网关品牌优先按 `brandId` / `brandName` 聚合。
- 当网关显式下发未知 `brandId`（例如 `acme-labs`）时，四级降级链跳过第 3 级本地前缀正则，直接尝试第 2 级安全 `iconPath` 否则落第 4 级中性占位，避免模型 ID 含 `gpt`/`seed` 等子串时被错误劫持为其他品牌。
- 当网关未下发 `brandId`（旧版快照或 BYOK 自定义模型）时，第 3 级本地前缀正则仍提供完整兼容识别，未命中则落第 4 级中性占位，绝不默认回落 `bytedance`。

## 证伪方式

- **P0 真源收敛与止血证伪**：
  - 将 `ModelPicker.jsx` 的中性占位回退改回 `bytedance`：新增的 `ModelPicker` E2E 断言（未知模型 `opaque-unknown-99` 不得渲染 `bytedance`、必须渲染中性占位标）立即转红。
  - 将四端任意一处的解析规则脱离 `dsh-ui-kit/model-brands` 并返回不一致的 `brandId`：跨端一致性回归测试立即转红。
- **P1 网关语义与执行指纹解耦证伪**：
  - 若在 `snapshotContentDigest` 中不再剔除 `brands`/`brandId`/`brandName`：新增的指纹解耦测试（修改 `brand_name` 与 `brands[].icon_path` 后断言 `snapshotContentDigest`、`catalog.fingerprint`、`contractFingerprint` 均不变，且画布 `setCatalogRuntime` 不触发 `reconcileCanvasForCatalog`、不产生 `input_changed`）立即转红。
  - 若 `store.acceptRefresh` 只看 `snapshotContentDigest` 而不看 `snapshotPresentationDigest`：纯品牌名/图标路径变更后的缓存落盘与 `onChanged` 通知回归测试立即转红。
- **P2 安全降级证伪**：
  - 传入恶意 `icon_path`（`<svg>`、`javascript:`、`https://...`、引号注入、超 4096 字节、首尾空白）：`sanitizeBrandIconPath` 与 UI 渲染测试验证其严格返回 `null` 并渲染中性占位，若放宽正则或允许裸 HTML 则安全测试立即转红。

## 旧标准变更

- `plugins/plugins/omnimux/tests/e2e/composer-shortcut-model-picker.e2e.test.mjs` :: `AC-11: resolveModelBrand 品牌解析准确性：seedream 正确返回 seedream，避免过度匹配`
  - 原断言期望 `ModelPicker.jsx` 私有映射将 `seedream`/`seedream-5-0-pro` 解析为 `seedream`、`nanobanana-2` 解析为 `nanobanana`；本任务按 Issue #203 架构决策将全端品牌解析统一收敛至网关规范 `brand_id`（`dsh-ui-kit/model-brands`），`seedream-*` 与 `seedance-*` 统一归属规范品牌 `bytedance`、`nanobanana-*` 归属规范品牌 `google`，同步更新该用例期望并新增未知模型返回 `null`（不再回落 `bytedance`）及 AC-13/AC-14 回归用例。
- `plugins/plugins/omnimux-browser/extension/tests/auto-model-picker.spec.ts` :: `resolveModelBrandKey：字典命中 → 前缀回退（gpt*/grok*）→ 未登记不渲染`
  - 原扩展内联白名单仅支持 `openai` / `grok` 故将 `claude-9` 判为 `null`；收敛至共享品牌库 `dsh-ui-kit/model-brands` 后 `claude-9` 规范识别为 `anthropic`，未登记品牌断言改用真正未注册的 `opaque-unknown-9` 与空串验证返回 `null`，并新增网关安全 `iconPath` 与恶意 `iconPath` 拦截用例。
- `plugins/plugins/omnimux-workflow/tests/e2e/modelCascadeMenu-indextts2-brand.e2e.test.mjs` :: `e2e: model cascade menu groups gxgenai/index-tts as Index TTS2 brand`
  - 原用例以正则 grep `ModelBrandIcon.tsx` 源码内联的 `indextts:` 与 `brand: 'indextts'` 字面量；收敛至共享真源 `dsh-ui-kit/model-brands` 后 SVG 与匹配规则由共享包统一提供，改为断言真实运行时解析与共享资产（`resolveModelBrand('indextts-2') === 'indextts'`、`BRAND_SVGS.indextts` 存在且 `groupPickerCandidates` 正确归组为 `Index TTS2`），并配套新增 `ModelBrandIcon.hybrid.test.mjs` 真 DOM 与缓存解耦回归，断言力度只增不减。
