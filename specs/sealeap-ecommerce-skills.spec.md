# SeaLeap 跨平台电商外部技能入库（195 项）

Tracking Issue: #418

## 背景与研究依据

1. 用户需求：将开源仓库 `xjli360/sealeap-ecommerce-skills`（MIT License，基线提交 `914f920b368fd73f867e3d03af7e48b9ab1e18ed`）中的 195 个跨平台电商 Agent 技能入库至 `omnimux-market` 技能广场插件，放入合适的已有分类，供用户按需安装与启用。
2. 对标研究与仓内架构审计：
   - 上游 `sealeap-amazon-skills/assets/catalog.json` 共收录 195 个技能，覆盖 Shopify（28）、Etsy（23）、eBay（23）、TikTok Shop（22）、Walmart（24）、美客多（25）、OZON（26，均标注依赖 MPstats）和 Wayfair（24）等 8 个平台，按 `mode` 划分为 `selection`（44 项）、`operations`（110 项）与 `advertising`（41 项），全部自带规范化 `SKILL.md` 及配套方法论文档，采用 `Copyright (c) 2026 SeaLeap` MIT 许可。
   - `omnimux-market` 已有 `source.type: "git"` 轻量目录指针机制（`src/expert/catalog.js`、`src/expert/install.js`、`src/install.ts`）与异步稀疏检出能力基础；采用“零仓内拷贝，仅存 Git 指针 + 按需稀疏克隆到 `DSH_HOME/skills/<slug>/`”方案，可将仓内体积增量与未安装用户的上下文注入成本控制到最低（0-Token）。
   - `omnimux-market` 现有广场分类采用 6 个 4 字垂直场景，同时门禁与多套测试强约束广场「全部」视图与首页 `featured-skills.json` 严格保持 36 个官方自研技能。因此必须将 `selection`（44 项）映射到 `scene-research`（「市场洞察」）、`operations` + `advertising`（151 项）映射到 `scene-growth`（「营销增长」），并将所有 195 项标记 `recommended: false`，确保「全部」视图与首页 36 项零污染，仅在对应分类视图和搜索中可见，并在「市场洞察」与「营销增长」内提供二级平台筛选（全部、官方、Shopify、Etsy、eBay、TikTok Shop、Walmart、美客多、OZON、Wayfair）。

## 假设

1. **目录指针与异步并发安全稀疏安装**：在 `catalog/index.json` 新增 195 条 `kind: "skill"`、`tab: "skills"`、`recommended: false`、`origin: "third-party"`、`license: "MIT"`、`owner: "SeaLeap"`、`author: "SeaLeap"`、`installType: "marketplace"`、`source: { type: "git", repo: "xjli360/sealeap-ecommerce-skills", path: "sealeap-amazon-skills/<path>", ref: "main" }` 条目，并在 `expert/install.js` 与 `install.ts` 实现按仓库串行锁、异步 `execFile`、超时期限、符号链接拒绝（`lstat` 检查）、`--` 参数分隔及临时暂存目录原子重命名，可在不臃肿公开仓库的前提下实现并发安全的按需安装与跨重启持久化。
2. **安装即启用、卸载即停用与 `/` 提示零污染**：在 `expert/catalog-provider.js` 跳过未安装的外部 `third-party` + `git` 技能，并确保详情页 `DetailCard` 与广场「我的 Skill」开关分别映射 `install`（启用）与持久化 `uninstall`（停用，预装技能除外），同时移除 `skills-ui.js` 对未安装 `git` 技能伪造视频脚手架占位的 fallback，即可实现“未安装 0-Token、安装后完整读取真实 `SKILL.md` 且 `/` 立即可用、卸载即停用”。
3. **分类保真、首页 36 守恒与平台二级筛选**：在 `skill-picker-logic.js`、`PlazaCardGrid.jsx`、`FeaturedCard.jsx` 与 `usePlazaFilter.js` 中，将外部技能从 `全部` 视图过滤，保留在 `scene-research` / `scene-growth` 分类视图（官方 8 项置顶分组，外部技能分组紧随其后并支持平台胶囊过滤）与搜索中，`skillScenarioCounts().total` 维持 36，可兼顾发现效率与既有一方货架体验。

