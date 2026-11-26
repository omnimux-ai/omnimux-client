# Expert Market Precision Evolution (8 → 10) & Scoped Tool-Restriction Runtime

- **Tracking Issue**: [#318](https://github.com/omnimux-ai/omnimux-client/issues/318)
- **基线提交**: `origin/main@c5d64961`

## 背景与研究依据

1. **专家阵容与最新能力断层**：
   - 顶层出厂预设已按 `specs/converge-agent-presets.spec.md` 收敛为 `OmniMux`（默认）与 `创建Agent`（`cordis`）两项，专家市场 `omnimux-market` 内置 8 位跨境电商 SOP 专家。
   - 本仓随后落地了 `omnimux-tiktok-selection`（18 个 `tiktok_selection_*` 三闸跟爆工具）、6,380+ 云端资产与多语言本地化广告链路，但既有 `ecom-market-research`（选品专家）仅调用静态 CSV 脚本、未接管三闸跟爆工作台；冷启动商品/品牌建档与跨国多语种视频裂变也缺少专职 SOP 专家。
2. **底座能力差距（工具裁剪与首启引导）**：
   - DSH `@deepseek-ai/dsh-tools` 原生支持在 Agent 作用域通过 `ctx.tools.restrict({ allow, deny })` 隐藏无关全局工具（同时自动联动系统提示词与 Schema 裁剪，并豁免 Agent 自身作用域基础工具）；
   - 当前 `ExpertPresetRuntime` 为每位聘用专家暴露全量 100+ 宿主工具，且用户在空白会话切换至已聘用 `ecom-*` 专家时，输入框下方无起手式引导（`ComposerQuickShortcuts` 仅针对 `omni-agent`）。
3. **范围边界（如实降级）**：
   - `omnimux-accounts`、`omnimux-publish`、`omnimux-analytics` 在 `plugin-lifecycle.json` 仍处 `alpha`（仅 TikTok），`omnimux-pibrowse` 预编译内核目前仅支持 `darwin-arm64`，因此「矩阵运营」专家延后至 Phase 2，本轮严格聚焦已就绪的预览档能力。
   - 严格保持 `app/deepseek-harness/` 上游 submodule 只读不改。

## 假设

1. 新增独立 Agent-plane 子路径插件 `omnimux-market/expert-tool-scope`（`inject: ['tools']`），按 OmniMux 受管宿主工具域表计算 `deny` 集合并仅针对当前已注册全局工具调用 `ctx.tools.restrict({ deny })`，同时监听 `tools/change` 按排序签名幂等对账，可在不误杀 Agent 基础工具与用户自装第三方 MCP 连接器、不触发未知工具异常和递归死循环的前提下，按角色精准收敛模型可见工具面。
2. 将 `DEFAULT_MARKET_EXPERTS` 由 8 位精进至 10 位（升级 `ecom-market-research` 接管 `omnimux-tiktok-selection` 18 工具；新增 `ecom-brand-curator` 品牌管家与 `ecom-global-localizer` 本土专家，配套 2 个 `disable-model-invocation: true` 随包 Skill 与零第三方依赖的 Python 3 确定性校验脚本 `validate_brand_kit.py` / `check_localization_matrix.py`），并保持 `presets/manifest.json` 的 `shippedPresets` 严格为 `['omni-agent', 'cordis']`，可覆盖冷启动建档、实时三闸跟爆与多国本地化裂变闭环。
3. 在中枢 `conversation.input.dock` 槽位新增轻量 `ExpertBootstrapBar`（复用 `.omx-quick-shortcuts` 布局与 `--dsw-*` 语义 Token，零硬编码色值、零中点分隔符），仅在空白会话且当前预设为已聘用 `ecom-*` 专家时展示 3 条一键填入起手式（不自动发送、与 `omni-agent` 快捷方式和 `cordis` 创造模式严格互斥），可显著降低聘用专家首轮冷启动门槛。

## 证伪方式

1. **工具裁剪真实宿主证伪**：挂接真实 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-scope` + `@deepseek-ai/dsh-tools`，若任一专家挂载后仍暴露其非放行受管域工具，或误藏 Agent 自身工具 / 第三方自定义 MCP 工具，或在缺失可选插件/空 `deny` 集时抛错，或延迟注册新工具未对账/引发递归循环，或被 `auditRows`/`leakedServices` 判 `broken`，则假设 1 证伪。
2. **阵容与确定性脚本证伪**：若 `shippedPresets` 偏离 2 项白名单、任一新 Skill 未配置 `disable-model-invocation: true` 或缺失清单登记、任一 Python 脚本在纯系统 `python3` 下对合法/异常夹具判定失准、或新专家中英名称/像素头像在中枢与市场不一致，则假设 2 证伪。
3. **空白会话引导与视觉证伪**：若 `ExpertBootstrapBar` 在 `omni-agent`、`cordis` 或非空白会话中泄漏 DOM，或点击起手式触发自动发送/破坏已有非自有草稿，或高保真演示/编译产物在亮/暗双主题与 520px 窄屏存在裁切/重叠/裸色 Token，则假设 3 证伪。

## 改动清单

1. **规范与高保真演示**：
   - `specs/expert-market-precision-evolution.spec.md`
   - `ui-demo/expert-market-sop-experts-demo.html`
2. **工具裁剪底座（`omnimux-market`）**：
   - `plugins/plugins/omnimux-market/src/expert-tool-domains.ts`
   - `plugins/plugins/omnimux-market/src/expert-tool-scope-plugin.ts`
   - `plugins/plugins/omnimux-market/package.json`（新增 `./expert-tool-scope` 导出）
   - `plugins/plugins/omnimux-market/src/expert-runtime.ts`
3. **8 → 10 专家阵容、起手式元数据与新随包 Skill（`omnimux-market`）**：
   - `plugins/plugins/omnimux-market/src/expert-market.ts`
   - `plugins/plugins/omnimux-market/src/local-api.ts`
   - `plugins/plugins/omnimux-market/src/client/plaza/plazaUtils.js`
   - `plugins/plugins/omnimux-market/src/client/apply.js` & `src/client/skill-plaza.js`（发布只读 `window.__omnimuxExpertStarters` 通道）
   - `plugins/plugins/omnimux-market/skills/omnimux-ecom-brand-curator/`（`SKILL.md` + `scripts/validate_brand_kit.py`）
   - `plugins/plugins/omnimux-market/skills/omnimux-ecom-global-localizer/`（`SKILL.md` + `scripts/check_localization_matrix.py`）
   - `plugins/plugins/omnimux-market/skills/omnimux-ecom-market-research/SKILL.md`
   - `plugins/plugins/omnimux-market/dsh.manifest.json` & `plugins/plugins.registry.json`
4. **中枢适配与空白会话引导条（`omnimux` & `presets`）**：
   - `plugins/presets/manifest.json`
   - `plugins/plugins/omnimux/src/client/agent-presets-i18n.js`
   - `plugins/plugins/omnimux/src/client/agent-preset-enhancer.js`
   - `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/expertBootstrapCatalog.js`
   - `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/ExpertBootstrapBar.jsx`
   - `plugins/plugins/omnimux/src/client/index.js`
5. **测试与门禁**：
   - 新增 `plugins/plugins/omnimux-market/src/tests/expert-tool-scope.test.ts`（挂接真实 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-scope` + `@deepseek-ai/dsh-tools`）
   - 扩展 `plugins/plugins/omnimux-market/src/presets/ecom-sop-skills.test.js`（10 项随包 Skill 清单校验 + `validate_brand_kit.py` / `check_localization_matrix.py` 确定性单测）
   - 新增 `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/ExpertBootstrapBar.test.js`
   - 同步更新既有 8 专家快照断言测试（见下方「旧标准变更」）

## 旧标准变更

由于本次任务按 Issue #318 将专家市场内置 SOP 专家阵容由 8 位精进至 10 位（新增 `ecom-brand-curator` 品牌管家与 `ecom-global-localizer` 本土专家，升级 `ecom-market-research` 接管三闸跟爆工具，分类分布由 `research 2 / production 3 / growth 3` 变为 `research 3 / production 4 / growth 3`），以下既有快照断言用例随新契约同步更新：

- `plugins/plugins/omnimux-market/src/tests/experts-market.test.ts` :: `DEFAULT_MARKET_EXPERTS defines 8 SOP cross-border experts, all default available with zero Topview residue`
  - 原断言：断言 `DEFAULT_MARKET_EXPERTS.length === 8` 及原 8 位专家 ID 列表。
  - 变更理由：按 Issue #318 精兵演进方案新增 `ecom-brand-curator` 与 `ecom-global-localizer`，同时每位专家新增 `toolDomains` 与 3 条 `starters`。
  - 新期望证据：同步更新为校验 10 位 SOP 专家 ID、非空 `toolDomains`、3 条中英双语 `starters`、像素头像与零 Topview 残留，并验证 `expertMarketList` 返回 `12` 条（2 系统预置 + 10 市场专家）。
- `plugins/plugins/omnimux-market/src/tests/experts-market.test.ts` :: `truthful state: fresh env & stale .agent-presets dir never show fake enabled; system presets show [system]`
  - 原断言：断言 `items.length === 10`（2 系统预置 + 8 市场专家）。
  - 变更理由：内置市场专家由 8 位增至 10 位，总列表数由 10 变为 12。
  - 新期望证据：更新断言为 `items.length === 12`（2 系统预置 + 10 市场专家），其余真状态、零假已入职与 `cordis` 描述断言保持不变。
- `plugins/plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js` :: `E2E 旅程一：跨境电商 SOP 专家库包含 8 位角色，全部默认可聘用且支持按 SOP 阶段筛选`
  - 原断言：断言 `DEFAULT_MARKET_EXPERTS.length === 8` 及阶段计数 `research 2 / production 3 / growth 3`。
  - 变更理由：新增 `ecom-brand-curator`（`research`）与 `ecom-global-localizer`（`production`），总数变为 10、阶段计数变为 `research 3 / production 4 / growth 3`。
  - 新期望证据：同步更名并校验全部 10 位 ID、新阶段分布与检索过滤。
- `plugins/plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js` :: `E2E 旅程二：官方系统预置、已入职市场专家与用户自建 Agent 真源聚合，系统预置不渲染禁用按钮`
  - 原断言：断言 `reconciled.length === 11`（2 系统 + 8 市场 + 1 自建）。
  - 变更理由：市场专家增至 10 位后聚合总数变为 13。
  - 新期望证据：更新聚合总数为 13（2 系统 + 10 市场 + 1 自建），系统预置/用户自建无禁用钮与卡片渲染断言不变。
- `plugins/plugins/omnimux-market/tests/e2e/expert-market-avatars.spec.js` :: `E2E 专家市场卡片头像渲染：8 位 SOP 电商专家均以确定性像素小人展示、无 Topview 残留且默认可聘用`
  - 原断言：断言 `DEFAULT_MARKET_EXPERTS.length === 8` 与 `plazaUtils.DEFAULT_MARKET_EXPERTS.length === 8`。
  - 变更理由：内置专家列表升级为 10 位。
  - 新期望证据：同步更名并逐一验证全部 10 位专家的像素头像、无 Topview 残留、默认 `available` 与阶段胶囊。
- `plugins/plugins/omnimux/src/client/agent-presets-i18n.test.js` :: `getPresetFallbackCopy returns localized fallback copy for all presets`
  - 原断言：循环校验原有 8 位 `ecom-*` 专家的中英文简化名称与双语描述。
  - 变更理由：新增 `ecom-brand-curator` 与 `ecom-global-localizer`。
  - 新期望证据：扩展循环清单至全部 10 位 `ecom-*` 专家，精确校验中英文名称与非空双语简介。
- `plugins/plugins/omnimux-market/src/tests/bundled-skills.test.ts` :: `loadBundledMarketSkills loads all 19 manifest-declared skills with layered invocation policy`
  - 原断言：断言 `skills.length === 18`（1 个全局可见 + 17 个默认 0-Token 随包 Skill）。
  - 变更理由：按 Issue #318 新增 `omnimux-ecom-brand-curator` 与 `omnimux-ecom-global-localizer` 两个 `disable-model-invocation: true` 随包 Skill，随包总数由 18 增至 20。
  - 新期望证据：更新断言为 `skills.length === 20`，同时保持仅 `omnimux-social-data` 全局 `modelInvocable: true`（其余 19 项默认 0-Token）。
- `plugins/plugins/omnimux-market/src/tests/bundled-skills.test.ts` :: `registerBundledMarketSkills registers provider at BUNDLED_SKILL_RANK (600) with working list/get and dispose`
  - 原断言：断言 `candidates.length === 18`。
  - 变更理由：随包 Skill 清单新增 2 项至 20 项。
  - 新期望证据：更新断言为 `candidates.length === 20`，其余 rank/invocation/get/dispose 断言不变。
- `plugins/plugins/omnimux-market/src/presets/ecom-sop-skills.test.js` :: `all 8 cross-border SOP skills are declared in dsh.manifest.json with valid frontmatter and zero dead tools`
  - 原断言：断言 `ECOM_SOP_SKILLS` 8 项技能均声明于 `dsh.manifest.json` 并具合法 frontmatter。
  - 变更理由：按 Issue #318 新增 `omnimux-ecom-brand-curator` 与 `omnimux-ecom-global-localizer` 两个随包 SOP Skill，总数由 8 增至 10。
  - 新期望证据：同步扩展至 10 项随包 Skill，并补齐 `validate_brand_kit.py` 与 `check_localization_matrix.py` 确定性通过/拦截单测。
- `plugins/plugins/omnimux/src/client/agent-preset-enhancer.test.js` :: `gives every known expert a distinct avatar`
  - 原断言：断言 `Object.keys(AGENT_PRESET_AVATARS)` 仅包含原有 8 位 `ecom-*` 专家与其余已知预设。
  - 变更理由：新增 `ecom-brand-curator` 与 `ecom-global-localizer` 两位市场专家及其像素头像色相配置。
  - 新期望证据：扩展 `ids` 清单纳入两位新专家，继续断言每个已知专家像素头像互不冲突。
- `plugins/plugins/omnimux/src/client/agent-market-avatar-convergence.test.js` :: `市场垂直专家在输入框与专家市场全部统一收敛至确定性像素艺术头像`
  - 原断言：循环校验原有 8 位 `ecom-*` 专家的像素头像收敛一致性。
  - 变更理由：新增 `ecom-brand-curator` 与 `ecom-global-localizer`。
  - 新期望证据：扩展循环清单至全部 10 位 `ecom-*` 专家，校验中英文别名 1:1 收敛至同一像素头像。
