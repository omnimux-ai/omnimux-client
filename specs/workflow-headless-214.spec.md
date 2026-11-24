# 画布视频拆解、分镜与导演助手迁移至 Hub `headlessSkill` 与 Skill 真源（#214）

## 背景

依据 [headless-skill-execution.md](../plugins/docs/contracts/headless-skill-execution.md) 与 Issue #214，`omnimux-workflow` 在后台 AI 推理链路上存在三类存量不合规项：

1. **重复手写 Markdown 表格与标题正则解析器**：`videoDeconstruct/service.ts`（`extractMarkdownTables` / `extractFiveDimensions`）与 `videoStoryboard/service.ts` 自行解析 `video_analyze` 返回的自由 Markdown 文本，脆弱易失配且与灵感库重复造轮子。
2. **重复实现视频分析预处理**：`prepareAnalyzeVideo.ts` 独立维护 20MiB/9MiB 转码预处理与临时样片目录，与 Hub `omnimux/src/headless/transport.js` 并存两套实现。
3. **导演助手提示词硬编码与直连 `textComplete`**：`director/directorAssistant.ts` 将 `ANALYSIS_PROMPT` 写死在源码中，未注册至 DSH 原生 `ctx.skills`，也未接入 Hub `headlessSkill` 统一并发、Schema 校验与防脏写治理。

## 新用户基线

- 新用户仅安装桌面壳 + 执行中枢（`omnimux`）并完成登录，不依赖任何开发机本地路径、端口或自备代理。
- `omnimux-workflow` 随包分发标准 Skill 资产（`skills/workflow-video-deconstruct/SKILL.md`、`skills/workflow-director-analyze/SKILL.md`），经 `ctx.skills.registerProvider`（rank 600）注册至 DSH 原生 `ctx.skills`。
- 未就绪 `headlessSkill` 或未配置支持视频/视觉分析的目录模型时，显式返回清晰中文错误与标准错误码，绝不静默伪造成功态或填充写死模板。

## 范围

### 1. 插件自带 Skill 真源与注册（`plugins/plugins/omnimux-workflow/`）
- 新增 `skills/workflow-video-deconstruct/SKILL.md` 与 `skills/workflow-director-analyze/SKILL.md`，纳入 `package.json` `files`（`"skills"`）与 `dsh.manifest.json`（`skills`、`seamsConsumed` 增补 `"headlessSkill"`）。
- 新增 `src/workflow/workflowSkills.ts`：参照 `omnimux-inspiration/src/inspiration-skills.js` 通过 `ctx.skills.registerProvider`（`BUNDLED_SKILL_RANK = 600`）注册进 DSH 原生 `ctx.skills`（兼容 `skills.register` 最小测试注册表），在 `mountWorkflowHost(ctx)` 自动挂载。

### 2. 视频拆解与分镜迁移至结构化输出并下线重复预处理
- 新增 `src/workflow/videoAnalysisSchema.ts`：定义 `VIDEO_DECONSTRUCT_SCHEMA`、`VIDEO_STORYBOARD_SCHEMA`、`DIRECTOR_ANALYSIS_OUTPUT_SCHEMA`、结构化输入构造器、确定性 `inputFingerprint` 生成与无正则结构化结果归一化函数。
- 重构 `src/workflow/videoDeconstruct/service.ts` 与 `src/workflow/videoStoryboard/service.ts`：
  - 移除 `extractMarkdownTables` 与 `extractFiveDimensions` 正则/Markdown 表格解析器；
  - 统一通过 Hub `ctx.get('headlessSkill')` 执行 `workflow-video-deconstruct` Skill 并传入严格 JSON Schema、`references: [{ type: 'video', pathOrUrl: absVideoPath }]`、中枢目录解析出的 `model` 及 `inputFingerprint` / `verifyFingerprint`；
  - 移除对 `prepareVideoForAnalyze` 的调用，由 Hub `headlessSkill` 统一承接视频媒体准备与分流（本地 FFmpeg `video_scene_detect` / `video_thumbnail_extract` 抽帧保留）。
- 删除重复预处理模块 `src/workflow/prepareAnalyzeVideo.ts` 及其专属单测 `src/workflow/prepareAnalyzeVideo.test.mjs`。
- 扩展 `src/workflow/videoAnalyzeFailure.ts` 映射 Hub `headlessSkill` 标准错误码（保留全部既有错误码映射不变）。

