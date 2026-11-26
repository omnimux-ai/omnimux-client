# OmniMux Skill 市场垂直精品化（Phase A：6 大垂直场景、36 款官方精品与数量守恒）

- **Tracking Issue**: [#350](https://github.com/omnimux-ai/omnimux-client/issues/350)
- **基线提交**: `origin/main@51104110`

## 背景与研究依据

1. **市场定位与对标调研结论**：
   - OmniMux 当前仓内已沉淀 **49 份真实 `SKILL.md`**（`catalog/skills/` 18 份、`plugins/omnimux-market/skills/` 20 份、`omnimux-clip` 1 份，以及 `omnimux-inspiration` / `omnimux-products` / `omnimux-tiktok-selection` / `omnimux-video` / `omnimux-workflow` 各 2 份），但 Skill 广场仅上架 16 款且分类口径 4 处冲突（`categories.ts` 12 泛类、`catalog/index.json` `skillScenarios` 6 类、`skillCategories` 7 类、`category` 旧领域 7 类），同时混入 `$DSH_HOME/skills` 本地个人技能与 `kind: "suite"` 专家套件，导致「全部 16 / 探索更多 93」计数严重不守恒。
   - 对标本机 Accio Work Desktop 技能市场目录结构后确认：Accio 以泛办公长尾为主（9 泛场景 × 4–10 技能），仅通过 `skill-creator` 与 `skill-finder` 承载冷启动与泛化找技能入口；而 OmniMux 在短视频带货创作、爆款拆解复刻、商品视觉与社媒/TikTok 增长赛道已具备完整工具链，应坚持「内容创作 + 电商/社媒营销增长」垂直精品定位，不走泛办公大杂烩路线。
2. **本 PR（Phase A）严格边界**：
   - **只做**：6 大垂直场景统一收口、重叠本地化 Skill 合并、2 款纯原创随包内置 `skill-creator` / `skill-finder`（`0-Token`）、`source.type = "plugin"` 零拷贝插件引文上架 + 卫生门禁、36 款官方精品上架（16 既有 + 2 新随包 + 18 插件直引；14 款内部/底部依赖技能保持隐式不入广场发现流）、广场数量守恒修复、去中点 `·` 与 `查看全部 >` 滚动修复、中枢/广场 UI 文案与图标同步。
   - **不做**（留待后续 PR）：`WorkshopStore` 可写 `state.v1.json` 启停开关、`我的 Skill` 页签升级与云端远端目录热更新。
   - **全局 0-Token 预算守恒**：`skill-finder` 必须携带 `disable-model-invocation: true`，确保 `verify-global-skills.mjs` 维持 `2/4` 预算不膨胀；`presets/omni-agent/skills.json` 的 33 项输入栏选择器 4Tab 口径（Issue #337）保持兼容不受破坏。

## 假设

1. 将 Skill 市场统一收口为 **6 大垂直场景**（`scene-video` 短视频创作 5、`scene-replicate` 爆款复刻与再制 6、`scene-visual` 商品视觉与海报 5、`scene-research` 选品与社媒洞察 8、`scene-growth` 投放与增长运营 8、`scene-tools` 剪辑与效率工具 4）并上架 **36 款官方精品技能**，同时合并 `omnimux-ecom-global-localizer` 到 `catalog/skills/global-ad-localizer`（同步更新 `dsh.manifest.json`、`expert-market.ts` 与确定性脚本测试）并新增纯原创 0-Token 随包技能 `skill-creator` 与 `skill-finder` 后，可实现能力零丢失、零重叠与全量双语元数据一致。
2. 在 `catalog.js` / `install.js` / `verify-skill-hygiene.mjs` 中原生支持 `source.type = "plugin"`（校验 `{ plugin, path }` 真实存在且声明于宿主插件 `dsh.manifest.json`，零复制物理目录，安装态按插件内置技能直认已就绪，读取正文直读插件源目录）并扩展卫生门禁双向证伪后，无需复制任何一份 `SKILL.md` 即可把 `omnimux-market/skills/`（17 款）与 `omnimux-clip/skills/`（1 款）共 18 款插件随包技能安全上架广场，且不触发 `check:boundaries` 或 `verify-skill-hygiene` 违规。
3. 在 `skill-aggregate.ts` / `local-api.ts` / `skill-picker-logic.js` / `skill-plaza.js` 中隔离「官方广场发现集」与「个人 `$DSH_HOME/skills` 已装清单」及 `kind: "suite"` 套件，并在 `PlazaCardGrid.jsx` 移除 `' · '` 中点分隔符、将 `查看全部 >` 修复为平滑滚动至探索更多专区后，广场「全部」计数严格满足 `36 === 热门精选 5 + 新品上市 5 + 探索更多 26 === 5 + 6 + 5 + 8 + 8 + 4`，且亮/暗双主题及窄屏下无裁切、无未定义 `--dsw-*` Token、点击 `创建 Skill` 可在无外网环境下真实预填 `/skill-creator`。

## 证伪方式

1. **目录结构、门禁与双向证伪测试**：
   - 运行 `node scripts/verify-skill-hygiene.mjs` 与扩展后的 `node --test scripts/verify-skill-hygiene.test.mjs`，并用损坏 `source.type: "plugin"` 路径/未声明插件技能/违禁 `license` 夹具验证门禁真实报错失败；
   - 运行 `node scripts/verify-skill-bilingual.mjs`、`node scripts/generate-featured-skills.mjs --check`、`node scripts/verify-global-skills.mjs`、`node scripts/verify-dsw-tokens.mjs`、`node scripts/verify-plugin-boundaries.mjs` 与 `node scripts/workspace-check.mjs --check`。
2. **单测与真实计数守恒回归**：
   - 新增 `skill-aggregate.test.ts` 与 `skill-plaza` 回归测试：注入 10 条未入库 `$DSH_HOME/skills` 伪造技能 + 8 条 `suite` 时，验证空词浏览发现流仍严格返回 36 款且 `hot 5 + new 5 + exploreMore 26 === 36`，非空关键词检索仍能召回匹配已装技能；
   - 运行 `omnimux-market`（含 `ecom-sop-skills.test.js`、`catalog.test.js`、`install.test.js`、`bundled-skills.test.ts`、`experts-market.test.ts` 等）与 `omnimux`、`omnimux-inspiration` 全部单测及 E2E。
3. **高保真演示 + Worktree 真实浏览器双主题验收**：
   - 先使用 `ego-browser` 在亮/暗双主题和宽/窄双视口下验收高保真 HTML 演示；
   - 再对工作树构建产物通过 `ego-browser` 实测渲染：核对 6 场景胶囊与精确数字、热门 5 / 新品 5 / 探索更多 26 守恒、页面零 `·` 中点、`查看全部 >` 点击后滚动进入探索更多、`plugin` 类型技能详情正文可读、`创建 Skill` 点击正常触发预填，以及亮/暗主题与窄屏布局完整无截断。

## 改动清单

1. **规格与高保真演示**：
   - `specs/skill-market-phase-a-350.spec.md`
   - 独立交互演示 HTML（保存在会话 scratch 目录并先期浏览器验收）
2. **重叠技能合并与新随包技能（`plugins/plugins/omnimux-market/`）**：
   - 合并 `plugins/plugins/omnimux-market/skills/omnimux-ecom-global-localizer`（含 `scripts/check_localization_matrix.py`）至 `plugins/plugins/omnimux-market/catalog/skills/global-ad-localizer/`，移除旧目录
   - 更新 `plugins/plugins/omnimux-market/dsh.manifest.json`（`skills[]` 从 20 收敛为 19，移除 `skillMetadata['omnimux-ecom-global-localizer']`）、`src/expert-market.ts`、`src/bundled-skills.ts`、`src/expert-skills-plugin.ts` 与 `src/presets/ecom-sop-skills.test.js`
   - 新增纯原创随包 `plugins/plugins/omnimux-market/catalog/skills/skill-creator/{SKILL.md,meta.yaml}` 与 `skill-finder/{SKILL.md,meta.yaml}`（均设 `disable-model-invocation: true`）
   - 更新 `plugins/plugins.registry.json`（`registry:build`）
3. **支持 `source.type = "plugin"` 零拷贝引用与门禁（`plugins/`）**：
   - `plugins/plugins/omnimux-market/src/types.ts`、`src/install.ts`、`src/local-api.ts`、`src/skill-aggregate.ts`
   - `plugins/plugins/omnimux-market/src/expert/{paths.js,catalog.js,install.js,catalog-provider.js}`（同步编译 `lib/`）
   - `plugins/scripts/verify-skill-hygiene.mjs` & `plugins/scripts/verify-skill-hygiene.test.mjs`
4. **6 大垂直场景、36 款精选上架与快照（`plugins/`）**：
   - `plugins/plugins/omnimux-market/catalog/index.json`（`skillScenarios` 收敛为 6 场景、`skillCategories` 同步、36 款 `skill` 条目含精确 5 热 / 5 新 / 26 探索与完整双语/归属字段）
   - `plugins/plugins/omnimux-market/catalog/skill-recommendations.json`
   - `plugins/scripts/generate-featured-skills.mjs` & `plugins/plugins/omnimux/src/client/session-guide/skills/featured-skills.json`
5. **数量守恒、6 场景映射、去中点、`查看全部 >` 与双主题/详情修复**：
   - `plugins/plugins/omnimux-market/src/categories.ts`
   - `plugins/plugins/omnimux-market/src/skill-aggregate.ts` & `src/local-api.ts`
   - `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js`
   - `plugins/plugins/omnimux-market/src/client/skill-plaza.js`
   - `plugins/plugins/omnimux-market/src/client/plaza/PlazaCardGrid.jsx` & `FeaturedCard.jsx`
   - `plugins/plugins/omnimux-market/src/client/{i18n.js,css.js,skills-ui.js}`
   - `plugins/plugins/omnimux/src/client/session-guide/catalog.js` & `plugins/plugins/omnimux/src/client/session-guide/skills/{SkillCard.jsx,SkillsPanel.jsx}`
6. **回归与适配测试**：
   - 新增/强化 `catalog.test.js`、`install.test.js`、`skill-aggregate.test.ts`、`verify-skill-hygiene.test.mjs`
   - 同步更新下方「旧标准变更」列明的既有快照断言测试

## 旧标准变更

由于本次任务按 Issue #350 将 Skill 市场统一收口为「6 大垂直场景 / 36 款官方精品技能（含 18 款 `plugin` 零拷贝引用）/ 数量严格守恒」，以下修改了断言目标（旧场景数 8/6、旧技能数 16/113/114、旧 20 个随包 SOP 技能或套件混入首页等）的既有测试按规范逐条声明原标准、变更理由与新期望证据：

- `plugins/plugins/omnimux-market/src/presets/ecom-sop-skills.test.js` :: `all 10 cross-border SOP skills are declared in dsh.manifest.json with valid frontmatter and zero dead tools`
  - 原断言：校验 `skills/` 下 10 个 `omnimux-ecom-*` 目录（含已合并的 `omnimux-ecom-global-localizer`）。
  - 变更理由：`omnimux-ecom-global-localizer` 已合并至 `catalog/skills/global-ad-localizer/`（含脚本 `scripts/check_localization_matrix.py`）。
  - 新期望证据：校验其余 9 个 `skills/omnimux-ecom-*` 与 `catalog/skills/global-ad-localizer/SKILL.md` 声明、前置元数据及工具零遗漏全部通过。
- `plugins/plugins/omnimux-market/src/tests/bundled-skills.test.ts` :: `*`
  - 原断言：校验 `dsh.manifest.json` 声明 `20` 个随包技能及 `expert-skills` 测试按旧随包数量断言。
  - 变更理由：合并去重移除 `skills/omnimux-ecom-global-localizer` 后 `dsh.manifest.json` `skills[]` 收敛为 `19` 个，`ecom-global-localizer` 专家改用 `catalog/skills/global-ad-localizer`。
  - 新期望证据：断言 `skills.length === 19`、`candidates.length === 19` 与 `loadCatalogSkillBySlug` 解析通过。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景 taxonomy：8 个场景，每个都有成员，114 个技能无未映射孤儿`
  - 原断言：按旧版场景名称断言 6 个旧 ID（标题遗留「8 个场景 / 114 个技能」字样）。
  - 变更理由：统一收口为 6 个「内容创作 + 电商/社媒营销增长」垂直场景及 36 款精选精品技能，并同步清晰命名用例。
  - 新期望证据：断言 6 个新场景 ID `['scene-video', 'scene-replicate', 'scene-visual', 'scene-research', 'scene-growth', 'scene-tools']`，36 款上架技能零孤儿。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景分类栏：全部 + 8 个场景，数量为真实目录计数`
  - 原断言：校验 `buildWorkshopCategories` 返回旧场景 ID 与旧「8 个场景」命名标题。
  - 变更理由：同上，统一为「全部 + 6 个垂直场景」，计数严格守恒于 36 款上架精品。
  - 新期望证据：断言 `buildWorkshopCategories(null)` 返回 7 项（`全部 36` + 6 场景 `5, 6, 5, 8, 8, 4`）。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景过滤：显式 scenario 命中，旧 category 条目按兼容映射命中`
  - 原断言：`stickman-video-director` 命中 `scene-seeding`，`product-showcase` 命中 `scene-product`。
  - 变更理由：旧场景 ID 迁移为新垂直场景 ID（`scene-video`、`scene-visual`）。
  - 新期望证据：断言 `stickman-video-director` 归 `scene-video`，`product-showcase` 归 `scene-visual`，显式/兼容映射均精准命中。
- `plugins/plugins/omnimux-market/src/client/skill-header.test.js` :: `install action opens existing modal and category row precedes content`
  - 原断言：`categoryButtons.slice(0, 5)` 键为 `['', 'scene-seeding', 'scene-brand', 'scene-product', 'scene-performance']`。
  - 变更理由：场景顺序与 ID 更新为 6 个新垂直场景。
  - 新期望证据：断言 `categoryButtons.length === 7` 且前 5 项为 `['', 'scene-video', 'scene-replicate', 'scene-visual', 'scene-research']`。
- `plugins/plugins/omnimux-market/src/client/skill-linkage.test.js` :: `Issue #2609：两款技能同时上架技能货架（catalog/index.json），保留 image-static 形式并归属场景分类`
  - 原断言：`sk-omx-shoppable-carousel` 的 `scenario` 为 `'scene-product'`，`sk-omx-replicate-carousel` 为 `'scene-repurpose'`。
  - 变更理由：两款技能分别归属新垂直场景 `'scene-visual'` 与 `'scene-replicate'`。
  - 新期望证据：更新预期 `scenario` 为 `'scene-visual'` / `'scene-replicate'`，物理随包与预装态断言保留不变。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A1 分类栏：按场景收敛为「全部」+ 8 个场景`
  - 原断言：断言 `SCENARIOS` 为旧 6 场景且名称含历史「8 个场景」。
  - 变更理由：场景词表更新为 6 个统一垂直场景。
  - 新期望证据：断言 `SCENARIOS` 为 6 个垂直场景 ID 且分类栏只列「全部」+ 6 场景。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A1 列表：套件只落「套件」分类，其他分类不混入套件`
  - 原断言：`plazaDiscoverySections()` 无分类（`全部`）下 `all.regular` 混入 8 条 `suite`。
  - 变更理由：修复「全部 36 === 热门 5 + 新品 5 + 探索更多 26」计数守恒，发现页「全部」仅列官方 36 款精品 Skill，不再混入 `suite`；`套件` 分类独立列 8 条套件。
  - 新期望证据：断言 `all.regular` 零 `suite` 混入，`category: '套件'` 仍完整返回 `SUITES.length === 8`。
- `plugins/plugins/omnimux-market/tests/e2e/suite-marketplace.spec.js` :: `E2E 旅程一（边界）：全部含套件、技能领域分类不含套件、选择器页签不含套件`
  - 原断言：校验切换到 `全部`（`''`）时包含套件标题。
  - 变更理由：同上，Skill 广场 `全部` 仅展示 36 款垂直精品 Skill，套件仅在 `套件` 分类展示。
  - 新期望证据：验证 `全部` 仅含 Skill 且套件数为 0，`category: '套件'` 完整展示 8 张套件卡。
- `plugins/plugins/omnimux-market/src/client/skill-recommendations.test.js` :: `shipped configuration covers every recommended skill and validates clean`
  - 原断言：`home.regular.length` 等价 `skills + suites - homeRecommendations`，且推荐技能数为 16。
  - 变更理由：推荐精品扩至 36 款，同时 `all` 发现区不再混入 `suite`。
  - 新期望证据：断言 `config.featuredSkills.length === 36` 且 `home.regular.length === skills.length - config.homeRecommendations.length`。
- `plugins/plugins/omnimux-market/src/client/skill-recommendations.test.js` :: `real workshop renders shelf sections and every recommended skill on Featured`
  - 原断言：工坊 DOM 中推荐卡被 `renderFeaturedSection` 分离渲染，`.regular-section` 只含剩余项。
  - 变更理由：`renderFeaturedSection` 停用后 `resolvePlazaSectionsData` 将 `featuredItems` 合回常规区「热门精选(5) / 新品上市(5) / 探索更多(26)」，保证首页 36 项无遗漏。
  - 新期望证据：断言真实工坊 `全部` 页签渲染恰好 `36` 张 `.featured-card`。
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 安装源：场景技能全部为内置 bundled 源`
  - 原断言：仅允许 `source.type === 'bundled'` 与 `catalog/skills/` 路径。
  - 变更理由：Phase A 合法引入 `source.type === 'plugin'`（指向宿主插件 `skills/<slug>` 的零拷贝直引）。
  - 新期望证据：断言 `source.type` 为 `'bundled'` 或 `'plugin'`，且物理 `SKILL.md` 真实存在。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `buildWorkshopCategories() 返回 8 个场景分类，默认全部`
  - 原断言：校验 `cats[1].id === 'scene-seeding'`、`cats[3].id === 'scene-product'`、`cats[4].id === 'scene-performance'`。
  - 变更理由：场景分类切换为 6 大垂直场景 `scene-video`、`scene-visual`、`scene-research` 等。
  - 新期望证据：断言更新为新垂直场景 ID 及精确数量与顺序。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `多语言原生适配：在中文与英文环境下独立呈现原生文案，彻底消除斜杠双语拼接`
  - 原断言：断言旧场景 `cat.scene-seeding` 与旧英文翻译。
  - 变更理由：6 大垂直场景标签切换为 `cat.scene-video` / `cat.scene-replicate` 等新中英文文案（并修复 `cat.scene-tools` 重复键覆盖问题）。
  - 新期望证据：断言中英文环境下场景与卡片标题独立呈现对应原生文案，无斜杠拼接与双语残缺。
- `plugins/plugins/omnimux-market/tests/e2e/market-hot-picks-new-arrivals-5.spec.js` :: `E2E-3 新品上市专区严格限制为前 5 个技能，杜绝第 6 个落单`
  - 原断言：仅校验新品区数量为 5（旧版含遗留总数及未校验与探索更多交集）。
  - 变更理由：在 `PlazaCardGrid.jsx` 移除 `' · '` 中点计数并落地 36 款守恒，强约束热门(5) / 新品(5) / 探索更多(26) 严格互斥且和为 36。
  - 新期望证据：断言互斥无重叠且总和严格等于 36（`5 + 5 + 26 === 36`）。
- `plugins/plugins/omnimux/tests/e2e/creatify-skills-library-refactor.e2e.test.mjs` :: `默认呈现全部技能，置顶热门精选(3)、新品上市(6)与探索更多(103)分区`
  - 原断言：历史测试标题含 `(3)/(6)/(103)` 且主体校验旧版 16 款（热门 5 / 新品 6 / 探索 5）。
  - 变更理由：Phase A 官方精品上架扩充至 36 款，且统一与广场一致采用「热门 5 + 新品 5 + 探索更多 26」。
  - 新期望证据：断言 `featured-skills.json` 与 UI 分区呈现 `5 + 5 + 26 === 36`。
- `plugins/plugins/omnimux/tests/e2e/debrand-skills-library.e2e.test.mjs` :: `验证全量快照与目录中零品牌残留，author均为Official且tags无原厂词汇`
  - 原断言：`snapshot.skills.length === 16`，统一断言 `owner === 'omnimux-market'` 与 `license === 'MIT'`。
  - 变更理由：官方精品扩至 36 款，且直引 `omnimux-clip` 的 `clip-craft` 保持自身真实 `owner: 'omnimux-clip'` 与 `license: 'SEE LICENSE IN LICENSE'`。
  - 新期望证据：断言 `snapshot.skills.length === 36`、零品牌残留，且 `omnimux-market` 与 `omnimux-clip` 均按真实 provenance 通过校验。
- `plugins/scripts/generate-featured-skills.test.mjs` :: `GEN-04：真实目录生成的快照仍是 113 条精选 / 8 个场景分类，且与磁盘快照逐字节一致`
  - 原断言：历史标题含 `113 条 / 8 个场景`，实际校验旧目录 16 条快照字节一致。
  - 变更理由：官方货架精品扩展为 36 条 / 6 个垂直场景分类。
  - 新期望证据：断言实盘快照与生成器输出逐字节一致（`36` 条精选 / `6` 个场景分类）。
- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-01：市场目录 113/113 官方货架技能双语齐备（门禁验收证据）`
  - 原断言：历史标题含 `113/113`，校验旧 16 条货架双语齐备。
  - 变更理由：官方货架扩充至 36 条，须 36/36 全量双语通过。
  - 新期望证据：断言实仓 36/36 官方货架技能双语齐备，门禁零错误。
- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-03（故障注入）：缺失字段被定位到 id 与字段名，且不通过`
  - 原断言：故障注入复用 `cat.skills` 与旧数量断言。
  - 变更理由：随新目录结构更新故障注入夹具并保留完整字段定位断言。
  - 新期望证据：断言缺失英文字段仍被精确报告到具体 `id` 与字段名且门禁不通过。
- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-06：CLI 端到端——正常目录 exit 0，故障目录 exit 1 且不空转`
  - 原断言：CLI 成功输出校验旧总数。
  - 变更理由：正常目录通过条数由 16 变为 36。
  - 新期望证据：断言正常目录 CLI 输出 `36/36` 且 exit 0，故障目录 exit 1。
- `plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js` :: `TrendingReplicateSection: 技能卡片名称跟随 DSH 语言环境精准适配中英文双语`
  - 原断言：断言第 2 枚场景胶囊为旧 `scene-seeding` 且 `scene-tools` 原词或旧技能位置。
  - 变更理由：6 垂直场景收口后第 2 枚场景为 `scene-video`（`短视频创作` / `Video Creation`），原 `content-strategy` / `social-caption` 迁至 `scene-growth`（`投放与增长运营` / `Ads & Growth Ops`）。
  - 新期望证据：分别按 `scene-video`（含 `火柴人视频导演` / `Stickman Video Director`）与 `scene-growth` 校验中英文切换完全通过。
- `plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js` :: `featured-skills-data: 快照文件格式与约束`
  - 原断言：快照技能总数为 16，且全部固定为单一归属。
  - 变更理由：快照扩充至 36 款精品（18 `bundled` + 18 `plugin`）。
  - 新期望证据：断言快照 `skills.length === 36` 且每条均含完整结构与真实归属。
- `plugins/scripts/verify-skill-hygiene.test.mjs` :: `real repository passes verifySkillHygiene with zero violations`
  - 原断言：`catalogDirCount === 18`（16 indexed + 2 bundled），未校验 `pluginRefCount`。
  - 变更理由：新增随包技能 `skill-creator` 与 `skill-finder` 使 `catalogDirCount` 变为 20（18 + 2），并新增 `pluginRefCount === 18` 与跨插件引文校验。
  - 新期望证据：断言实仓 `verifySkillHygiene` 零违规（20 目录、18 plugin refs、30 随包技能）并通过 3 条负向故障注入单测。
