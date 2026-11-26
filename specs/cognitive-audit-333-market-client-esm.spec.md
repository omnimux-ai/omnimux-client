# 将 `omnimux-market/src/client/` 22-Fragment 文本拼接构建迁为标准 ES 模块（Issue #333）

## 背景

`plugins/plugins/omnimux-market/scripts/concat-client.mjs` 将 `src/client/` 下 22 个片段文件按顺序字符串拼接进单一顶层作用域，再通过 `esbuild` 的 `stdin` 打包为 `lib/client.js`。该机制带来三类认知与工程隐患：

1. 22 个文件间依赖数十个隐式未声明符号，IDE 跳转、静态未定义引用检查与模块化重构全部失效，`boot.js` 甚至需要硬注释禁止顶层解构。
2. 拼接进入同一词法作用域导致 2 处隐式函数重名覆盖（`StarIcon` 在 `skills-ui.js` 与 `marketplace.js`；`findComposer` 在 `session-create.js` 与 `composer.js`）。
3. `skill-plaza.js:1-6` 为维持旧的 `readFileSync` 字符串正则测试通过，保留了 6 行“魔术注释”，与实际代码归属（`src/client/plaza/*.{js,jsx}`）脱节。

## 假设

1. 抽出 `src/client/runtime-state.js` 集中承载 5 个跨文件可变运行时状态（`plazaKeepAlive`、`plazaSessions`、`plazaUiWorkspace`、`plazaRemote`、`plazaWorkspaces`）后，全部 22 个客户端文件可改写为标准 ES 模块（显式 `import`/`export`），形成无环 DAG（打破原有的 `session-create.js -> tool-views.js -> skills-ui.js -> session-create.js` 隐式环）。
2. 将 `scripts/concat-client.mjs` 切换为 `esbuild.build({ entryPoints: ['src/client/apply.js'], bundle: true, format: 'cjs', ... })` 后，生成的 `lib/client.js` 保持 `window.__ModuleLoader__.load({ id: "omnimux-market", factory })` 产物契约、外部依赖列表、全部 slot 注册键、`__omnimuxSkillLibrary` / `__omnimuxExpertStarters` / `__omnimuxLocale` / `window.trySkillInSession` 全局 seam 与 UI 表现完全等价。
3. 移除 `skill-plaza.js:1-6` 魔术注释，并将仅依赖魔术注释或 `boot.js` 旧 `require` 写法的测试迁移到真实归属模块与标准 ESM 导入校验，不会弱化任何产品契约覆盖。

## 证伪方式

1. 全部 22 个文件及 `runtime-state.js` 均可通过标准 ES 模块解析，且 `scripts/concat-client.mjs` 不再含 `FRAGMENTS` 数组与字符串拼接逻辑（若恢复拼接或遗漏导入，`esbuild` 打包与新增的 ESM 图校验测试直接失败）。
2. 运行 `omnimux-market` 全量单测、E2E 测试、`typecheck`、`plugins run build:all`、`verify-stage-contracts.mjs`、`verify-plugin-load.mjs`、`verify-plugin-boundaries.mjs`、`verify-dsw-tokens.mjs`、`verify-test-standard-declarations.mjs`、`auto-qa-gate.mjs` 及 `bundle:lock:check` 全部通过。
3. 在工作树内跑 `worktree-web-qa.mjs sidebar-chrome` 验证真实浏览器侧栏与工作台运行态。

## 旧标准变更

- `plugins/plugins/omnimux-market/src/client/skill-shelf-parity.test.js` :: `boot.js injects the logic module as a single namespace binding`
  - 原断言：校验 `boot.js` 包含片段拼接时期的 CJS 写法 `const SkillShelf = require("./skill-picker-logic.js")` 且不解构 `require(...)`。
  - 变更理由：`boot.js` 迁移为标准 ES 模块，改用 `import * as SkillShelf from "./skill-picker-logic.js"` 命名空间导入。
  - 新期望与证据：断言 `boot.js` 使用 `import * as SkillShelf from "./skill-picker-logic.js"` 且不包含针对 `./skill-picker-logic.js` 的命名解构导入。

- `plugins/plugins/omnimux-market/src/client/skill-shelf-parity.test.js` :: `picker and plaza consume the shared SkillShelf module`
  - 原断言：在 `skill-plaza.js` 原文中检索 `SkillShelf.SKILL_SHELF_TAXONOMY` 与 `SkillShelf.buildPlazaSearchPayload`（此前仅靠 `skill-plaza.js:2` 魔术注释命中，真实调用位于 `src/client/plaza/usePlazaFilter.js`）。
  - 变更理由：清除 `skill-plaza.js` 魔术注释后，测试应校验真实归属模块与模块导入链路。
  - 新期望与证据：断言 `skill-plaza.js` 消费 `SkillShelf.plazaDiscoverySections` 并显式导入 `./plaza/usePlazaFilter.js`，且 `plaza/usePlazaFilter.js` 实际消费 `SKILL_SHELF_TAXONOMY` 与 `buildPlazaSearchPayload`。

- `plugins/plugins/omnimux-market/src/client/skill-shelf-parity.test.js` :: `plaza domain contract comment matches both classification sources`
  - 原断言：用正则匹配 `skill-plaza.js:6` 的魔术注释 `// 领域契约：(.+)` 并与 `WORKSHOP_DOMAIN_ORDER`、`SKILL_SHELF_TAXONOMY` 对账。
  - 变更理由：本任务目标正是移除 `skill-plaza.js` 魔术注释，改为直接校验真实模块导出与导入绑定。
  - 新期望与证据：断言 `skill-plaza.js` 显式从 `./plaza/plazaUtils.js` 导入 `WORKSHOP_DOMAIN_ORDER`，且 `WORKSHOP_DOMAIN_ORDER` 与 `SKILL_SHELF_TAXONOMY` 的分类 ID 集合严格一致。

