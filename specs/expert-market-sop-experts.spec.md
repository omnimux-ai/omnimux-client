# Expert Market True-State Runtime & Cross-Border E-commerce SOP Built-in Experts

## 背景与研究依据

- **问题根因核查（仓库基线 `origin/main@960a8dc0`）**：
  1. DSH 0.1.7+ 已移除基于 `$DSH_HOME/.agent-presets/` 目录扫描的 `@deepseek-ai/dsh-agent-presets` 插件，Agent 预设唯一权威注册入口是官方 `ctx.agentPresets` 服务（声明行或动态 `ctx.agentPresets.register(definition)`），见 `app/dsh-plugin-desktop/src/agent-preset-rows.ts` 与 `app/deepseek-harness/packages/preset/agent-preset-registry/src/index.ts`。
  2. `omnimux-market` 原实现存在三重失真：
     - `DEFAULT_MARKET_EXPERTS` 与前端 `plazaUtils.js` 将 4 位旧平台专家 `initialStatus` 硬编码为 `'enabled'`，并在插件激活时调用 `materializeEnabledMarketExperts()` 往已废弃的 `.agent-presets/` 目录写入空壳文件；
     - `reconcileMarketExperts()` 聚合官方 `ctx.agentPresets.list()` 时只升不降，对不在官方注册表中的市场专家仍按旧目录 / `initialStatus` 展示为 `[ 已入职 ]`，且将系统预置（`omni-agent`、`cordis`）状态标成 `enabled` 导致误显「禁用」按钮，同时 `cordis` 缺失 `SYSTEM_PRESET_METADATA` 导致卡片裸显英文 ID；
     - 点击安装/禁用仍只操作 `.agent-presets/`，并且 `host.ts` 广播事件命名空间为旧名 `'agent-presets'`，而 DSH 0.1.7+ 客户端 `ui-agent-preset` 监听的是 `AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'`，导致前端会话预设选择器无法实时刷新。
  3. 原市场 5 位专家按平台横向切分，3 位仅有一句占位模板人设，且 `youtube-creator-expert` 与 `media-creator` 残留历史第三方（Topview）文案。

- **对标研究与取舍**：
  - 参考项目：`heqiangdiao-wq/AI-Cross-Border-Ecommerce-Agent-Toolkit`（基于跨境电商实操 SOP 拆分为分析簇 01-02、创意簇 03-05、运营簇 06-07 共 7 环节）。
  - 吸收核心工程方法论：① 算术与合规质检交由确定性脚本执行，禁止模型心算；② 单一参数真源（`spec_table`）+ 跨环节硬阻塞契约；③ 合规红线（禁用绝对化用语、未授权品牌、虚假功效与灰产手段）；④ 广告与评论数据按漏斗/归因定向回流到具体 Listing 字段或单张素材；⑤ 不代操作广告/卖家后台，只输出分级审批清单。
  - 结合 OmniMux 差异化取舍：不按平台（Shopee/Amazon/TikTok/ML）复制多套同名专家，而是按 **电商 SOP 职能拆 8 位内置专家 + 1 个共享平台规则与合规 Skill + 7 个含确定性 Python 脚本的领域 Skill**，充分串联 OmniMux 现役商品库（`products_*`）、资产/数字人（`assets_*`/`avatar_*`）、灵感 5D 拆解（`inspiration_*`）、无限画布（`workflow_*`）与剪辑工坊（`clip_*`），同时如实声明 `omnimux-accounts`/`omnimux-publish`/`omnimux-analytics` 的当前档位边界。

## 假设

1. 将市场专家状态判定改为以 `ctx.agentPresets.list()` 为唯一运行态真源，配合 `$DSH_HOME/omnimux-market/installed-experts.json` 账本与 `ExpertPresetRuntime`（动态调用 `ctx.agentPresets.register()` / `unregister()`，绑定 Host `root.baseUrl`，安装后复核 `broken` 并回滚失败挂载，广播 `settings/document-updated` 命名空间 `'agent-preset-registry'`），可彻底消除「假已入职」，并实现安装即进会话下拉、禁用即移除、重启仅恢复已安装项。
2. 将系统预置（`omni-agent`、`cordis`）状态设为 `'system'`、用户自建设为 `'custom'`、8 位新 SOP 市场专家默认 `'available'` 且在后端拒绝禁用非市场预设，同时将旧 4 位专家 ID 并入 `retired-presets.js` 与 `presets/manifest.json`（并对已禁用的 `ecom-*` 市场专家在 `agent-preset/not-found` 时透明回退 `omni-agent`），可在保持 `shippedPresets` 严格 2 项白名单的前提下保证历史会话永不死锁。
3. 将 8 位 SOP 专家与 8 个随包 Skill（含 7 个纯 Python 3 标准库优先、零额外 `pip install` 依赖的确定性计算/质检脚本）入库 `plugins/plugins/omnimux-market/skills/` 并同步 `dsh.manifest.json` 与 `plugins.registry.json`，同时更新中枢双语文案与像素头像映射，可实现全链路可用且全部静态门禁与单测通过。

## 证伪方式

1. 若全新环境或存在遗留 `~/.omnimux-dev/.agent-presets/` 目录时，专家市场仍把未注册专家标为 `[ 已入职 ]`，或系统预置显示「禁用」按钮 / `cordis` 裸显英文名，或安装后 `ctx.agentPresets.list()` 不包含对应健康预设、禁用后未移除、或 `broken` 挂载未被回滚，则假设 1 证伪。
2. 若 `presets/manifest.json` 的 `shippedPresets` 偏离 2 项白名单、或历史会话命中已退役/已禁用专家时抛出 `agent-preset/not-found`、或已安装专家被错误重定向回 `omni-agent`，则假设 2 证伪。
3. 若任一 Python 确定性脚本在系统 `python3`（无第三方库）下执行失败或算术/边界测试不通过、任一 Skill 缺失声明/引用死工具/残留 Topview 文案或本机路径、或 UI 门禁（亮/暗主题、窄屏、无硬编码颜色、无冗余状态 Toast）未通过，则假设 3 证伪。

