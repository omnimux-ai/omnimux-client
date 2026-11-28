# 剪辑原生动效与模板复刻（Phase 1）

将 OpenMotion 的参考拆解与参数化动效能力蒸馏至 OmniMux：以 `omnimux-clip`（OpenReel v1）作为唯一时间轴与成片母舰，向 Agent 透出内核已内置的声明式动效与包装能力（`GraphicTemplate`、`EditingTemplate`、关键帧动画、25 种文字动效），配套原创 `clip-recreate` 编排 Skill。

## 目标与范围

用户可以在左侧主对话要求拆解参考视频、调用参数化图形与一键包装模板、设置关键帧与文字动画，并在右侧 OpenReel 时间轴继续手工拖拽参数与导出 MP4。

- **包含范围**：
  - 新增只读工具 `clip_templates` 与同源路由 `GET /omnimux-clip/api/templates`（支持内置 `GraphicTemplate`、`EditingTemplate`、`TextAnimationPreset` 及 `omnimux-assets` 受管自定义模板查询）。
  - `clip_edit` 扩展 6 个原子操作：`add_graphic_instance`、`update_graphic_params`、`remove_graphic_instance`、`apply_editing_template`、`set_keyframes`、`set_text_animation`。
  - `clip_get` 扩展安全投影：`graphicInstanceCount`、`graphicInstances[]`、`graphicInstanceId`、`keyframeCount`、`textAnimationPreset`。
  - `omnimux-clip` 捆绑并注册原创 Skill `clip-recreate`。
- **明确不包含**：
  - 严禁开放 OpenReel 自定义 JS 表达式或代码审批字段（维持 `motion-expression-denied` 红线）。
  - 不新增第二套编辑器、不引入无头浏览器代码渲染器（留给 Phase 3）和 ASR 词级转写（留给 Phase 2）。
  - 零修改 `plugins/plugins/omnimux-clip/src/client/openreel/` 上游核心目录。

## 假设与契约边界

- Host `.js` 模块不能直接导入 `src/client/openreel/` 下的 `.ts` 文件，因此通过 `scripts/build-client.mjs` 新增节点产物 `lib/openreel-templates.js`，供 `clip_templates` 与 Host 模板校验同源复用 OpenReel 内置目录与 `validateGraphicTemplate`。
- `applyEditingTemplate` 在 OpenReel Web Store 中会读写 `useEngineStore` 单例并直接推送全局状态；为保证 `clip_edit` 的 `validateOnly: true` 零副作用与单批原子回滚，桥接层 `native-templates.ts` 仅复用 `resolveEditingTemplate` 与独立 `TitleEngine` / `GraphicsEngine` 实例在 `NativeDraft` 副本上纯计算。
- `keyframe/setAll` 在 `clip-helpers.ts` 仅查找轨道 `clips[]`（媒体片段），对 `textClips` 须走 `draft.action('text/update', ...)`，对 `shapeClips` / `svgClips` 须走 `draft.action('shape/update', ...)` / `draft.action('svg/update', ...)`。
- `resizeGraphic` 传入 `startTime` 时会锁定右边界，因此当 `update_graphic_params` 同时更新 `startSec` 与 `durationSec` 时，先调用 `moveGraphic` 再调用 `resizeGraphic({ duration })`。
- 工具入参严格遵守 DSH Host JSON Schema 子集：模板参数与控件值采用 `[{ id, value }]` 数组而非动态键对象，范围关键字经 `toHarnessParameters` 剥离并由 `validateValue` 执行领域校验。

## 工具与 HTTP 契约

### 1. `clip_templates` 与 `GET /omnimux-clip/api/templates`

- `GET /omnimux-clip/api/templates` 挂载于 `CLIP_API_PREFIX`，继承 `auth: 'required'` 与 `requestRejection` fail-closed 守卫（未鉴权返回 401/403，连接服务缺失返回 503）。
- `clip_templates` 参数：`kind?`（`all` | `graphic` | `editing` | `text_animation`）、`category?`、`templateId?`、`includeAssetLibrary?`。
- 开启 `includeAssetLibrary` 时，扫描受管资产库中的 JSON 文件并经 `validateGraphicTemplate` 校验，仅返回合法模板，不泄露宿主机绝对路径；未知 `templateId` 抛出 `template-not-found`。

### 2. `clip_edit` 新增操作

