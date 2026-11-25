# Phase 4：技能来源与许可元数据治理（`origin`/`license`/`owner`）、外部无许可技能清退、第三方声明审校与双壳 Office 差异说明（#237）

## 背景与根因

依据主线治理方案 [Issue #233](https://github.com/omnimux-ai/omnimux-client/issues/233) 与子任务 [Issue #237](https://github.com/omnimux-ai/omnimux-client/issues/237)，Phase 1（#234）、Phase 2（#235）与 Phase 3（#236）已建立内置 Skill 单一真源、零空壳货架、原生 `ctx.skills.registerProvider` 挂载与全局上下文预算门禁。对全仓现存技能做逐项版权与来源审计后，识别出四类合规与透明度缺口：

1. **市场目录与插件清单缺少结构化 provenance 字段**：
   - `plugins/plugins/omnimux-market/catalog/index.json` 中 114 条技能全部统一标注 `"author": "Official"`，缺乏机器可校验的 `origin`（`first-party` / `third-party` / `upstream`）、`license` 与 `owner` 字段；
   - 7 个声明随包技能的产品插件（`omnimux-clip`、`omnimux-inspiration`、`omnimux-market`、`omnimux-products`、`omnimux-tiktok-selection`、`omnimux-video`、`omnimux-workflow`）的 `dsh.manifest.json` 尚未声明 `skillMetadata` 结构化来源与许可映射。
2. **随仓分发包含缺乏再分发许可的外部内容**（经维护者逐批确认处置结论）：
   - **批次 1（112 条 `metadata.json` 驱动的外部营销技能）**：源自早期外部营销技能库脱敏入库并统一标注 `"author": "Official"`，无开源再分发许可，须整体下架并移除物理目录；同时将仓内既有的 16 款完整自研技能（含 4 个首页快捷方式、`replicate-carousel`、`shoppable-carousel`、`ecommerce-image`、`ad-creative`、`global-ad-localizer`、`stickman-video-director`、`dynamic-poster`、`character-scene-storyboard`、`cinematic-motion-language`、`content-strategy`、`social-caption`、`clip-export`）正式上架至 `catalog/index.json` 精选货架；
   - **批次 2（`sopilot-social-agents`）**：原由第三方站点抓取整合并缺少再分发许可，须从 `plugins/plugins/omnimux-market/skills/`、`dsh.manifest.json`、`plugins.registry.json`、预设货架与 `suite-tiktok-agent` 彻底移除；
   - **批次 3（`kling-global-ad-localizer`）**：原目录包含外部厂商运行契约（`references/kling-generation-runtime.md`，含 `WorkBuddy` 残留）、外部署名（`KLING AI & OmniMux Team`）与外部头像图（`expert.png`），须重写并重命名为纯自研 OmniMux 技能 `global-ad-localizer`（移除外部契约与第三方商标/素材，全面适配 OmniMux 原生多模态生成与工作流工具）；
   - **批次 4（外链封面与 `meta.yaml` 归属标注）**：`character-scene-storyboard/meta.yaml` 与 `ecommerce-image/meta.yaml` 残留外部 `cdn.hailuoai.com` 封面链接，须清空；全部保留的 `meta.yaml` 统一标注 `origin: first-party`、`license: MIT`、`owner: omnimux-market` 与 `OmniMux Team`。
3. **第三方声明双向审校缺口**：
   - 需核验 `plugins/plugins/omnimux-market/THIRD_PARTY_NOTICES.md` 与实际随仓分发的第三方技能清单（当前合规保留且随仓分发的第三方技能仅 `bggg-data-amazon` MIT 包，含 `LICENSE`、`references/upstream_LICENSE` 与 `PROVENANCE.md`）一一对应，并用 CI 门禁阻止后续引入无声明的第三方随包技能。
4. **双壳内置 Office 技能边界未在公开文档披露**：
   - 旧桌面壳 `app/dsh-plugin-desktop`（冻结在 DSH `0.2.1-rc.3`）挂载上游 `@deepseek-ai/dsh-skill-office` 提供的 7 个 Office 技能；
   - 活跃桌面壳 `app/dsh-desktop-next`（DSH `0.2.2-rc.5`）出于安装包体积权衡（`libreoffice-kit` 双架构原生依赖约 305 MB），在 `app/dsh-desktop-next/cordis.patch.yml` 与 `app/dsh-desktop-next/scripts/runtime-file-policy.ts` 中显式禁用并排除了 `@deepseek-ai/dsh-skill-office`、`@deepseek-ai/dsh-office-kit`、`@deepseek-ai/dsh-tool-office` 与 `@deepseek-ai/libreoffice-kit-*`。该跨壳能力差异需在中英文公开文档中明确标注。

## 目标架构与实施范围

### 1. 结构化元数据规范（`origin` / `license` / `owner`）
- **`origin` 枚举**：`first-party` | `third-party` | `upstream`
- **`license` 规范**：
  - 随仓分发（`source.type === 'bundled'`、插件 `dsh.manifest.json` 随包技能、`bundled-skills.json`）必须声明明确许可（不得为 `UNKNOWN` / `SEE UPSTREAM`），且 `first-party` 技能须与所属包 `package.json` 的 `license`（对齐 `plugins/scripts/license-registry.json`：`omnimux-market` 为 `MIT`，`omnimux-clip` / `omnimux-inspiration` / `omnimux-products` / `omnimux-tiktok-selection` / `omnimux-video` / `omnimux-workflow` 为 `SEE LICENSE IN LICENSE`）一致；
  - 远端只引用、不随仓再分发的目录条目（`source.type === 'git'` 或 `source.type === 'mcp'`，如外部 Git 专家/套件与外部 MCP 连接器）标注 `origin: "third-party"`、`license: "SEE UPSTREAM"` 与准确 `owner`（上游仓库或外部提供方）。
- **`owner` 规范**：非空维护责任方标识（如 `omnimux-market`、`omnimux-clip`、`infometa/workbuddyskills`、`nexscope-ai/Amazon-Skills` 等）。
- **第三方随包附加字段**：随仓分发的 `origin: "third-party"` 技能（如 `bggg-data-amazon`）必须同时声明 `upstream`（锁定上游来源 URL）与 `noticeRef`（指向 `THIRD_PARTY_NOTICES.md` 的锚点章节），且目录内携带 `LICENSE` 原文。
- **杜绝不实 `"Official"` 归属**：`catalog/index.json` 严禁任何条目使用 `"author": "Official"`；自研技能统一使用 `"author": "OmniMux"`。

### 2. 市场货架与预设收敛
- 下架并删除 112 个 `metadata.json` 外部技能目录与 `catalog/index.json` 对应条目。
- 正式上架 16 款完整自研技能至 `catalog/index.json`（全部 `recommended: true`，双语 4 字段齐备，覆盖 6 个活跃场景分类：`scene-repurpose`、`scene-product`、`scene-performance`、`scene-seeding`、`scene-brand`、`scene-tools`；热门精选 5 款 + 新品上市 6 款 + 探索更多 5 款）。
- `catalog/bundled-skills.json` 保留 2 款不进普通市场卡的随包引导/数据技能（`bggg-data-amazon` 标记 `origin: "third-party", license: "MIT"`；`hypit-setup` 标记 `origin: "first-party", license: "MIT"`，仅提供官方安装指引不捆绑外部代码）。
- `usePlazaFilter.js::buildWorkshopCategories` 对场景计数做真实目录聚合，只展示存在真实技能的场景分类，消除空分类胶囊。
- 同步更新 `catalog/skill-recommendations.json`、`catalog/preset-skills.json`、`presets/omni-agent/skills.json`、`scripts/generate-featured-skills.mjs`、`plugins/omnimux/src/client/session-guide/skills/featured-skills.json` 与 `src/expert/catalog.js`（解析并保留 `origin` / `license` / `owner` / `author`）。

### 3. CI 闭环门禁（`verify-skill-hygiene.mjs`）
扩展 `plugins/scripts/verify-skill-hygiene.mjs`（已接入 `pnpm verify:skill-hygiene`、`pnpm verify:gates` 与 `.github/workflows/quality-gate.yml`）：
1. 校验 `catalog/index.json` 全部条目均具备合法 `origin` / `license` / `owner`，且零条目使用 `"author": "Official"`；
2. 校验所有随包条目（`catalog/index.json` bundled 条目、`catalog/bundled-skills.json`、各插件 `dsh.manifest.json` 的 `skillMetadata`）均具备具体 `license` 且无缺失/悬空元数据键；
3. 校验 `dsh.manifest.json` 的 `skillMetadata` 与 `skills[]` 双向 1:1 对齐，且 `first-party` 许可与包 `package.json` 一致；
4. 双向校验 `THIRD_PARTY_NOTICES.md`：所有随仓 `origin: "third-party"` 技能必须在 `THIRD_PARTY_NOTICES.md` 中登记且包内含 `LICENSE`；同时不得残留已下架第三方技能声明；
5. 拦截 `catalog/skills/*/meta.yaml` 与 `SKILL.md` 中的外部热链（`cdn.hailuoai.com`）及外部厂商运行契约残留（`kling-generation-runtime`、`WorkBuddy`）。

### 4. `THIRD_PARTY_NOTICES.md` 审校与双壳 Office 差异公开文档
- 审校并更新 `plugins/plugins/omnimux-market/THIRD_PARTY_NOTICES.md`，显式列出随仓分发的第三方技能清单（仅 `bggg-data-amazon` MIT）及非随仓远端引用边界说明。
- 在 `app/docs/architecture.md`、`app/docs/architecture.en.md`、`app/docs/faq.md` 与 `app/docs/faq.en.md` 明确记录 `dsh-plugin-desktop`（冻结 `0.2.1-rc.3`，保留上游 7 个 Office 技能）与 `dsh-desktop-next`（活跃 `0.2.2-rc.5`，按 `cordis.patch.yml` 与 `runtime-file-policy.ts` 显式排除 `@deepseek-ai/dsh-skill-office` / `office-kit` / `libreoffice-kit` 以节省 ~305 MB 安装包体积）的双壳 Office 技能差异与用户替代方案。

## 涉及改动范围

- **包含**：
  - `plugins/plugins/omnimux-market/catalog/skills/`（删除 112 个外部目录；重写 `kling-global-ad-localizer` 为纯自研 `global-ad-localizer`；清理 `character-scene-storyboard` 与 `ecommerce-image` 的 `cdn.hailuoai.com` 封面并更新所有保留 `meta.yaml`）
  - `plugins/plugins/omnimux-market/skills/sopilot-social-agents/`（整目录删除）
  - `plugins/plugins/omnimux-market/catalog/{index.json,bundled-skills.json,preset-skills.json,skill-recommendations.json}`
  - `plugins/plugins/omnimux-market/{dsh.manifest.json,THIRD_PARTY_NOTICES.md,src/expert/catalog.js,src/client/plaza/usePlazaFilter.js}`
  - 其余 6 个含随包技能插件的 `dsh.manifest.json`（`omnimux-clip`、`omnimux-inspiration`、`omnimux-products`、`omnimux-tiktok-selection`、`omnimux-video`、`omnimux-workflow`）及 `plugins/plugins.registry.json`
  - `plugins/presets/omni-agent/skills.json`
  - `plugins/plugins/omnimux-browser/extension/src/content/twitter-copilot/prompts.ts`（仅移除注释中已删除技能名 `sopilot-social-agents`）
  - `plugins/scripts/{generate-featured-skills.mjs,verify-skill-hygiene.mjs}` 与 `plugins/plugins/omnimux/src/client/session-guide/skills/featured-skills.json`
  - `app/docs/{architecture.md,architecture.en.md,faq.md,faq.en.md}`
  - 受影响的既有测试文件与新增 Phase 4 门禁测试、`bundle.lock.json`
- **不包含**：
  - `plugins/plugins/omnimux-browser/extension/src/content/twitter-copilot/` 对竞品页面按钮的 DOM 抑制逻辑（与 `sopilot-social-agents` 技能无关）；
  - `plugins/plugins/omnimux/assets/minimax-showcase/creation-cards.json` 与 `omnimux-workflow` 对应非技能展示素材。

## 旧标准变更

本任务按 Issue #237 及维护者确认处置方案：下架 112 个无许可外部市场技能并上架 16 款自研随包技能、删除无许可插件技能 `sopilot-social-agents`、将 `kling-global-ad-localizer` 重写为纯自研 `global-ad-localizer`，并在全量目录落实结构化 `origin`/`license`/`owner` 与禁止 `"Official"` 归属。以下既有测试直接引用被下架技能 ID/slug 或旧目录总数（113/114/112/19/34/8 场景），按新真源契约更新：

- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-01：市场目录 113/113 官方货架技能双语齐备（门禁验收证据）`
  - 原断言：断言市场目录官方货架技能数恰好为 `113`（原 112 外部 + `replicate-carousel`）。
  - 变更理由：下架 112 个外部无许可技能并上架 16 款自研技能后，目录官方货架技能数为 `16`（16/16 全部通过双语校验）。
  - 新期望证据：更新期望数量为 `16`（且断言与 `catalog/index.json` 实际官方货架条目数一致），`pnpm verify:skill-bilingual` 与 `verify-skill-bilingual.test.mjs` 全绿。
- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-03（故障注入）：缺失字段被定位到 id 与字段名，且不通过`
  - 原断言：以被下架的 `sk-omx-ugc-confessional` 作为故障注入样本，并断言 `report.checked === 113`。
  - 变更理由：`sk-omx-ugc-confessional` 属于本次下架的 112 个无许可外部技能。
  - 新期望证据：改用保留的自研上架技能 `sk-omx-replicate-viral-video` 注入缺失字段并断言精准定位且 `report.checked === 16`。
- `plugins/scripts/verify-skill-bilingual.test.mjs` :: `GATE-06：CLI 端到端——正常目录 exit 0，故障目录 exit 1 且不空转`
  - 原断言：断言 CLI 输出匹配 `113/113` 且 `checked === 113`。
  - 变更理由：市场目录官方货架技能已收敛为 16 款自研技能。
  - 新期望证据：更新期望匹配 `16/16` 且 `checked === 16`、`passed === 16`，CLI 端到端实跑通过。
- `plugins/scripts/generate-featured-skills.test.mjs` :: `GEN-04：真实目录生成的快照仍是 113 条精选 / 8 个场景分类，且与磁盘快照逐字节一致`
  - 原断言：断言精选快照为 `113` 条技能与 `8` 个场景分类。
  - 变更理由：下架 112 个外部无许可技能并上架 16 款自研技能后，精选快照覆盖 `16` 条自研技能与 `6` 个非空场景分类（`scene-app`、`scene-local` 无自研成员已隐藏）。
  - 新期望证据：更新期望为 `16` 条精选与 `6` 个场景分类，并与磁盘 `featured-skills.json` 逐字节一致。
- `plugins/scripts/verify-skill-hygiene.test.mjs` :: `real repository passes verifySkillHygiene with zero violations`
  - 原断言：断言 `result.stats.presetSkillRefCount >= 400`（原 4 个预设各挂载 112 条外部技能导致总数超 500）。
  - 变更理由：下架 112 个外部技能后，各预设货架收敛为真实自研技能引用（约 180+ 条）。
  - 新期望证据：更新阈值断言 `presetSkillRefCount >= 120` 并新增 Phase 4 `origin`/`license`/`owner`、`THIRD_PARTY_NOTICES.md` 与反外链/反 Official 门禁断言及反向故障注入用例。
- `plugins/scripts/verify-agent-presets.test.mjs` :: `omni-agent agent.cordis.yml is structurally valid and mounts generic subagent delegation without static experts`
  - 原断言：断言 `plugins/omnimux-market/skills/sopilot-social-agents/SKILL.md` 存在。
  - 变更理由：`sopilot-social-agents` 缺乏再分发许可，按 Phase 4 决议删除。
  - 新期望证据：改为断言保留的随包技能 `plugins/omnimux-market/skills/omnimux-social-data/SKILL.md` 存在，且 `sopilot-social-agents/SKILL.md` 不存在。
- `plugins/scripts/verify-preset-skills-materialization.test.mjs` :: `sync-agent-presets.sh never writes preset skills into the target skill root (rc.3)`
  - 原断言：使用临时夹具目录名 `sopilot-social-agents` 验证既有用户技能不被覆盖。
  - 变更理由：清理已删除技能名残留。
  - 新期望证据：夹具目录名改为保留技能 `omnimux-social-data`，不改任何保护语义。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景 taxonomy：8 个场景，每个都有成员，114 个技能无未映射孤儿`
  - 原断言：断言 8 个场景全有成员（含 `scene-app`、`scene-local`）。
  - 变更理由：下架 112 个外部技能后，16 款自研技能覆盖 6 个活跃场景（`scene-seeding`、`scene-brand`、`scene-product`、`scene-performance`、`scene-repurpose`、`scene-tools`），不再保留空场景。
  - 新期望证据：断言 6 个活跃场景全有成员且全部 16 款技能零未映射孤儿。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景过滤：显式 scenario 命中，旧 category 条目按兼容映射命中`
  - 原断言：以被下架的 `UGC 告白` / `ugc-confessional` 验证显式 scenario 与 slug 回查。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `火柴人视频导演` / `stickman-video-director`（`scene-seeding`）验证相同逻辑。
- `plugins/plugins/omnimux-market/src/client/skill-scenario.test.js` :: `场景分类栏：全部 + 8 个场景，数量为真实目录计数`
  - 原断言：断言分类栏共 `9` 项（全部 + 8 场景）。
  - 变更理由：活跃场景收敛为 6 个，分类栏为 `7` 项（全部 + 6 个非空场景），避免渲染 0 计数空胶囊。
  - 新期望证据：断言分类栏共 `7` 项，全部计数为正且求和等于 `skills.length`。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A1 分类栏：按场景收敛为「全部」+ 8 个场景`
  - 原断言：断言 `buildWorkshopCategories` 返回 9 项（全部 + 8 场景）。
  - 变更理由：同步 6 个活跃场景分类口径，隐藏无成员空场景。
  - 新期望证据：断言返回 7 项（全部 + 6 场景），每项 `count > 0`。
- `plugins/plugins/omnimux-market/src/client/preset-skill-lookup.test.js` :: `15 款技能都在货架上，且分类、文案、封面齐备`
  - 原断言：`RESTORED_CATEGORIES` 中 `创作视频` 引用 `kling-global-ad-localizer`，`创作图片` 引用已下架外部技能 `product-photoshoot` 与 `editorial-luxury-ig-carousel`。
  - 变更理由：`kling-global-ad-localizer` 已重写为纯自研 `global-ad-localizer`；2 个外部图片技能下架后由仓内自研 `dynamic-poster` 与 `character-scene-storyboard` 补位，保持 `创作视频` 8 款、`创作图片` 6 款全真源。
  - 新期望证据：更新 `RESTORED_CATEGORIES` 为上述纯自研技能清单并通过全项字段/封面/磁盘 `SKILL.md` 断言。
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.test.js` :: `tiktok-agent preset carries complete per-skill metadata (ec1590182 社媒纯化后 22 款)`
  - 原断言：断言 `tiktok-agent` 技能总数为 `34`（含已删 `sopilot-social-agents`）。
  - 变更理由：移除无许可 `sopilot-social-agents` 并用 `dynamic-poster`、`character-scene-storyboard` 补位已下架的 2 个外部图片技能后，总数收敛为 `33`。
  - 新期望证据：更新期望数量为 `33`，其余元数据完整性断言不变。
- `plugins/plugins/omnimux-market/src/expert/catalog-provider.test.js` :: `catalog provider list returns candidates with 0 token modelInvocable: false`
  - 原断言：断言目录候选集合包含已下架的 `ugc-confessional` 与 `ugc-showcase`。
  - 变更理由：两项属于本次下架的 112 个外部技能。
  - 新期望证据：改为断言包含自研上架技能 `replicate-carousel` 与 `shoppable-carousel`（以及 4 条快捷方式技能）。
- `plugins/plugins/omnimux-market/src/expert/catalog-provider.test.js` :: `catalog provider loads a previously listed candidate with the official provider.get shape`
  - 原断言：以 `ugc-confessional` 验证 `provider.get`。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `replicate-carousel` 验证 `provider.get`。
- `plugins/plugins/omnimux-market/src/expert/catalog-provider.test.js` :: `catalog provider returns valid definition metadata for an installed candidate`
  - 原断言：以 `ugc-confessional` 验证已安装候选读取。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `replicate-carousel` 验证相同逻辑。
- `plugins/plugins/omnimux-market/src/expert/catalog-provider.test.js` :: `resolved definitions satisfy official validateDefinition`
  - 原断言：以 `ugc-confessional` 验证定义契约。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `replicate-carousel` 验证相同逻辑。
- `plugins/plugins/omnimux-market/src/expert/catalog.test.js` :: `loadCatalog memos by path+mtime; install invalidates installed flag`
  - 原断言：以 `sk-omx-ugc-confessional` 验证缓存与安装失效。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 验证相同行为。
- `plugins/plugins/omnimux-market/src/expert/catalog.test.js` :: `loads bundled catalog`
  - 原断言：断言 `skills.length >= 50`。
  - 变更理由：下架 112 个无许可外部技能并上架 16 款自研技能后，市场目录技能数为 `16`。
  - 新期望证据：更新断言为 `skills.length >= 16`，并补充校验全部条目携带合法 `origin`/`license`/`owner` 且无 `"Official"`。
- `plugins/plugins/omnimux-market/src/expert/catalog.test.js` :: `decorate sees a copied skill as installed`
  - 原断言：以 `sk-omx-ugc-confessional` 验证本地安装态装饰。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 验证相同行为。
- `plugins/plugins/omnimux-market/src/expert/install.test.js` :: `installs a bundled skill once`
  - 原断言：以 `sk-omx-ugc-confessional` 验证随包技能幂等安装。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 验证相同行为。
- `plugins/plugins/omnimux-market/src/expert/summon.test.js` :: `summon installs then returns a slash gesture`
  - 原断言：以 `sk-omx-ugc-confessional` 验证召唤手势 `/ugc-confessional`。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 验证召唤手势 `/replicate-viral-video`。
- `plugins/plugins/omnimux-market/src/expert/summon.test.js` :: `blank session stages expert-mode when the preset exists`
  - 原断言：以 `sk-omx-ugc-confessional` 验证空白会话召唤。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 验证相同行为。
- `plugins/plugins/omnimux-market/src/tests/install.test.ts` :: `*`
  - 原断言：`installSkill routes catalog slugs to local installItem` 使用已下架的 `ugc-confessional` / `sk-omx-ugc-confessional`。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `replicate-viral-video` / `sk-omx-replicate-viral-video` 验证本地目录安装路由。
- `plugins/plugins/omnimux-market/src/tests/skill-aggregate.test.ts` :: `*`
  - 原断言：`live catalog still exposes ugc-confessional as custom` 与 `T03-04` 引用已下架的 `ugc-confessional`。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用保留自研技能 `replicate-viral-video` / `sk-omx-replicate-viral-video` 验证相同检索与双语投影行为。
- `plugins/plugins/omnimux-market/src/tests/skill-bilingual.test.ts` :: `*`
  - 原断言：`T01-10` 抽样断言已下架的 `sk-omx-ugc-confessional`。
  - 变更理由：`sk-omx-ugc-confessional` 已下架。
  - 新期望证据：改用 `sk-omx-replicate-viral-video` 抽样验证双语字段投影。
- `plugins/plugins/omnimux-market/src/tests/try-attach.test.ts` :: `*`
  - 原断言：`tryAttach loads bundled skill into the session without writing skills dir` 使用已下架的 `ugc-confessional` / `sk-omx-ugc-confessional`。
  - 变更理由：`ugc-confessional` 已下架。
  - 新期望证据：改用 `replicate-carousel` / `sk-omx-replicate-carousel` 验证无落盘试用加载。
- `plugins/plugins/omnimux-market/src/tests/bundled-skills.test.ts` :: `*`
  - 原断言：`loadBundledMarketSkills` 与 `registerBundledMarketSkills` 断言 `omnimux-market` 随包技能总数为 `19`（含 `sopilot-social-agents`）。
  - 变更理由：删除无许可 `sopilot-social-agents` 后，`omnimux-market` 随包技能数为 `18`（1 个全局 `omnimux-social-data` + 17 个 0-Token 垂类技能）。
  - 新期望证据：更新期望数量为 `18` 且与 `dsh.manifest.json` 实时对齐。
- `plugins/plugins/omnimux-market/tests/e2e/market-hot-picks-new-arrivals-5.spec.js` :: `E2E-1 目录配置验证：脚本转视频 与 UGC 脚本全流程策划 纳入热门精选且总数为 5`
  - 原断言：断言被下架的 `sk-omx-script-to-video` 与 `sk-omx-ugc-script-planner` 位于热门精选。
  - 变更理由：两项属于本次下架的 112 个无许可外部技能；新的 5 款热门精选为自研核心技能（`sk-omx-replicate-viral-video`、`sk-omx-create-selling-video`、`sk-omx-video-hook-analysis`、`sk-omx-reverse-video-prompt`、`sk-omx-replicate-carousel`）。
  - 新期望证据：改为校验自研热门精选技能 `isHot: true` 与 `热门精选` 标签，且热门精选总数等于 `5`。
- `plugins/plugins/omnimux-market/tests/e2e/kling-ad-localizer-bundled.test.js` :: `kling-global-ad-localizer: catalog entries and bundled files are valid`
  - 原断言：断言 `sk-omx-kling-global-ad-localizer` 存在且含外部运行契约 `references/kling-generation-runtime.md` 与 `expert.png`。
  - 变更理由：按 Phase 4 批次 3 决议移除外部 `KLING AI` 运行契约与素材并重写为纯自研 `global-ad-localizer`（`sk-omx-global-ad-localizer`）。
  - 新期望证据：更新用例校验 `sk-omx-global-ad-localizer` 目录条目（含 `origin: 'first-party'`、`license`、`owner`）、`SKILL.md`/`meta.yaml`/`agents/global-ad-localizer.md` 完整且不含 `kling-generation-runtime`/`WorkBuddy` 残留。
- `plugins/plugins/omnimux-market/tests/e2e/kling-ad-localizer-bundled.test.js` :: `kling-global-ad-localizer: bundled install unpacks skill and references`
  - 原断言：断言解包 `kling-global-ad-localizer` 含 `references/kling-generation-runtime.md`。
  - 变更理由：同上，外部运行契约已移除，技能重命名为 `global-ad-localizer`。
  - 新期望证据：更新用例验证解包 `global-ad-localizer` 释放 `SKILL.md` 与 `agents/global-ad-localizer.md` 且不含外部运行契约文件。
- `plugins/plugins/omnimux/tests/e2e/creatify-skills-library-refactor.e2e.test.mjs` :: `默认呈现全部技能，置顶热门精选(3)、新品上市(6)与探索更多(103)分区`
  - 原断言：断言 9 个分类胶囊、热门精选 3 卡、新品上市 6 卡、探索更多 103 卡及选中 `sk-omx-ugc-confessional`。
  - 变更理由：下架 112 个外部无许可技能并上架 16 款自研技能后，首页 Skills 面板呈现 7 个分类胶囊（全部 + 6 场景）、热门精选 5 卡、新品上市 6 卡、探索更多 5 卡，首张卡片为 `sk-omx-replicate-viral-video`。
  - 新期望证据：更新分区计数与首卡断言匹配新自研精选快照并通过真实 JSDOM 渲染测试。
- `plugins/plugins/omnimux/tests/e2e/debrand-skills-library.e2e.test.mjs` :: `验证全量快照与目录中零品牌残留，author均为Official且tags无原厂词汇`
  - 原断言：断言快照与目录为 112 条、`author === 'Official'`，并读取已下架的 `course-to-short-video` 与 `motion-design-flow`。
  - 变更理由：Phase 4 下架 112 个外部技能并正式禁止 `"author": "Official"`，改为校验 16 款自研上架技能均具 `origin: 'first-party'`、`author: 'OmniMux'`、具体 `license` / `owner` 且零外部品牌/热链残留。
  - 新期望证据：更新断言以验证新 16 款自研上架技能的合规性与零品牌残留。
- `plugins/plugins/omnimux/tests/e2e/skill-prefill-slug.e2e.test.mjs` :: `点击 Skills 货架上的技能卡片，输入框只出现说明请求`
  - 原断言：点击首卡后断言 `window.__omnimuxActiveSkill?.slug === 'ugc-confessional'` 且输入框不含 `/ugc-confessional`。
  - 变更理由：首卡已变更为自研核心技能 `replicate-viral-video`。
  - 新期望证据：更新期望 slug 为 `replicate-viral-video`，继续严格验证不向输入框注入斜杠指令且正确点亮技能药丸。
- `plugins/plugins/omnimux-market/src/client/skill-header.test.js` :: `install action opens existing modal and category row precedes content`
  - 原断言：断言分类栏按钮为 9 个（「全部」+ 8 个场景）。
  - 变更理由：8 个场景中 `scene-app` 与 `scene-local` 在自研货架下已无成员，分类栏按真实成员收敛为「全部」+ 6 个场景。
  - 新期望证据：断言分类栏为 7 个按钮，前 5 个 key 仍为 `['', 'scene-seeding', 'scene-brand', 'scene-product', 'scene-performance']`。
- `plugins/plugins/omnimux-market/src/expert/suite-catalog.test.js` :: `suite counts match the packaged content`
  - 原断言：断言 `suite-tiktok-agent` 含 45 条技能清单项。
  - 变更理由：`sopilot-social-agents` 因缺少再分发许可被彻底删除，并同步从该预装套件清单中移除。
  - 新期望证据：断言 `suite-tiktok-agent` 恰好 44 条技能清单项，其余套件计数不变。
- `plugins/plugins/omnimux-market/tests/e2e/aigc-category.spec.js` :: `E2E 分类栏：中英文界面与目录声明的场景分类一致`
  - 原断言：断言分类栏长度 9（「全部」+ 8 个场景）。
  - 变更理由：`catalog/index.json` 的 `skillScenarios` 已收敛为 6 个有成员的真实场景。
  - 新期望证据：断言分类栏长度 7，且中英文标签仍与目录 `skillScenarios` 逐项一致。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `buildWorkshopCategories() 返回 8 个场景分类，默认全部`
  - 原断言：断言分类栏长度 9（「全部」+ 8 个场景）。
  - 变更理由：同上，`scene-app` / `scene-local` 无成员后不再出现在分类栏。
  - 新期望证据：断言分类栏长度 7，首项仍为 `''`/「全部」，`scene-seeding`/`scene-product`/`scene-performance` 顺序不变。
- `plugins/plugins/omnimux-market/tests/e2e/suite-marketplace.spec.js` :: `E2E 旅程三：TikTok 预装套件出厂默认展示「卸载」，点击弹出卸载确认框并调用卸载`
  - 原断言：断言 `TIKTOK.suite.skills.length` 为 45。
  - 变更理由：`sopilot-social-agents` 删除后该预装套件清单为 44 条。
  - 新期望证据：断言 44 条，后续卸载交互断言保持不变。