## 改动范围与交付清单

1. **演示与规范**：`specs/expert-market-sop-experts.spec.md`、`ui-demo/expert-market-sop-experts-demo.html`。
2. **动态注册与真状态后端（`omnimux-market`）**：
   - 新增 `src/expert-ledger.ts`（账本原子读写与损坏降级告警）；
   - 新增 `src/expert-runtime.ts`（`ctx.agentPresets.register()` 动态构建完整 Agent-plane 组合、健康检查回滚、卸载与启动恢复）；
   - 重构 `src/expert-market.ts`（8 位 SOP 专家阵容与结构化 Persona、全 `available` 初值、`SYSTEM_PRESET_METADATA` 补齐 `omni-agent`/`cordis`、`reconcileMarketExperts` 真源聚合）；
   - 更新 `src/local-api.ts` 与 `src/host.ts`（异步安装/禁用接口、非市场预设禁用拦截、广播命名空间修正为 `'agent-preset-registry'`、移除启动自动物化 `.agent-presets/`）。
3. **中枢适配（`omnimux` & `presets`）**：
   - 更新 `plugins/presets/manifest.json` 与 `plugins/plugins/omnimux/src/host/retired-presets.js`；
   - 更新 `plugins/plugins/omnimux/src/client/agent-presets-i18n.js` 与 `agent-preset-enhancer.js`（清理 Topview，补全 8 位专家中英双语与像素头像映射）。
4. **专家市场前端 UI（`omnimux-market/src/client/`）**：
   - 更新 `plaza/plazaUtils.js`、`plaza/usePlazaFilter.js`、`plaza/ExpertCard.jsx`、`skill-plaza.js`、`css.js`、`i18n.js`（SOP 阶段筛选、真状态徽章、系统/自建无禁用钮、安装失败内联可恢复错误提示、遵循 Show Don't Tell 与 `--dsw-*` 语义 Token）。
5. **8 个随包 SOP Skill + 7 个确定性 Python 脚本**：
   - `plugins/plugins/omnimux-market/skills/omnimux-ecom-{platform-rules,market-research,pricing-strategy,listing-copy,visual-qa,video-script,ads-diagnosis,review-voc}/`；
   - 同步 `plugins/plugins/omnimux-market/dsh.manifest.json` 与 `plugins/plugins.registry.json`。
6. **测试与门禁验收**：更新及新增单测、E2E、Python `unittest`、Skill 契约校验，跑通全部门禁并在隔离真实浏览器验收。

## 旧标准变更

由于本次任务将专家市场由旧版「5 位按平台拆分（含 4 位硬编码 `enabled` 及 Topview 文案残留）」升级为「8 位按跨境电商 SOP 闭环分工（全部默认 `available`，以官方 `ctx.agentPresets.list()` 为唯一真源）」，以下既有 E2E 用例名称及断言随新产品契约更新：

- `plugins/plugins/omnimux-market/tests/e2e/expert-market-avatars.spec.js` :: `E2E 专家市场卡片头像渲染：精简后的 5 位出海专家均以确定性像素小人展示且与卡片渲染 1:1 一致`
  - 原断言：校验旧 5 位平台专家列表长度与像素头像渲染。
  - 变更理由：旧 5 位含 Topview 残留且按平台冗余拆分的专家已替换为 8 位跨境电商 SOP 专家，且默认状态由硬编码 `enabled` 收敛为 `available`。
  - 新期望证据：同文件新用例 `E2E 专家市场卡片头像渲染：8 位 SOP 电商专家均以确定性像素小人展示、无 Topview 残留且默认可聘用` 覆盖全部 8 位专家像素头像、零 Topview 残留、默认 `available` 与 SOP 阶段标签渲染，已通过 `pnpm --filter omnimux-market test`。
- `plugins/plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js` :: `E2E 旅程一：出海专精专家收敛为 5 位，彻底杜绝 HTML 生成器与双胞胎冗余`
  - 原断言：断言 `DEFAULT_MARKET_EXPERTS.length === 5` 及旧 5 位平台专家 ID。
  - 变更理由：市场内置专家库升级为 8 位跨境电商 SOP 角色并新增 SOP 阶段筛选。
  - 新期望证据：同文件新用例 `E2E 旅程一：跨境电商 SOP 专家库包含 8 位角色，全部默认可聘用且支持按 SOP 阶段筛选` 验证 8 位 ID、阶段筛选（research 2 / production 3 / growth 3）与检索过滤，已通过 `pnpm --filter omnimux-market test`。
- `plugins/plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js` :: `E2E 旅程二：官方系统团队与用户自建 Agent 动态聚合至专家市场全息视图`
  - 原断言：断言旧系统预设（`standard`/`tiktok-agent`/`drama-agent`）聚合后 `status === 'enabled'`。
  - 变更理由：系统预置与用户自建在市场中标为 `enabled` 会误显「禁用」按钮；现收敛为 `omni-agent`/`cordis` 标 `status: 'system'`、用户自建标 `status: 'custom'`，均不渲染禁用按钮。
  - 新期望证据：同文件新用例 `E2E 旅程二：官方系统预置、已入职市场专家与用户自建 Agent 真源聚合，系统预置不渲染禁用按钮` 与 `E2E 旅程三：安装失败时前端回滚卡片状态并记录可恢复错误信息`，已通过 `pnpm --filter omnimux-market test`。

