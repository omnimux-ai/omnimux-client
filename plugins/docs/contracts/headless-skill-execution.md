---
title: "后台无头技能执行契约"
id: "contract-headless-skill-execution"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-23"
updated: "2026-11-23"
---

# 后台无头技能执行契约

本契约约束所有桌面业务插件（`plugins/plugins/omnimux-*/`）的后台 AI 分析、提取、解构、翻译与结构化总结能力。任何业务插件新增或修改后台无头 AI 能力前，必须完整阅读本契约并遵守以下全部条款。

## 核心原则

OmniMux 的执行中心（`plugins/plugins/omnimux/`，简称 Hub）是全工作台访问大模型、技能真源与后台并发调度的唯一集成层。业务插件只负责声明输入素材、目标技能和业务落库规则，严禁在插件内部另起炉灶维护第二套 AI 推理管线。

### 六条硬约束

1. **禁止借前台对话栏充当 RPC 管道**
   - 后台结构化分析不得强行展开前台聊天窗口、不得往用户当前会话注入临时附件或自动点击发送，也不得在工作区左侧创建一次性垃圾会话。
   - 前台对话会话仅用于用户主动发起的创作研讨、追问与复刻；是否将对话结果沉淀回业务记录由用户显式确认。
2. **提示词以 DSH 原生 `ctx.skills` 为单一真源**
   - 后台任务的系统方法论必须注册为标准 Skill 资产，由执行层通过 `ctx.skills.get(skillName)` 动态读取，使后台批处理与前台对话复用同一套拆解标准。
   - 禁止在业务插件源码中继续新增大段硬编码分析提示词或私有本地提示词文件加载器。
3. **输出以 JSON Schema 为强契约，禁止新增脆弱 Markdown 正则解析**
   - 后台无头技能必须声明结构化 `outputSchema`，由 Hub 统一提取 JSON 并校验类型、必填项与枚举范围；校验失败最多自动附带错误明细修复重试 1 次，仍不合法时显式失败并抛出 `headless-skill-schema-invalid`。
   - 禁止把自由 Markdown 文本作为新的跨模块机器接口，禁止在业务插件中新增 Markdown 标题、符号或表格正则解析器（既有历史数据只读兼容除外）。
4. **模态分流、媒体准备与模型路由全归 Hub**
   - 业务插件不得直接调用 DSH 原生 `ctx.llm` / `llm.stream`（由 `pnpm check:boundaries` 门禁强制拦截），也不得在插件内编写供应商客户端或按聊天模型禁用后台能力。
   - 所有后台无头执行统一消费 Hub 提供的 `headlessSkill` 接缝（`ctx.get('headlessSkill')`），底层复用 Hub `textComplete`：**默认跟随当前会话模型**（`agents.get(sessionId)?.model?.current()` → `agentDefaultModel.currentSelection()`），支持在插件配置（`omnimux.toolModel`）中显式覆盖指定模型；目标模型不支持对应多模态或不可用时直接显式报错，不做静默回退或暗中更换默认模型。
5. **统一并发治理与事件推送，禁止新增前端定时盲轮询**
   - Hub 在 `headlessSkill` 内部按模态实施分类并发限流（默认 `video: 2`、`image: 4`、`text: 5`），支持 `AbortSignal` 与 `cancel(jobId)` 取消。
   - 阶段变化（`queued`、`running`、`repairing`、`done`、`failed`、`cancelled`）统一通过 Hub 单一事件总线 `hubEvents` 发出 `omnimux:headless-skill` 事件；新功能不得再新增前端定时轮询状态机。
6. **防脏写与防失控预算**
   - 调用方必须传入确定性的 `inputFingerprint`（覆盖关键正文与素材标识）；执行前后发生素材变更时由调用方拒绝脏写或显式标记陈旧。
   - 后台任务默认采用单轮结构化调用（`1-shot`）并强制绑定超时上限；严禁无步数上限的后台静默循环或吞掉上游异常（禁止空 `catch` 或伪造成功态）。

## Hub 共享接缝契约（`headlessSkill`）

Hub 在 `plugins/plugins/omnimux/src/headless/mount.js` 注册共享 Cordis Service `headlessSkill`（业务插件通过 `ctx.get('headlessSkill')` 消费；随 `textComplete` 门控同步启停，当 `gate.enabled: false` 或 `omnimux_text_complete` 关闭时同步停用）：

