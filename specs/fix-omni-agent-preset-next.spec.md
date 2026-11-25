# 修复 Desktop Next 缺失 omni-agent 预设声明致新建会话报 agent-preset/not-found

## 背景

在桌面端切换至 `dsh-desktop-next`（DSH `0.2.2-rc.5`）后，打开应用并尝试新建会话时顶部弹出：

`新建会话失败：agent-preset/not-found: Unknown agent preset: omni-agent`

同时输入框下方的 Agent 选择器仅剩 DSH 上游原生的「创建 Agent」（`cordis`）。

根因链路有三层：

1. **缺失 `omni-agent` 声明行**：此前 `omni-agent` 仅由旧壳 `app/dsh-plugin-desktop` 在启动期通过 `composeShippedAgentPresetRows()` 从 `preset/agent-presets/` 注入 `@deepseek-ai/dsh-agent-preset` 行；而 `plugins/plugins/omnimux/cordis.patch.yml` 在关闭上游 `preset-standard`、`preset-ptc`、`preset-minimal` 并将 `agent-preset-registry.config.default` 设为 `omni-agent` 时，并未自行声明 `omni-agent`。切换到 `dsh-desktop-next` 后，`agentPresets` 仅注册了上游 `cordis`，默认及已选预设 `omni-agent` 查无此项。
2. **新装 `dsh-desktop-next` Profile 的 bundle 顺序颠倒**：`app/dsh-desktop-next/src/profiles.ts` 的 `WEB_BUNDLES` 将 `OMNIMUX_PRODUCT_BUNDLES` 排在 `PROFILE_TEMPLATES.web.bundles`（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）之前，导致 `omnimux/cordis.patch.yml` 对 `preset-standard`/`preset-ptc`/`preset-minimal`、`agent-preset-registry`、`llm-pi-ai`、`skill-filesystem` 的按 `id` 覆写早于目标行插入而被静默跳过（升级后的 `omnimux` Profile 因 `next-profile-upgrade.ts` 先排核心包再排产品包而命中关闭，直接触发 `omni-agent` 缺失报错）。
3. **预设组合含 DSH `0.2.2-rc.5` 已移除的子路径导出**：`plugins/presets/omni-agent/agent.cordis.yml`（由 `plugins/scripts/build-agent-presets.mjs` 生成）及兄弟路径 `plugins/plugins/omnimux-market/src/expert-runtime.ts` 均仍引用 `@deepseek-ai/dsh-tool-subagent-control/list-agents`。该子路径在 DSH `0.2.2-rc.5` 已并入主入口 `@deepseek-ai/dsh-tool-subagent-control`（`exports` 不再导出 `./list-agents`），导致声明挂载时因 `ERR_PACKAGE_PATH_NOT_EXPORTED` 使整个预设变成 `broken`（`agent-preset/invalid`）；且 `omnimux-market` 侧 `pluginPackages.packageOf` 仅解析裸包名，未能筛掉该失效子路径。

## 目标

1. **遵循 DSH 原生声明式预设架构，由 `omnimux` bundle 声明 `omni-agent`**：
   - 保持 `plugins/presets/omni-agent/{Agent.md,preset.yml}` 为单一真源；
   - `plugins/scripts/build-agent-presets.mjs` 把 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行保留为**按已安装包 export map 条件启用**（rc.3 该子路径存在且是 `list_agents` 的唯一注册点；rc.5 已并入主入口并移除子路径，行自动 `disabled`），并幂等生成 `plugins/presets/omni-agent/agent.cordis.yml` 与 `plugins/plugins/omnimux/presets/omni-agent.patch.yml`（标准 `@deepseek-ai/dsh-agent-preset` 声明，与 `@deepseek-ai/dsh-web-app/presets/*.patch.yml` 同构）；
   - `plugins/plugins/omnimux/package.json` 将 `dsh.bundle.patch` 设为 `["./cordis.patch.yml", "./presets/omni-agent.patch.yml"]`，并在 `files` 与 `exports` 声明 `presets` 与 `./presets/*.patch.yml`；
   - `plugins/scripts/verify-package-files.mjs` 支持 `dsh.bundle.patch` 为字符串或数组，确保每个声明的补丁文件都落盘并受 `files` 白名单覆盖。
