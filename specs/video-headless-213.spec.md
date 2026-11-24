# omnimux-video 视频理解迁入 Skill 真源与 headlessSkill 结构化契约（Issue #213）

## 背景与目标

`omnimux-video` 的 `video_analyze` / `video_reverse_prompt` 仍是旧模型：私有 `prompts/*.md` 文件加载器提供系统提示词，模型返回自由 Markdown，插件再靠 `<<<PROMPT>>>` 标记块与正则解析。这违反 [后台无头技能执行契约](../../plugins/docs/contracts/headless-skill-execution.md)：提示词必须以 DSH 原生 `ctx.skills` 为单一真源，后台执行必须经 Hub `headlessSkill`，输出必须是 JSON Schema 强契约。

目标：把五维拆解与 I2V 反推方法论迁入插件自带 `skills/`，通过 `ctx.skills.registerProvider`（rank 600）自动注册；两个工具改走 `ctx.get('headlessSkill')` 并声明严格 JSON Schema；保留 `dest` 落盘与工具返回字段兼容。

## 范围

- 新增 `plugins/plugins/omnimux-video/skills/video-analyze/SKILL.md` 与 `skills/video-reverse-prompt/SKILL.md`（带插件域前缀，避免与市场目录技能重名）。
- 新增 `src/understand/skills.js`（加载 + rank 600 provider 注册）、`src/understand/schemas.js`（两个 JSON Schema 与 Markdown 投影）、`src/understand/seam.js`（headlessSkill 解析与绝对路径落盘）。
- 重写 `src/understand/analyze.js`、`src/understand/reverse.js`：经 `headlessSkill.run` 执行，消费 `data` 结构化结果，`dest` / `appendix_dest` 仍写旧格式文件。
- 删除 `src/understand/prompts.js`、`prompts/`、`src/understand/parse-tags.js` 及其测试（私有提示词加载器与 Markdown 标记块解析不再存在）。
- 收敛 `src/understand/pack-video.js`：保留路径/扩展名/存在性校验，移除本地视频体积上限，超大素材由 Hub `headlessSkill` 统一准备（`headless-skill-transport-*` 错误显式上抛）。
- `src/config.js`：`understand` 只保留 `defaultModel` / `maxTokens`；`maxVideoBytes` / `analyzePromptPath` / `reversePromptPath` 退役（旧配置字段被忽略）。
- `src/index.js`：`inject` 改为 `['tools']`，`apply` 内注册 bundled Skills，工具执行改取 `ctx.get('headlessSkill')`，移除 `prompt_path` 参数。
- `package.json` `files` 用 `skills` 替换 `prompts`；`dsh.manifest.json` 增加 `skills` 声明与 `seamsConsumed: ["headlessSkill"]`。
- `bundle.lock.json`：仅刷新 `omnimux-video` 单槽。

## 假设

- Hub `headlessSkill` 已在生产运行时挂载（`omnimux` 插件提供），并按其契约校验 `outputSchema`、做一次修复重试后抛 `headless-skill-schema-invalid`。
- 下游对 `video_analyze` 的消费主要读取 `text`（Markdown）与 `dest` 文件，对 `video_reverse_prompt` 读取 `prompt` / `appendix` / `dest`；本次保留这些字段，同时新增结构化 `data`。
- 分镜数据以 JSON 数组返回后，下游无需再写 Markdown 表格正则。

## 证伪方式

- 移除 `registerVideoSkills(ctx)` 或把 rank 改为非 600：`skills.test.js` 的 provider 注册与 rank 断言转红。
- 把任一工具改回 `textComplete`/直连旧路径：`understand.test.js` 的 `needs-provider` 与请求契约断言转红。
- 删除任一 Schema 或放开 `additionalProperties`：`headless.test.js` 的严格契约断言转红。
- 删除 `dest` 写盘：`headless.test.js` 的落盘兼容断言转红。
- 把 `headless-skill-schema-invalid` 吞成泛化错误：`understand.test.js` 的错误码断言转红。

## 验收

- `corepack pnpm --dir plugins --filter omnimux-video test`：除本机 ffmpeg 9 不兼容的既有 live 用例（`ffmpeg.live.test.js`，本单未触碰）外全绿；单元用例 119 pass / 0 fail。
- `corepack pnpm --dir plugins run build:all`、`bundle-lock --check`、`workspace-check --check`、`verify-skill-hygiene`、`verify-package-files`、`registry:verify`、`verify-plugin-load`、`check:boundaries`、`verify-test-standard-declarations`、`gitleaks`、`git diff --check` 全绿。
- 工作树 `0 dirty`，PR 远端非跳过检查全绿且 `OPEN / MERGEABLE / CLEAN`。

## 旧标准变更

- `plugins/plugins/omnimux-video/src/config.test.js`：
  - 原断言：`understand` 默认值与覆盖解析包含 `maxVideoBytes` / `analyzePromptPath` / `reversePromptPath`。
  - 必须改的理由：这三个字段随 headlessSkill 迁移退役，提示词真源改为 Skill、媒体传输归 Hub。
  - 新期望证据：`understand` 仅含 `defaultModel` / `maxTokens`，旧字段被忽略且不复活旧路径。
- `plugins/plugins/omnimux-video/src/understand/understand.test.js`：
  - 原断言：`textComplete.execute` 被调用并返回 Markdown；`loadPromptFile` 加载 bundled prompt；`<<<PROMPT>>>` 标记块被解析。
  - 必须改的理由：私有提示词加载器、标记块解析与 `textComplete` 直连全部移除，改由 `headlessSkill` + JSON Schema 承担。
  - 新期望证据：请求携带 `skillName` / `outputSchema` / `references`，`dest` 仍写旧格式文件，结构化 `data` 与错误码断言生效。
- 删除 `src/understand/parse-tags.test.js`：被删模块的测试随模块一起移除，替代覆盖见 `headless.test.js` 的 `beats` 结构化断言。
