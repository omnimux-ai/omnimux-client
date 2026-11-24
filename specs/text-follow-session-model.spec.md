# Hub 文本与后台无头执行默认跟随当前会话模型并移除静默回退

## 背景

在 Hub `textComplete`（以及建立在其上的 `headlessSkill`、灵感拆解/翻译、工作流分析等后台调用）的既有实现中存在三处过度干预与隐式行为：

1. 当插件配置 `omnimux.toolModel` 为 `auto` 或未设置时，请求不会跟随用户当前会话模型（DSH `agents.get(sessionId)?.model?.current()` / `agentDefaultModel.currentSelection()`），而是掉进 `defaultTextModel` / `defaultAnalysisModel` 并硬落到官方目录默认模型（如 `gemini-3.8-flash`）。
2. 当请求携带视频、音频或 PDF 文档时，即使配置了 `toolModel`，`execute.js` 也会静默跳过 `toolModel` 并改走其它渠道与模型。
3. 当已配置的 `toolModel` 对应的提供方适配器缺失时，`execute.js` 依次尝试本机 CLI Agent → `modelCatalog.default` → 官方默认路由的三跳静默回退，掩盖真实配置问题且不可持续。

用户已明确产品原则：**默认跟随当前会话模型，允许在插件配置（`omnimux.toolModel`）中显式覆盖指定模型；模型不支持对应多模态或不可用时直接报错，由用户自行切换模型或修改插件配置，不做静默回退或暗中指定默认模型。**

## 假设

- 在 DSH 宿主运行态下，当前会话模型以 `agents.get(sessionId)?.model?.current()` 为首选真源，其次在 Agent 工具调用上下文中读取 `agents.currentInitiator()?.model?.current()`，无会话上下文时以 `ctx.get('agentDefaultModel')?.currentSelection()` 为真源（DSH 在会话切模型时已通过 `session-controller` 同步写入 `agentDefaultModel`）。
- 当调用方未显式传入 `model` / 渠道意图（如 `@byok-*`、`@agent`、`@standard`）时：
  - 若插件配置 `omnimux.toolModel`（或调用方 `input.toolModel`）为有效 `provider:model`，则全模态严格锁定该指定模型；格式非法、适配器缺失或通道不支持目标模态时直接显式报错，零静默回退。
  - 若 `toolModel` 为 `auto` 或未设置，且宿主提供了会话模型真源，则全模态严格锁定当前会话模型；不支持目标模态或上游报错时直接显式透传错误，零静默回退。
- 对于纯文本与图片输入，锁定目标走 DSH 原生 `ctx.llm.stream({ provider, model })`（其中 `provider === 'omnimux'` 且宿主注入了 `resolveOfficialApiKey` 时走官方 `completeTextViaChat` 以兼容新用户账号执行密钥；不在 Contract v2 白名单但未被禁用的官方会话模型如桌面默认 `deepseek-v4-flash` 在其合约支持的文本/图片模态上正常放行，不支持的视频/音频/文档模态立即显式报错）。
- 对于视频、音频、文档等超出 `llm-pi-ai` 附件模态（仅 `text` / `image`）的输入，仍严格锁定在同一个 `{ provider, model }` 上，绝不暗中更换模型：
  - `provider === 'omnimux'`：白名单模型按精确 `model` 校验官方目录、模态契约、`@group` 候选池与门控后走 `completeTextViaChat`；被门控/配置禁用的模型全路径拒绝；不支持目标模态时直接报错。
  - 其它在 `llm-pi-ai` 中配置了 `api: 'openai-completions'` 且具备合法 `http(s)` `baseURL` 的提供方：严格使用该提供方自身的有效配置（`descriptor.value.providers` 优先，避免复活已删除的 `base` 条目），原样保留其 `baseURL`（不强制拼接 `/v1`）并透传合法自定义 `headers`，仅使用其自身 `apiKeyEnv` 凭据直连 `completeTextViaChat`（不传入官方凭据或环境变量，凭据读取异常不泄露原始错误细节）；若上游模型不支持该模态，由上游自然返回错误。
  - 其它协议（如 `anthropic-messages`、`openai-responses` 或缺少 `baseURL`）：直接抛出 `omnimux-invalid-request` 提示当前模型不支持该模态，请切换支持多模态的模型或在插件配置中指定工具模型。
