# Issue #193: OmniMux 社媒研究预设技能包（1 数据层 + 8 工作流）

## 背景与研究依据

- 工单：[omnimux-ai/omnimux-client#193](https://github.com/omnimux-ai/omnimux-client/issues/193)
- 对标来源：`ScrapeCreators/social-media-research-skills`（MIT，仅借鉴 workflow-first 研究方法论骨架、中位数基线判爆款与诚实边界，不复制其付费 API 代码或数据）。
- 仓库现状核查（2026-11-23，`main@876ac4b3`）：
  1. `app/dsh-plugin-desktop/preset/skills/` 为 `.gitignore` 忽略的打包/预置生成目录，真实单一真源是各插件目录下的 `skills/<id>/SKILL.md` 及 `dsh.manifest.json` 的 `skills` 字段；打包/staging 时由 `app/dsh-plugin-desktop/scripts/stage-preset-profile.ts::stageSkills()` 自动复制并写入 `omnimux-skill.json`（`{ id, origin: "plugin:<name>" }`）和 `distribution.json` 摘要，启动时由 `app/dsh-plugin-desktop/src/preset-profile.ts::seedPresetSkills()` / `reconcileManagedProfile()` 写入 `$DSH_HOME/skills/`。
  2. 当前仅 5 个内置 preset skill：`omnimux`（2 个 Cordis 技能）、`omnimux-clip`（`clip-craft`）、`omnimux-market`（`sopilot-social-agents`、`tiktok-growth`）。`omnimux-market` 属于 `preview` 档位（见 `app/config/plugin-tiers.json`）且已承载社媒垂类内置技能，因此将 9 个新技能归属 `plugins/plugins/omnimux-market/skills/`（`origin: "plugin:omnimux-market"`）复用现有机制，无需新增空壳插件。
  3. **运行时工具真源对账（验收项 #3）**：逐一核对 `plugins/plugins/omnimux/src/official/mount.js`、`plugins/plugins/omnimux/src/official/social-data.js`、`plugins/plugins/omnimux/src/media/stt-mount.js`、`plugins/plugins/omnimux-video/src/index.js`、`plugins/plugins/omnimux-analytics/src/index.js` 后发现，交接草案中存在两类当前客户端运行时未内置的工具名：
     - `harvest_*`（`harvest_tiktok_user`、`harvest_tiktok_search`、`harvest_pinterest_pins`、`harvest_sites_status`、`harvest_site_login`）：`omnimux-social-harvest` 插件不在 `omnimux-client/plugins/plugins/` 中；
     - `video_breakdown_analyze`：`omnimux-video-preview` 插件不在 `omnimux-client/plugins/plugins/` 中。
     对应处理：在 9 个 `SKILL.md` 及随包 `README.md` / `TRIGGER-MATRIX.md` 中全部移除上述失效工具名，将 Pinterest 明确划入「当前无内置采集工具」边界；视频理解使用现役 `video_analyze`（`omnimux-video`），语音转写使用现役 `omnimux_speech_to_text`（`omnimux`），公开社媒采集使用现役 `omnimux_social_data` 及 18 个平台直调工具（`omnimux_{tiktok,instagram,youtube,x}_*`、`omnimux_tiktok_shop_*`），Instagram 作品流标注当前 schema 仅支持 `{ url, username }`（无翻页游标参数）。

## 假设

1. 将 9 个社媒研究预设技能合入 `plugins/plugins/omnimux-market/skills/<name>/SKILL.md`，在 `plugins/plugins/omnimux-market/dsh.manifest.json` 声明 `skills`，并同步更新 `plugins/plugins.registry.json` 与 `plugins/plugins/omnimux-market/package.json` 的 `files`（包含 `"skills"`），同时将 `README.md` 与 `TRIGGER-MATRIX.md` 随包入库在 `skills/omnimux-social-data/references/` 后，`stagePresetProfile()` 会把全部 9 个技能完整物化到 `preset/skills/<name>/`（附带 `origin: "plugin:omnimux-market"` 的 `omnimux-skill.json`）并被 `seedPresetSkills()` 写入 Harness Home 技能根目录。
2. 移除失效工具名（`harvest_*`、`video_breakdown_analyze`）并严格对齐当前已注册工具 schema 后，所有 9 个技能引用的每个具体工具名在当前工作区插件注册表中均真实存在，且不承诺未交付的评论正文、受众人口学、广告库或 Pinterest 采集能力。
3. 当用户在真实对话或运行态中分别提出「找爆款（`omnimux-outlier-post-finder`）」「拆账号（`omnimux-creator-teardown`）」与「挖评论/看受众画像/拆广告库」请求时，对应技能可按 `description` 触发词命中，使用真实公开账号数据产出符合 Output Format 且含来源 URL 与置信度的报告，并对无数据场景如实告知缺口而不编造。

## 证伪方式

1. 若 `stagePresetProfile()` + `verifyPreset()` 或 `seedPresetSkills()` 在隔离目录运行后，缺少任一技能目录、缺少 `omnimux-skill.json`、`origin` 不为 `plugin:omnimux-market`，或 `references/README.md` / `references/TRIGGER-MATRIX.md` 未随包物化，则假设 1 被证伪。
2. 若自动化工具真源校验测试（扫描 9 个 `SKILL.md` 及 `references/` 中所有具名工具标识符，并与 `plugins/plugins/` 实际注册工具集合比对）发现任意失效工具名、或任一技能 frontmatter `name` 与目录名不一致、或缺少中文触发词、或 8 个工作流技能缺少六段式结构，则假设 2 被证伪。
3. 若任一门禁检查（`pnpm --filter omnimux-market test`、`registry:verify`、`check:package-files`、`presets:verify`、`app` 下 `stage-preset-profile.spec.ts`）失败，或用真实公开账号端到端执行 2 个工作流技能无法拿到真实数据并产出合标报告，或无数据场景下出现伪造评论/人口学/广告数据，则假设 3 被证伪。

## 改动范围与交付清单

1. 新增 9 个预设技能：`plugins/plugins/omnimux-market/skills/omnimux-{social-data,outlier-post-finder,creator-teardown,transcript-intelligence,trend-discovery,competitor-research,social-listening,product-demand,content-repurposing}/SKILL.md`。
2. 随包入库说明与触发矩阵：`plugins/plugins/omnimux-market/skills/omnimux-social-data/references/README.md` 与 `TRIGGER-MATRIX.md`（公开仓合规，无本机路径或私有仓引用）。
3. 更新声明与注册表：`plugins/plugins/omnimux-market/dsh.manifest.json`、`plugins/plugins/omnimux-market/package.json`（`files` 增加 `"skills"`）、`plugins/plugins.registry.json`。
4. 新增自动化契约测试：`plugins/plugins/omnimux-market/src/presets/social-research-skills.test.js`（校验 9 技能清单、YAML frontmatter、中文触发词、六段式结构、README/TRIGGER-MATRIX 覆盖、零失效工具名）与 `plugins/scripts/verify-preset-skills-materialization.test.mjs`（跨插件运行时工具与 `SOCIAL_DATA_CATALOG` capability 真源反漂移、以及 `plugins.registry.json` 一致性校验）。
5. 本地隔离 staging/seeding 验证 + 真实公开账号端到端验证（`omnimux-outlier-post-finder` + `omnimux-creator-teardown` + 无数据场景拒绝）。
