# Agent 预设收敛：唯一默认内容电商 Agent（英文版 Agent.md）+ DSH 原生创造模式

## 背景

此前 `plugins/presets/` 下累积了 40 个目录（8 个业务/系统预设 + 6 个历史兼容别名 + 26 个 `expert-*` 子代理目录），打包期全量复制到 `preset/agent-presets/` 并被壳侧全量声明为 `@deepseek-ai/dsh-agent-preset`，再叠加 DSH 上游内置的 4 个预设（`standard`、`ptc`、`minimal`、`cordis`），导致顶层 Agent 选择器暴露出 42 个选项。

更深层的架构问题有三点：
1. OmniMux 全部业务插件工具（画布、视频分析、剪辑、商品库、资产库、灵感/对标、发布、数据、Hub 媒体生成）均注册在 Host Plane 全局共享，拆成 7 个平台/场景业务 Agent 并没有不同的工具权限边界，本质上是“披着 Agent 壳的 Skill”。
2. `instagram-agent`、`x-agent`、`youtube-agent`、`viral-video-agent` 四个预设的 `agent.cordis.yml` 仅有 `persona` 行，缺失 `tool-fs`、`tool-skill`、`compaction`、`tool-subagent` 等基础底座能力；而 26 个 `expert-*` 子代理目录直接暴露在用户选择器中。
3. 同一内容电商卖家常在同一商品会话内连续执行对标拆解、带货视频、电商套图/轮播与广告本地化，硬拆多个业务 Agent 反而打断上下文与技能池。

## 目标

1. **只保留 2 个可见 Agent 预设**：
   - 默认业务 Agent：`omni-agent`（显示名 `OmniMux`，`order: 1`），采用蒸馏后的英文版 `plugins/presets/omni-agent/Agent.md` 作为单一真源并同步至 `agent.cordis.yml` 的 `persona.prefix`，装配完整健康的 DSH 标准工具链（无 10/13/6 静态 `expert_*` 子代理绑定）。
   - 系统级创造模式：直接使用 DSH 上游原生 `cordis`（`@deepseek-ai/dsh-web-app/presets/cordis.patch.yml`）。
2. **彻底移除其余出厂预设目录与上游非创造模式入口**：
   - 清理 `plugins/presets/` 下除 `omni-agent/` 外的其余 39 个预设目录、`.retired/` 与 `fragments/`。
   - 在 `plugins/plugins/omnimux/cordis.patch.yml` 停用上游 `preset-standard`、`preset-ptc`、`preset-minimal`，并将 `agent-preset-registry.config.default` 设为 `omni-agent`。
3. **保障存量用户与老会话平滑兼容（零死锁、零黑名单补丁）**：
   - 在 `plugins/plugins/omnimux/src/host/retired-presets.js` 为 `agentPresets` 安装可卸载的运行时退役重定向：当历史会话或冷历史视图解析已退役预设 ID（或 `expert-*`）时自动映射至 `omni-agent`，同时 `list()` / `remoteExportList()` 仅返回真实注册的 2 个预设，客户端不引入任何黑名单或 DOM 隐藏补丁。
   - 在 `app/dsh-plugin-desktop/src/setup-wizard-settings.ts` 扩展启动期设置迁移：将存量用户 `settings.yaml` 中指向已退役预设的 `selectedDefault` 迁移至 `omni-agent`，保留用户自定义未知预设不动。
4. **收口前端耦合点**：
   - 输入框下方快捷方式（`isTikTokAgentPreset.js`）以唯一默认业务 Agent `omni-agent`（含 `OmniMux` 及历史 `tiktok-agent` 兼容）为展示条件，`cordis` 创造模式仍返回 `false` 保持零 DOM。
   - `omnimux-market` 技能选择器支持 `OmniMux` / `内容电商助手` / `omni-agent` 别名解析至 `omni-agent` 预设绑定，`plugins/presets/omni-agent/skills.json` 承接统一的内容电商技能清单（保留 `catalog/preset-skills.json` 既有绑定以兼容存量会话与既有测试）。
   - 同步更新高保真修改前后演示 `ui-demo/agent-preset-menu-redesign-demo.html` 反映「42 项 → 2 项（OmniMux 默认 + DSH 原生创造模式）」。

## 非目标

