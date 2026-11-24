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

## 验收（合并 `origin/main@a5fa61ee` 后实测，Node 24.18.1）

- `corepack pnpm --dir plugins --filter omnimux-video test`：**159 pass / 1 fail**。唯一失败是本机 ffmpeg 9.0.2 移除 `-vsync` 导致既有 live 冒烟用例 `ffmpeg.live.test.js :: smoke: video_scene_detect finds cuts and extracts frames` 报 `video-ffmpeg-failed`；该文件与 `src/engine/*` 本单未触碰，CI 无 ffmpeg 时该 live 套件不执行。
- 排除 live 套件的单元用例：**128 pass / 0 fail**（含 `skills.test.js`、`headless.test.js`、`config.test.js`、`understand.test.js`）。
- `corepack pnpm --dir plugins run build:all`：13/13。
- `verify:skill-hygiene`：catalog 127 目录，插件随包声明 26 个，零上游重名/零软链/零孤儿/零重复。
- `check:boundaries`：5224 source files 通过。
- `registry:verify`：15 个插件 anti-drift 通过。
- `check:package-files`：15 个插件 `files` 与多语言元信息合规（`skills/` 已进入发布清单）。
- `verify:plugin-load`：15/15。
- `verify-test-standard-declarations`：本范围 16 条旧标准声明通过。
- `bundle-lock --check`（14 plugins，相对 main 仅 `omnimux-video` 单槽变动）、`workspace-check --check`、`gitleaks`（no leaks）、`git diff --check`（exit 0）全绿；工作树 `0 dirty`。

## 双向证伪记录（本机实测）

- rank 600 改为 0：`skills.test.js` 红（`0 !== 600`）。
- `VIDEO_ANALYZE_SCHEMA.required` 移除 `shots`：`headless.test.js` 红（`analyze schema must require shots`）。
- `video_analyze` 的 `skillName` 改为 `video-understand`：`headless.test.js` 红（`actual: 'video-understand'`）。
- 删除 `video_reverse_prompt` 的 `dest` 写盘：`headless.test.js` 红（`ENOENT ... prompt.txt`）。
- 以上四项还原后单元用例 128 pass 全绿。