```ts
interface HeadlessSkillRunRequest<T = Record<string, unknown>> {
  /** 标准 Skill 名称（kebab-case），由 Hub 通过 ctx.skills.get 解析 */
  skillName: string
  /** 业务侧传入的用户输入文本或结构化上下文 */
  input: string
  /** 有序媒体引用（图片、视频、音频、文档） */
  references?: Array<{ type: 'image' | 'video' | 'audio' | 'document'; pathOrUrl: string; mime?: string }>
  /** 必填 JSON Schema 子集（支持 type/properties/required/items/enum/additionalProperties） */
  outputSchema: Record<string, unknown>
  /** 并发分组，缺省按 references 是否含 video/image 自动推断 */
  modality?: 'text' | 'image' | 'video'
  /** 可选显示标题与业务归属标识，供任务面板与事件关联 */
  label?: string
  ownerPlugin?: string
  targetId?: string
  /** 确定性输入指纹，用于同目标幂等去重与写回前一致性校验 */
  inputFingerprint?: string
  /** 写回前可选校验钩子；若返回 false 表示源内容已变更，中止返回脏结果 */
  verifyFingerprint?: () => boolean | Promise<boolean>
  /** 可选模型覆盖、工作目录、最大输出与超时控制 */
  model?: string
  cwd?: string
  maxTokens?: number
  timeoutMs?: number
  /** 校验失败后自动修复次数，默认 1，最大允许 1 */
  maxRepairAttempts?: number
  signal?: AbortSignal
}

interface HeadlessSkillRunResult<T = Record<string, unknown>> {
  mode: 'live'
  jobId: string
  skillName: string
  model: string
  data: T
  repaired: boolean
  inputFingerprint?: string
}
```

### 暴露方法

| 方法 | 说明 |
| :--- | :--- |
| `run(request)` | 校验参数与 Skill 真源，进入分类并发队列执行，返回结构化校验通过的结果或抛出 `OmnimuxError` |
| `listJobs(filter?)` | 返回当前运行中及近期已结算的后台任务只读快照（可按 `ownerPlugin`、`targetId`、`status` 过滤） |
| `getJob(jobId)` | 查询单个任务快照 |
| `cancel(jobId, reason?)` | 取消排队中或执行中的后台任务并触发内部 `AbortController` |

### 标准错误码

- `headless-skill-invalid-request`：缺少 `skillName`、`input` 或合法 `outputSchema`
- `headless-skill-not-found`：`ctx.skills` 中不存在目标技能或技能正文为空
- `headless-skill-schema-invalid`：初始输出与自动修复重试均未通过 JSON Schema 校验
- `headless-skill-stale-input`：任务完成时 `verifyFingerprint()` 返回 `false`，拒绝写入陈旧结果
- `headless-skill-cancelled`：任务被 `cancel(jobId)` 或调用方 `AbortSignal` 取消
- `headless-skill-timeout`：超过单次任务时间上限
- `headless-skill-transport-exceeded`：本地图片或压缩后的视频仍超过内联传输容量，拒绝提交不完整素材
- `headless-skill-transport-unavailable`：本地超大视频需通过 `videoProcess` 能力（`video_inline_analysis_prepare`）准备完整视频，但接缝不可用
- `needs-provider` / `needs-omnimux`：沿用 Hub 原生渠道与登录前置错误码，禁止包装为 500 或静默吞错

### 事件契约

Hub 通过 `hubEvents.emit({ type: 'omnimux:headless-skill', payload })` 推送任务状态变更，`payload` 包含：

- `jobId`、`ownerPlugin`、`targetId`、`label`、`skillName`、`modality`、`status`、`stage`、`model`、`inputFingerprint`、`createdAt`、`startedAt`、`finishedAt`、`errorCode`、`error`

## 边界门禁

`plugins/scripts/verify-plugin-boundaries.mjs` 强制校验非 Hub 插件不得直接访问 `ctx.llm` 或 `llm.stream`（仅显式豁免 `omnimux-browser/src/text-session-model.ts` 的只读会话模型目录查询）。新增业务后台 AI 能力必须走 `headlessSkill` 接缝。

## 存量不合规模块迁移清单

在全仓审计中发现以下既有实现不符合本契约，已建立独立 Issue 分阶段迁入 `headlessSkill`，期间禁止在旧路径上继续复制同款模式：

- [#211](https://github.com/omnimux-ai/omnimux-client/issues/211)：`omnimux-inspiration` — **已迁移**（Skill 真源 `inspiration-deconstruct` / `inspiration-translate` + JSON Schema + Hub `transport.js` 视频准备 + `hubEvents` 实时推送与取消；旧 `analyzer.js` 仅保留历史数据只读兼容）
- [#212](https://github.com/omnimux-ai/omnimux-client/issues/212)：`omnimux-products`（硬编码提示词与 `yaml-mini.js` 文本解析）
- [#213](https://github.com/omnimux-ai/omnimux-client/issues/213)：`omnimux-video`（私有提示词文件加载与非结构化 Markdown 输出）
- [#214](https://github.com/omnimux-ai/omnimux-client/issues/214)：`omnimux-workflow`（重复视频预处理、重复 Markdown 表格解析与导演助手硬编码提示词）
