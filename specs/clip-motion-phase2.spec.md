# 剪辑 ASR 词级字幕、音频节拍高光分析与自动闪避（Phase 2）

在 Phase 1 开放 `omnimux-clip` 原生声明式动效模板与 `clip-recreate` 复刻编排的基础上，Phase 2 补齐「听声音 -> 对节拍 -> 动字幕 -> 精剪口播 -> 降音乐闪避」的完整音视频节奏闭环：打通中枢 `omnimux` 的结构化语音转写时间戳，透出 OpenReel 内核已具备的本地节拍检测（`BeatDetectionEngine`）、高光片段提取（`analyzeAudioForHighlights` / `extractHighlights`）、词级动态字幕（6 种 `CaptionAnimationStyle`）、台本气口与口癖裁剪（`planTranscriptCut`）、时间轴 Marker、实时闪避（`liveDucking`）及节拍卡点（`BeatSyncEngine`）。

## 目标与范围

用户可要求 Agent 先转写音频或检测音乐节拍/高光点，再将带词级时间戳的动态字幕、气口裁剪、标记点、人声闪避与音画卡点批量落盘进 OpenReel 原生工程，全程零修改上游 `src/client/openreel/` 并保持单一 Undo 步与 `validateOnly` 预演隔离。

- **包含范围**：
  - **Hub `omnimux` 结构化转写增强**：`plugins/plugins/omnimux/src/media/stt.js` 在 `response_format === 'verbose_json'` 时无损保留并归一化模型返回的 `language`、`duration`、`segments[]`、`words[]`；其他格式严格保持既有 `{ mode, model, text }` 返回形态不变。
  - **分析工具与同源路由**：新增只读/分析工具 `clip_analyze`（L2）及同源 Saved 路由 `GET /omnimux-clip/api/projects/:id/transcript`（继承 `auth: 'required'` 与 `requestRejection` 503 fail-closed 守卫）。`mode: 'transcript'` 支持 Saved 回退与实时工程台本分析（分句、词数、说话人、停顿 `pauses`、口癖 `fillers`、关键词 `matches`）；`mode: 'beats' | 'highlights'` 仅限实时可见编辑器执行本地 PCM/WebAudio 解码与真实节拍/高光分析（无音频或未打开编辑器严格报错，绝不编造 BPM 或高光段）。
  - **`clip_edit` 扩展 7 个原子操作**：`import_subtitles`、`set_caption_style`、`cut_transcript_ranges`、`set_marker`、`remove_marker`、`set_audio_ducking`、`sync_clips_to_beats`。
  - **`clip_get` 扩展投影**：`base` 新增 `markerCount`；`clipView` 新增媒体 `audioType` 与 `liveDucking`；`full` 视图新增 `markers[]` 并扩展 `subtitles[]`（含 `animationStyle`、`speaker`、`language`、`wordCount`、`words[]`）与 `style` 高亮/描边/阴影/内边距/安全区字段。
  - **Skill 与 Phase 1 评审备忘收尾**：更新 `clip-craft` 与 `clip-recreate` Skill；修正 `plugins/docs/contracts/plugin-agent-tools-inventory.md` 遗留的一处工具数量描述；在 `native-live.test.js` 补齐 `set_keyframes` 的 `graphic-member-readonly` 显式断言。
- **明确不包含**：
  - 零修改 `plugins/plugins/omnimux-clip/src/client/openreel/` 上游核心目录。
  - 不开放自定义 JS 脚本或审批字段（维持 `motion-expression-denied`）。
  - 不新增独立于 OpenReel 的第二套字幕或剪辑引擎。

## 验收标准

