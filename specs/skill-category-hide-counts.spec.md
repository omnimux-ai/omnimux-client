# 移除 Skill 分类筛选胶囊数字统计（Issue #402）

## 背景与研究依据

完成 6 大垂直场景标签四字化（Issue #397 / PR #398）后，技能广场（`omnimux-market` `skill-plaza.js`）与姐妹视图会话引导/创作发现技能面板（`omnimux` `SkillsPanel.jsx`）的分类筛选胶囊仍在右侧渲染数字角标（`全部 36`、`视频创作 5`、`效率工具 4` 等），造成水平胶囊栏额外视觉噪点与不均等宽度。

依据界面极简降噪原则：
- 仅保留纯文本分类名称，移除分类筛选胶囊中的 `.cat-count` 与 `.omnimux-skills-chip-count` 数字角标及冗余 CSS；
- 数据层计数逻辑（`buildWorkshopCategories`、`skillScenarioCounts`、`featured-skills.json` 中的 `count` 字段与 36 技能守恒校验）及分组标题（如 `探索更多`）保持不变，确保空分类过滤与单测契约不受影响。

## 范围与方案

1. `plugins/plugins/omnimux-market/src/client/skill-plaza.js`：`renderCategoryBar` 中 `.cat-btn` 移除 `<span className="cat-count">{c.count}</span>`，仅渲染分类标签文本。
2. `plugins/plugins/omnimux-market/src/client/css.js`：移除无引用的 `.cat-count` 与 `.cat-btn.active .cat-count` 样式规则，保留 `.cat-btn` 交互样式。
3. `plugins/plugins/omnimux/src/client/session-guide/skills/SkillsPanel.jsx`：`chipsBar` 中 `.omnimux-skills-chip` 移除 `<span className="omnimux-skills-chip-count">{cat.count}</span>`。
4. `plugins/plugins/omnimux/src/client/session-guide/styles.js`：移除无引用的 `.omnimux-skills-chip-count` 样式块。
5. 新增两条端到端测试（`plugins/plugins/omnimux-market/tests/e2e/skill-category-no-count.spec.js` 与 `plugins/plugins/omnimux/src/client/session-guide/skills/skill-category-no-count.e2e.test.js`，均已接入各自包 `test` / CI 发现范围），强断言中英双语与 `chipsOnly` 下 7 个胶囊均为纯分类名称、不含任何数字节点或 `.cat-count` / `.omnimux-skills-chip-count`。

## 假设

1. 移除 `.cat-btn` 与 `.omnimux-skills-chip` 内部的数字计数徽章及其无用样式后，技能广场与会话引导面板均呈现干净的纯文本分类胶囊，不显示任何数字。
2. 保留 `buildWorkshopCategories`、`skillScenarioCounts` 与 `featured-skills.json` 数据层的 `count` 属性，因此 6 大垂直场景筛选、空分类自动排除、36 款精品计数守恒与全部既有单测依然完全成立。

## 证伪方式

1. **端到端与回归单测**：分别运行 `skill-category-no-count.spec.js`（两处页面）及 `omnimux-market`、`omnimux-inspiration`、`omnimux` 全量测试；若任意胶囊内仍渲染 `.cat-count`、`.omnimux-skills-chip-count` 或出现数字文本，断言立即失败。
2. **工作树真实浏览器渲染验收**：启动工作树独立服务并在真实 Chromium 暗色宽屏（1480px）与亮色窄屏（780px）下检查 `.category-bar .cat-btn` 的 DOM 文本与视觉效果，核验 7 个胶囊均为纯文字、点击筛选正常且零 `.cat-count` 节点。