2. **修正 `dsh-desktop-next` 的 `WEB_BUNDLES` 顺序并兼容旧壳/隔离脚本防重**：
   - `app/dsh-desktop-next/src/profiles.ts` 将 `WEB_BUNDLES` 调整为 `[...new Set([...PROFILE_TEMPLATES.web!.bundles, ...OMNIMUX_PRODUCT_BUNDLES])]`，使 `omnimux` 与产品插件补丁始终叠加在 `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` 之后；
   - `app/dsh-plugin-desktop/src/profile.ts` / `agent-preset-rows.ts` 及 `plugins/scripts/host-runtime-layout.mjs` 跳过已由 bundle 声明的预设 ID，避免在旧壳或隔离脚本中与 `omnimux` 重复注册 `omni-agent`。
3. **修复兄弟路径 `omnimux-market`**：
   - `plugins/plugins/omnimux-market/src/expert-runtime.ts` 同样按完整 specifier 的真实解析结果决定是否挂 `list-agents` 行（`host.ts` 提供 `resolvesSpecifier`），rc.5 不挂、rc.3 保留；`packageOf` 只认裸包名，不能用来判断子路径导出。

## 非目标

- 不修改 `app/deepseek-harness/` 上游 submodule 源码。
- 不改变 `omni-agent` 的产品人格文案、默认工具策略或 `retired-presets.js` 退役重定向语义。
- 不改动未授权的 Prod 环境（`~/.omnimux` / 正式发布）。

## 研究依据

- 上游 `app/deepseek-harness/packages/bundle/web-app/package.json` 与 `README.md` 明确规定：bundle 通过 `dsh.bundle.patch` 数组按序声明 `cordis.patch.yml` 及 `presets/<id>.patch.yml`，每个预设文件插入一条 `@deepseek-ai/dsh-agent-preset` 行；`app/dsh-desktop-next/src/profiles.ts` 的 `applyProfileLocalBundleOverrides()` 与 `app/dsh-plugin-desktop/src/profile.ts` 均原生通过 `bundlePatchPaths()` 支持数组形式。
- 上游 `app/deepseek-harness/packages/subagent/tool-subagent-control/package.json` 与 `src/index.ts` 证实 DSH `0.2.2-rc.5` 已在主入口直接调用 `registerListAgents(ctx)`，并移除了 `./list-agents` 导出。
- 实测脚本验证 `app/dsh-desktop-next` 打包产物 `app.asar` 与依赖树中，`omni-agent` 其余 23 项插件包全部可解析且 schema 合法，唯独 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

## 假设

当 `omnimux` bundle 按 DSH 原生契约随包声明 `./presets/omni-agent.patch.yml`（`./list-agents` 行按宿主 export map 条件启用），且 `dsh-desktop-next` 的 `WEB_BUNDLES` 将上游基础 bundle 置于产品插件之前、旧壳与隔离脚手架跳过已由 bundle 声明的预设 ID、并同步清理 `omnimux-market` 兄弟路径后：
- 无论是升级自旧壳的 `profiles/omnimux`（经 `omnimux:sync` 物化覆盖即可生效）还是全新初始化的 `dsh-desktop-next` Profile，`agentPresets` 都会健康挂载 `omni-agent`（`broken === undefined`、`isDefault === true`）与 `cordis`；
- 新建会话默认使用 `omni-agent` 正常创建，不再出现 `agent-preset/not-found` 或 `agent-preset/invalid`；
- 旧壳 `dsh-plugin-desktop` 与 `host-runtime-layout` 不产生重复预设 ID 冲突。

## 证伪方式

