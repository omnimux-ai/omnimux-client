# Skill 分类按场景重构

## 背景与问题

当前 Skill 货架的一级分类沿用广告形式（UGC 和用户评价 / 故事讲述和脚本 / 图片和静态广告 / 视频广告 / 产品展示 / 模因与原生 / 其它营销分类），与参考图 1 的「场景分类」层级不一致。用户需要先理解自己要完成什么营销任务，再在对应场景里选技能；按形式分类会让「做一条真人测评」「给新品拍商品图」「投一版信息流素材」这类任务散落在多个分类中。

## 方案

把 Skill 货架一级分类改为按用户营销任务划分的 8 个场景：

| 场景 ID | 中文 | 英文 |
| --- | --- | --- |
| `scene-seeding` | 内容种草 | Content Seeding |
| `scene-brand` | 品牌宣传 | Brand Story |
| `scene-product` | 商品展示 | Product Showcase |
| `scene-performance` | 效果广告 | Performance Ads |
| `scene-app` | 应用推广 | App Promotion |
| `scene-local` | 本地生活 | Local Services |
| `scene-repurpose` | 内容再制 | Content Repurposing |
| `scene-tools` | 通用工具 | General Tools |

- 目录新增 `skillScenarios` 声明与每个技能条目的 `scenario` 字段，`category` 仍保留广告形式作为二级形式标签，避免破坏既有预设与安装链路。
- 市场 Skill 页分类栏展示「场景分类」标签 + 场景胶囊 + 条目数量；切换场景只过滤货架卡片，不改变检索与安装逻辑。
- 会话内 Skill 面板（`SkillsPanel`）与市场共用同一份场景目录，分类胶囊同样显示数量。
- 中英文均使用同一场景 ID 对应的本地化文案。

## 假设

1. 114 个在册技能可被完整映射到 8 个场景，且每个场景都有真实成员，不存在默认空分类。
2. 保留 `category` 作为形式标签后，既有预设分类、技能安装与会话预填链路不需要迁移数据。
3. 场景数量与参考图 1 的「场景分类 + 数量」信息层级一致，能让运营同学先按任务收敛，再选具体技能。

## 证伪方式

1. 任一场景分类在目录中无成员，或存在未映射场景的技能条目。
2. 切换场景后卡片不属于该场景，或「我的 Skill」/预设技能过滤因旧 `category` 值全部落空。
3. Skill 页分类栏仍出现旧 7 个广告形式分类作为一级分类，或场景数量未展示。
4. 构建、单测、E2E、静态门禁任一环节失败。

## 变更范围与验收项

1. `plugins/plugins/omnimux-market/catalog/index.json`：新增 `skillScenarios` 与 114 条 `scenario` 字段。
2. `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js`：场景 taxonomy、匹配、计数。
3. `plugins/plugins/omnimux-market/src/client/plaza/usePlazaFilter.js`、`skill-plaza.js`、`css.js`、`i18n.js`、`plaza/FeaturedCard.jsx`：场景分类栏、数量样式、双语标签。
4. `plugins/scripts/generate-featured-skills.mjs` 与 `plugins/plugins/omnimux/src/client/session-guide/skills/*`：快照输出场景分类并在 Skill 面板展示数量。
5. 更新受影响的单测、E2E 与快照门禁；完成亮/暗主题与窄屏真实浏览器截图校验。

## 旧标准变更

以下既有断言因本次显式改变一级分类需求同步更新：

- `plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js` :: `TrendingReplicateSection: 头部渲染「创作灵感 / Skill」双 Tab 并支持平滑切换`
  - 原断言：技能分类胶囊为 1 个全部 + 7 个细分类。新期望：1 个全部 + 8 个场景分类，并且点击第一个场景「内容种草」后卡片数减少。证据：`node --test plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js`。
- `plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js` :: `featured-skills-data: 快照文件格式与约束`
  - 原断言：快照 categories 长度为 7。新期望：场景 categories 长度为 8，且每个技能带 scenario。证据同上。
- `plugins/plugins/omnimux-market/src/client/skill-header.test.js` :: `install action opens existing modal and category row precedes content`
  - 原断言：分类栏固定 8 个旧营销分类按钮。新期望：分类栏含「场景分类」标签 + 9 个按钮（全部 + 8 场景），顺序由 SKILL_SCENARIOS 固定。证据：`node --test plugins/plugins/omnimux-market/src/client/skill-header.test.js`。
- `plugins/plugins/omnimux-market/src/client/skill-linkage.test.js` :: `Issue #2609：两款技能同时上架技能货架（catalog/index.json），属于 image-static 分类`
  - 原断言：商品轮播图与图文复刻均只断言 category=image-static。新期望：保留 category 兼容断言，并新增商品轮播图 scenario=scene-product、图文复刻 scenario=scene-repurpose。证据：`node --test plugins/plugins/omnimux-market/src/client/skill-linkage.test.js`。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A1 分类栏：013fcb898 后收敛为「全部」+ 7 个营销分类`
  - 原断言：8 个旧营销分类。新期望：9 项「全部 + 8 场景」，且每个场景 count > 0。证据：`node --test plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js`。
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 分类栏：中英文界面与目录声明的营销分类一致`
  - 原断言：buildWorkshopCategories 与 catalog.categories 的 7 个营销分类一致。新期望：与 catalog.skillScenarios 的 8 个场景一致，中英文标签均存在。证据：`node --test plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js`。
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 目录数据：每个营销分类都真实拥有技能成员`
  - 原断言：每个 category 都有成员且无 orphans。新期望：每个 scenario 都有成员，且 114 个技能都有已声明 scenario。证据同上。
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 安装源：营销技能全部为内置 bundled 源`
  - 原断言：营销技能全部为 bundled。新期望：场景技能仍全部为 bundled，source.path 以 catalog/skills/ 开头。证据同上。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `buildWorkshopCategories() 返回全新 7 大分类，默认全部`
  - 原断言：1 个全部 + 7 个业务分类。新期望：1 个全部 + 8 个场景分类且 count > 0。证据：`node --test plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js`。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `多语言原生适配：在中文与英文环境下独立呈现原生文案，彻底消除斜杠双语拼接`
  - 原断言：分类栏首项为 UGC 和用户评价。新期望：首项为内容种草 / Content Seeding，商品展示为第三项。证据同上。
- `plugins/plugins/omnimux/tests/e2e/creatify-skills-library-refactor.e2e.test.mjs` :: `默认呈现全部技能，置顶热门精选(3)、新品上市(6)与探索更多(103)分区`
  - 原断言：SkillsPanel 有 1 个全部 + 7 个分类胶囊。新期望：1 个全部 + 8 个场景分类胶囊（其余旧快照数量断言不在本次范围，保持原状）。证据：`node --test plugins/plugins/omnimux/tests/e2e/creatify-skills-library-refactor.e2e.test.mjs`。
- `plugins/scripts/generate-featured-skills.test.mjs` :: `GEN-04：真实目录生成的快照仍是 113 条精选 / 7 个分类，且与磁盘快照逐字节一致`
  - 原断言：快照 113 条 / 7 个分类。新期望：113 条 / 8 个场景分类，且与磁盘快照逐字节一致。证据：`node --test plugins/scripts/generate-featured-skills.test.mjs`。