- `plugins/plugins/omnimux-market/src/client/workbench-seat.test.js` :: `skill plaza consumes SkillShelf rules instead of SkillHub categories`
  - 原断言：在 `skill-plaza.js` 原文匹配 `SkillShelf.SKILL_SHELF_TAXONOMY` 与 `SkillShelf.buildPlazaSearchPayload`（此前仅靠魔术注释命中）。
  - 变更理由：清除 `skill-plaza.js` 魔术注释，改为断言真实归属模块 `plaza/usePlazaFilter.js` 及 `skill-plaza.js` 对其的显式导入。
  - 新期望与证据：断言 `skill-plaza.js` 消费 `SkillShelf.plazaDiscoverySections` 并导入 `./plaza/usePlazaFilter.js`，且 `plaza/usePlazaFilter.js` 消费 `SKILL_SHELF_TAXONOMY` 与 `buildPlazaSearchPayload` 且无写死双渠道。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `category order conforms to PRD §6.1 / AC-05 (10 items)`
  - 原断言：在 `skill-plaza.js` 原文匹配 10 个中文分类字面量（此前仅靠 `skill-plaza.js:6` 魔术注释命中，真实真源为 `plaza/plazaUtils.js` 的 `WORKSHOP_DOMAIN_ORDER`）。
  - 变更理由：清除魔术注释后改为直接断言导入自 `./plaza/plazaUtils.js` 的真实 `WORKSHOP_DOMAIN_ORDER` 导出，以及 `skill-plaza.js` 对它的引用。
  - 新期望与证据：断言 `WORKSHOP_DOMAIN_ORDER` 包含 PRD §6.1 / AC-05 的全部 10 个领域分类，且 `skill-plaza.js` 显式导入并使用 `WORKSHOP_DOMAIN_ORDER`。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `featured section renders 4-column 16:9 cards and hides completely when 0 items`
  - 原断言：在 `skill-plaza.js` 原文匹配 `featured-cover-wrap`、`featured-hover-actions`、`hover-btn-detail`、`hover-btn-try`（此前仅靠 `skill-plaza.js:5` 魔术注释命中，样式在 `css.js`、卡片实现已迁至 `plaza/FeaturedCard.jsx` Creatify 极光卡）。
  - 变更理由：清除魔术注释后，在真实归属文件 `css.js` 与 `plaza/FeaturedCard.jsx` 上断言对应类名，并在 `skill-plaza.js` 断言其导入 `./plaza/FeaturedCard.jsx`。
  - 新期望与证据：保留 `featuredItems.length > 0` 断言，校验 `skill-plaza.js` 导入 `./plaza/FeaturedCard.jsx`，在 `css.js` 校验 `.featured-cover-wrap`，并在 `plaza/FeaturedCard.jsx` 校验 `omnimux-creatify-card`、`featured-hover-actions`、`hover-btn-detail`、`hover-btn-try`。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `install modal provides drag & drop and requirements notice`
  - 原断言：在 `skill-plaza.js` 原文匹配 `drop-zone`、`req-section`、`btn-modal-install`（此前仅靠 `skill-plaza.js:3` 魔术注释命中，真实实现位于 `plaza/InstallModal.jsx`）。
  - 变更理由：清除魔术注释后，在真实组件 `plaza/InstallModal.jsx` 上断言这 3 个结构契约，并在 `skill-plaza.js` 断言 `function InstallModal` 委托 `PlazaInstallModal`。
  - 新期望与证据：`skill-plaza.js` 保留 `function InstallModal` 与 `./plaza/InstallModal.jsx` 导入，真实组件源码 `plaza/InstallModal.jsx` 校验 `drop-zone`、`req-section`、`btn-modal-install`。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `Issue #773: top bar strictly aligns with reference mock and featured card metadata is complete`
  - 原断言：在 `skill-plaza.js` 原文匹配 `coverSrc ?`（此前仅靠 `skill-plaza.js:5` 魔术注释命中，卡片实现已演进为 `plaza/FeaturedCard.jsx` 的 `resolveSkillAuroraStyle` 与 `item.homeCover` 封面解析）。
  - 变更理由：清除魔术注释后将精选卡封面/视觉校验指向真实组件 `plaza/FeaturedCard.jsx` 的 `resolveSkillAuroraStyle` 与 `item.homeCover`，其余 `skill-plaza.js` 与 `css.js` 断言保持不变。
  - 新期望与证据：`plaza/FeaturedCard.jsx` 断言包含 `resolveSkillAuroraStyle` 与 `item.homeCover`，`skill-plaza.js` 与 `css.js` 其余全部断言保持原样。

- `plugins/plugins/omnimux-market/src/client/apply-inject.test.js` :: `uiWorkspace 服务可用时懒挂到 plazaUiWorkspace`
  - 原断言：通过旧片段全局沙箱读取 `mod.sandbox.plazaUiWorkspace`。
  - 变更理由：`apply.js` 迁为标准 ES 模块后，跨文件共享运行时引用收敛至 `src/client/runtime-state.js` 导出的 `marketRuntime` 对象。
  - 新期望与证据：通过 ESM 测试加载器注入 `marketRuntime`，断言 `apply(ctx)` 将可用 `uiWorkspace` 懒挂到 `marketRuntime.plazaUiWorkspace`。