1. **主缺陷双向证伪**：在真实 `dsh-desktop-next` Host（`verify-host.mjs` / 集成测试）中，移除 `omnimux/presets/omni-agent.patch.yml` 声明后，调用 `agentPresets/list` 缺失 `omni-agent` 且以默认/显式 `omni-agent` 创建会话抛出 `agent-preset/not-found: Unknown agent preset: omni-agent`；恢复声明后，`agentPresets/list` 精确返回 `[omni-agent (default, healthy), cordis]`，且 `session/create` 成功。
2. **DSH 版本兼容证伪**：若把 `list-agents` 行改成无条件启用，rc.5 宿主会因 `ERR_PACKAGE_PATH_NOT_EXPORTED` 让整份预设 `broken`；若改成无条件删除，rc.3 壳会丢失 `list_agents` 工具。条件启用后 rc.5 的 `omni-agent` 与市场专家 `broken === undefined`，且 rc.3 的 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 仍可解析并注册。
3. **新装顺序证伪**：若 `WEB_BUNDLES` 仍将 `omnimux` 置于 `@deepseek-ai/dsh-web-app` 之前，全新 `NextProfiles.ensure('desktop')` 组合后 `preset-standard` 仍保持启用且 `agent-preset-registry.config.default` 仍为 `standard`；调整顺序后 `preset-standard`/`ptc`/`minimal` 均为 `disabled: true` 且 `default === 'omni-agent'`。
4. **旧壳防重证伪**：在 `dsh-plugin-desktop` 与 `host-runtime-layout` 回归测试中，当 bundle 层已声明 `omni-agent` 时，壳侧/脚本不再二次插入重复的 `omnimux-preset-omni-agent` 行。

## 验收标准

- `node plugins/scripts/build-agent-presets.mjs` 幂等生成 `plugins/presets/omni-agent/agent.cordis.yml` 与 `plugins/plugins/omnimux/presets/omni-agent.patch.yml`；两者都保留 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行，且带 `!!js` 条件 `disabled`（rc.3 解析成功则启用、rc.5 无该导出则禁用）。
- `plugins/plugins/omnimux/package.json` 声明 `dsh.bundle.patch: ["./cordis.patch.yml", "./presets/omni-agent.patch.yml"]`，`files` 包含 `"presets"`，`exports` 包含 `"./presets/*.patch.yml"`，通过 `verify-package-files.mjs`、`verify-models.mjs`、`verify-plugin-load.mjs`、`presets:verify` 与 `workspace-check.mjs --check`。
- 真实 `dsh-desktop-next` Host 冒烟与回归测试通过：`agentPresets/list` 仅返回健康的 `omni-agent`（默认）与 `cordis`，默认 `session/create` 成功，`list_agents` 工具由主包 `@deepseek-ai/dsh-tool-subagent-control` 正常提供。
- `app/dsh-desktop-next`、`app/dsh-plugin-desktop`、`plugins/plugins/omnimux`、`plugins/plugins/omnimux-market` 及受影响门禁测试全绿。
- 合入 `main` 后，共享 Dev 经 `omnimux:sync` + `omnimux:restart dev` 重载并验证 `omni-agent` 可见且新建会话成功。

## 实施要点

- 新增 `plugins/plugins/omnimux/presets/omni-agent.patch.yml`（由 `build-agent-presets.mjs` 从 `Agent.md` + `preset.yml` 生成），`omnimux` 的 `dsh.bundle.patch` 改为 `["./cordis.patch.yml", "./presets/omni-agent.patch.yml"]`，`files` 增列 `presets`，`exports` 增列 `./presets/*.patch.yml`。
- `plugins/scripts/build-agent-presets.mjs` 把 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行改为按宿主 export map 条件启用（`dsh-tool-subagent-control` 主入口在 rc.5 已包含 `registerListAgents`，rc.3 仍依赖该子路径），并同时生成两份产物。
- `plugins/scripts/verify-package-files.mjs` 支持 `dsh.bundle.patch` 为字符串或数组，逐项校验落盘与 `files` 覆盖。
- `plugins/scripts/test-env-bootstrap.mjs` 的 `agentPresetPatchText` 接收隔离 profile 的真实目录：`profileBundlePresetDirectories()` 从 `<profile>/node_modules/<bundle>/presets` 收集已安装 bundle 的声明并跳过重复；`host-runtime-layout.upstreamPresetIds` 不再扫描宿主 App 根（旧壳在 `preset/plugins`、新壳在 app.asar 内，均不存在该路径），改为由调用方传入真实目录。
- `app/dsh-desktop-next/src/profiles.ts` 的 `WEB_BUNDLES` 改为「上游 core 在前、产品 bundle 在后」。
- `app/dsh-plugin-desktop/src/agent-preset-rows.ts` 增加 `declaredPresetIds`，`src/profile.ts` 在合成前收集当前组合已声明的 `@deepseek-ai/dsh-agent-preset` id 并跳过。
- `plugins/scripts/host-runtime-layout.mjs` 的 `upstreamPresetIds` 同时扫描上游 `dsh-web-app/presets` 与随包 `omnimux/presets`。
- `plugins/plugins/omnimux-market/src/expert-runtime.ts`（及其提交的 `lib/expert-runtime.js` 构建产物）去掉同一失效子路径行。

