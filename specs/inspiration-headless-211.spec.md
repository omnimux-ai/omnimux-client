# 灵感库迁移至 Hub `headlessSkill` 与极简信息流/右侧多态详情栏改版（#211）

## 背景

依据 [headless-skill-execution.md](../plugins/docs/contracts/headless-skill-execution.md) 与 Issue #211，当前 `omnimux-inspiration` 存在四类不合规实现与两类体验问题：

1. 后端在 `scoped-analysis.js` 与 `structure-script.js` 硬编码解构与翻译提示词，脱离 DSH 原生 `ctx.skills` 真源；
2. 依赖 `analyzer.js` 数十条 Markdown 正则提取解构结果，换模型或微调格式易失配；
3. 业务插件自行实现 9MB 视频内联压缩预算与临时目录清理（与 `omnimux-workflow` 重复）；
4. 使用私有 `WeakMap` 锁与前端定时盲轮询，未接入 Hub `headlessSkill` 并发池与 `hubEvents` 事件流；
5. 界面存在大量中点（`·`）分隔符、冗余解释文案，且信息流仅支持单一瀑布流、点击卡片弹出全屏阻断式弹窗而非停靠式右侧多态详情栏。

## 新用户基线

- 新用户仅安装桌面壳 + 执行中枢（`omnimux`）并完成登录，不依赖任何开发机本地路径、端口或自备代理。
- `omnimux-inspiration` 随包分发标准 Skill 资产（`skills/inspiration-deconstruct/SKILL.md`、`skills/inspiration-translate/SKILL.md`）并注册到 DSH `ctx.skills`。
- 未登录或未配置分析渠道时，沿用 Hub `needs-provider` / `needs-omnimux` / `analysis-service-unconfigured` 明确中文错误提示，绝不静默伪造成功态。

## 范围

### 1. Hub 无头视频传输准备上收（`plugins/plugins/omnimux/src/headless/`）
- 新增 `transport.js`：统一管理多模态视频引用 9MB base64 内联传输预算、多视频共享配额、通过 `ctx.get('videoProcess')` 执行 `video_inline_analysis_prepare`（保完整时间轴与音频）及 `finally` 临时目录清理。
- 在 `execute.js` / `mount.js` 中自动调用传输准备，并在 `headless.test.js` 补齐 98MB 单视频、多视频分摊、超限图片拒绝、缺失 `videoProcess` 报错与取消清理测试。

### 2. 灵感库 Skill 真源 + JSON Schema + Hub `headlessSkill` 迁移（`plugins/plugins/omnimux-inspiration/`）
- 新增 `skills/inspiration-deconstruct/SKILL.md` 与 `skills/inspiration-translate/SKILL.md`（纳入 `package.json` `files` 与 `dsh.manifest.json` `skills`），通过 `src/inspiration-skills.js` 注册至 DSH `ctx.skills`。
- 新增 `src/analysis-schema.js`：定义严格的 `INSPIRATION_ANALYSIS_SCHEMA` 与 `INSPIRATION_TRANSLATION_SCHEMA` 及结构化结果归一化函数（新产出不经 `analyzer.js` 正则解析，`analyzer.js` 仅保留历史数据只读兼容）。
- 重构 `src/scoped-analysis.js`、`src/http-handlers.js`、`src/http-routes.js`、`src/index.js`：
  - 范围分析（`post` / `body` / `media`）与正文/脚本翻译统一通过 Hub `headlessSkill.run(...)` 执行；
  - 保留 `input_fingerprint` 防脏写、并发防重入（`409`）、重启中断恢复（`recoverInterruptedAnalyses`）与 `AbortSignal` / `POST /omnimux/inspiration/local/:id/analyze/cancel` 取消能力。

