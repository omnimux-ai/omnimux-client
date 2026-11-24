# Issue #235: Phase 2 — 修复 33 个货架空壳（含 3 个首页快捷方式）、移除静态 `installed: true` 并补齐 CI 闭环门禁

## 背景与研究依据

- 追踪总单：[omnimux-ai/omnimux-client#233](https://github.com/omnimux-ai/omnimux-client/issues/233)
- 本阶段工单：[omnimux-ai/omnimux-client#235](https://github.com/omnimux-ai/omnimux-client/issues/235)
- 前置阶段：[omnimux-ai/omnimux-client#234](https://github.com/omnimux-ai/omnimux-client/issues/234)（PR #241，已合入 `3d861ebd`）
- 关联对齐：[omnimux-ai/omnimux-client#213](https://github.com/omnimux-ai/omnimux-client/issues/213)（`video_analyze` 与 `video_reverse_prompt` 视频理解提示词真源化）
- 仓库现状核查（`main@6268ee8a`）：
  1. **33 个标记 `installed: true` 但仓内无 `SKILL.md` 的空壳条目**：
     - `plugins/presets/omni-agent/skills.json`：36 条中 12 条有实文件、24 条空壳（全部硬编码 `"installed": true`）。
     - `plugins/plugins/omnimux-market/catalog/preset-skills.json`：`tiktok-agent`（22 条中 19 条空壳）、`omni-agent`（20 条中 15 条空壳），其余 3 个预设（`drama-agent`、`marketing-agent`、`content-creation-team`）各有 112 条实文件技能，但所有条目均硬编码 `"installed": true`。
     - 两表去重后共 33 个无实文件的空壳 slug。
  2. **首页 4 个核心快捷方式缺 3 份 `SKILL.md`，且 `handleTryAttach` 漏查随包技能目录**：
     - `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/catalog.js` 绑定的 4 个快捷方式：`replicate-viral-video`（已有 `catalog/skills/replicate-viral-video/SKILL.md`）、`video-hook-analysis`（缺失）、`create-selling-video`（缺失）、`reverse-video-prompt`（缺失）。
     - `plugins/plugins/omnimux-market/src/local-api.ts` 的 `handleTryAttach` 仅查 `$DSH_HOME/skills/<slug>` 与 `catalog/index.json` 条目，未查 `catalog/skills/<slug>/SKILL.md`（`bundled-skills.json` 随包技能）、`omnimux-market/skills/<slug>/SKILL.md`（插件随包 SOP 技能）以及运行态 `ctx.skills.get(slug)`；导致干净环境点击快捷方式或随包货架技能且离线时直接落入 `"instruction body is unavailable"`。
  3. **静态 `installed: true` 伪造安装态**：
     - `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js` 直接读取 `preset-skills.json` 里的静态 `installed: true`，使 `findPresetSkill`、`getPresetSkillBinding`、`plazaDiscoverySections` 无法真实区分「随包内置可用（`bundled`）」与「本地磁盘/Provider 已安装（`installed`）」，也无法拦住无实文件的空壳。

## 假设

1. 为 3 个缺失的首页快捷方式（`video-hook-analysis`、`create-selling-video`、`reverse-video-prompt`）在 `plugins/plugins/omnimux-market/catalog/skills/<slug>/SKILL.md` 补齐原创、可执行且仅引用实际已注册运行时工具的技能指令并登记至 `catalog/bundled-skills.json`，同时在 `local-api.ts` / `expert/install.js` / `expert/catalog-provider.js` / `install.ts` 打通本地随包与 `ctx.skills` 解析链路后，4 个首页快捷方式与所有货架技能在空 `$DSH_HOME/skills/`、离线环境下执行 `tryAttach` 均返回 `hasBody: true` 与非空真实正文，绝不落入 `"instruction body is unavailable"`。
2. 清理 `plugins/presets/omni-agent/skills.json` 与 `plugins/plugins/omnimux-market/catalog/preset-skills.json` 中的全部 30 个空壳条目、对齐 Phase 1 保留的自研随包技能及已预装的社媒/跨境 SOP 技能，并移除全部静态 `"installed": true` 后，两份货架清单实现零空壳与零静态安装态伪造。
3. 在 `skill-picker-logic.js` 中基于 `catalog/index.json`、`catalog/bundled-skills.json`、`omnimux-market/dsh.manifest.json` 推导 `BUNDLED_SKILL_SLUGS`，结合 `api("list")` 返回的实时磁盘安装与非目录 Provider 集合推导 `installed` / `bundled` / `available`，并在 `skill-picker.js` 与 `skill-plaza.js` 消费派生状态后，前端既能真实反映磁盘/Provider 安装态，又能让本地随包技能免下载即点即用。
4. 扩展 `plugins/scripts/verify-skill-hygiene.mjs`（同步在 `quality-gate.yml` 与 `pnpm test:gates` 执行），新增零空壳校验（首页快捷方式、`presets/*/skills.json`、`catalog/preset-skills.json`、内置专家 `DEFAULT_MARKET_EXPERTS` 与随包 `catalog/experts/*`）、禁静态 `installed: true` 校验与运行时工具名真源校验后，任何新增空壳、伪造安装态或虚构工具引用均会被 CI 稳定拦截。

## 证伪方式

1. **快捷方式端到端双向证伪**：在空 `$DSH_HOME/skills/` 且离线/阻断远端下载的测试环境下对 4 个快捷方式 slug 逐一调用 `handleApi(tryAttach)`，必须全部返回 `hasBody: true` 且 `renderAttachedTrialSection` 不含 `"instruction body is unavailable"`；回退本地随包解析后该用例必须失败。
2. **静态 `installed: true` 伪造证伪**：在单元测试中向 `findPresetSkill` / `getPresetSkillBinding` 注入带 `"installed": true` 但不在真实随包/已装/Provider 集合中的假条目，必须返回 `null` / `available: false`、`installed: false`；`plazaDiscoverySections` 在 `installedItems: []` 时不得把未落盘的预设技能标为 `installed: true`。
3. **CI 门禁双向证伪**：在 `verify-skill-hygiene.test.mjs` 构造含空壳快捷方式、空壳预设/货架/内置专家引用、静态 `installed: true`、以及未注册工具名的临时夹具，`verifySkillHygiene` 必须全部判定 `ok: false` 并返回对应错误码；真实仓树必须返回 `ok: true` 且 `issues` 为空。
4. **全量本地验证**：`corepack pnpm --dir plugins run build:all`、`omnimux-market` 与 `omnimux` 受影响单测、`verify:skill-hygiene`、`verify:skill-bilingual`、`check:boundaries`、`presets:verify`、`test:gates`、`verify-test-standard-declarations`、`verify-fix-regression-test` 全部通过。

## 改动范围与交付清单

1. **新增 3 个首页快捷方式真实 `SKILL.md` 并登记 `bundled-skills.json`**：
   - `plugins/plugins/omnimux-market/catalog/skills/video-hook-analysis/SKILL.md`
   - `plugins/plugins/omnimux-market/catalog/skills/reverse-video-prompt/SKILL.md`
   - `plugins/plugins/omnimux-market/catalog/skills/create-selling-video/SKILL.md`
   - 更新 `plugins/plugins/omnimux-market/catalog/bundled-skills.json`
2. **修复本地随包与运行态技能正文解析链路**：
   - `plugins/plugins/omnimux-market/src/expert/install.js`：导出 `resolveLocalBundledSkillDir` / `readLocalBundledSkillMarkdown`（严格 slug 校验，按 `catalog/skills` → `skills` → `catalog/experts/*/skills` → 同级 `omnimux-*/skills` 查找）。
   - `plugins/plugins/omnimux-market/src/local-api.ts` 与 `src/host.ts`：`handleTryAttach` 与 `resolveExploreDirectory` 接入本地随包解析与 `ctx.skills` 运行时查询；`handleSkillList` 附加真实 `providerSlugs`（排除 `omnimux-catalog` 远端占位）。
   - `plugins/plugins/omnimux-market/src/expert/catalog-provider.js`：`list()` 补充发布 `bundled-skills.json` 0-Token 候选，`resolveSkillDefinition` 支持 `skills/` 与同级插件技能。
   - `plugins/plugins/omnimux-market/src/install.ts`：`installSkill` 支持直接从本地随包目录安装，避免误打远端 SkillHub。
3. **清理 30 个货架空壳并移除静态 `installed: true`**：
   - 收敛更新 `plugins/presets/omni-agent/skills.json`（保留真实有 `SKILL.md` 的核心创作/社媒/跨境 SOP 技能，零空壳、零静态 `installed`）。
   - 收敛更新 `plugins/plugins/omnimux-market/catalog/preset-skills.json`（`tiktok-agent` 与 `omni-agent` 保留 `创作视频` / `创作图片` 为前两大分类并收敛至真实技能，移除所有 5 个预设里的静态 `installed: true`）。
4. **货架可用态派生改造**：
   - `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js`：引入 `BUNDLED_SKILL_SLUGS`、`hydratePresetSkill`、`isSkillLocallyAvailable`，移除对静态 `installed: true` 的信任，改为由随包真源 + 实时已装/Provider 清单推导。
   - `plugins/plugins/omnimux-market/src/client/skill-picker.js` 与 `src/client/skill-plaza.js`：消费实时 `api("list")`（含 `providerSlugs`）与 `isSkillLocallyAvailable`。
5. **扩展 CI 门禁与双向证伪测试**：
   - 扩展 `plugins/scripts/verify-skill-hygiene.mjs` 与 `plugins/scripts/verify-skill-hygiene.test.mjs`。
   - 增补 `plugins/plugins/omnimux-market/src/tests/try-attach.test.ts` 与客户端逻辑回归测试，更新受旧空壳清单影响的 3 份既有测试。

## 旧标准变更

- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `未内置的条目视为解析不到，绝不返回`
  - 原断言：依赖静态 `installed: false` / `installed: true` 字段区分同一 slug 是否可解析。
  - 变更理由：Issue #235 禁止以静态 `installed: true` 伪造安装态，`findPresetSkill` 改为基于真实随包/已装/Provider 清单推导，同时保留对显式禁用（`installed: false`）与未在真实清单中条目的拒绝语义。
  - 新期望证据：同名用例校验未在真实可用集合的静态 `installed: true` 条目返回 `null`，以及显式传入 `installedSlugs` / `providerSlugs` 后正确命中。
- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `四条 slug 都在出厂 Agent 预设技能表里，且均为已内置`
  - 原断言：断言 `presets/omni-agent/skills.json` 静态写有 `hit.installed === true`。
  - 变更理由：Issue #235 移除静态 `installed: true`，改为要求 4 条快捷方式在 `presets/omni-agent/skills.json` 登记、无静态 `installed` 字段且在磁盘拥有真实非空 `SKILL.md`。
  - 新期望证据：用例校验 4 条 slug 均在 `presets/omni-agent/skills.json` 中、不携带静态 `installed` 字段，且磁盘物理 `SKILL.md` 存在且非空。
- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `四条 slug 现在都能从会话技能选择器的预设绑定解析到`
  - 原断言：断言 `findPresetSkill(slug).installed === true`（来自静态 JSON）。
  - 变更理由：Issue #235 将随包可用态（`bundled: true` / `available: true`）与真实磁盘安装态（`installed`，由运行态推导）解耦。
  - 新期望证据：用例校验 4 条 slug 均能经 `findPresetSkill` 解析，返回 `bundled: true`、`available: true` 且名称与快捷方式一致。
- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `15 款技能都在货架上，且分类、文案、封面齐备`
  - 原断言：钉住旧版 15 款清单（含 9 个无 `SKILL.md` 的空壳条目）并断言静态 `hit.installed === true`。
  - 变更理由：Issue #235 清理无实文件的 9 个空壳（`video-script-creation`、`video-prompt-generation`、`video-generation`、`video-storyboard-image`、`product-image-set`、`aplus-content`、`image-replication`、`multi-angle-product-images`、`ai-virtual-try-on`），以真实有 `SKILL.md` 的随包与跨境 SOP 技能替代，并移除静态 `installed: true`。
  - 新期望证据：用例校验 `创作视频` 与 `创作图片` 分类下所有货架条目均含完整中英文标题、合法封面路径、`bundled: true`、`available: true`，且逐条对应真实非空磁盘 `SKILL.md`。
- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `新增 15 款的字段集与既有条目完全一致（不再漏 titleEn）`
  - 原断言：按旧 15 款清单比对含静态 `installed` 字段的对象键集合。
  - 变更理由：清理 9 个空壳并全量移除 `preset-skills.json` 静态 `installed` 字段后，应校验全量货架条目字段集统一且无静态 `installed`。
  - 新期望证据：用例校验 `tiktok-agent` 与 `omni-agent` 全部技能字段集一致、均有非空 `titleEn` 且原始 JSON 不含静态 `installed` 字段。
- `plugins/plugins/omnimux-market/src/client/skill-linkage.test.js` :: `filterPresetSkills 按恢复后的分类归档：创作视频 7 款、创作图片 8 款`
  - 原断言：硬编码旧版含 9 个空壳的 7/8 数量。
  - 变更理由：Issue #235 清除 `创作视频` 与 `创作图片` 中的 9 个无实文件空壳并收敛为真实随包及 SOP 技能，同时保持 `创作视频` / `创作图片` 前二顺序、`reverse-video-prompt` 归入 `创作视频` 与禁用 `搜索爆款视频` 分类。
  - 新期望证据：用例断言收敛后的真实技能数量（创作视频 8 款、创作图片 6 款）、4 条快捷方式均在 `创作视频`、且 `搜索爆款视频` 返回空集。
- `plugins/plugins/omnimux-market/src/client/skill-linkage.test.js` :: `Issue #2609：两款电商图文技能预装进创作图片分类，且为已内置态`
  - 原断言：断言静态 `hit.installed === true`。
  - 变更理由：Issue #235 移除静态 `installed: true`，改以 `bundled: true` / `available: true` 表达随包预装态（选择器同样不显示下载角标且点击不触发安装动作）。
  - 新期望证据：用例断言 `shoppable-carousel` 与 `replicate-carousel` 的 `bundled === true`、`available === true`、`isSkillLocallyAvailable(hit) === true` 且 `installPayload(hit) === null`。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `tiktok-agent contains the 6 preset categories (ec1590182 社媒纯化)`
  - 原断言：断言含 4 个纯空壳分类（`蓝海选品`、`爆款短视频`、`达人与账号复盘`、`创作者中心`）的旧 6 分类列表。
  - 变更理由：Issue #235 清除全部无实文件空壳并将分类收敛为 5 个全实文件支撑的分类（`创作视频`、`创作图片`、`选品与需求`、`趋势与达人复盘`、`文案与运营`）。
  - 新期望证据：用例断言新的 5 个分类与 6 个页签（含 `all`），且每个分类均有真实技能支撑。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `tiktok-agent preset carries complete per-skill metadata (ec1590182 社媒纯化后 22 款)`
  - 原断言：检查 16 个已被清理的空壳技能标题。
  - 变更理由：Issue #235 清除空壳条目并替换为有真实 `SKILL.md` 的随包与社媒/跨境 SOP 技能。
  - 新期望证据：用例校验收敛后核心快捷方式、电商图文与社媒/跨境 SOP 技能标题与完整元数据（含封面与 `bundled: true` / `available: true`）。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `filterPresetSkills filters by category and search query`
  - 原断言：以空壳词「蓝海」匹配已删除的空壳条目「TikTok 蓝海爆品发现」。
  - 变更理由：该空壳条目已随 Issue #235 清除，由真实 SOP 技能「类目市场与选品调研」等替代。
  - 新期望证据：用例改以真实关键词「选品」「复刻」验证跨分类搜索过滤与各分类计数精确匹配。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `filterPickerItems delegates to filterPresetSkills when presetBinding is passed`
  - 原断言：按已移除的纯空壳分类 `蓝海选品` 断言 2 条空壳结果。
  - 变更理由：空壳分类 `蓝海选品` 已收敛为有真实 `SKILL.md` 支撑的 `选品与需求` 分类（3 款真实选品/需求/定价 SOP 技能）。
  - 新期望证据：用例按 `选品与需求` 验证 `filterPickerItems` 委托行为与精确条目数。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `Issue #1280: tiktok-agent 创作视频 category lists the preset viral video skills with covers`
  - 原断言：检查 3 个已清理的空壳名称（`视频生成`、`视频脚本创作`、`视频提示词生成`）。
  - 变更理由：Issue #235 清理该 3 个空壳，保留 4 条真实快捷方式并接入真实随包/SOP 视频技能（`带货短视频脚本`、`电影级运镜语言`、`多语言出海视频广告`、`剪辑草稿导出`）。
  - 新期望证据：用例断言收敛后的 8 款真实视频技能全部可见、含封面且 `featured` / `regular` 无重复，同时验证在 `installedItems: []` 时不会虚假标为 `installed: true`。