- 不修改 `app/deepseek-harness/` 上游 submodule 源码。
- 不删除 `plugins/plugins/omnimux-market/catalog/skills/` 中的任何内容电商 Skill 实体。
- 不在客户端增加硬编码退役黑名单或 `display: none` 遮盖（保持 `verify-anti-slop.test.mjs` Gate 1/2 严格成立）。
- 不把本次改动合入共享 Dev/Prod（先在任务工作树完成构建、单测、门禁与浏览器验收）。

## 研究依据

- 对标参考：行业多模态创作 Agent 的架构演进实践表明，按职能静态拆分多个部门子代理（编剧/美术/分镜/音频/剪辑）会产生高维护成本与上下文割裂，收敛为「单一主 Agent（清晰职责、对象边界、真相规则与授权门禁）+ 按需加载 Skill + 通用最小边界子代理」更易控且更稳定。
- 本仓技能盘点：通读 `plugins/plugins/omnimux-market/catalog/skills/`（142 个 bundled Skill）与 `omnimux-clip/skills/clip-craft/SKILL.md`，提炼出 6 条跨链路不变量（证据四级隔离、商品本体锁定、跨境四栏本地化、锚点/小样优先、Skill 优先律、剪辑诊断与外发强授权）。
- 本仓底座实证：`app/deepseek-harness/packages/preset/agent-preset-registry/src/index.ts` 与 `packages/api/session-controller/src/agent.ts` 证实 `remoteExportList()` 返回全部已注册定义，而老会话恢复走 `resolve()` / `mount()` / `acquireScope()`；因此在 Host 侧收敛注册集合到 2 项并重定向已退役 ID，既可彻底净化选择器，又能防止老会话 `agent-preset/not-found`。

## 假设

将产品预设真源收敛为单一 `plugins/presets/omni-agent/`（由英文 `Agent.md` 驱动 `agent.cordis.yml`）、在 `plugins/plugins/omnimux/cordis.patch.yml` 停用上游 `preset-standard`/`preset-ptc`/`preset-minimal` 并设默认值为 `omni-agent`、在 Host 侧对退役预设 ID 做可逆重定向并在桌面端迁移旧默认设置后，用户在选择器中只会看到「OmniMux（默认）+ 创建Agent（DSH 原生 `cordis`）」两项，老会话恢复与快捷方式/技能货架链路全部正常。

## 证伪方式

1. 若 `AgentPresetRegistry` 实测 `remoteExportList()` 仍包含超过 2 项、或默认预设不为 `omni-agent`，则预设收敛或 patch 顺序失效。
2. 若老会话（`agentPreset: tiktok-agent` / `standard` / `instagram-agent` / `expert-video`）经 `resolve()` / `mount()` / `acquireScope()` 抛出 `agent-preset/not-found`，则退役重定向契约失效。
3. 若 `omni-agent` 会话下输入框快捷方式不展示、或 `cordis` 创造模式下错误展示快捷方式，则前端角色门控改造不完整。
4. 若 `presets:verify`、`omnimux` / `omnimux-market` 单测、桌面 `dsh-plugin-desktop` 单测或 `verify-test-standard-declarations` 任一失败，则改动破坏既有契约。

## 验收标准

- `plugins/presets/` 下仅保留 `omni-agent/`（含英文 `Agent.md`、`preset.yml`、`agent.cordis.yml`、`skills.json`）、`manifest.json`、`README.md`；`manifest.json` 的 `shippedPresets` 严格为 `['omni-agent', 'cordis']`。
- `plugins/presets/omni-agent/agent.cordis.yml` 的 `persona.config.prefix` 与 `plugins/presets/omni-agent/Agent.md` 逐字一致，包含完整 DSH 基础工具栈，且不含任何静态 `expert_*` 子代理行；`node plugins/scripts/build-agent-presets.mjs` 运行幂等。
- `plugins/plugins/omnimux/cordis.patch.yml` 停用 `preset-standard`、`preset-ptc`、`preset-minimal`，并将 `agent-preset-registry.config.default` 设为 `omni-agent`。
- `plugins/plugins/omnimux/src/host/retired-presets.js` 单测验证：`list()` / `remoteExportList()` 仅返回 `[omni-agent, cordis]`；已退役 ID 与 `expert-*` 在 `resolve()` / `mount()` / `recompose()` / `acquireScope()` / `mountChild()` 中透明重定向到 `omni-agent`；未知自定义 ID 仍抛出 `agent-preset/not-found`；disposer 卸载后完全恢复原方法。
- `app/dsh-plugin-desktop/src/setup-wizard-settings.ts` 单测验证：旧设置中的退役默认预设自动迁移到 `omni-agent`，`cordis` 与自定义未知预设保持不变。
- `isTikTokAgentPreset` 对 `omni-agent` / `OmniMux` 及兼容 `tiktok-agent` 返回 `true`，对 `cordis` 返回 `false`；输入框快捷方式与技能货架在 `omni-agent` 下正常呈现。
- 高保真演示 `ui-demo/agent-preset-menu-redesign-demo.html` 在真实浏览器暗/亮主题与窄视口下清晰展示 `42 → 2`（OmniMux 默认 + DSH 原生创造模式）收敛结果。

