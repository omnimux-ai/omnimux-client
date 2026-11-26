# Skill Picker 4 分类收敛与 33 项技能命名/描述精简（Issue #337）

## 背景与研究依据

对标主流内容电商 AI 工具技能面板（见任务对话图 1 / 图 3）：
- 标题控制在 **4–7 字**，以动宾短语（`分析账号`、`分析竞品店铺`、`创作带货视频`）或转换型（`视频转提示词`）为主，不堆砌「A与B」双主题拼接和内部术语。
- 描述控制在 **17–23 字**，聚焦「输入/条件 → 产出结果」，在单行或双行容器内完整展示不截断；分析洞察类描述去掉末尾句号。
- 分类 Tab 采用等长 4 字标签（`创作视频` / `创作图片` / `分析洞察` 等），降低扫读摩擦。

当前输入栏技能选择器（[skill-picker.js](plugins/plugins/omnimux-market/src/client/skill-picker.js)、[css.js](plugins/plugins/omnimux-market/src/client/css.js)）宽度为 `360–380px`，`.sh-picker-desc` 采用 `white-space: nowrap; text-overflow: ellipsis` 单行展示。现状存在：
1. 5 个业务分类中 `选品与需求` 仅 3 项，且 7 字标签 `趋势与达人复盘` 在顶栏直接截断为 `趋势与达...`，右侧滚动箭头 `.sh-picker-more` 常驻占位 `32px`。
2. 33 项技能命名含大量 `A与B` 拼接与黑话（如 `定价与单元经济核算`、`评论 VOC 与差评归因`、`品牌与话题社媒聆听`）。
3. 33 条描述中有 31 条超过 25 字（最高 56 字），在 380px 单行容器里几乎全部出现 `...` 截断，且暴露内部实现细节（`用脚本精算`、`参数真源`、`按意图路由`）。

## 范围与方案（用户确认方案 1）

1. **业务分类收敛为 4 个 4 字 Tab（加 `全部` 共 5 个 Tab）**：
   - `创作视频`（8 项）
   - `创作图片`（6 项）
   - `分析洞察`（11 项：原 `选品与需求` 3 项置顶 + 原 `趋势与达人复盘` 7 项 + `分析商品评论`）
   - `文案运营`（8 项：4 项文案生成/改写 + `规划内容策略`、`TikTok 增长指南`、`诊断广告投放`、`平台合规自查`）
2. **全量 33 项技能名称与描述精简**：
   - 标题 4–7 字（仅 `TikTok 增长指南` 含品牌英文），去除 `A与B` 拼接与内部术语。
   - 描述 ≤ 22 个汉字视觉宽度、去掉末尾句号，在 `380px` 面板中单行完整可读无 `...` 截断。
3. **搜索别名兜底（零检索退化）**：
   - 33 项条目统一新增 `aliases: string[]` 字段（保持 `preset-skills.json` 单一字段形状契约），保留旧术语与原标题关键词（如 `VOC`、`单元经济`、`CR10`、`社媒聆听`、`反推`、`归因`、`9图视觉矩阵`）。
   - `filterPresetSkills` 将 `aliases` 与 `tags` 纳入匹配文本，旧检索词仍可命中对应技能。
4. **顶栏滚动箭头按需显隐**：
   - `SkillPickerPanel` 检测 `tabsRef.current` 的 `scrollWidth > clientWidth + 1`（监听窗口缩放与 `ResizeObserver`），未溢出时不渲染 `.sh-picker-more`，释放 `32px` 空间并消除无效点击图标。
5. **多源一致**：
   - 同步更新 `plugins/presets/omni-agent/skills.json`、`plugins/plugins/omnimux-market/catalog/preset-skills.json`、`plugins/plugins/omnimux-market/catalog/index.json`（15 项重叠加卡片）、`plugins/plugins/omnimux-market/src/client/i18n.js`（`skill.desc.replicate-viral-video` 与 `skill.desc.video-hook-analysis` 中文值），并执行 `node plugins/scripts/generate-featured-skills.mjs` 刷新 `featured-skills.json`。

## 假设

1. 业务分类收敛为 4 个 4 字标签（`全部` + `创作视频`/`创作图片`/`分析洞察`/`文案运营`）且按需隐藏 `.sh-picker-more` 后，在真实 Chromium `380px` 宽度面板与宿主默认盒模型下，顶栏 `tabs.scrollWidth <= tabs.clientWidth`（零横向溢出、零标签截断）。
2. 全量 33 条精简描述在真实 Chromium `380px` 宽度面板（含内边距与单行 `12px` 字体）下全部满足 `desc.scrollWidth <= desc.clientWidth`（零 `...` 截断），且亮/暗双主题对比度与排版完整。
3. 将历史术语（`VOC`、`单元经济`、`CR10`、`社媒聆听`、`反推`、`类目市场与选品调研`）写入统一 `aliases` 字段并接入 `filterPresetSkills` 后，用户搜旧词仍能精确命中重命名后的技能，且不影响非预设模式与 `preset-skill-lookup` 的单一字段形状约束。

## 证伪方式

1. **真实浏览器几何探针（E2E）**：通过 `runStyleDomProbe` 在真实 Chromium 中以宿主真实 `css.js` 样式和 `380px` 面板宽度渲染全部 5 个 Tab 与 33 条技能行，逐条断言 `tabs.scrollWidth <= tabs.clientWidth`、`.sh-picker-more` 未渲染、且 33 条 `.sh-picker-name` 与 `.sh-picker-desc` 的 `scrollWidth <= clientWidth`；同时构造 8 个 Tab 的溢出夹具断言 `.sh-picker-more` 会正常出现。任意一条触发截断或箭头显隐错误即直接证伪失败。
2. **检索与契约回归单测**：运行 `omnimux-market` 全量单测与 E2E，验证 4 分类分布（8 / 6 / 11 / 8 = 33）、`omni-agent` 与 `tiktok-agent` 同步一致、单一字段形状（`rawShapes.size === 1`）、搜旧词（`VOC`、`单元经济`、`社媒聆听`、`反推`、`CR10`）命中新技能、双语门禁（`market-all-skills-bilingual.spec.js`）与 `generate-featured-skills.mjs --check` 全部通过。
3. **高保真 HTML 演示 + 亮/暗主题实机浏览器检查**：先用独立 HTML 演示对比改前/改后在亮/暗双主题、380px 窄容器下的视觉与交互，并确认实测截图无截断、无透底、无布局跳动。