### 3. 极简信息流 + 右侧多态详情栏 + `hubEvents` 实时同步（`plugins/plugins/omnimux-inspiration/src/client/`）
- **极简信息流与双视图**：在灵感库工具栏新增「画廊 / 列表」切换，新增紧凑列表视图 `InspirationListView.jsx`；精简详情栏与轮播区的冗余说明文案，移除灵感库信息流、轮播与详情栏所有中点 `·` 分隔符（保留一级页标准 `<PageHeader>` 壳契约）。
- **右侧多态详情栏**：在灵感库页点击卡片/列表行展开非阻断式停靠右侧详情栏（`InspirationDetailSidebar.jsx` 复用 `InspirationPostDetail` 的 `mode="sidebar"`），按素材类型（短视频 / 轮播图 / 单图 / 纯文案）自适应呈现顶部预览与结构化拆解区；保留独立弹层 `InspirationPreviewModal` 供外部插件与全局预览服务复用。
- **`hubEvents` 实时阶段推送**：在 `InspirationPostDetail.jsx` 订阅 `window.__omnimuxHubEvents` 的 `omnimux:headless-skill` 事件，实时展示排队/加载技能/解析/校验/修复阶段并提供取消按钮；`hubEvents.isHealthy()` 为真时不再启动盲轮询，仅在事件通道不可用时回退轮询。

不做：不改动其他业务插件（`omnimux-products` #212、`omnimux-video` #213、`omnimux-workflow` #214）。

## 旧标准变更

本任务按 Issue #211 契约将视频内联传输准备上收至 Hub `omnimux/src/headless/transport.js`，并将灵感库后端解构与翻译统一迁移至 Hub `headlessSkill` + JSON Schema（不再在灵感库插件内部调用旧 `prepareAnalysisTransport` 与裸 `textComplete` 自由文本契约），因此对以下既有测试按新架构契约调整或迁移，并在 Hub 与灵感库补齐更严格的端到端覆盖：

- `plugins/plugins/omnimux-inspiration/src/analysis-transport.test.js` :: `98MB saved video uses formal full-timeline, audio-preserving seam and cleans only its output`
  - 原断言：直接调用业务插件内 `prepareAnalysisTransport` 验证 98MB 视频保时长/保音频压缩与临时文件清理。
  - 变更理由：视频传输准备能力已按 #211 上收至 Hub `plugins/plugins/omnimux/src/headless/transport.js`，业务插件不再私自持有压缩管线。
  - 新期望证据：对应 98MB 压缩、全时长保音校验与清理用例完整迁入 `plugins/plugins/omnimux/src/headless/headless.test.js` 并全部通过。
- `plugins/plugins/omnimux-inspiration/src/analysis-transport.test.js` :: `shares encoded total budget across all videos, leaves originals in order`
  - 原断言：调用业务插件 `prepareAnalysisTransport` 校验多视频共享 9MB 内联预算配额。
  - 变更理由：多视频预算分摊已统一上收至 Hub `transport.js`。
  - 新期望证据：同名语义用例迁入 `plugins/plugins/omnimux/src/headless/headless.test.js` 并通过。
- `plugins/plugins/omnimux-inspiration/src/analysis-transport.test.js` :: `refuses oversized image-only payload without submitting a subset`
  - 原断言：调用业务插件 `prepareAnalysisTransport` 拒绝超限图片提交。
  - 变更理由：超限图片拒绝提交已统一上收至 Hub `transport.js`。
  - 新期望证据：对应断言迁入 `plugins/plugins/omnimux/src/headless/headless.test.js` 并通过。
- `plugins/plugins/omnimux-inspiration/src/analysis-transport.test.js` :: `missing seam, failed/oversize output and cancellation clean output and never replace source`
  - 原断言：调用业务插件 `prepareAnalysisTransport` 验证缺失 `videoProcess` 接缝、压缩超限、伪造输出与取消清理。
  - 变更理由：该组边界校验随传输准备能力整体上收至 Hub `transport.js`。
  - 新期望证据：对应用例迁入 `plugins/plugins/omnimux/src/headless/headless.test.js` 并通过。