## 旧标准变更

- `plugins/scripts/verify-agent-presets.test.mjs` :: `preset fragments exist and list the expected experts`
  - 理由：本次将 26 个静态 `expert-*` 子代理预设与 `presets/fragments/` 整体移除，主 Agent 改为按需使用通用 `subagent`/`workflow`，不再维护静态专家片段。
  - 新期望与证据：替换为校验 `presets/omni-agent/Agent.md` 为单一真源并与 `agent.cordis.yml` 的 `persona.prefix` 逐字一致，且不含静态 `expert_*` 绑定。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `omni-agent agent.cordis.yml is structurally valid and mounts all 10 experts`
  - 理由：收敛后 `omni-agent` 不再静态挂载 10 个 `expert_*` 子代理，而是保持完整标准底座与通用 `subagent`/`subagent_fork`/`workflow`。
  - 新期望与证据：验证 `omni-agent/agent.cordis.yml` 结构合法、包含标准底座工具、`toolNames` 为空数组，且无 `expert_*` 行。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `ad-creative-agent (marketing) agent.cordis.yml is structurally valid and mounts all 6 marketing experts`
  - 理由：`ad-creative-agent` 已收敛移除，由唯一默认 `omni-agent` + 广告类 Skill 承接。
  - 新期望与证据：验证 `presets/` 仅含 `omni-agent` 目录，不再包含 `ad-creative-agent` 等多余预设。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `drama-agent in .retired is structurally valid and mounts all 6 drama experts`
  - 理由：`.retired/` 历史归档预设与静态专家片段随本次全量收敛一并清理，历史会话改由运行时退役重定向承接。
  - 新期望与证据：通过 `retired-presets.test.js` 验证 `drama-agent` 透明重定向至 `omni-agent`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `marketing-growth-team in .retired is structurally valid and mounts all 4 growth experts`
  - 理由：`.retired/` 历史归档预设随本次收敛移除，历史会话改由运行时退役重定向承接。
  - 新期望与证据：通过 `retired-presets.test.js` 验证 `marketing-growth-team` 透明重定向至 `omni-agent`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `growth-experts fragment lists exactly the 4 growth experts`
  - 理由：`presets/fragments/` 已移除，不再通过静态片段拼接子代理。
  - 新期望与证据：由单一 `omni-agent/Agent.md` 同步机制替代并验证。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `standard in .retired is structurally valid code development agent`
  - 理由：`.retired/standard` 随本次收敛移除，且 `preset-standard` 在 OmniMux 配置中停用。
  - 新期望与证据：验证 `omnimux/cordis.patch.yml` 停用 `preset-standard`/`preset-ptc`/`preset-minimal` 并将默认设为 `omni-agent`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `daily-work in .retired is structurally valid daily work collaboration agent`
  - 理由：`.retired/daily-work` 随本次收敛移除。
  - 新期望与证据：通过 `retired-presets.test.js` 验证 `daily-work` 透明重定向至 `omni-agent`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `cordis preset exists and includes native cordis capabilities and skills`
  - 理由：不再在 `plugins/presets/cordis/` 复制一份重复定义，直接使用 DSH 原生 `@deepseek-ai/dsh-web-app/presets/cordis.patch.yml`。
  - 新期望与证据：验证 `omnimux/cordis.patch.yml` 未停用 `preset-cordis`，且 `plugins/omnimux/skills/{cordis-plugin-development,editing-cordis-compositions}/SKILL.md` 仍完整随中枢分发。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `preset.yml metadata matches requirements for shipped presets`
  - 理由：出厂目录收敛为仅剩 `omni-agent`，显示名收敛为 `OmniMux`。
  - 新期望与证据：验证 `presets/omni-agent/preset.yml` 包含 `name: OmniMux` 与 `order: 1`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `sync-agent-presets.sh maintains presets in KEEP array`
  - 理由：`sync-agent-presets.sh` 收敛为校验唯一产品预设目录 `omni-agent`。
  - 新期望与证据：验证 `sync-agent-presets.sh` 声明 `KEEP=(omni-agent)` 并可成功通过校验。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `all historical and legacy compatibility presets must exist and be structurally mountable`
  - 理由：物理留存 13+ 兼容预设目录正是导致 DSH 0.2.1-rc.3 选择器出现 42 项的根因；现已改为 Host 侧 `retired-presets.js` 透明重定向，无需保留物理目录污染选择器。
  - 新期望与证据：`retired-presets.test.js` 逐项验证全部历史/退役预设 ID 在 `resolve`/`mount`/`acquireScope` 下均成功解析到 `omni-agent`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `sync-agent-presets.sh synchronizes all legacy aliases to prevent session resume lockup`
  - 理由：历史会话防死锁已迁移至运行时 `retired-presets.js` + 桌面启动迁移 `setup-wizard-settings.ts`，`sync-agent-presets.sh` 不再校验已删除的物理别名目录。
  - 新期望与证据：验证 `manifest.json` 登记完整 `retiredPresetRedirects` 清单并与 `retired-presets.js` 一致。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `presets manifest.json defines the single source of truth whitelist for shipped presets`
  - 理由：出厂可见预设白名单从 8 项收敛为 2 项：`['omni-agent', 'cordis']`。
  - 新期望与证据：断言 `manifest.shippedPresets.map(p => p.id)` 精确等于 `['omni-agent', 'cordis']`。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `omni-agent persona positions as universal social lead and forbids forced spawn`
  - 理由：`omni-agent` 升级为面向内容电商与跨境卖家的英文版 `Agent.md`，并明确按需最小委派原则。
  - 新期望与证据：断言英文 `Agent.md` 与 `omni-agent/agent.cordis.yml` 明确内容电商定位、Skill 优先、最小委派与 Creator Mode 边界。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `build-agent-presets is idempotent`
  - 理由：仅剩 `omni-agent` 需要构建同步，不再存在 `tiktok-agent` 与 `ad-creative-agent`。
  - 新期望与证据：验证 `build-agent-presets.mjs` 对 `presets/omni-agent/agent.cordis.yml` 两次运行完全幂等。