| 验收项 | 操作与判定 |
| --- | --- |
| AC-M2-01 Hub `verbose_json` 结构化转写透传 | `executeOmnimuxSpeechToText` 在 `verbose_json` 下输出归一化 `language`、`duration`、`segments[]`、`words[]`；`json`/`text`/`srt`/`vtt` 输出结构严格不变。 |
| AC-M2-02 台本分析双面一致性 | `GET /omnimux-clip/api/projects/:id/transcript` 执行 401/503 fail-closed 守卫，并与 `clip_analyze(mode: 'transcript')` 返回一致的 `sentences`、`pauses`、`fillers` 与 `matches`。 |
| AC-M2-03 本地节拍与高光真实分析 | `executeNativeAnalyze` 在无活跃编辑器或无有效音频时返回 `EDITOR_OFFLINE` / `audio-analysis-failed`；使用合成 120 BPM PCM `AudioBuffer` 验证真实 `BeatDetectionEngine` 与 `extractHighlights` 计算。 |
| AC-M2-04 词级动态字幕导入与样式更新 | `import_subtitles` 支持 `srt`、`transcriptJson`（含 `words[]`）与 `cues[]`（含 `timeOffsetSec` 偏移，非法输入抛 `subtitle-invalid`）；`set_caption_style` 应用 6 种 `CaptionAnimationStyle` 与高亮色并保留 `words[]`，可通过 `clip_get(view: 'full')` 检出。 |
| AC-M2-05 台本气口与口癖原子裁切 | `cut_transcript_ranges` 支持 `pauses`、`fillers` 与显式 `ranges`；`validateOnly: true` 零副作用；正式提交单次 `undo()` 完整恢复时间轴与字幕；锁轨触发 `TRACK_LOCKED`。 |
| AC-M2-06 时间轴标记与实时闪避 | `set_marker` / `remove_marker` 增改删标记并在 `clip_get` 检出 `markerCount` / `markers[]`；`set_audio_ducking` 配置 `audioType`（`dialogue`/`music`）与 `liveDucking`（`enabled`/`amountDb`/包络时间）且支持撤销重做。 |
| AC-M2-07 节拍卡点与安全边界回归 | `sync_clips_to_beats` 基于 `BeatSyncEngine` 计算 `cut-to-beats` 与 `preserve-duration`，遵循素材长度上限、不重叠约束与单步撤销；Phase 1 成员 `set_keyframes` 只读守卫抛 `graphic-member-readonly`；新操作保持 `motion-expression-denied`。 |
| AC-M2-08 工具契约与全量门禁 | DSH Host 注册全部 11 个 Clip 工具、`dsh.manifest.json`、契约文档与 Skill 卫生/全局预算校验全部 0 阻断通过，`build:all`、`omnimux`、`omnimux-clip` 测试全绿。 |

## 源码改造清单

- `plugins/plugins/omnimux/src/media/stt.js`、`stt-mount.js`、`stt.test.js`（`verbose_json` 结构化时间戳透传与单测）
- `plugins/plugins/omnimux-clip/src/templates/openreel-entry.ts`（扩展 Node bundle 导出字幕、音频、台本工具与枚举）
- `plugins/plugins/omnimux-clip/src/errors.js`（新增 `subtitle-invalid`、`audio-analysis-failed` HTTP 状态映射）
- `plugins/plugins/omnimux-clip/src/timeline/analyzeTranscriptCore.js`、`analyzeTranscript.js`（新增 Host 与 Client 共用纯台本分析模块）
- `plugins/plugins/omnimux-clip/src/timeline/nativeProjectView.js`（扩展 `markerCount`、`markers[]`、词级 `subtitles[]` 与 `audioType`/`liveDucking` 投影）
- `plugins/plugins/omnimux-clip/src/http/routes.js`（新增 `GET /omnimux-clip/api/projects/:id/transcript`）
- `plugins/plugins/omnimux-clip/src/client/live/native-analyze.ts`（新增实时 `transcript` / `beats` / `highlights` 分析桥接）
- `plugins/plugins/omnimux-clip/src/client/live/native-rhythm.ts`（新增 7 个字幕/标记/闪避/卡点原子操作桥接）
- `plugins/plugins/omnimux-clip/src/client/live/native-overlays.ts`、`native-edit.ts`、`run-command.ts`（接线与样式扩展）
- `plugins/plugins/omnimux-clip/src/tools.js`、`dsh.manifest.json`（注册 `clip_analyze` 与 7 个新 op，更新 Prompt 与清单元数据）
- `plugins/plugins/omnimux-clip/skills/clip-craft/SKILL.md`、`skills/clip-recreate/SKILL.md`（补齐 ASR 字幕、节拍卡点与闪避工作流）
- `plugins/docs/contracts/plugin-agent-tools-inventory.md`、`plugins/docs/contracts/clip-live-control.md`（同步 11 工具契约并清理 Phase 1 数量备忘）
- `plugins/plugins/omnimux-clip/src/tools.test.js`、`src/client/native-live.test.js`（工具与原生引擎全量回归）
- `bundle.lock.json`（随 `omnimux` 与 `omnimux-clip` 变更重算校验）

