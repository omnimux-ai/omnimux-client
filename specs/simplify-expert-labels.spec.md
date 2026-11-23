# Simplify Expert Market Category Labels & Built-in Expert Names

## 背景与问题

PR #209 合入后，专家市场新增了 8 位跨境电商 SOP 内置专家与阶段筛选栏，但命名与分类文案偏长，在 4 列专家卡片与聊天输入框的 Agent 预设下拉选择器中易拥挤或截断：

1. **分类标签偏长**：现有筛选栏与卡片阶段徽标为「选品与策略 / 货架与内容生产 / 投放与复盘闭环 / 系统与自建」（5–7 字；英文最长 19 字符 `Ads & Feedback Loop`），与同页 Skill 分类（2–4 字）节奏不一致，在窄屏与卡片状态行容易挤压 `[ 可聘用 ]` 徽标。
2. **专家名称偏长**：现有 8 位内置专家采用「A 与 B 专家」复合短语（11–15 字；英文 33–44 字符），既增加扫读负担，又在聊天页预设下拉芯片中显冗长。

## 简化方案（保持 ID 与向后兼容不变）

- **保留全部预设 ID 不变**（`ecom-market-research` 等 8 个 ID、账本结构、动态注册机制、8 个随包 Skill 及脚本路径均不动），避免已装账本与会话记录失效。
- **中枢头像别名向后兼容**：`omnimux` 的 `AGENT_PRESET_NAMES` 补充全部简化中英文名称，同时保留上一版完整名称映射至同一 ID，确保历史消息/视图仍命中同一像素头像。

### 分类标签简化（统一 2 字中文 / 单词英文）

| Stage ID | 原中文 | 简化中文 | 原英文 | 简化英文 |
| --- | --- | --- | --- | --- |
| `all` | 全部 | **全部** | All | **All** |
| `research` | 选品与策略 | **选品** | Research & Strategy | **Research** |
| `production` | 货架与内容生产 | **内容** | Listing & Creative | **Content** |
| `growth` | 投放与复盘闭环 | **运营** | Ads & Feedback Loop | **Operations** |
| `system` | 系统与自建 | **系统** | System & Custom | **System** |

筛选栏无障碍标签由「专家阶段筛选 / Expert Stage Filter」简化为「专家分类 / Expert Category」。

### 8 位内置专家名称简化（统一 4 字中文 / 2 词英文）

| Preset ID | 分类 | 原中文 | 简化中文 | 原英文 | 简化英文 |
| --- | --- | --- | --- | --- | --- |
| `ecom-market-research` | 选品 | 市场选品与竞品调研专家 | **选品专家** | Market Research & Competitor Analyst | **Market Analyst** |
| `ecom-product-strategy` | 选品 | 产品定位与定价策略专家 | **定价专家** | Product Strategy & Pricing Expert | **Pricing Strategist** |
| `ecom-listing-copy` | 内容 | 跨境 Listing 与合规文案专家 | **文案专家** | Listing Copy & Compliance Specialist | **Listing Copywriter** |
| `ecom-visual-studio` | 内容 | 电商主图与商详视觉专家 | **视觉专家** | E-commerce Main Image & Visual Designer | **Visual Designer** |
| `ecom-video-director` | 内容 | 带货短视频与爆款复刻导演 | **视频导演** | Shoppable Video & Viral Replication Director | **Video Director** |
| `ecom-ads-optimizer` | 运营 | 跨境广告诊断与买量优化专家 | **广告专家** | Cross-Border Ads & Growth Diagnostics Expert | **Ads Optimizer** |
| `ecom-review-voc` | 运营 | 评论 VOC 与售后话术专家 | **评论运营** | Review VOC & Customer Care Specialist | **Review Analyst** |
| `ecom-creator-growth` | 运营 | 达人建联与社媒增长专家 | **达人运营** | Creator Partnerships & Social Growth Expert | **Creator Manager** |

## 假设

1. 将 5 个分类标签统一压缩为 2 字中文（`全部 / 选品 / 内容 / 运营 / 系统`）与单词英文（`All / Research / Content / Operations / System`），并将 8 位专家名统一为 4 字中文角色名与 2 词英文名，能在专家市场卡片与对话预设选择器中实现单行无截断展示，且不损失职能识别度。
2. 同步更新后端目录（`expert-market.ts` 与 Persona 提示词）、前端目录与字典（`plazaUtils.js`、`i18n.js`、`skill-plaza.js`）、中枢映射（`agent-presets-i18n.js`、`agent-preset-enhancer.js`）、预设清单（`presets/manifest.json`）及随包 Skill 引述，可保证市场、选择器、注册表与系统提示词四处文案完全一致。