- `plugins/scripts/verify-agent-presets.test.mjs` :: `every shipped preset persona row uses the persona plugin key \`prefix\`, never \`text\``
  - 理由：产品目录仅剩 `presets/omni-agent/agent.cordis.yml`。
  - 新期望与证据：校验 `presets/omni-agent/agent.cordis.yml` 的 `persona` 使用必填 `prefix` 键且不含 `text`。

- `plugins/scripts/verify-anti-slop.test.mjs` :: `Anti-Slop Gate 3: 出厂主力预设必须 100% 严格对齐 presets/manifest.json 白名单 (Strict SSOT Alignment)`
  - 理由：出厂可见主力预设白名单按本次需求从 8 项收敛为 2 项（`['omni-agent', 'cordis']`）。
  - 新期望与证据：断言 `manifest.shippedPresets` 长度严格为 2，且精确包含 `omni-agent` 与 `cordis`。

- `plugins/scripts/verify-agent-presets-health.test.mjs` :: `GATE-02: 出厂预设白名单与正交性校验`
  - 理由：收敛为单一业务预设 `omni-agent` 后，不再存在“多社媒预设两两技能重合度 ≤ 30%”的旧规则，健康门禁更新为校验仅允许 `omni-agent` 且具备完整 `Agent.md` / `preset.yml` / `agent.cordis.yml` / `skills.json`。
  - 新期望与证据：合法 `omni-agent` 通过校验，混入已退役或非法预设目录（如 `standard`、`tiktok-agent`、`expert-video`）均报错拦截。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.test.js` :: `白名单严格包含 6 种官方及别名定义`
  - 理由：收敛后唯一默认内容电商 Agent 为 `omni-agent`（显示名 `OmniMux`），快捷方式白名单新增 `omni-agent`/`OmniMux` 及其中英文别名（共 12 项）并同步修正用例标题。
  - 新期望与证据：白名单精确匹配 12 项默认与历史兼容别名，原 6 项历史别名全部保留。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.test.js` :: `非 TikTok 预设严格返回 false，零 DOM 误判`
  - 理由：`omni-agent` 成为唯一默认内容电商 Agent 后，快捷方式必须对 `omni-agent` 生效，而非仅对已退役的 `tiktok-agent` 生效；原用例把 `omni-agent` 当作“非内容电商反例”，改用 `cordis`（创造模式）与 `standard` 作为显式反例。
  - 新期望与证据：`omni-agent` 与兼容 `tiktok-agent` 均返回 `true`，`cordis` 与 `standard` 严格返回 `false`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.test.js` :: `显式非 TikTok 预设绝对优先，绝不受全局 window.__omnimuxActivePreset 污染穿透`
  - 理由：同上，收敛后用 `cordis` 验证显式入参绝对优先于全局 `window.__omnimuxActivePreset`。
  - 新期望与证据：全局挂有 `omni-agent`/`tiktok-agent` 时，显式 `cordis` 依然严格返回 `false`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.test.js` :: `显式非 TikTok 预设绝对优先，绝不受 DOM 席位属性或文本残留污染穿透`
  - 理由：同上，收敛后用 `cordis` 验证显式入参绝对优先于 DOM 席位残留。
  - 新期望与证据：DOM 挂有 `omni-agent`/`tiktok-agent` 时，显式 `cordis` 依然严格返回 `false`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.test.js` :: `全局变量与 DOM 席位同时存在 TikTok 残留时，显式指定非 TikTok 预设依然严格隔离返回 false`
  - 理由：同上，收敛后用 `cordis` 验证显式指定非内容电商预设在全局与 DOM 同时残留时依然严格隔离。
  - 新期望与证据：显式 `cordis` 与 `standard` 严格返回 `false`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.e2e.test.js` :: `E2E: 会话预设切换与全局/DOM 探测绝对优先级隔离`
  - 理由：同上，`omni-agent` 现为默认内容电商 Agent 应展示快捷方式，改用 `cordis` 验证切换至非内容电商模式时零残留。
  - 新期望与证据：切到 `cordis` 返回 `false`，切到 `omni-agent` / `tiktok-agent` 返回 `true`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/reactivePreset.test.js` :: `reactive preset switch updates isTikTokAgentPreset immediately`
  - 理由：同上，将响应式切换场景的“隐藏态”从 `omni-agent` 改为 `cordis`，验证 `cordis ↔ omni-agent` 切换实时生效。
  - 新期望与证据：从 `cordis` 切到 `omni-agent` 立即变为 `true`，切回 `cordis` 立即变为 `false`。

- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/reactivePreset.e2e.test.js` :: `E2E: TikTok Agent 快捷指令响应式感知预设变动与角色限定联动`
  - 理由：同上，`omni-agent` 默认显示快捷方式，切至 `cordis` 创造模式时快捷方式消失。
  - 新期望与证据：初始 `cordis` 零 DOM → 切到 `omni-agent` 出现快捷方式 → 切回 `cordis` 恢复零 DOM。

