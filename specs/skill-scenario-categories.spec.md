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

- `plugins/plugins/omnimux-market/src/client/skill-header.test.js`、`suite-marketplace.test.js`、`tests/e2e/market-creatify-cards.spec.js`、`tests/e2e/aigc-category.spec.js`：原断言固定旧 7 个营销分类，改为断言 `skillScenarios` 的 8 个场景与数量。
- `plugins/scripts/generate-featured-skills.test.mjs`、`plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js`：原断言 7 个分类，改为 8 个场景分类。
- `plugins/plugins/omnimux-market/src/client/skill-linkage.test.js`：原断言商品轮播图/图文复刻属于 `image-static`，改为断言场景字段（商品轮播图 `scene-product`、图文复刻 `scene-repurpose`），`category` 断言保持向后兼容。