## 本地测试证据

- **构建与锁一致性**：
  - `corepack pnpm --dir plugins run build:all`：13 个插件全部构建成功（`omnimux-clip` 生成 `lib/openreel-templates.js` 与 `lib/client.js`）。
  - `node scripts/bundle-lock.mjs && node scripts/workspace-check.mjs --check`：`13 plugins` 锁文件与工作区元数据一致（`dsh-version`、`bundle-lock`、`verify-docs-dsh-version`、`workspace-check` 全绿）。
- **单元与原生集成测试**：
  - `env -u OMNIMUX_API_KEY -u OMNIMUX_TOKEN corepack pnpm --filter omnimux test`：450 个测试文件全绿（Node 测试 `4118 / 4118` 通过、476 suites、0 fail；DOM e2e `93 / 93` 通过、15 suites、0 fail；含 `stt.test.js` 的 `verbose_json` 归一化测试）。注：未清除宿主环境注入变量时，`src/decisions/execute.test.js` 的 `resolveGatewayApiKey` 用例会读取宿主 env。
  - `corepack pnpm --filter omnimux-clip test`：`312 / 312` 通过（16 suites、0 fail、0 skipped），覆盖 `tools.test.js`（11 工具注册、DSH Schema 校验、`GET /projects/:id/transcript` 401/503/400 与工具一致性、`clip_analyze` beats/highlights 实时派发与 `clip_get` 完整投影）、`native-live.test.js`（Phase 1 `set_keyframes` 成员只读断言 + `#phase2` 词级字幕与跨段边界词去重、台本裁切与结尾 padding 收敛、标记与闪避、空库/短音频守卫、合成 120 BPM 与 96 BPM 弱起拍 PCM 真实 `BeatDetectionEngine` 与裁剪范围 `analyzeAudioForHighlights` 计算及卡点），以及 `clip-mixed-export.test.mjs` 等 4 项集成测试。
- **门禁与契约校验**：
  - `corepack pnpm --dir plugins verify:tools`：`omnimux-clip` 11/11 工具在源码、`inject`、`output`、`dsh.manifest.json` 与 `inventory.md` 间 100% 对齐（0 阻断错误）。
  - `corepack pnpm --dir plugins test:agent-tools`：82 / 82 插件工具通过 JSON Schema、内存隔离调用、离线路由冒烟（8/8）与敏感参数守卫。
  - `corepack pnpm --dir plugins verify:skill-hygiene`（35 份技能 / 178 工具 / `modelInvocable=2/4`）、`verify:global-skills`（`[clip-craft, omnimux-social-data]`）、`verify:skill-bilingual`（36/36）、`note:lint`、`check:boundaries`（5331 文件）、`verify:product-baseline`、`check:package-files`（15 包）、`verify:licenses`（15 包，0 警告）、`verify:agents-skills` 均通过；`verify-silent-catch` 对本次新增及修改源码文件命中数为 0；`src/client/openreel/` 零改动。
  - 未执行项：真实桌面 Electron/浏览器实机端到端与真实云端模型调用。

## 旧标准变更

- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers the ten tool names including clip_templates`
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers tools, prompt and clipEditor seam`
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `registers the ten Clip tools and forwards the Cordis execution identity`

理由与新期望：因本 PR 新增只读分析工具 `clip_analyze`，`omnimux-clip` 注册工具清单由 10 个扩充至 11 个（插入在 `clip_templates` 之后）；原有 10 个工具与所有校验、版本、安全守卫断言完整保留，新期望由 `omnimux-clip` 单测/集成测试与 `verify:tools` 全绿验证。