- `plugins/plugins/omnimux/src/client/agent-presets-i18n.test.js` :: `getPresetFallbackCopy returns localized fallback copy for all presets`
  - 理由：`omni-agent` 定位与默认名称升级为 `OmniMux`（面向内容电商与跨境卖家）。
  - 新期望与证据：`getPresetFallbackCopy('omni-agent', 'zh'|'en')` 返回 `OmniMux` 与对应内容电商说明。

- `app/dsh-plugin-desktop/tests/setup-wizard-settings.spec.ts` :: `replaces legacy code preset defaults with ptc`
  - 理由：`ptc` 已在本次收敛中停用，旧预设默认值（含 `code`、`standard`、`ptc`、`minimal`、`tiktok-agent` 等）统一迁移至唯一默认内容电商预设 `omni-agent`。
  - 新期望与证据：单测验证 `code`、`standard`、`ptc`、`minimal` 与旧业务预设均迁移为 `omni-agent`，而 `cordis` 与自定义未知预设保持原样。

- `app/dsh-plugin-desktop/tests/profile.spec.ts` :: `still maps the released code preset to ptc after the 0.1.7 section rename`
  - 理由：同上，启动链中 `migrateDesktopSettingsDocumentSections` 之后执行 `migrateLegacyAgentPresetSettings`，已停用的 `code`/`ptc` 预设统一迁移至 `omni-agent`。
  - 新期望与证据：单测验证 `agent-presets.default: code` 经两步迁移后落盘为 `agent-preset-registry.selectedDefault: omni-agent`。

