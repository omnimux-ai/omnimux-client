# Skill 市场 6 大垂直场景标签四字化与命名规范沉淀（Issue #397）

## 背景与研究依据

前期 #350 已完成 Skill 市场 **6 大垂直场景 + 36 款精品技能** 收口，但在真实桌面与窄视口检查中，场景筛选胶囊沿用了 5–7 字并列拼接长名（`爆款复刻与再制`、`选品与社媒洞察`、`投放与增长运营`、`剪辑与效率工具`、`商品视觉与海报`），导致：
1. 水平筛选栏词长不齐（5/5/6/7/7/7 字），宽/窄屏扫读密度偏重；
2. 4 个分类出现「A与B」双主题拼接，且 `短视频创作` 对包含分镜/电影运镜语义的场景来说偏窄；
3. 需要把此次优化与前期 [Skill Picker 四分类命名收敛](specs/skill-picker-naming-taxonomy-337.spec.md) 的实践沉淀为仓库长期契约与自动门禁，详见 [UI 分类标签与短文案命名规范](plugins/docs/contracts/ui-copy-naming.md)。

## 范围与方案

保持全部 6 个内部场景 ID（`scene-*`）与 36 款技能总数/计数守恒不变，将中英文展示标签收敛为统一 4 字中文（配精炼英文）：

| Scenario ID | 旧中文 | 新中文 | 旧英文 | 新英文 | 技能数 |
| --- | --- | --- | --- | --- | --- |
| `scene-video` | 短视频创作 | 视频创作 | Video Creation | Video Creation | 5 |
| `scene-replicate` | 爆款复刻与再制 | 爆款复刻 | Viral Replication | Viral Replication | 6 |
| `scene-visual` | 商品视觉与海报 | 商品视觉 | Visual & Product | Product Visuals | 5 |
| `scene-research` | 选品与社媒洞察 | 市场洞察 | Market & Social Research | Market Insights | 8 |
| `scene-growth` | 投放与增长运营 | 营销增长 | Ads & Growth Ops | Growth Marketing | 8 |
| `scene-tools` | 剪辑与效率工具 | 效率工具 | Editing & Tools | Editing & Tools | 4 |

同步措施：
1. 更新 `plugins/plugins/omnimux-market/catalog/index.json`（`categories`、`skillCategories`、`skillScenarios` 与 20 条技能的 `subtitle`/`tags`）、`src/categories.ts`、`src/client/i18n.js`、`src/client/plaza/FeaturedCard.jsx`、`omnimux/src/client/session-guide/catalog.js`、`SkillCard.jsx`、`skill-finder` / `skill-creator` 文档与元数据，并通过 `generate-featured-skills.mjs` 重生精选快照。
2. 新建 [plugins/docs/contracts/ui-copy-naming.md](plugins/docs/contracts/ui-copy-naming.md) 并在 [plugins/AGENTS.md](plugins/AGENTS.md) 挂载入口。
3. 在 `skill-scenario.test.js` 新增四字节律、无「A与B」拼接与跨文件单一真源自动化断言。

## 假设

1. 将 6 个场景标签统一收敛为 4 字纯中文（`视频创作`/`爆款复刻`/`商品视觉`/`市场洞察`/`营销增长`/`效率工具`）后，不改变任何 `scene-*` ID 与 `5+6+5+8+8+4=36` 计数逻辑，并能跨 `catalog`、`i18n.js`、`FeaturedCard.jsx`、`SkillCard.jsx`、`featured-skills.json` 保持单一真源一致。
2. 新标签在暗色宽屏（1480px）与亮色窄屏（780px）的真实浏览器渲染下，筛选栏单行可完整扫读且详情抽屉徽章无旧标签残留。
3. 命名契约文档与 `plugins/AGENTS.md` 更新可通过 `doc-lint.mjs` 与 `verify-agents-md.test.mjs` 的预算及链接校验。

## 证伪方式

1. **自动化契约与双语/卫生门禁**：`skill-scenario.test.js` 对 6 场景强制校验 `titleZh` 4 字纯汉字节律、禁拼接符、`titleEn <= 24` 字符，且跨 6 处真源字典完全对齐、20 条关联技能不残余旧标签；配合 `omnimux-market test`、`omnimux test`、`omnimux-inspiration test`、`verify:skill-bilingual`、`verify:skill-hygiene`、`generate-featured-skills --check`、`doc-lint`、`verify-agents-md.test.mjs` 全量验证。
2. **工作树真实浏览器检查**：使用工作树实时构建服务分别在暗色 1480px 与亮色 780px 下核验 7 枚筛选胶囊（`全部 36` + 6 个 4 字场景）、抽屉分类徽章与零横向溢出。

## 旧标准变更

本任务（Issue #397）将 6 大垂直场景标签调整为统一 4 字中文并精简英文对应词，因此以下既有测试用例中硬编码旧标签字面量的断言需按新标准同步更新：

- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `多语言原生适配：在中文与英文环境下独立呈现原生文案，彻底消除斜杠双语拼接`
  - 原断言：校验测试双语词典与 `buildWorkshopCategories()` 输出 `'短视频创作'`、`'商品视觉与海报'` 及 `'Visual & Product'`。
  - 变更理由：Issue #397 已将 `scene-video` 更新为 `'视频创作'`，将 `scene-visual` 更新为 `'商品视觉'` / `'Product Visuals'`。
  - 新期望证据：断言更新为 `'视频创作'`、`'商品视觉'` 与 `'Product Visuals'`，`market-creatify-cards.spec.js` 全量通过。
- `plugins/plugins/omnimux-market/tests/e2e/skill-detail-footer-buttons.spec.js` :: `DetailCard 从 handleSkillDetail({ card }) 水合 preinstalled 与 installed 状态，并隐藏卸载入口 (#350)`
  - 原断言：注入的 `i18n.js` 桩中 `catLabel: () => '剪辑与效率工具'`。
  - 变更理由：Issue #397 已将 `scene-tools` 中文标签统一收口为 `'效率工具'`，测试夹具同步使用现行场景名。
  - 新期望证据：桩返回值更新为 `'效率工具'`，详情抽屉预装/卸载入口隐藏与底部按钮防挤压断言全部通过。