- `plugins/plugins/omnimux-inspiration/src/analysis-transport.test.js` :: `scope pipeline resolves the lazy service getter, calls model only with prepared input and cleans on model success/failure/cancel`
  - 原断言：在业务插件侧组合 `videoProcess` 与 `textComplete` 测试压缩后再调模型。
  - 变更理由：业务插件不再直接调用 `videoProcess + textComplete`，改为延迟解析并委托 Hub `headlessSkill`。
  - 新期望证据：更新为校验延迟解析 `headlessSkill` 透传 98MB 视频引用及成功/失败/取消与 503 缺失报错，且与 Hub `headless.test.js` 共同闭环。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `sends complete ordered inputs and only selected directions, preserving real source and model`
  - 原断言：断言裸 `textComplete.execute` 收到自由文本 `prompt`。
  - 变更理由：范围分析已迁移至 Hub `headlessSkill.run` + `inspiration-deconstruct` Skill + `INSPIRATION_ANALYSIS_SCHEMA`。
  - 新期望证据：校验 `headlessSkill.run` 收到的 `skillName`、`outputSchema`、`input` 与有序 `references` 及落盘结构化结果。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `isolates body, selected image and second video without accepting a supplied path`
  - 原断言：检查 `textComplete` 入参中的 `prompt` 与 `references`。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：继续严格断言 body/image/video 隔离与禁止外部路径注入，仅检查对象更新为 `headlessSkill` 请求载荷。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `analyzes a legacy photo saved as its owned local cover`
  - 原断言：检查 `textComplete` 的 `references` 仅含本地封面路径。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：断言 `headlessSkill.run` 的 `references` 仅含本地封面路径且分析成功。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `merges concurrent scopes and rejects duplicate in-flight requests`
  - 原断言：通过 `textComplete` 模拟阻塞验证并发合并与 409 防重入。
  - 变更理由：执行通道已切换至 `headlessSkill.run`。
  - 新期望证据：通过 `headlessSkill.run` 阻塞继续验证多范围并发合并与同范围 409 拒绝。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `preserves previous actual output on failed retry`
  - 原断言：校验保留上次自由文本结果。
  - 变更理由：新产出为经 JSON Schema 校验的结构化对象（含 `summary`、`sections` 等）。
  - 新期望证据：校验失败重试后保留上次真实结构化结果的 `summary` 与 `source: 'live'`。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `propagates cancellation and saves retryable failure`
  - 原断言：校验取消信号传递给 `textComplete` 第二参数。
  - 变更理由：`headlessSkill.run` 通过统一请求对象的 `req.signal` 透传取消信号。
  - 新期望证据：断言 `req.signal` 正确触发中止、返回 499 并持久化可重试失败态，同时新增 `POST /:id/analyze/cancel` 显式取消测试。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.test.js` :: `translates raw body, preserves script translation/draft and marks legacy provenance`
  - 原断言：校验裸 `textComplete` 收到手写翻译提示词。
  - 变更理由：正文与脚本翻译均已迁移至 Hub `headlessSkill.run` + `inspiration-translate` Skill + `INSPIRATION_TRANSLATION_SCHEMA`。
  - 新期望证据：断言 `skillName`、`outputSchema`、`input` 仅含完整原文不含脚本台词，并新增脚本翻译与分段 ID 保留用例。

## 证伪方式

- Hub 单测验证：`headlessSkill` 自动压缩 98MB 视频并在成功/失败/取消路径彻底清理临时文件。
- 灵感库后端单测验证：
  - 范围分析与正文/脚本翻译通过 `headlessSkill.run` 触发 `inspiration-deconstruct` / `inspiration-translate` 技能并返回经 JSON Schema 校验的结构化字段（不走 `analyzer.js` 正则）；
  - `input_fingerprint` 冲突（`409`）、缺失素材（`422`）、重启中断恢复、并发去重与 `cancel` 中断全部通过；
  - 历史旧记录（仅含 `raw_markdown`）仍可只读正常渲染。
- 灵感库前端单测与真实浏览器验证：
  - 画廊 / 列表双视图切换正常；点击条目在右侧停靠栏多态展示视频 / 轮播图 / 纯文案，且支持直接切换条目；
  - `window.__omnimuxHubEvents` 推送 `omnimux:headless-skill` 时无盲轮询定时请求并实时更新阶段与结果；
  - 亮/暗双主题、窄屏响应下视觉层次清晰、无中点 `·` 与无溢出遮挡。

## 验收

- `corepack pnpm --dir plugins run build:all`
- `pnpm --filter omnimux test`
- `pnpm --filter omnimux-inspiration test`
- `pnpm check:boundaries`
- `pnpm registry:verify`
- `pnpm verify:stages` / `pnpm verify:stage-scroll` / `pnpm verify:product-baseline` / `pnpm verify:plugin-load`
- `node --test plugins/scripts/verify-anti-slop.test.mjs`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node scripts/workspace-check.mjs --check`
- 真实浏览器（亮/暗双主题 + 窄屏）截图验收