- `add_graphic_instance`：`templateId` 与 `libraryAssetId` 严格二选一（`fileId` 仅配合 `libraryAssetId`），`startSec` 必填，`durationSec?`、`trackId?`、`instanceId?`、`name?`、`params?`（`[{ id, value }]`）。自定义模板在 Host 侧读取并经 `validateGraphicTemplate`（含 `svgIsSafe`、层数与字节上限、原型污染检查）预审后注入，失败抛 `template-invalid` 或 `path-denied`。
- `update_graphic_params`：必填 `instanceId`，至少传 `params`、`startSec`、`durationSec`、`trackId` 之一；拉长或缩短仅伸缩中间停留时长，保护首尾动效区间；未知或非法参数抛 `graphic-param-invalid`。
- `remove_graphic_instance`：必填 `instanceId`，`ungroup?: boolean`（`true` 时拆散为独立普通图层）。
- `apply_editing_template`：必填 `clipId`（仅限 `video` / `image` 媒体片段）与 `templateId`，可选 `controls?: [{ id, value }]`。
- `set_keyframes`：必填 `clipId` 与 `keyframes[]`（`property`、`timeSec`、`value`、`easing?`），`mode?: 'merge' | 'replace'`；越界时间或数值抛 `keyframe-out-of-range`。
- `set_text_animation`：必填 `clipId`（仅限非模板成员普通 `text` 片段）与 `preset`，可选 `inDurationSec`、`outDurationSec`、`unit`、`staggerSec`、`outPreset`。
- 成员保护：直接用 `set_text`、`set_text_animation` 或 `set_keyframes` 修改属于 `GraphicInstance` 的 `<instance>__<layer>` 成员片段时，抛出 `graphic-member-readonly`（409）。

## 源码改造清单

- `plugins/plugins/omnimux-assets/src/index.js`、`src/library-service.test.js`（在 `assetLibrary` 窄服务增加只读 `listAssets` 与 `readTextFile`）
- `plugins/plugins/omnimux-clip/src/templates/openreel-entry.ts`（新增，导给 Node 打包入口）
- `plugins/plugins/omnimux-clip/scripts/build-client.mjs`、`.gitignore`、`package.json`、`dsh.manifest.json`（构建并打包 `lib/openreel-templates.js`，并在清单登记 `clip_templates` 与 `clip-recreate`）
- `plugins/plugins/omnimux-clip/src/templates/catalog.js`（新增，Host 模板目录与自定义模板验证共用服务）
- `plugins/plugins/omnimux-clip/src/errors.js`（补充 5 个领域错误 HTTP 状态映射）
- `plugins/plugins/omnimux-clip/src/http/routes.js`、`src/index.js`（新增 `GET /templates` 并透传 `getAssetLibrary`）
- `plugins/plugins/omnimux-clip/src/media/authorizeToolMedia.js`（Host 预审 `add_graphic_instance` 与 `apply_editing_template`）
- `plugins/plugins/omnimux-clip/src/timeline/nativeProjectView.js`（扩展安全投影）
- `plugins/plugins/omnimux-clip/src/client/live/native-templates.ts`、`src/client/live/native-input.ts`、`src/client/live/native-overlays.ts`、`src/client/live/native-edit.ts`（原生草稿桥接、成员保护与 `reconcileGraphicInstances`）
- `plugins/plugins/omnimux-clip/src/tools.js`（注册 `clip_templates` 与 6 个新 op）
- `plugins/plugins/omnimux-clip/skills/clip-recreate/SKILL.md`、`src/clip-skills.js`（注册原创复刻 Skill）
- `plugins/docs/contracts/plugin-agent-tools-inventory.md`、`plugins/docs/contracts/clip-live-control.md`（同步工具清单与契约）
- `bundle.lock.json`（随 `omnimux-assets` 与 `omnimux-clip` 源码更新重算包哈希并校验通过）

## `clip-recreate` Skill 边界

`clip-recreate` 专注于参考拆解、商品与风格替换、`MotionSpec` 映射与双帧对照自检，时间轴操作与导出遵守 `clip-craft`；明确声明无法等比还原重度 3D 或复杂代码图表，不编造模板 ID 与参数，不将原参考视频整段直接塞入工程。

## 证伪方式

| 验收项 | 操作与判定 |
| --- | --- |
| AC-M1-01 Host 工具注册与双面一致性 | 使用 DSH Host `projectToolSchema` 校验全部 10 个 Clip 工具；验证 `GET /omnimux-clip/api/templates` 的 401/403、缺失 connection 503 与同源返回。 |
| AC-M1-02 图形模板实例化与参数热更新 | `add_graphic_instance` 创建 `builtin-lt-classic-bar`，`clip_get(view: 'full')` 检出 `graphicInstances[]`；`update_graphic_params` 改文案/颜色保留原 `instanceId` 并重建成员层。 |
| AC-M1-03 首尾保护时长与成员只读守卫 | `update_graphic_params` 延长时长保留入退场保护；直接改成员层抛 `graphic-member-readonly`；`ungroup: true` 拆散后可编辑。 |
| AC-M1-04 一键包装模板原子性与预演 | `apply_editing_template('overlay-progress-bar')` 在 `validateOnly: true` 下不改 `revision`、全局 Store 与撤销栈；正式应用后单次 Undo 全量清空。 |
| AC-M1-05 关键帧与 25 种文字动效 | `set_keyframes` 覆盖 media/text/shape 片段，`timeSec` 或 `opacity` 越界抛 `keyframe-out-of-range`；`set_text_animation` 设置 `typewriter` 及独立退场动效。 |
| AC-M1-06 批次联动与状态同步 | 同批 `add_graphic_instance` + `remove_range(ripple: true)` 经 `reconcileGraphicInstances` 同步；半合法批次原子回滚。 |
| AC-M1-07 安全与资产边界回归 | 含 `<script>`/`onload=`/`foreignObject`/外链 `href` SVG 或 `__proto__` 的模板抛 `template-invalid`；越权资产抛 `path-denied`；脚本字段继续抛 `motion-expression-denied`。 |
| AC-M1-08 Skill 发现与完整构建门禁 | `ctx.skills` 返回 `clip-craft` 与 `clip-recreate`；工作区 `build:all`、`verify:tools`、`test:agent-tools`、`verify:plugin-load` 与 `omnimux-clip` 测试全绿。 |

