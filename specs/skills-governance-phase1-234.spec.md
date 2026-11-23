# Issue #234: Phase 1 — 移除与 DSH 上游重名的旧版 Cordis 技能并清理 `catalog/skills/` 未上架孤儿目录

## 背景与研究依据

- 追踪总单：[omnimux-ai/omnimux-client#233](https://github.com/omnimux-ai/omnimux-client/issues/233)
- 本阶段工单：[omnimux-ai/omnimux-client#234](https://github.com/omnimux-ai/omnimux-client/issues/234)
- 仓库现状核查（`main@0f9a9f7c`）：
  1. **与 DSH 上游重名错版**：`plugins/plugins/omnimux/skills/{cordis-plugin-development,editing-cordis-compositions}/SKILL.md` 为早期上游拷贝，经 `plugins/plugins/omnimux/dsh.manifest.json` 声明后会被桌面打包链路落盘至全局 `$DSH_HOME/skills/`；但 DSH 上游 `@deepseek-ai/dsh-agent-preset/skills/` 已原生内置新版并精确限域在 Creator 模式（`cordis`），且 `plugins/presets/omni-agent/agent.cordis.yml` 明确规定默认 Agent 不承担插件与 Cordis 组合开发。
  2. **`catalog/skills/` 中存在 28 个未纳入 `catalog/index.json` 技能表的目录**：
     - **13 个早期简版占位**（317–863B，无实质可执行指令，且未在运行时被任何目录项读取）：`content-creation-team`、`content-creator`、`growth-hacker`、`invest-analysis-team`、`legal-consult-team`、`mp-cover-design`、`product-manager`、`software-dev-team`、`stock-research`、`tencent-wj`、`web-access`、`wecom-drive`、`xiaohongshu-ops`（`exp-content-creator` 与 `exp-growth-hacker` 在 `catalog/index.json` 中指向远程 git `experts/...`，不依赖此目录）。
     - **1 个生产目录中的测试桩**：`esc-demo-note`（312B），仅被 `plaza-tools.test.ts`、`connector-tools.test.ts`、`local-api-search.test.ts` 使用，随生产包分发不合理。
     - **1 个 Git 符号链接重复副本**：`catalog/skills/replicate-viral-video` 是指向 `viral-video-replication` 的符号链接（mode `120000`），导致同一技能出现两份目录入口并在 Windows 无 symlink 环境下存在检出断裂风险。
     - **13 个有完整内容的自研随包技能**：`ad-creative`、`bggg-data-amazon`、`character-scene-storyboard`、`cinematic-motion-language`、`clip-export`、`content-strategy`、`dynamic-poster`、`ecommerce-image`、`hypit-setup`、`kling-global-ad-localizer`、`replicate-viral-video`、`social-caption`、`stickman-video-director`，此前缺乏显式登记，无法与孤儿目录区分。

## 假设

1. 移除 `plugins/plugins/omnimux/skills/{cordis-plugin-development,editing-cordis-compositions}` 及其在 `dsh.manifest.json` / `plugins.registry.json` 中的声明后，所有产品插件均不再与 DSH 上游 `@deepseek-ai/dsh-agent-preset/skills/` 存在技能重名冲突，且 `omnimux`、`omnimux-market` 单测与预设校验全部通过。
2. 删除 13 个早期占位、将 `esc-demo-note` 移出生产目录（改为测试自带临时夹具或真实已上架技能）、将 `replicate-viral-video` 符号链接转为真实物理目录并收敛 `viral-video-replication` 重复引用、同时用 `catalog/bundled-skills.json` 显式登记 13 个随包自研技能后，`catalog/skills/` 达到零符号链接、零未认领孤儿目录、零逐字节重复副本。
3. 新增 `plugins/scripts/verify-skill-hygiene.mjs` 与 `plugins/scripts/verify-skill-hygiene.test.mjs`，接入 `plugins/package.json` 的 `test:gates` 与 `plugins/scripts/governance-manifest.json`，能够稳定拦截上述 4 类退化并支持双向证伪。

## 证伪方式

1. 若任一产品插件 `skills/` 目录或 `dsh.manifest.json` 仍包含上游 `@deepseek-ai/dsh-agent-preset/skills` 同名技能，则 `verify-skill-hygiene` 与 `verify-preset-skills-materialization.test.mjs` 必须断言失败。
2. 若 `catalog/skills/` 出现任意符号链接、未被 `index.json` 或 `bundled-skills.json` 认领的孤儿目录、两份清单重叠条目、指向不存在目录的悬空登记，或逐字节重复的 `SKILL.md`，则 `verify-skill-hygiene` 必须断言失败。
3. 若构建（`corepack pnpm --dir plugins run build:all`）、插件单测（`omnimux`、`omnimux-market`）、`registry:verify`、`presets:verify`、`test:gates` 任一未通过，则本阶段不可合入。

## 改动范围与交付清单

1. 删除 `plugins/plugins/omnimux/skills/{cordis-plugin-development,editing-cordis-compositions}`，更新 `plugins/plugins/omnimux/dsh.manifest.json` 与 `plugins/plugins.registry.json`。
2. 清理 `plugins/plugins/omnimux-market/catalog/skills/` 中的 13 个早期占位与 `esc-demo-note`，并更新 `plaza-tools.test.ts`、`connector-tools.test.ts`、`local-api-search.test.ts`。
3. 消除符号链接 `catalog/skills/replicate-viral-video`，将其收敛为规范物理目录（`name: replicate-viral-video`），清理 `presets/omni-agent/skills.json` 与 `catalog/preset-skills.json` 中的 `viral-video-replication` 重复项并对齐 `i18n.js`。
4. 新增 `plugins/plugins/omnimux-market/catalog/bundled-skills.json` 登记 13 个非市场随包技能。
5. 更新 `plugins/scripts/verify-preset-skills-materialization.test.mjs` 与 `plugins/scripts/verify-agent-presets.test.mjs`；新增 `plugins/scripts/verify-skill-hygiene.mjs` 与 `plugins/scripts/verify-skill-hygiene.test.mjs`，登记至 `plugins/scripts/governance-manifest.json` 并接入 `plugins/package.json` 的 `test:gates`。
