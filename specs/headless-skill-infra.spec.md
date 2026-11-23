# 后台无头技能执行工程基建（Hub `headlessSkill` + 契约 + 边界门禁）

## 背景

全仓审计发现多个业务插件各自维护私有后台 AI 推理管线：
- `omnimux-inspiration`（#211）：源码内硬编码拆解与翻译提示词、手写 9MB 视频字节配额与临时目录压缩、依赖数十条 Markdown 正则硬抠结果、私有内存锁与前端盲轮询；
- `omnimux-products`（#212）：硬编码品牌与商品分析提示词、自建迷你 YAML 解析器提取自由文本；
- `omnimux-video`（#213）：私有提示词加载绕过 `ctx.skills`、只输出非结构化 Markdown；
- `omnimux-workflow`（#214）：重复实现视频分析预处理与 Markdown 表格解析器、导演助手硬编码场景分析提示词。

## 范围

1. 新增 L1 契约 `plugins/docs/contracts/headless-skill-execution.md`，沉淀 6 条硬约束、`headlessSkill` 接口契约与存量迁移清单（#211–#214）。
2. 在 `plugins/AGENTS.md`（严守 <= 100 行 / <= 14,900 字节）与 `plugins/plugins/omnimux/AGENTS.md`（<= 60 行）增加必读触发器指针。
3. 在 `plugins/plugins/omnimux/src/headless/` 实现并挂载共享 Cordis Service `ctx.provide('headlessSkill', api)`：
   - 读取 DSH 原生 `ctx.skills` 真源；
   - 复用 Hub `textComplete` 自动分流文本/图片（DSH 原生 `ctx.llm.stream`）与视频多模态通道；
   - JSON Schema 强校验 + 1 次自动修复重试（失败显式抛 `OmnimuxError`，绝不静默降级）；
   - 按模态分类并发限流池（video/image/text）、`AbortSignal` 取消、`inputFingerprint` 防重入与防脏写；
   - 通过现有 `hubEvents` 广播 `omnimux:headless-skill` 任务阶段事件。
4. 在 `plugins/scripts/verify-plugin-boundaries.mjs` 新增边界门禁，拦截业务插件直接调用 `ctx.llm` / `llm.stream` 绕过 Hub 执行接缝（显式白名单仅允许 Hub 本身及 `omnimux-browser/src/text-session-model.ts` 只读模型目录解析）。

不做：本阶段不修改各业务插件既有行为（由 #211–#214 分模块迁移，先建基建与规范再逐步改建）。

## 证伪方式

- `headless.test.js` 覆盖：Skill 真源读取与缺失显式报错、Schema 校验通过、首次非法输出触发 1 次自动修复重试成功、两次失败抛 `headless-skill-schema-invalid`、视频/文本分类并发限流、外部/接口 `cancel(jobId)` 中断、`inputFingerprint` 幂等防重入与写回前指纹冲突检测、`hubEvents` 事件流顺序。
- `verify-plugin-boundaries.mjs` 单元测试验证：业务插件出现 `ctx.llm.stream` 或 `llm.stream` 时门禁必须退出非零；白名单与 Hub 内部放行。
- `node --test scripts/verify-agents-md.test.mjs` 验证 `AGENTS.md` 预算与所有链接/锚点解析通过。

## 验收

- `pnpm --filter omnimux test`
- `pnpm check:boundaries`
- `node --test plugins/scripts/verify-agents-md.test.mjs`
- `pnpm --dir plugins verify:product-baseline`
- `pnpm --dir plugins verify:plugin-load`

## 旧标准变更

由于本次在 Hub（`omnimux`）新增共享接缝 `headlessSkill`（与 `textComplete` 同步门控挂载），Hub 默认暴露的接缝总数由 20 个增加为 21 个，顺序列表在 `textComplete` 后新增 `headlessSkill`，因此同步更新 `apply.test.js` 的三个接缝清单断言：

- `plugins/plugins/omnimux/src/host/apply.test.js` :: `registers media, text, identity, attachments, and catalog seams in a stable order`
  - 原断言：断言 `official.mount: false` 时 `provided` 为 14 个接缝，不含 `headlessSkill`。
  - 变更理由：Hub 在 `mountTextComplete` 后挂载 `headlessSkill` 接缝（见 `plugins/plugins/omnimux/src/host/apply.js`），原列表未包含该新增接缝。
  - 新期望证据：`provided` 在 `textComplete` 后包含 `headlessSkill`，`pnpm --filter omnimux test` 全量通过。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `registers all 55 tools and 20 seams by default`
  - 原断言：用例标题与 `provided` 断言为默认注册 55 个工具和 20 个接缝。
  - 变更理由：新增 `headlessSkill` 共享接缝后默认接缝数变更为 21 个，同步更新用例名与 `provided` 数组断言。
  - 新期望证据：用例更名为 `registers all 55 tools and 21 seams by default`，`provided` 精确断言 21 个接缝（含 `headlessSkill`），`gate.enabled: false` 用例同步验证停用时不包含 `headlessSkill`。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `fine-grained disables media, text models, and official tools via gate`
  - 原断言：细粒度仅禁用视频与单工具时 `provided` 为 19 个接缝，不含 `headlessSkill`。
  - 变更理由：该场景下 `textComplete` 仍处于启用态，因此 `headlessSkill` 同步挂载，接缝列表包含 `headlessSkill`。
  - 新期望证据：`provided` 在 `textComplete` 后精确断言包含 `headlessSkill`，且 `apply.test.js` 全部用例通过。