## 证伪方式

1. 任意一处 UI（专家市场卡片标题、卡片分类胶囊、顶部分类栏、中英切换、会话预设兜底文案）仍出现旧长名称或旧长分类文案。
2. 4 列桌面或 520px 窄屏下分类栏、卡片状态行或标题出现换行错位、重叠或溢出。
3. 使用新简化名或旧完整名调用 `resolveAgentPresetAvatar()` 时无法解析出对应的 `ecom-*` ID 及 1:1 一致的像素头像。
4. 构建、单测、E2E、静态门禁或合并后 `~/.omnimux-dev` 物化任一环节失败。

## 变更范围与验收项

1. **演示与规范**：`specs/simplify-expert-labels.spec.md`、`ui-demo/expert-market-sop-experts-demo.html`。
2. **`omnimux-market`**：`src/expert-market.ts`、`src/client/i18n.js`、`src/client/plaza/plazaUtils.js`、`src/client/skill-plaza.js`、`skills/omnimux-ecom-market-research/SKILL.md` 及重新构建 `lib/`。
3. **`omnimux` 与 `presets`**：`plugins/presets/manifest.json`、`plugins/plugins/omnimux/src/client/agent-presets-i18n.js`、`plugins/plugins/omnimux/src/client/agent-preset-enhancer.js` 及重新构建 `lib/`。
4. **测试与真实浏览器验收**：更新受影响文案断言的单测与 E2E，完成亮/暗主题与 520px 窄屏真实浏览器截图校验，合入 `main` 后物化更新至 `~/.omnimux-dev`。

## 旧标准变更

以下既有断言因本次显式简化分类与专家名称需求同步更新：

- `plugins/plugins/omnimux/src/client/agent-market-avatar-convergence.test.js` :: `市场垂直专家在输入框与专家市场全部统一收敛至确定性像素艺术头像`
  - 原断言：仅校验旧版 11–15 字完整名称（如 `市场选品与竞品调研专家`）映射到对应像素头像。
  - 变更理由：本次按用户要求将 8 位内置专家名简化为 4 字角色名与 2 词英文名，需同时覆盖新中英文简称并保留旧名称别名兼容。
  - 新期望证据：同用例改为循环校验 `[新中文简称, 新英文简称, 旧中文全称]` 三组别名 100% 收敛至同一 `ecom-*` 确定性像素头像，已通过 `node --test plugins/plugins/omnimux/src/client/agent-market-avatar-convergence.test.js`。
- `plugins/plugins/omnimux/src/client/agent-presets-i18n.test.js` :: `getPresetFallbackCopy returns localized fallback copy for all presets`
  - 原断言：仅以 `assert.ok(zh?.name)` 弱校验 8 位 SOP 专家兜底名称非空。
  - 变更理由：本次简化 8 位专家中英文名称后，强化断言逐条锁定中英文简化名称（如 `选品专家` / `Market Analyst`）。
  - 新期望证据：同用例改为 `assert.equal` 精确校验全部 8 位 SOP 专家的中英简化名称与双语描述非空且无 Topview 残留，已通过 `node --test plugins/plugins/omnimux/src/client/agent-presets-i18n.test.js`。
- `plugins/plugins/omnimux-market/src/tests/experts-market.test.ts` :: `*`
  - 原断言：阶段字典正则匹配旧 5–7 字分类文案（`选品与策略` / `货架与内容生产` / `投放与复盘闭环`）。
  - 变更理由：专家分类标签按需求简化为 2 字中文与单词英文。
  - 新期望证据：同文件同步断言 4 个中文简化分类（`选品` / `内容` / `运营` / `系统`）与 4 个英文简化分类（`Research` / `Content` / `Operations` / `System`），已通过 `pnpm --filter omnimux-market test`。
- `plugins/plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js` :: `E2E 旅程二：官方系统预置、已入职市场专家与用户自建 Agent 真源聚合，系统预置不渲染禁用按钮`
  - 原断言：样例数据使用旧全称 `跨境 Listing 与合规文案专家`，未校验卡片分类徽标文本。
  - 变更理由：随本次名称与分类简化，样例数据更新为 `文案专家` 并新增卡片 2 字分类徽标断言。
  - 新期望证据：同用例校验 `文案专家`、`选品专家` 与卡片 `expert-card-stage` 文本为 `选品`，已通过 `pnpm --filter omnimux-market test`。
