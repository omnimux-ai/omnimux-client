# OmniMux 出厂 Agent Presets

顶部会话模式已收敛为 **2 项可见预设**（单一默认内容电商 Agent + DSH 原生创造模式）：

| id | 显示名（中 / 英） | order | 来源 | 说明 |
|---|---|---|---|---|
| `omni-agent` | OmniMux（默认） | 1 | `plugins/presets/omni-agent/` | 唯一默认内容电商与跨境运营 Agent；英文版 `Agent.md` 为单一指令真源，完整标准工具栈，按需加载领域 Skill 与通用子代理。 |
| `cordis` | 创建Agent / Create Agent | 2 | DSH 上游原生 (`@deepseek-ai/dsh-web-app`) | DSH 原生创造模式，用于插件实验开发、运行时检查与自定义 Agent 搭建。 |

## 收敛架构与兼容机制

1. **产品真源极简化**：本目录仅维护 `omni-agent/`（含 `Agent.md`、`preset.yml`、`agent.cordis.yml`、`skills.json`）、`manifest.json` 与本说明；`scripts/build-agent-presets.mjs` 将 `omni-agent/{Agent.md,preset.yml}` 幂等同步至 `omni-agent/agent.cordis.yml` 与中枢声明补丁 `plugins/plugins/omnimux/presets/omni-agent.patch.yml`（随 `omnimux` bundle 的 `dsh.bundle.patch` 数组分发）。
2. **上游非创造模式停用**：`plugins/plugins/omnimux/cordis.patch.yml` 停用上游 `preset-standard`、`preset-ptc`、`preset-minimal`，并将 `agent-preset-registry.config.default` 设为 `omni-agent`，仅保留上游 `preset-cordis`；`app/dsh-desktop-next/src/profiles.ts` 的 `WEB_BUNDLES` 保证 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 先于产品插件加载，使中枢覆盖与 `omni-agent` 声明在全新与升级 Profile 中均生效。
3. **领域能力归位 Skill**：TikTok/Instagram/YouTube/X 运营、爆款拆解复刻、电商商详套图、跨境多语言广告与专业剪辑全部作为 Skill 按需驱动，不再按平台或子角色拆成多个 Agent 预设，也不再维护 26 个静态 `expert-*` 子代理目录。
4. **老会话与存量设置兼容（零选择器污染）**：
   - 不再在 `presets/` 物理留存历史别名目录（避免 DSH `agent-preset-registry` 将其暴露到下拉选择器）；
   - 运行时由中枢 `plugins/plugins/omnimux/src/host/retired-presets.js` 对 `manifest.json` 登记的 `retiredPresetRedirects`（及 `expert-*`）执行透明重定向至 `omni-agent`，保证历史会话恢复与冷历史读取不报 `agent-preset/not-found`，同时 `list()` / `remoteExportList()` 严格仅返回 2 项；
   - 桌面端启动期由 `app/dsh-plugin-desktop/src/setup-wizard-settings.ts` 自动将旧配置中的退役 `selectedDefault` 迁移至 `omni-agent`，保留用户自定义预设不受影响。