## 验证证据（本机实测，2026-11-25）

| 检查 | 命令 | 结果 |
|---|---|---|
| 真实 Host 预设名册 + 默认会话创建 | `cd app && corepack yarn workspace dsh-desktop-next verify:host` | 通过；日志 `verify-host: OmniMux converged preset roster (omni-agent default + native cordis) and default session creation passed` |
| 桌面 Next 全量单测 | `cd app && corepack yarn workspace dsh-desktop-next test` | 165 文件 / 1466 通过 |
| 壳单测 | `cd app && corepack yarn workspace dsh-plugin-desktop test` | 175 文件 / 2139 通过（先执行 `dsh-plugin-desktop build` 以生成 `lib/`，属历史基线前置；含新增 `tests/agent-preset-rows.spec.ts`） |
| 桌面 typecheck | `cd app && corepack yarn typecheck` | 通过（`contract-types` 4 个类型文件为当前版本） |
| 插件单测 | `corepack pnpm --dir plugins --filter omnimux test` / `--filter omnimux-market test` | 84 / 全部通过 |
| 预设门禁 | `corepack pnpm --dir plugins run presets:verify` | 16 通过 |
| 插件门禁 | `presets:verify` + `verify:models` + `check:boundaries` + `verify:product-baseline` + `verify:plugin-load` | 全部通过（`15/15 package(s) passed plugin load check`） |
| 工作区元数据 | `node scripts/workspace-check.mjs` | 通过（`bundle.lock.json` 14 插件一致） |
| 脚本单测 | `node --test plugins/scripts/{host-runtime-layout,verify-package-files,verify-agent-presets-health,test-env-bootstrap*}.test.mjs` | 95 通过 |

### 双向证伪（回退修复即红，恢复即绿）

1. 把 `plugins/plugins/omnimux/presets/omni-agent.patch.yml` 临时改为 `[]` 后重跑 `verify:host`：真实 Host 的 `session/create` 返回
   `{"ok":false,"error":{"code":"agent-preset/not-found","message":"Unknown agent preset: omni-agent","details":{"agentPreset":"omni-agent","available":["cordis"]}}}`，与用户截图症状一致；恢复文件后同一脚本通过。
2. 把 `WEB_BUNDLES` 顺序改回产品 bundle 在前：`tests/profiles.spec.ts :: orders core DSH bundles before OmniMux bundles ...` 失败（`expected 12 to be less than 1`）；恢复后 55 项通过。
3. 让 `host-runtime-layout.mjs` 只扫描上游预设目录：`omnimux bundle 已声明 omni-agent 时，composeAgentPresetRows 跳过重复合成` 失败；恢复后 44 项通过。
4. 去掉 `composeShippedAgentPresetRows` 的 `declaredPresetIds` 跳过：`tests/agent-preset-rows.spec.ts :: declares a shipped preset only while no active bundle already declares it` 失败（`expected [ { …(3) } ] to deeply equal []`）；恢复后通过。
5. 把 `omni-agent.patch.yml` 的 `list-agents` 行改成无条件 `disabled: false` 后在 rc.5 宿主重跑 `verify:host`：日志出现 `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './list-agents' is not defined by "exports"`，预设挂载失败；恢复条件表达式后通过。
6. 直接对比两代宿主解析结果：rc.5（`app/dsh-desktop-next/node_modules`）对 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，主入口文件含 5 处 `list_agents`；rc.3（`app/dsh-plugin-desktop/node_modules`）该子路径可解析且 `lib/types/list-agents.js` 含 5 处 `list_agents`，主入口 0 处。证明条件启用同时满足两条 DSH 线。
7. 隔离 profile：`agentPresetPatchText` 在 profile 的 `node_modules/omnimux/presets` 存在时返回空串（不再写重复声明），不存在时仍声明 `omnimux-preset-omni-agent`；对应 `test-env-bootstrap-fresh.test.mjs` 用例双向覆盖。