### 3. 导演助手迁移至 Skill 真源 + Hub `headlessSkill`
- 重构 `src/workflow/director/directorAssistant.ts`：
  - 移除硬编码 `ANALYSIS_PROMPT`，改由 Hub `headlessSkill.run(...)` 调度 `workflow-director-analyze` Skill 与 `DIRECTOR_ANALYSIS_OUTPUT_SCHEMA`；
  - 传入确定性 `inputFingerprint` 与 `verifyFingerprint`（并在返回后继续执行 `confirm(workspaceId, nodeId, source)`），保留严格 `zod` `analysisSchema` 二次校验、64KiB 载荷上限、账号/epoch 切换拦截与 `simulated` 显式 provenance 语义。

不做：不触碰 `app/`、`plugins/plugins/omnimux/`、`plugins/plugins/omnimux-market/`、`plugins/plugins/omnimux-viewer/`、`plugins/plugins.registry.json` 及其他插件。

## 旧标准变更

本任务按 Issue #214 与 `plugins/docs/contracts/headless-skill-execution.md` 下线画布插件私有的重复视频预处理 `prepareAnalyzeVideo.ts`，并将画布视频拆解、分镜提取与导演助手识图统一迁移至 Hub `headlessSkill`（`ctx.get('headlessSkill')`）与结构化 JSON Schema 输出。相应既有测试从校验旧直连工具/裸 `textComplete`/Markdown 表格改为校验 `headlessSkill` 载荷与结构化输出，逐条声明如下：

- `plugins/plugins/omnimux-workflow/src/workflow/prepareAnalyzeVideo.test.mjs` :: `small local file → null (no prepare needed)`
  - 原断言：校验 `prepareVideoForAnalyze` 对小于 20MiB 的本地视频返回 `null` 且不调用 `videoProcess`。
  - 变更理由：视频分析媒体准备已遵循契约第 4 条统一上收至 Hub `omnimux/src/headless/transport.js`，`prepareAnalyzeVideo.ts` 重复实现已整体删除。
  - 新期望证据：Hub `omnimux/src/headless/headless.test.js` 覆盖小视频直传与大视频压缩；画布侧在 `videoDeconstructRoutes.test.mjs` 与 `videoStoryboardRoutes.test.mjs` 验证请求直接将 `absVideoPath` 经 `references` 交由 Hub `headlessSkill`，不再调用私有 `video_inline_analysis_prepare`。
- `plugins/plugins/omnimux-workflow/src/workflow/prepareAnalyzeVideo.test.mjs` :: `oversized local file → prepare 产物路径被采纳`
  - 原断言：校验超限本地视频经 `prepareVideoForAnalyze` 调 `video_inline_analysis_prepare` 返回临时路径。
  - 变更理由：重复预处理模块 `prepareAnalyzeVideo.ts` 已下线，媒体准备全归 Hub `headlessSkill`。
  - 新期望证据：画布服务直接向 `headlessSkill.run` 透传视频引用并在上游抛 `headless-skill-transport-exceeded` / `headless-skill-transport-unavailable` 时准确映射中文错误。
- `plugins/plugins/omnimux-workflow/src/workflow/prepareAnalyzeVideo.test.mjs` :: `remote URL → prepare 被调用并返回产物`
  - 原断言：校验远程视频 URL 经 `prepareVideoForAnalyze` 预处理。
  - 变更理由：重复预处理模块 `prepareAnalyzeVideo.ts` 已下线，远程 URL 原样作为 `references[0].pathOrUrl` 交由 Hub `headlessSkill` 分流。
  - 新期望证据：`videoDeconstructRoutes.test.mjs` 验证远程 URL 直接作为 `references[0].pathOrUrl` 传递给 `headlessSkill.run`。
- `plugins/plugins/omnimux-workflow/src/workflow/prepareAnalyzeVideo.test.mjs` :: `prepare overshoot → null（回退原错误）`
  - 原断言：校验 `prepareVideoForAnalyze` 在 `overshoot` 时返回 `null`。
  - 变更理由：重复预处理模块 `prepareAnalyzeVideo.ts` 已下线，超限拒绝由 Hub `headlessSkill` 的 `headless-skill-transport-exceeded` 承担。
  - 新期望证据：`videoAnalyzeFailure.test.mjs` 与路由测试验证 `headless-skill-transport-exceeded` 被映射为 `analyze-invalid-input`。