- `plugins/plugins/omnimux/src/auth/http-routes.test.js` :: `lists the model catalog without secrets`
  - 理由：`omnimux` 宿主入口新增可选注入 `agentPresets` 以挂载运行时退役预设重定向，HTTP-only 夹具将无该服务场景建模为 absent（与 `settings`、`commands`、`configEditor` 同等处理）。
  - 新期望与证据：允许可选 `agentPresets` 注入并保持所有既有 HTTP 路由、目录与脱敏断言不变。

- `plugins/plugins/omnimux/src/auth/http-routes.test.js` :: `apply mounts auth routes when webServer arrives through inject`
  - 理由：同上，HTTP-only 夹具新增对可选宿主服务 `agentPresets` 的 absent 建模。
  - 新期望与证据：所有挂载路径与 `sessionQuery` 断言保持原样并通过。

## 实施边界

仅改动预设目录 `plugins/presets/`、相关门禁脚本 `plugins/scripts/`、中枢 `plugins/plugins/omnimux/`、技能市场绑定 `plugins/plugins/omnimux-market/`、桌面设置迁移 `app/dsh-plugin-desktop/src/setup-wizard-settings.ts`（及其测试）、任务规格与交互演示；不改 `app/deepseek-harness/` 上游 submodule。

## 影响文件

- `specs/converge-agent-presets.spec.md`
- `plugins/presets/omni-agent/Agent.md`
- `plugins/presets/omni-agent/preset.yml`
- `plugins/presets/omni-agent/agent.cordis.yml`
- `plugins/presets/omni-agent/skills.json`
- `plugins/presets/manifest.json`
- `plugins/presets/README.md`
- 删除 `plugins/presets/` 下其余 39 个预设目录、`.retired/`、`fragments/`
- `plugins/scripts/build-agent-presets.mjs`
- `plugins/scripts/sync-agent-presets.sh`
- `plugins/scripts/sync-to-app.sh`
- `plugins/scripts/test-env-bootstrap.mjs`
- `plugins/scripts/verify-agent-presets.mjs`
- `plugins/scripts/verify-agent-presets.test.mjs`
- `plugins/scripts/verify-agent-presets-health.test.mjs`
- `plugins/scripts/verify-anti-slop.test.mjs`
- `plugins/plugins/omnimux/cordis.patch.yml`
- `plugins/plugins/omnimux/src/host/retired-presets.js`
- `plugins/plugins/omnimux/src/host/retired-presets.test.js`
- `plugins/plugins/omnimux/src/host/apply.js`
- `plugins/plugins/omnimux/src/client/agent-presets-i18n.js`
- `plugins/plugins/omnimux/src/client/agent-preset-enhancer.js`
- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/isTikTokAgentPreset.js`
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js`
- `app/dsh-plugin-desktop/src/setup-wizard-settings.ts`
- `app/dsh-plugin-desktop/tests/setup-wizard-settings.spec.ts`
- `ui-demo/agent-preset-menu-redesign-demo.html`

## 验证

- `node plugins/scripts/build-agent-presets.mjs`
- `corepack pnpm --dir plugins run presets:verify`
- `node plugins/scripts/verify-agent-presets.mjs`
- `node --test plugins/scripts/verify-agent-presets-health.test.mjs`
- `node --test plugins/scripts/verify-preset-skills-materialization.test.mjs`
- `corepack pnpm --dir plugins --filter omnimux build && corepack pnpm --dir plugins --filter omnimux test`
- `corepack pnpm --dir plugins --filter omnimux-market build && corepack pnpm --dir plugins --filter omnimux-market test`
- `corepack pnpm --dir plugins run verify:plugin-load`
- `cd app && corepack yarn workspace dsh-plugin-desktop test`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node scripts/workspace-check.mjs --check`
- 真实浏览器检查 `ui-demo/agent-preset-menu-redesign-demo.html`（暗/亮双主题、窄视口、收敛到 2 项对比）。