- 仅在既无显式 `toolModel` 也无宿主会话模型服务（例如离线单测或未挂载 `agentDefaultModel` 的独立调用）时，保留既有 `scenarioBindings` / 目录路由兼容，不影响显式传 `model` 或渠道参数的调用（如画布节点、显式 `@byok-*` / `@agent` / 官方指定模型）。

## 新用户基线

- 依赖：新用户安装并登录 OmniMux 桌面端后，DSH 宿主默认挂载 `agentDefaultModel`（初始指向 `omnimux` 下的会话模型）与 `omnimux` 执行中枢（`toolModel` 默认为空/`auto`）。不依赖任何开发机本地网关、回环地址或私有路径。
- 缺省与报错：
  - 新用户使用默认 `omnimux` 多模态会话模型时，文本、图片、视频、音频与文档分析均可直接跟随该会话模型跑通（未配置 `OMNIMUX_API_KEY` 时继续通过账号执行密钥 `resolveOfficialApiKey` 鉴权，未启用账号分析服务时明确报 `official-credential-required`）。
  - 用户将对话切换到纯文本模型或不支持视频直传的协议（如 Anthropic Messages）并触发视频/图片分析时，明确报出模型不支持该模态的中文提示或上游真实错误，引导用户切模型或在插件配置中指定 `toolModel`，不静默回退或伪造结果。
  - 用户在插件设置中指定了无效或已移除提供方的 `toolModel` 时，明确报出配置/适配器错误，不暗中切到其它渠道。

## 范围

- `plugins/plugins/omnimux/src/text/mount.js`：向 `executeOmnimuxText` 注入 `agents` 与 `agentDefaultModel` 宿主服务，移除废弃的 `modelCatalog` 静默回退入参。
- `plugins/plugins/omnimux/src/text/execute.js`：
  - 新增会话模型解析（`agents.get(sessionId)?.model?.current()` → `agentDefaultModel?.currentSelection()`）与 `llm-pi-ai` 提供方配置读取；
  - 统一 `toolModel` 与会话模型为单一锁定目标执行路径，覆盖全部模态（text / image / video / audio / document）；
  - 删除 `isProviderAdapterUnavailable` 三跳静默回退链（local CLI agent → `readCatalogDefault` → 官方默认路由）。
- `plugins/plugins/omnimux/src/headless/execute.js` 与 `plugins/plugins/omnimux/src/text/http.js`：透传可选 `sessionId`（及 `headless/execute.js` 的可选 `toolModel`），使带会话上下文的调用能精准跟随对应会话模型。
- `plugins/docs/contracts/headless-skill-execution.md`：同步说明模型选择遵循“默认跟随当前会话模型、可由插件配置 `toolModel` 覆盖、失败显式报错不静默回退”。
- 单测与回归验证：`plugins/plugins/omnimux/src/text/tool-model-fallback.test.js`、`plugins/plugins/omnimux/src/text/execute.test.js`、`plugins/plugins/omnimux/src/text/mount.test.js`、`plugins/plugins/omnimux/src/headless/headless.test.js`。

不做：本次不改设置页前端 UI 组件与文案（设置页已有 `工具模型` 下拉框，默认 `自动` 并列出所有会话可达模型）。

## 证伪方式

1. **跟随会话模型**：`toolModel` 为 `''` 或 `'auto'`，提供 `agentDefaultModel` / `agents` 时，纯文本、图片与视频请求必须严格命中当前会话 `{ provider, model }`，且 `scenarioBindings` / `defaultTextModel` / `defaultAnalysisModel` 不会劫持路由；切换会话模型后下一次调用立即跟随新模型。
2. **多模态不支持显式报错**：当前会话模型不支持图片（`llm.stream` 抛 `UNSUPPORTED_CONTENT`）或使用不支持视频直传的协议（如 `anthropic-messages`）或 `omnimux` 模型契约不含该模态时，必须直接抛错且调用次数为 1（或前置 0 次网络请求），绝不静默切到 `gemini-3.8-flash` 或其它提供方。
3. **插件配置 `toolModel` 显式覆盖且零回退**：配置 `toolModel` 后，无论当前会话模型是什么、无论文本/图片/视频，均严格使用 `toolModel`；当 `toolModel` 对应适配器缺失或提供方未配置时，必须直接抛错，绝不调用本地 CLI Agent、`modelCatalog` 默认值或官方默认路由；跨提供方直连绝不读取或发送 `OMNIMUX_API_KEY` / `resolveOfficialApiKey`。
4. **实网验证**：在隔离临时 `DSH_HOME` 中基于本工作树源码，以真实 `magpie` 会话模型（`toolModel: 'auto'`）与 `omnimux:gemini-3.8-flash`（会话切换 / `toolModel` 覆盖）跑通灵感拆解（纯文本、多图、小视频、超 9MB 视频压缩）与翻译，并核验不支持视频的协议/模型显式报错。

