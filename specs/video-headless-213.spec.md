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

## 验收（合并 `origin/main@5d0b6924`（含 #250、#254）后实测，Node 24.18.1）

- `corepack pnpm --dir plugins --filter omnimux-video test`：**159 pass / 1 fail**。唯一失败是本机 ffmpeg 9.0.2 移除 `-vsync` 导致既有 live 冒烟用例 `ffmpeg.live.test.js :: smoke: video_scene_detect finds cuts and extracts frames` 报 `video-ffmpeg-failed`；该文件与 `src/engine/*` 本单未触碰，CI 无 ffmpeg 时该 live 套件不执行。
- 排除 live 套件的单元用例：**128 pass / 0 fail**（含 `skills.test.js`、`headless.test.js`、`config.test.js`、`understand.test.js`）。
- `corepack pnpm --dir plugins run build:all`：13/13。
- `verify:skill-hygiene`：catalog 130 目录，插件随包声明 28 个（含 #254 新增货架技能），零上游重名/零软链/零孤儿/零空壳；`video-reverse-prompt` 与市场目录 `reverse-video-prompt` 不撞名。
- `check:boundaries`：5225 source files 通过。
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

## 旧标准变更

以下用例在 headlessSkill 与 Skill 真源迁移中被删除、改名或语义替换，逐条声明原断言、必须改的理由与新期望证据。

- `plugins/plugins/omnimux-video/src/config.test.js` :: `parseVideoConfig reads understand overrides`
  - 原断言：原断言解析 `maxVideoBytes` / `analyzePromptPath` / `reversePromptPath` 三个字段。
  - 必须改的理由：随 headlessSkill 迁移退役，提示词真源归 Skill，媒体传输归 Hub，旧字段只允许被忽略。
  - 新期望证据：`parseVideoConfig reads understand overrides and ignores retired prompt/transport fields` 断言 `understand` 仅含 `defaultModel` / `maxTokens`。

- `plugins/plugins/omnimux-video/src/understand/parse-tags.test.js` :: `parseTaggedSections`
  - 原断言：原断言 `<<<PROMPT>>>` / `<<<APPENDIX>>>` 标记块解析与整段回退。
  - 必须改的理由：标记块解析器随 Markdown 正则接口一并删除，结构化结果改由 JSON Schema 提供。
  - 新期望证据：`headless.test.js` 的 `beats` 结构化断言与 `video-reverse-prompt` Schema 覆盖同一语义。

- `plugins/plugins/omnimux-video/src/understand/parse-tags.test.js` :: `extracts prompt and appendix when tags are present`
  - 原断言：原断言从标记块中拆出 prompt 与 appendix。
  - 必须改的理由：模型不再输出标记块，prompt/appendix 是 JSON 字段。
  - 新期望证据：`headless.test.js` 断言 `prompt` / `appendix` 字段由 `headlessSkill` 结果驱动并分别落盘。

- `plugins/plugins/omnimux-video/src/understand/parse-tags.test.js` :: `falls soft to whole body when tags missing`
  - 原断言：原断言无标记时整段作为正文回退。
  - 必须改的理由：旧回退依赖自由文本，正是契约禁止的脆弱解析。
  - 新期望证据：缺失必填 `prompt` 时抛 `video-reverse-failed`，不静默伪造正文。

- `plugins/plugins/omnimux-video/src/understand/parse-tags.test.js` :: `treats empty prompt tag as unparsed fallback`
  - 原断言：原断言空标记块降级为未解析。
  - 必须改的理由：空结构属于上游违约，必须显式失败。
  - 新期望证据：`executeVideoReversePrompt` 对空 `prompt` 抛 `video-reverse-failed`。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `understand prompts + pack`
  - 原断言：原 describe 断言 bundled prompt 文件加载与体积上限。
  - 必须改的理由：prompt 文件与体积上限均移除，Hub transport 统一准备。
  - 新期望证据：describe 改名为 `understand pack + seams`，覆盖路径校验与 Hub 传输分工。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `accepts absolute mp4 under byte cap`
  - 原断言：原断言绝对路径 mp4 在本地字节上限内通过。
  - 必须改的理由：本地体积上限移除，超大素材交 Hub。
  - 新期望证据：`accepts an absolute mp4 and leaves transport sizing to Hub` 断言路径通过且不做本地体积拦截。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `builds user text with silent constraints`
  - 原断言：原断言反推用户文本包含静默硬约束。
  - 必须改的理由：用户文本保留，但标记块指令改为 JSON 契约。
  - 新期望证据：`headless.test.js` 断言请求 `input` 含身份策略与 JSON 输出要求。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `calls textComplete with system+video and writes dest`
  - 原断言：原断言直连 `textComplete` 并写 `dest`。
  - 必须改的理由：后台推理统一改经 `headlessSkill`。
  - 新期望证据：`routes through headlessSkill and writes the legacy markdown dest` 断言请求契约与 `dest` 投影。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `declares inject with tools and textComplete, and resolves textComplete via ctx.textComplete`
  - 原断言：原断言 `inject` 含 `textComplete` 并从 ctx 取该服务。
  - 必须改的理由：插件不再直接消费 `textComplete`，由 Hub `headlessSkill` 统一调度。
  - 新期望证据：`declares tools injection (not textComplete) and executes through ctx.get("headlessSkill")` 断言 `inject` 仅含 `tools` 且执行走 headlessSkill。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `keeps parsed false when tags missing`
  - 原断言：原断言无标记时 `parsed:false`。
  - 必须改的理由：结构化契约下不存在「未解析」分支，缺字段即失败。
  - 新期望证据：`parsed` 恒为 `true`；空 `prompt` 用例断言抛错。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `loads bundled analyze and reverse prompts`
  - 原断言：原断言从 `prompts/*.md` 加载系统提示词。
  - 必须改的理由：提示词真源迁入 `skills/<name>/SKILL.md`。
  - 新期望证据：`skills.test.js` 断言两个 Skill 从 SKILL.md 加载且经 provider rank 600 注册。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `maps hub video-unsupported to video-understand-unsupported`
  - 原断言：原断言该错误映射仍成立。
  - 必须改的理由：映射逻辑保留，但调用链改为 `headlessSkill` 抛错。
  - 新期望证据：同名用例在新链路下断言同一错误码。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `maps missing textComplete to needs-provider`
  - 原断言：原断言缺少 `textComplete` 时报 `needs-provider`。
  - 必须改的理由：缺失的是 `headlessSkill` 接缝。
  - 新期望证据：`maps a missing headlessSkill seam to needs-provider` 断言新接缝缺失时报同一错误码。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `parses tagged output and writes dest`
  - 原断言：原断言标记块解析后写 `dest` 与 `appendix_dest`。
  - 必须改的理由：标记块解析删除，改由结构化字段投影。
  - 新期望证据：`routes through headlessSkill and writes prompt plus appendix dests` 断言两处落盘。

- `plugins/plugins/omnimux-video/src/understand/understand.test.js` :: `registers process + understand + depth tools and does not mix understand into slug enum`
  - 原断言：原断言工具注册且 `prompt_path` 参数存在。
  - 必须改的理由：`prompt_path` 随私有提示词加载器退役。
  - 新期望证据：`registers process + understand + depth tools and drops retired prompt overrides` 断言 `prompt_path` 已移除。