## 本地测试证据

- `corepack pnpm --dir plugins run build:all`：13 个插件全部构建通过（`omnimux-clip` 含 `lib/openreel-templates.js` 与 `lib/client.js`，`omnimux-assets` 同步通过）。
- `node scripts/bundle-lock.mjs && node scripts/workspace-check.mjs --check`：`bundle.lock.json` 重算并校验一致（`dsh-version`、`bundle-lock` 13 个插件、`verify-docs-dsh-version`、`workspace-check` 全 `OK`）。
- `corepack pnpm --dir plugins verify:tools`：0 个阻断错误（`omnimux-clip` 10 个工具与 `dsh.manifest.json`、`inventory.md`、`inject`、output 契约 100% 对齐）。
- `corepack pnpm --dir plugins test:agent-tools`：81 个插件工具通过 Layer 1/2 契约与隔离调用，离线正则冒烟 8/8，Layer 4 安全审计 6 个敏感变更工具通过。
- `corepack pnpm --dir plugins verify:plugin-load` & `corepack pnpm --dir plugins test:plugin-load`：15/15 包加载检查通过，单测 9/9 通过。
- `corepack pnpm --dir plugins verify:skill-bilingual` / `verify:skill-hygiene` / `verify:global-skills` / `check:boundaries` / `check:package-files` / `verify:licenses` / `verify:product-baseline` / `verify:agents-skills`：全部退出码 0（全局 `modelInvocable=2/4`，5327 个源码文件边界合规，15 个包打包与开源许可一致）。
- `node plugins/scripts/verify-silent-catch.mjs --json`：`omnimux-clip/src/templates/catalog.js` 命中 `0`。
- `corepack pnpm --filter omnimux-assets test`：共 783 个用例（161 个套件），782 通过 / 0 失败 / 1 跳过（`assets_get defineTool` 因测试沙箱无宿主 `@deepseek-ai/dsh-tools` 包跳过）。
- `corepack pnpm --filter omnimux-clip test`：共 307 个用例（16 个套件，含 `plugins/tests/integration/clip-*.test.mjs`），307 通过 / 0 失败 / 0 跳过。
- `git diff --check` 与 `git diff -- plugins/plugins/omnimux-clip/src/client/openreel/`：均为空输出（上游 `openreel/` 零改动）。
- 隔离环境边界说明：以上均为 worktree 本机单测、集成模拟链路与静态门禁证据；真实 Electron 桌面客户端 UI/CDP 实测、真实 AI 网关出片与人工视觉验收尚未执行，待合入阶段与后续环境补充验证。

## 旧标准变更

- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers the nine frozen tool names`
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers tools, prompt and clipEditor seam`
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers the nine Clip tools and forwards the Cordis execution identity`
- `plugins/plugins/omnimux-clip/src/clip-skills.test.js` :: `loads clip-craft SKILL.md as core global model-invocable skill`
- `plugins/plugins/omnimux-clip/src/clip-skills.test.js` :: `registers via ctx.skills.registerProvider at BUNDLED_SKILL_RANK (600) and supports register() fallback`

理由与新期望：
1. 因本 PR 新增只读模板查询工具 `clip_templates`，`omnimux-clip` 工具清单由 9 个扩充至 10 个（插入在 `clip_list` 之后）。原有 9 个工具的所有校验、版本号、破坏性确认、越权和 `motion-expression-denied` 断言完整保留，新期望经 `corepack pnpm --filter omnimux-clip test` 307/307 全绿与 `verify:tools` 0 错误验证。
2. 因本 PR 为 `omnimux-clip` 新增随包技能 `clip-recreate`，捆绑 Skill 从 1 个（`clip-craft`）扩充至 2 个；按全局技能上下文预算为 `clip-recreate` 设置 `disable-model-invocation: true`（`modelInvocable: false, userInvocable: true`），保留 `clip-craft` 原有 rank 600 与 `modelInvocable: true` / `userInvocable: true` 断言，经 `verify:global-skills`、`verify:skill-hygiene` 与 `clip-skills.test.js` 验证全绿。