## 证伪方式

- 在 `src/expert/install.test.js` 验证：`installGitBundleAsync` 可并发安全安装同一仓库下的不同外部技能、拒绝包含符号链接的上游恶意目录、正确向 `git sparse-checkout` 传递 `--`、并保留完整上游文档内容。
- 在 `src/expert/catalog-provider.test.js` 验证：未安装的 `third-party` + `git` 目录项不会出现在 `/` 候选中；安装 `SKILL.md` 后立即出现在 `/` 候选中，卸载后立即消失。
- 在 `tests/local-api-search.test.ts` 验证：`handleSearch` 支持按中文/英文/平台关键词检索外部技能且携带 `origin`/`license`/`author`/`subtitle`；`handleSkillDetail` 在外部未安装时不因远程查询丢失本地目录元数据；`handleSkillContent` 为未安装外部技能诚实返回外部预览信息，安装后返回真实 `SKILL.md`。
- 在 `tests/e2e/sealeap-external-skills.spec.js` 验证：195 个 SeaLeap 技能全部正确映射至 `scene-research`（44）与 `scene-growth`（151）、`全部` 严格保持 36 项、`featured-skills.json` 保持 36 项、平台筛选与真实 git 安装/卸载持久化闭环成立。
- 执行前端全插件构建、双语/DSW Token/UI Gate/安全卫生/Workspace 校验、以及隔离 `DSH_HOME` 下真实浏览器（明暗双主题 + 1480px/780px 视口）交互与持久化回归测试。

## 旧标准变更

以下既有测试文件原本假设 `catalog/index.json` 中全量 `kind === "skill"` 条目总数恒等于 36 或全为 `bundled`/`plugin` 源，引入 195 个按需加载 `source.type === "git"` 外部电商技能后，同步调整其计数/过滤口径与英文白名单：

- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景 taxonomy：6 个垂直场景，每个都有成员，36 个技能无未映射孤儿`
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景分类栏：全部 + 6 个垂直场景，数量为真实目录计数`
- `plugins/plugins/omnimux-market/src/client/skill-recommendations.test.js` :: `shipped configuration covers every recommended skill and validates clean`
- `plugins/plugins/omnimux-market/src/client/skill-recommendations.test.js` :: `real workshop renders shelf sections and every recommended skill on Featured`
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 安装源：场景技能全部为内置 bundled 或 plugin 源且物理目录存在`
- `plugins/plugins/omnimux-market/tests/e2e/market-hot-picks-new-arrivals-5.spec.js` :: `E2E-3 新品上市专区严格限制为 5 个技能且不与热门精选重叠，总数严格守恒 36`
- `plugins/plugins/omnimux-market/tests/e2e/market-all-skills-bilingual.spec.js` :: `E2E-1 字典完整度与质量门禁：全量技能在 catalog 中具备纯净中英文四元多语言字段且严禁机翻粘连英文`

## 验收标准

1. `catalog/index.json` 新增全部 195 个 `xjli360/sealeap-ecommerce-skills` 技能指针，`recommended: false`，`scene-research` 包含 44 个外部技能（+ 8 官方），`scene-growth` 包含 151 个外部技能（+ 8 官方），`THIRD_PARTY_NOTICES.md` 完整合规署名 MIT 与上游来源。
2. 广场「全部」视图与首页 `featured-skills.json` 仍严格展示且仅展示 36 个官方技能（5 HOT + 5 NEW + 26 EXPLORE MORE）。
3. 「市场洞察」与「营销增长」支持官方优先排序与平台二级筛选（全部、官方及对应平台），外部卡片与详情弹窗实现诚实元数据预览、点击安装（即启用）、查看真实 `SKILL.md` 与切换开关停用卸载（预装技能仍不可卸载）。
4. 全量单测、安全卫生、Token 与工作区锁定校验通过，且在真实浏览器中完成明暗主题与宽窄视口实测。
