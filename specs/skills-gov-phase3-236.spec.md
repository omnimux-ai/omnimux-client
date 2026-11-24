# Phase 3：插件预装技能迁至 `ctx.skills.registerProvider`、全局上下文预算管控与存量受管副本回收（#236）

## 背景与根因

依据主线治理方案 [Issue #233](https://github.com/omnimux-ai/omnimux-client/issues/233) 与子任务 [Issue #236](https://github.com/omnimux-ai/omnimux-client/issues/236)，Phase 1（#234 / PR #241）与 Phase 2（#235 / PR #254）已完成上游重名与孤儿清理、货架空壳修复、移除静态 `installed: true` 及运行时桥接。当前仍有三项核心架构断层：

1. **双壳加载断层**：`app/dsh-plugin-desktop/scripts/stage-preset-profile.ts` 历史上将插件 `dsh.manifest.json` 声明的技能复制到 `preset/skills/` 再落盘到用户全局 `$DSH_HOME/skills/`；而新桌面壳 `app/dsh-desktop-next` 不执行该落盘链路，导致 `omnimux-clip`、`omnimux-market`、`omnimux-tiktok-selection` 的随包技能在 Next 干净安装下无法经 `ctx.skills` 发现或被 `headlessSkill` 读取。
2. **全局上下文膨胀与失真门禁**：26 个插件随包技能（其中大量为垂类电商 SOP、平台专用玩法或后台 JSON Schema 无头技能）全部以 `modelInvocable: true` 暴露给每个普通会话的 `<available_skills>`，造成持续提示词开销；同时 `plugins/scripts/verify-global-skills.mjs` 写死的旧白名单（`web-access/read/write/genui`）从未挂入 `test:gates` / `verify:gates` 且与真实插件清单脱节。
3. **存量升级遮蔽风险**：DSH `SkillRegistry` 中用户目录 `$DSH_HOME/skills/`（`user-dsh` rank 400）优先级高于插件内置提供方（`BUNDLED_SKILL_RANK` = 600）。老用户机器上由旧版 `dsh-plugin-desktop` 落盘并携带 `omnimux-skill.json`（`origin: "plugin:*"`）的历史目录会长期遮蔽升级后的插件随包技能正文与调用策略。

## 目标架构

1. **全量插件随包技能统一原生注册（`ctx.skills.registerProvider`, `rank: 600`）**
   - 所有在 `dsh.manifest.json` 声明 `skills` 的产品插件（`omnimux-clip`、`omnimux-inspiration`、`omnimux-market`、`omnimux-products`、`omnimux-tiktok-selection`、`omnimux-workflow`）均在宿主侧通过 DSH 原生 `ctx.skills.registerProvider` 注册其随包 `skills/*/SKILL.md` 目录（`source: 'bundled'`、`rank: 600`、`provider: '<plugin-id>'`）。
   - 解析 DSH 标准 YAML frontmatter 调用策略（`disable-model-invocation` → `modelInvocable`、`user-invocable` → `userInvocable`，拒绝非法旧键名）。
   - 兼容 Electron `app.asar` 打包：`app/dsh-desktop-next/package.json` 的 `build.asarUnpack` 增补 `"**/node_modules/omnimux-*/skills/**/*"`；各插件 Provider 在 `app.asar` 环境下优先将 `resourceBase.path` 与 `path` 解析至物理 `app.asar.unpacked` 目录，确保 Python 脚本与 `references/` 可被外部进程和 `dsh-fs-local` 正常读取。
2. **全局 0-Token 默认 + 专家作用域按需激活**
   - 仅核心高频全局技能保留 `modelInvocable: true`（当前为 `clip-craft`、`omnimux-social-data`，受全局预算上限 `<= 4` 约束）。
   - 其余垂类 SOP 技能（`omnimux-market` 的 18 个垂类技能：`sopilot-social-agents`、`tiktok-growth`、8 个社媒研究工作流、8 个跨境电商 SOP）及后台无头 JSON Schema 技能（`inspiration-deconstruct`、`inspiration-translate`、`products-brand-strategy`、`products-physical-import`、`tiktok-selection-risk-audit`、`tiktok-selection-video-script`、`workflow-video-deconstruct`、`workflow-director-analyze`）在 `SKILL.md` frontmatter 中声明 `disable-model-invocation: true`（全局 0-Token，保留 `userInvocable: true` 支持 `/<slug>`、技能选择器与快捷方式调用，同时不影响 Hub `headlessSkill` 通过 `ctx.skills.get(name)` 直接读取）。
   - `omnimux-market` 新增 `./expert-skills` 子路径插件（`src/expert-skills-plugin.ts`），挂载于 `buildMarketExpertPluginRows` 产出的动态专家 Preset 组合中：利用 DSH `SkillRegistry` 的作用域分层（nearest layer wins），仅在对应已聘用专家的会话作用域内将其声明的 `exp.skills` 提升为 `modelInvocable: true`（rank 600，用户本地覆盖 rank 100–500 仍优先），实现普通会话 0-Token、专家会话精准自主加载。
3. **停止桌面壳冗余拷贝 + 安全回收存量托管副本**
   - `app/dsh-plugin-desktop/scripts/stage-preset-profile.ts` 继续校验插件 `dsh.manifest.json` 声明的 `skills` 路径合法性、存在性与跨插件无重名，但不再复制到 `preset/skills/` 或写入 `distribution.json` 的 `kind: 'skill'` 条目。
   - 新增幂等安全回收函数 `reclaimLegacyManagedPluginSkills(home, keepIds?)`：仅删除 `<home>/skills/<id>` 中非符号链接、且包含常规 JSON 文件 `omnimux-skill.json`（满足 `origin` 以 `"plugin:"` 开头且 `id === <目录名>`）的受管目录；绝不触碰用户自建技能、市场手动安装技能、符号链接、无标记目录或非 `plugin:*` 目录。
   - 在 `app/dsh-plugin-desktop/src/preset-profile.ts`（`seedOmnimuxProfile` / `reconcileManagedProfile`）、`app/dsh-desktop-next/src/profiles.ts`（`loadNextProfile`）及 `plugins/plugins/omnimux/src/host/apply.js`（启动容错回收）统一触发回收。
4. **重写全局上下文预算与 Provider 契约门禁（`verify-global-skills.mjs`）**
   - 重写 `plugins/scripts/verify-global-skills.mjs`，全仓扫描所有声明 `skills` 的产品插件：
     - 校验每个插件的宿主源码均注册 `ctx.skills.registerProvider`（`BUNDLED_SKILL_RANK = 600`）并遵循 frontmatter 调用策略；
     - 校验每个插件 `SKILL.md` 的 frontmatter 合法性（禁止 DSH 拒绝的旧键名 `disableModelInvocation` / `modelInvocable` / `userInvocable`）；
     - 强制校验全局 `modelInvocable: true` 技能数 `<= 4` 且全部位于显式批准的全局核心白名单（`ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS`）。
   - 将 `verify:global-skills` 与 `scripts/verify-global-skills.test.mjs` 正式接入 `plugins/package.json` 的 `verify:gates` 与 `test:gates`，并同步 `plugins/scripts/governance-manifest.json`。

## 范围与非范围

- **包含**：
  - `plugins/plugins/omnimux-clip/`（新增 `src/clip-skills.js`、`src/clip-skills.test.js` 并接入 `src/index.js`）
  - `plugins/plugins/omnimux-tiktok-selection/`（新增 `src/selection-skills.js`、`src/selection-skills.test.js`，接入 `src/index.js`，为 2 个无头技能补齐 `disable-model-invocation: true`）
  - `plugins/plugins/omnimux-inspiration/`（更新 `src/inspiration-skills.js` 解析 frontmatter 调用策略与物理路径，为 2 个无头技能补齐 `disable-model-invocation: true` 并补充单测）
  - `plugins/plugins/omnimux-products/`（更新 `src/products-skills.js` 解析 frontmatter 调用策略与物理路径，为 2 个无头技能补齐 `disable-model-invocation: true` 并同步单测）
  - `plugins/plugins/omnimux-workflow/`（更新 `src/workflow/workflowSkills.ts` 解析 frontmatter 调用策略与物理路径，为 2 个无头技能补齐 `disable-model-invocation: true` 并补充单测）
  - `plugins/plugins/omnimux-market/`（新增 `src/bundled-skills.ts`、`src/expert-skills-plugin.ts` 及单测，接入 `src/host.ts`、`src/expert-runtime.ts`、`package.json` `exports`，为 18 个垂类技能补齐 `disable-model-invocation: true`，更新 `skills/omnimux-social-data/references/README.md` 打包说明）
  - `plugins/plugins/omnimux/`（新增 `src/host/legacy-skill-reclaim.js` 及单测并在 `src/host/apply.js` 启动时安全回收存量受管目录）
  - `app/dsh-plugin-desktop/`（`scripts/stage-preset-profile.ts` 停止冗余物化 `preset/skills/`；`src/legacy-skill-reclaim.ts` 与 `src/preset-profile.ts` 新增并调用 `reclaimLegacyManagedPluginSkills`；补齐单测）
  - `app/dsh-desktop-next/`（`src/profiles.ts` 调用 `reclaimLegacyManagedPluginSkills`；`package.json` `asarUnpack` 增补 `**/node_modules/omnimux-*/skills/**/*`；`scripts/packaged-payload.ts` 纳入 `REQUIRED_UNPACKED`；补齐单测）
  - `plugins/scripts/verify-global-skills.mjs`、`plugins/scripts/verify-global-skills.test.mjs`、`plugins/package.json`、`plugins/scripts/governance-manifest.json`、`.github/workflows/quality-gate.yml`、`bundle.lock.json`
- **不包含**：Phase 4（#237）的市场 `catalog/index.json` `origin/license/owner` 元数据审校与 `THIRD_PARTY_NOTICES.md` 更新。

## 旧标准变更

本任务按 Issue #236 将插件随包技能从旧的桌面预拷链路（`stage-preset-profile` → `preset/skills/` → `$DSH_HOME/skills/`）整体迁移至 DSH 原生 `ctx.skills.registerProvider` 并重写全局上下文预算门禁，因此对以下既有测试按新契约更新：

- `plugins/scripts/verify-global-skills.test.mjs` :: `GATE-01: 全局技能白名单校验`
  - 原断言：校验旧版 `checkGlobalSkillsDir` 与已脱节的 4 项虚拟目录名白名单（`web-access`、`read`、`write`、`genui`）。
  - 变更理由：旧版脚本与真实插件随包技能清单完全脱节且未接入 CI；Issue #236 明确要求重写 `verify-global-skills.mjs` 为校验全仓插件 `ctx.skills.registerProvider` 契约与真实全局 `modelInvocable: true` 预算上限，并接入 `test:gates`。
  - 新期望证据：替换为覆盖真实工作区扫描、预算超限拦截、未批准技能拦截、缺失 `registerProvider` 拦截与非法 frontmatter 键拦截的完整单测套件，且纳入 `pnpm test:gates` 实跑通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `stages the skills a product plugin declares and records them`
  - 原断言：断言 `stagePresetProfile` 将插件声明的 `skills/` 复制到 `preset/skills/clip-craft`（附 `omnimux-skill.json`）并在 `distribution.json` 中写入 `kind: 'skill'` 条目。
  - 变更理由：Phase 3 迁移后，插件随包技能直接随插件包通过 `ctx.skills.registerProvider` 注册（与 `dsh-desktop-next` 完全一致），不再复制到 `preset/skills/` 或 `$DSH_HOME/skills/`，避免 rank 400 本地目录遮蔽 rank 600 插件 Provider 并消除全局上下文污染；声明缺失与跨插件重名校验仍保留。
  - 新期望证据：更新该用例为校验 `stagePresetProfile` 验证插件声明的技能存在、不物化 `preset/skills/` 且不写入 `kind: 'skill'` 条目、并通过 `verifyPreset(presetDir)`，同时保留既有缺失/重名拦截用例，另在 `preset-profile.spec.ts` 新增存量受管 `omnimux-skill.json` 回收与用户技能零误删测试并通过。
- `plugins/plugins/omnimux-products/src/products-skills.test.js` :: `registers provider at rank 600 via ctx.inject(["skills"])`
  - 原断言：断言 `products-brand-strategy` 与 `products-physical-import` 的候选技能 `invocation` 为 `{ modelInvocable: true, userInvocable: true }`。
  - 变更理由：PR #255 在 Phase 3 全局预算门禁合入前将两个后台无头 JSON Schema 商品解析技能以默认 `modelInvocable: true` 注册；按 Issue #236 全局上下文 0-Token 策略，后台无头技能须声明 `disable-model-invocation: true`（`modelInvocable: false, userInvocable: true`），避免向普通会话 `<available_skills>` 注入无关 JSON Schema 提示词，且不影响 Hub `headlessSkill` 通过 `ctx.skills.get(name)` 直接加载。
  - 新期望证据：更新该用例断言 `candidate.invocation` 与 `loaded.invocation` 均为 `{ modelInvocable: false, userInvocable: true }`，并通过 `omnimux-products` 全部单测与 `verify-global-skills.mjs` 门禁。