## 旧标准变更

- `plugins/plugins/omnimux/src/text/tool-model-fallback.test.js` :: `tool model without a registered provider retries with the live catalog default`
  - 原断言：已配置的 `toolModel` 缺少提供方适配器时，静默重试目录默认模型。
  - 变更理由：按本规格与用户明确要求，移除一切静默回退；失效的 `toolModel` 必须显式报错，默认则跟随当前会话模型。
  - 新期望证据：改为验证失效 `toolModel` 显式抛错且零回退，以及未设 `toolModel` 时跟随会话模型的新回归用例，`pnpm --filter omnimux test` 全量通过。
- `plugins/plugins/omnimux/src/text/tool-model-fallback.test.js` :: `without a catalog the stale tool model still falls back to the default text route`
  - 原断言：没有目录数据时，失效的 `toolModel` 静默回退到官方默认文本路由。
  - 变更理由：按本规格与用户明确要求，移除静默回退到默认官方路由的行为，防止掩盖失效配置。
  - 新期望证据：改为验证缺少适配器时直接透传错误且零额外调用，`pnpm --filter omnimux test` 全量通过。
- `plugins/plugins/omnimux/src/text/tool-model-fallback.test.js` :: `a verified local agent is preferred over the catalog stream fallback`
  - 原断言：失效的 `toolModel` 优先静默回退到已验证的本机 CLI Agent。
  - 变更理由：按本规格与用户明确要求，禁止将失效 `toolModel` 暗中切往本机 CLI Agent。
  - 新期望证据：改为验证即便存在已验证本机 CLI Agent，失效 `toolModel` 仍直接报错且不触发本地 Agent 调用，`pnpm --filter omnimux test` 全量通过。
- `plugins/plugins/omnimux/src/text/tool-model-fallback.test.js` :: `a failing local agent falls through to the catalog default`
  - 原断言：本机 CLI Agent 回退失败后继续静默跌落到目录默认模型。
  - 变更理由：该多跳静默回退链已按本规格整体移除，不再存在本地 Agent → 目录默认的隐式降级路径。
  - 新期望证据：替换为验证多模态不支持/适配器缺失均严格直报错且零回退的新用例，`pnpm --filter omnimux test` 全量通过。
- `plugins/plugins/omnimux/src/text/execute.test.js` :: `a video reference skips the tool model lane instead of throwing invalid-request`
  - 原断言：配置 `toolModel: 'cpa:gpt-6.1-sol'` 后发送视频引用，断言跳过 `toolModel` 并静默落到 `scenarioBindings.analysis` 的 BYOK 模型 `my-model`。
  - 变更理由：按本规格，`toolModel` 对全部模态生效，绝不因携带视频而静默忽略用户指定的 `toolModel` 并改用其它提供方。
  - 新期望证据：更新为验证配置 `toolModel` 发送视频时严格使用该 `toolModel` 对应的 `llm-pi-ai` `openai-completions` 通道（且不读取官方凭据），若该提供方未配置或协议不支持则直接报错且零回退，`pnpm --filter omnimux test` 全量通过。

## 验收

- `pnpm --filter omnimux test`
- `pnpm --filter omnimux-inspiration test`
- `pnpm check:boundaries`
- `pnpm --dir plugins verify:product-baseline`
- `pnpm --dir plugins verify:plugin-load`
- `pnpm --dir plugins verify:model-contracts`
- 隔离实网调用验证（文本、多图、小视频、超 9MB 视频、翻译、会话模型跟随、不支持模态自然报错与 `toolModel` 覆盖）
