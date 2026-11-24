# omni-agent 补齐内置 web_fetch 网页读取兜底（Issue #199）

## 背景与目标

`plugins/presets/omni-agent/agent.cordis.yml` 与 `omnimux-market` 动态生成的 8 个跨境 SOP 专家预设都把
`@deepseek-ai/dsh-tool-web` 配成 `fetch: false`，只暴露 `web_search`。官方 `@deepseek-ai/dsh-base` 已原生挂载
`@deepseek-ai/dsh-web` 与匿名只读 HTTP(S) provider `@deepseek-ai/dsh-web-fetch-http`（内置大小/超时/重定向限制，
不依赖密钥），因此关掉 `fetch` 只是产品侧把可用能力收窄了。

结果是：当 Hub 的 `omnimux_page_fetch` 未挂载、未登录、超配额或报错时，Agent 没有轻量网页读取兜底，容易退化成
`bash curl`。目标是打开内置 `web_fetch`，并在人格里写清「优先 page_fetch、必要时回退 web_fetch、不要用 curl」。

## 范围

- `plugins/scripts/build-agent-presets.mjs`：`tool-web.config.fetch` 由 `false` 改为 `true`（保留 `searchTimeoutMs: 60000`，其余走官方默认）。
- `plugins/presets/omni-agent/Agent.md`：在 Capability contracts 一节补网页读取分工与回退规则；重跑生成器同步到 `agent.cordis.yml`。
- `plugins/plugins/omnimux-market/src/expert-runtime.ts`：动态专家预设同源改为 `fetch: true`，重建 `lib/expert-runtime.js`。
- `plugins/plugins/omnimux-browser/extension/tests/preset-chips.spec.ts`：只更新过期注释（原注称 host 未暴露 `web_fetch`），断言不弱化。
- 回归测试：
  - `plugins/scripts/verify-agent-presets.test.mjs` 新增预设/生成器/人格三处一致性断言；
  - `plugins/scripts/verify-tool-web-fetch-fallback.test.mjs` 新增真机回环集成用例（真实官方 `dsh-tool-web` + 本地 HTTP 服务器）；
  - `plugins/plugins/omnimux-market/src/tests/experts-market.test.ts` 新增动态专家预设 `fetch: true` 断言。
- `plugins/package.json`：`presets:verify` 挂上新的集成用例。
- `specs/fix-omni-agent-web-fetch-199.spec.md`（本文件）与 `bundle.lock.json`（只刷新 `omnimux-browser`、`omnimux-market` 两个受改动槽位）。

## 事实依据

- 官方 `dsh-tool-web` 的 `Config` 里 `fetch` 默认 `true`，`apply()` 仅在 `resolved.fetch` 为真时注册 `web_fetch`；因此 `fetch: false` 是唯一让工具消失的开关。
- `dsh-base` 已挂载 `dsh-web` 与 `dsh-web-fetch-http`，`web_fetch` 走 `ctx.web.fetch()`，与 Hub 的 `omnimux_page_fetch` 是两条独立链路。
- 全仓 `fetch: false` 仅剩上述三个预设源头（`agent.cordis.yml`、生成器、`expert-runtime.ts`），无其他兄弟预设漏改。

## 假设

- 打开 `fetch` 不改变 `omnimux_page_fetch` 的优先地位：人格明确「优先 page_fetch 提取干净 Markdown」。
- 内置 provider 的匿名只读限制（大小/超时/重定向）足够覆盖「轻量直读公开静态页/文档」场景，不需要额外参数。
- 关闭 `fetch` 时既有的 `web_search` 行为与提示词不受影响（回归用例断言 `web_search` 仍注册）。

## 证伪方式

- 把生成器 `fetch` 改回 `false` 并重跑生成器：`verify-agent-presets.test.mjs` 与 `verify-tool-web-fetch-fallback.test.mjs` 均转红（预设行断言 + `web_fetch` 未注册）。
- 只把 `expert-runtime.ts` 改回 `false`：集成用例的 `dynamic expert preset must enable web_fetch` 转红。
- 恢复后两条用例全绿，说明断言确实绑定在修复上而不是环境。

## 回归测试设计

- `verify-tool-web-fetch-fallback.test.mjs` 从仓库内 `app/vendor/dsh-runtime/<version>` 解包真实 `@deepseek-ai/dsh-tool-web`
  （版本读自 `dsh-version.json`，不访问公网），配 `cordis`/`schemastery`/`dsh-tools` 的工作区安装副本；仅把
  `turndown`/`@joplin/turndown-plugin-gfm` 换成最小模块桩（回环用例走纯文本正文，不触发 HTML→Markdown 转换）。
- 该用例分别用 `presets/omni-agent/agent.cordis.yml` 与 `buildMarketExpertPluginRows()` 的真实 `tool-web` 配置驱动官方
  工具：断言 `web_fetch` 注册成功、对本地回环 HTTP 服务器真实抓取返回 200 与正文标记；同一套断言在 `fetch: false` 下
  必然失败（内置反向对照块）。
- 测试环境不挂载 `omnimux_page_fetch`，对应「Hub 页面读取不可用」场景。

## 验收（合并 `origin/main@6268ee8a` 后实测）

- `corepack pnpm --dir plugins run presets:verify`：15 pass / 0 fail。
- `corepack pnpm --dir plugins run verify:tools`：0 阻断错误（4 条既有可优化项）。
- `corepack pnpm --dir plugins run test:agent-tools`：通过。
- `corepack pnpm --dir plugins --filter omnimux-market test`：1045 pass / 1 skip / 0 fail。
- `cd plugins/plugins/omnimux-browser/extension && corepack pnpm test`：1793 pass / 1 expected fail。
- `corepack pnpm --dir plugins run build:all`：13/13。
- `node scripts/bundle-lock.mjs --check`（14 plugins）、`node scripts/workspace-check.mjs --check`、`verify-plugin-load` 15/15、`verify-plugin-boundaries` 5222 source files、`verify-fix-regression-test` 识别 3 个有效回归测试、`verify-test-standard-declarations` 通过、`gitleaks` no leaks、`git diff --check` 全绿。
- `corepack pnpm --dir plugins run test:gates`：736 pass / 1 fail。唯一失败 `live-qa.test.mjs` 的 stage 计数（期望 7、实际 8）在 `origin/main` 上已存在，修复随未合入的 PR #244（与本单不同工作树、同一文件）；本单不触碰该文件，不在此重复修。

## 双向证伪记录（本机实测）

- 生成器 `fetch` 改回 `false` 并重跑生成器：`verify-agent-presets.test.mjs` 新增用例红（`generated preset must enable web_fetch`），`verify-tool-web-fetch-fallback.test.mjs` 红（`fetch: true must register web_fetch`）。
- `expert-runtime.ts` 单独改回 `false`：`verify-tool-web-fetch-fallback.test.mjs` 红（`dynamic expert preset must enable web_fetch`）。
- 还原后两处恢复全绿（15 pass）。

## 旧标准变更

只更新 `preset-chips.spec.ts` 里的一条过期注释（原注称 host 未暴露 `web_fetch`），对标指令仍以 `web_search` 为主，
既有 `/搜索/`、`/search/` 断言保持原样，无测试削弱。