- `plugins/plugins/omnimux-workflow/src/workflow/prepareAnalyzeVideo.test.mjs` :: `videoProcess 不可用 → null`
  - 原断言：校验缺少 `videoProcess` 时 `prepareVideoForAnalyze` 返回 `null`。
  - 变更理由：重复预处理模块 `prepareAnalyzeVideo.ts` 已下线，缺失视频准备能力由 Hub `headlessSkill` 抛出 `headless-skill-transport-unavailable`。
  - 新期望证据：`videoAnalyzeFailure.test.mjs` 验证 `headless-skill-transport-unavailable` 被映射为 `analyze-unavailable`。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 成功拆解视频并持久化五维内容拆解表格（分析维度 + 分析内容）`
  - 原断言：校验旧 `video_analyze` 工具被调用并收到 `{ video }`，返回 Markdown 报告经正则解析。
  - 变更理由：视频拆解已迁移至 Hub `headlessSkill.run` + `workflow-video-deconstruct` Skill + `VIDEO_DECONSTRUCT_SCHEMA` 结构化输出。
  - 新期望证据：校验 `headlessSkill.run` 收到 `skillName: 'workflow-video-deconstruct'`、`outputSchema`、`references: [{ type: 'video', pathOrUrl }]`、`model` 与 `inputFingerprint`，且 `.htable` 落盘 6 行五维内容并保持原响应与图节点契约。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 分析返回空内容时直接报错`
  - 原断言：通过 `video_analyze` 返回空白 Markdown 触发 `analyze-empty`。
  - 变更理由：执行通道已切换至 `headlessSkill.run`，无 Markdown 文本入口。
  - 新期望证据：校验 `headlessSkill.run` 返回空/非 live 载荷或全空维度字段时稳定返回 502 `analyze-empty`。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 分析结果中解析不出任何维度时直接报错，不填充写死文案`
  - 原断言：通过 `video_analyze` 返回无五维章节的 Markdown 触发 `analyze-empty`。
  - 变更理由：已移除 Markdown 标题正则解析器，改由结构化字段判断有效维度。
  - 新期望证据：校验 `headlessSkill.run` 返回六维全为空字符串的结构化对象时直接报错 502 `analyze-empty` 且不落盘节点。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 无 Markdown 表格时，按五维分析维度构造结构化表格`
  - 原断言：传入仅含五维标题的 Markdown 字符串验证按五维构造 2 列 6 行表格。
  - 变更理由：视频拆解已完全改为消费结构化 JSON 输出，不再解析 Markdown 表格或标题。
  - 新期望证据：传入结构化六维 JSON 数据验证构造 2 列 6 行 `.htable`、首行预览为 `summary` 且不经任何 Markdown 解析。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 传入工作流媒体相对路径 /omnimux-workflow/media/videos/xxx.mp4 能成功解析真实物理路径并拆解`
  - 原断言：断言 `toolCalls[i].video` 等于解析后的路径或远端 URL。
  - 变更理由：执行通道已切换至 `headlessSkill.run`，视频路径经 `references[0].pathOrUrl` 传递。
  - 新期望证据：继续严格断言三种路径解析结果原样出现在 `headlessCalls[i].references[0]`（`type: 'video'`）。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoDeconstructRoutes.test.mjs` :: `videoDeconstruct: 分析模型取自中枢目录而不是写死的 ID`
  - 原断言：断言 `toolCalls[0].model === 'catalog-vision-pro'`。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：继续断言 `headlessCalls[0].model === 'catalog-vision-pro'`。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoStoryboardRoutes.test.mjs` :: `videoStoryboard: 分析结果中解析不出分镜镜头时直接报错`
  - 原断言：通过 `video_analyze` 返回不含 Markdown 表格的文本触发 `shots-empty`。
  - 变更理由：分镜提取已移除 `extractMarkdownTables`，改消费 `headlessSkill.run` 的结构化 `shots` 数组。
  - 新期望证据：校验 `headlessSkill.run` 返回 `shots: []`（或全空白镜头项）时稳定报错 502 `shots-empty`。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoStoryboardRoutes.test.mjs` :: `videoStoryboard: 分析模型取自中枢目录而不是写死的 ID`
  - 原断言：断言 `toolCalls` 中 `tool === 'video_analyze'` 且 `args.model === 'catalog-vision-pro'`。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：断言 `headlessSkill.run` 被调用且 `model === 'catalog-vision-pro'`、`skillName === 'workflow-video-deconstruct'`、`references[0].type === 'video'`。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/videoStoryboardRoutes.test.mjs` :: `videoStoryboard: 目录里没有支持视频的模型时报 analyze-model-unavailable`
  - 原断言：断言 `toolCalls.some(c => c.tool === 'video_analyze') === false`。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：断言 `headlessCalls.length === 0` 且返回 502 `analyze-model-unavailable`。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `analyzeImage inspects a managed reference and returns strict bounded suggestions without editing the scene`
  - 原断言：mock `seams.textComplete.execute` 并断言 `calls[0].image` 与硬编码 `calls[0].prompt` 包含 `16`。
  - 变更理由：导演助手识图已迁移至 Hub `headlessSkill.run` + `workflow-director-analyze` Skill 真源，源码不再保留硬编码 `ANALYSIS_PROMPT`。
  - 新期望证据：mock `seams.headlessSkill.run`，断言收到 `skillName: 'workflow-director-analyze'`、`outputSchema`、`references: [{ type: 'image', pathOrUrl }]`、`model: 'visual@visual-group'`、`inputFingerprint` 与 `verifyFingerprint`，并继续严格校验返回的 `elements` 与场景零改动。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `analyzeImage rejects unregistered paths, unsafe references, malformed or oversized JSON and stale results`
  - 原断言：向 `seams.textComplete.execute` 注入畸形 JSON 字符串测试 `director-analysis-invalid` 与 `version_conflict`。
  - 变更理由：执行通道已切换至 `seams.headlessSkill.run`（返回结构化 `data` 或抛 `headless-skill-schema-invalid`）。
  - 新期望证据：向 `seams.headlessSkill.run` 注入非法/超限/额外字段/超 16 项/超 64KiB 结构化载荷、`headless-skill-schema-invalid` 及执行期间 `saveScene` 变更，继续严格断言拒为 `director-analysis-invalid` 与 `version_conflict`。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `analyzeImage rejects missing seams and preserves explicit simulated provenance`
  - 原断言：mock `seams.textComplete.execute` 返回 `mode: 'simulated'`，删 `seams.textComplete` 触发 `director-capability-unavailable`。
  - 变更理由：执行通道已切换至 `seams.headlessSkill.run`。
  - 新期望证据：mock `seams.headlessSkill.run` 返回 `mode: 'simulated'` 验证显式 `simulated: true`，删 `seams.headlessSkill` 断言拒为 `director-capability-unavailable`。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `capabilities require accepted-task recovery and never combine incompatible group input support`
  - 原断言：监控 `seams.textComplete.execute` 调用次数为 0。
  - 变更理由：识图执行通道已切换至 `seams.headlessSkill.run`。
  - 新期望证据：监控 `seams.headlessSkill.run` 调用次数为 0 且继续断言 `director-capability-unavailable`。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `analysis rejects account changes at each async boundary including A to B to A with a new epoch`
  - 原断言：在 `seams.textComplete.execute` 阶段触发账号切换并断言 `director-task-scope-mismatch`。
  - 变更理由：识图执行通道已切换至 `seams.headlessSkill.run`。
  - 新期望证据：在 `seams.headlessSkill.run` 阶段触发账号切换（含 `verifyFingerprint` 校验路径），继续严格断言 `director-task-scope-mismatch` 且场景零改动。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `analyzeImage rechecks the source after catalog selection before consuming a model`
  - 原断言：监控 `seams.textComplete.execute` 在目录选择期间场景变更后不被调用（`calls === 0`）。
  - 变更理由：识图执行通道已切换至 `seams.headlessSkill.run`。
  - 新期望证据：监控 `seams.headlessSkill.run` 在目录选择期间场景变更后不被调用（`calls === 0`）并拒为 `version_conflict`。
- `plugins/plugins/omnimux-workflow/src/workflow/director/directorAssistant.test.mjs` :: `capabilities select visual/image operations across scenarios, not the chat default`
  - 原断言：删除 `seams.imageGenerate` 与 `seams.textComplete` 后断言 `analyzeImage.available === false`。
  - 变更理由：识图能力可用性依赖 Hub `headlessSkill` 接缝而非直连 `textComplete`。
  - 新期望证据：删除 `seams.imageGenerate` 与 `seams.headlessSkill` 后断言 `analyzeImage.available === false` 与 `panorama.available === false`。

## 证伪方式

1. **Skill 注册与加载证伪**：临时修改 `workflowSkills.ts` 中的 `BUNDLED_SKILL_RANK` 或删去 `workflow-director-analyze`，`workflowSkills.test.mjs` 必须真实转红。
2. **结构化拆解与无正则解析证伪**：
   - 确认源码中不再存在 `extractMarkdownTables`、`extractFiveDimensions`、`prepareVideoForAnalyze`、`ANALYSIS_PROMPT`；
   - 临时破坏 `normalizeDeconstructDimensions` 或 `normalizeStoryboardShots` 的字段映射，`videoDeconstructRoutes.test.mjs` / `videoStoryboardRoutes.test.mjs` 必须真实转红。
3. **导演助手 `headlessSkill` 与双校验证伪**：
   - 临时放宽 `analysisSchema` 或跳过 `headlessSkill` 调度，`directorAssistant.test.mjs` 必须真实转红。

## 验收

- `corepack pnpm --dir plugins run build:all`
- `corepack pnpm --dir plugins --filter omnimux-workflow test`
- `corepack pnpm --dir plugins run typecheck`
- `corepack pnpm --dir plugins run check:boundaries`
- `node plugins/scripts/verify-skill-hygiene.mjs`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node scripts/bundle-lock.mjs --check`
- `node scripts/workspace-check.mjs --check`
- `git diff --check`
