# feat: 宿主 --dsw-* 主题 Token 静态白名单/棘轮门禁 + dsh-ui-kit 未定义 Token 清零（#264）

## 背景与目标

`LESSONS.md`「网关、目录与宿主运行时契约单一真源，客户端不得自造默认值、推导命名或伪造就绪状态」（`seen 3`）要求：宿主运行时契约必须消费上游真实定义，客户端不得凭语义臆造 Token。现有 `guard-ui-rules.mjs` 只禁止裸色 Hex/rgba，反而鼓励使用 `var(--dsw-alias-*)` 却不校验 Token 是否真实存在，导致 #259 一类「静态检查全绿、暗色真机才暴露」的缺陷。

本单交付三件事：

1. 全仓 `--dsw-*` 真源白名单 + 单向不增棘轮静态门禁 `plugins/scripts/verify-dsw-tokens.mjs`，接入 CI；
2. 修复共享设计系统基座 `plugins/packages/dsh-ui-kit` 的全部裸写未定义 Token（17 处 / 6 个 CSS Module），并完成明/暗双主题真实浏览器视觉验收；
3. 将对应 `LESSONS.md` 条目从活跃规则迁入「已毕业」。

## AC-1 · 真源核实与提取口径

### 双壳运行态事实

- 产品仓有两个 Electron 壳：`app/dsh-desktop-next`（新壳）与 `app/dsh-plugin-desktop`（Cordis 插件壳）。两者 `package.json` 均依赖 `@deepseek-ai/dsh-client-ui-theme` 与 `@deepseek-ai/dsh-web-app`，加载同一套 Harness Web UI。
- `app/deepseek-harness/packages/client/ui-theme/src/client/styles.ts` 在运行时把 8 张样式表注入 `document.head`：`base.css`、`corner-shape.css`、`design-platform.css`、`focus.css`、`onboarding.css`、`scrollbar.css`、`gradient-shadow-text.css`、`shiki.css`。
- 上述 8 张表合并后共 **450 个 `--dsw-*` Token**（含颜色 / 表面 / 边框 / 状态 / 阴影 / 圆角 / 字阶等）。只扫 `design-platform.css` 会漏掉 `base.css` 的 `--dsw-radius-*`/`--dsw-font-*` 与 `gradient-shadow-text.css` 的 `--dsw-elevation-*`，从而误杀合法 Token。
- 两壳按 `app/upstream.json` 与各自 `package.json` 锁定的 `@deepseek-ai/dsh-client-ui-theme` 版本不同：`app/dsh-desktop-next`（活跃线）锁定 `0.2.2-rc.5`（450 个 Token），冻结的 `app/dsh-plugin-desktop` 锁定 `0.2.1-rc.3`（403 个 Token；双版本交集 402 个 Token，当前插件对 rc.5 新增的 48 个 Token 引用为 0）。rc.3 中出现的全部 `--dsw-*` 除一个已无引用的 `--dsw-specific-sidebar-nav-item-hover` 外均为 rc.5 上游子集，因此白名单以活跃线 rc.5 的 450 Token 为准。
- 两壳自身 native-ui 样式（`dsh-desktop-next/src/native-ui/theme.css` + `onboarding.css`、`dsh-plugin-desktop/src/native-ui/shared/theme.css` + `compatibility-chrome/style.css`）与 `dsh-desktop-next/src/web-document.ts` 启动态样式共出现 44 个 `--dsw-*` 定义（29 / 9 / 6），经逐项核对 **全部**是上述 8 张表的子集；因此双壳交集真源 = ui-theme 运行时 8 张表。
- 非运行时测试夹具/快照里的 `--dsw-*` 定义（如 `test-support/`、`*.e2e.test.js` 内联样式）不算真源。

### CI 无 submodule 的机制

- `.github/workflows/quality-gate.yml` 的 `actions/checkout@v4` **未配置 `submodules: true`**，CI 中 `app/deepseek-harness` 为空目录，门禁不能依赖现场读取。
- 因此上游真源固化为版本化快照 `plugins/scripts/dsw-token-allowlist.json`：
  - `source.harnessCommit` 记录 `PROVENANCE.json` 中 `app/deepseek-harness` 的 pin（当前 `9c2670d3bce5…`）；
  - `source.styleFiles` 固定 8 张运行时表；
  - `source.tokens` 固化 450 个 Token。
- 门禁在 CI 只读快照，并始终校验 `PROVENANCE.json` 的 submodule pin 与 `source.harnessCommit` 一致；任何子模块升级未重生成快照都会 `allowlist-pin-stale` 失败。
- 本地存在 submodule 时，额外逐字节重算 8 张表并与快照集合比对，漂移即 `allowlist-stale`；`--update-allowlist` 按真实真源重生成。

## AC-2 · 门禁语义

### 扫描范围

- `plugins/plugins/*/src/**`、`plugins/packages/*/src/**` 的 `.css/.scss/.less/.ts/.tsx/.js/.jsx/.mjs`。
- 排除 `node_modules`、`lib`、`dist`、`build`、`tests`、`test`、`__tests__`、`fixtures`、`fixture`、`test-support`、`coverage`、`openreel`、`vendor`，以及 `*.test.*` / `*.spec.*`。
- 提取前按文件类型安全剥离注释并保留换行：`.css/.scss/.less` 只剥 `/* ... */` 块注释（跳过引号字符串，`//` 不视为注释，避免误吞 `url(https://...)`）；`.js/.jsx/.ts/.tsx/.mjs` 剥 JS 行注释与块注释（保护字符串/模板字符串内的 `//`），并同时剥 CSS-in-JS 模板字符串内的 `/* ... */`，注释中的伪定义与伪引用一律不参与判定。
- Token 引用 = `var(--dsw-*)` 的每一次出现（含带 fallback 形态 `var(--dsw-*, …)`，二者同等计入）；`REFERENCE_RE` 带右侧 `(?=\s*[,)])` 定界，`var(--dsw-alias-*, …)` 这类散文片段不会被前缀截断误提取。
- 合法集合 = 上游 450 Token ∪ 同一插件/包 `src/` 内出现的 `--dsw-*: value` 本地定义。

### 单向不增棘轮

- `plugins/scripts/dsw-token-baseline.json` 按「插件/包 → 文件 → `{count, tokens}`」记录存量。
- 判定：`actual.count <= baseline.count` 且 `actual.tokens ⊆ baseline.tokens`。`actual < baseline` 永远放行并只打印「可收紧」提示，绝不因清理而失败；`--update-baseline` 主动收紧。
- `plugins/packages/dsh-ui-kit` 锁定为 0：任何未定义 Token 直接 `ui-kit-undefined-token` 失败，且基线文件出现该包条目即 `ui-kit-baseline-entry` 失败。
- 存量基线（本单修复前实测）：673 处未定义引用 / 130 个唯一 Token / 14 个包；修复后 651 处 / 13 个包（dsh-ui-kit 清零 17 处：9+1+1+2+2+2）。

### CI / 脚本登记

- `.github/workflows/quality-gate.yml`：`Run syntax & contract gates` 增加 `node --check scripts/verify-dsw-tokens.mjs`；`Repo gate scripts` 增加 `node scripts/verify-dsw-tokens.mjs` 与 `node --test scripts/verify-dsw-tokens.test.mjs`。
- `plugins/package.json`：新增 `verify:dsw-tokens`，并接入 `verify:gates` 与 `test:gates`。
- `plugins/scripts/governance-manifest.json`：登记 `verify-dsw-tokens.mjs`、`verify-dsw-tokens.test.mjs`。

## AC-3 · dsh-ui-kit Token 映射决策（基于上游真实解析色值）

上游 `design-platform.css` 亮/暗块实测解析值（light | dark）：

| 位置 | 原未定义 Token | 替换为 | 解析值（light | dark） | 实测对比度 |
|---|---|---|---|---|---|
| Badge `.brand` bg | `--dsw-alias-brand-secondary` | `--dsw-alias-interactive-bg-active` | `rgba(38,49,72,.10)` | `rgba(255,255,255,.14)` | 15.76 / 8.53 |
| Badge `.success` bg | `--dsw-alias-state-success-subtle` | `--dsw-alias-state-success-tertiary` | `rgb(230,250,237)` | `rgb(35,60,44)` | 2.09 / 5.25 |
| Badge `.warning` bg | `--dsw-alias-state-warning-subtle` | `--dsw-alias-state-warn-tertiary` | `rgb(254,245,231)` | `rgb(39,36,31)` | 2.58 / 5.53 |
| Badge `.warning` 文本 | `--dsw-alias-state-warning-primary` | `--dsw-alias-state-warn-label` | `rgb(221,134,41)` | `rgb(221,134,41)` | 同上（与警告浅底配对） |
| Badge `.error` bg | `--dsw-alias-state-error-subtle` | `--dsw-alias-interactive-bg-hover-danger` | `rgba(236,19,19,.05)` | `rgba(242,90,90,.15)` | 4.15 / 3.53 |
| Badge `.info` bg | `--dsw-alias-state-info-subtle` | `--dsw-alias-state-business-tertiary` | `rgb(228,237,253)` | `rgb(52,65,91)` | 3.60 / 4.39 |
| Badge `.info` 文本 | `--dsw-alias-state-info-primary` | `--dsw-alias-state-business-primary` | `rgb(65,118,230)` | `rgb(122,170,255)` | 同上（与信息浅底配对） |
| MediaCard/Table/SelectableTile 选中 | `--dsw-alias-interactive-bg-selected` | `--dsw-alias-interactive-bg-active` | `rgba(38,49,72,.10)` | `rgba(255,255,255,.14)` | 15.76 / 8.53（选中行文本） |
| StatBar 上升趋势 | `--dsw-alias-status-success` | `--dsw-alias-state-success-primary` | `rgb(34,197,94)` | `rgb(34,197,94)` | 2.28 / 6.12 |
| Tabs `.pill .tabItem.active` bg | `--dsw-alias-bg-elevated` | `--dsw-alias-bg-layer-3` | `rgb(255,255,255)` | `rgb(53, 54, 56)` | — |

补充说明：

- 原清单为 9 Token/15 处/5 文件；实际扫描发现 `tabs/Tabs.module.css` 另有 2 处 `--dsw-alias-bg-elevated`（同为未定义），本单一并清零，故实际为 10 Token/17 处/6 文件。
- 错误色避坑：`--dsw-alias-state-error-secondary` 亮/暗均为实心 `rgb(242,90,90)`，不是浅底；浅红底使用 `--dsw-alias-interactive-bg-hover-danger`。
- 对比度取舍：Badge 的 success/warning/info 文本使用上游状态主色配官方浅底，实测 2.09–3.60（亮）/4.39–5.53（暗），低于 WCAG AA 4.5。这与上游 `ui-primitives/Tag.module.css`（`state-success-primary` 10% 混合底 + 同色文本）及 `ConnectionIndicator` 的官方配对一致；本单不硬塞裸色或臆造 Token，保留官方语义配对并在验收报告显式标注该取舍，供评审决定是否另立 a11y 专单。

## AC-4 · LESSONS 毕业

- 将「网关、目录与宿主运行时契约单一真源…（`seen 3`）」从「活跃规则」移入「已毕业」表，落地位置链接 `AGENTS.md#硬约束` 与 `plugins/scripts/verify-dsw-tokens.mjs`（#264 / 本 PR）。

## 验证记录（本机实测）

- `node plugins/scripts/verify-dsw-tokens.mjs`：通过，18 个插件/包、上游 Token 450、存量未定义引用 651（13 个包，均在基线内）、`dsh-ui-kit 0`。
- `node --test plugins/scripts/verify-dsw-tokens.test.mjs`：23 pass / 0 fail。
- `corepack pnpm --filter dsh-ui-kit test`：77 pass / 0 fail（含新增 `src/token-contract.test.js` 与三处组件断言更新）。
- `node --test plugins/scripts/verify-agents-md.test.mjs`：9 pass；`verify-governance-registry.test.mjs`：4 pass。
- `node plugins/scripts/analyze-lessons-signals.mjs . --json`：退出 0，活跃条目与已毕业表解析正常。
- 全仓 18 包剥离前后差异审计：仅 4 处带 `--dsw-*` 的引用被剥除（`Divider.tsx` 1、`GenWaveCard.module.css` 1、`GenWaveCard.tsx` 1、`genWavePalette.ts` 1；`genWavePalette.ts` L6 的 `--dsw-alias-*` 为纯文本提及，不计入引用），逐行核对全部位于注释；旧实现 136 行误吞（评审所述 123 行正则相关 + 13 行模板相关）全部归零，0 行有效代码/字符串被误剥，剥离前后行数一致。
- 真实浏览器：工作树外演示目录 `omnimux-demos/issue-264-dsw-ui-kit/index.html`（不提交入仓）加载真实 `design-platform.css`；Playwright 1.63 + 系统 Chrome 无头（1440×1100 @2x）截取 Light/Dark 全页与 5 个组件分区共 12 张截图，`results.json` 记录 52 个探针的 computed color / effective background / WCAG 对比度；已用 `read_image` 复核明暗双主题，无不可读、偏色或透底。

## 旧标准变更

以下既有用例断言的 Token 名本身是未定义 Token，随本单清零必须改为官方真实 Token；断言强度（`assert.match` 对 CSS 正则、禁止裸色 Hex/rgb 的 `doesNotMatch`）不变。

- `plugins/packages/dsh-ui-kit/src/badge/Badge.test.js` :: `consumes official --dsw-alias-* tokens across all variants without raw hex or rgb`
  - 原断言：`var(--dsw-alias-state-warning-primary)` 与 `var(--dsw-alias-state-info-primary)` 存在。
  - 必须改的理由：这两个 Token 在宿主 `design-platform.css` 中不存在，属被本单清零的未定义引用；真实 Token 为 `--dsw-alias-state-warn-label` 与 `--dsw-alias-state-business-primary`。
  - 新期望证据：断言改为上述真实 Token；新增 `src/token-contract.test.js` 全量校验 `dsh-ui-kit` 每个 `var(--dsw-*)` 都在上游白名单或本地定义内。

- `plugins/packages/dsh-ui-kit/src/table/Table.test.js` :: `uses only official --dsw-alias-* tokens in Table.module.css`
  - 原断言：`var(--dsw-alias-interactive-bg-selected)` 存在。
  - 必须改的理由：该 Token 不存在；真实选中态 Token 为 `--dsw-alias-interactive-bg-active`。
  - 新期望证据：断言改为 `--dsw-alias-interactive-bg-active`，并由 `token-contract.test.js` 全量兜底。

- `plugins/packages/dsh-ui-kit/src/tile/SelectableTile.test.js` :: `uses only official --dsw-alias-* tokens for background, border, and states`
  - 原断言：`var(--dsw-alias-interactive-bg-selected)` 存在。
  - 必须改的理由：同上，未定义 Token 清零。
  - 新期望证据：断言改为 `--dsw-alias-interactive-bg-active`，并由 `token-contract.test.js` 全量兜底。

## 双向证伪记录

- 新增未定义 Token（裸写 `var(--dsw-foo)`）= `undefined-token` 失败。
- 新增未定义 Token（带 fallback `var(--dsw-foo, #fff)`）同样失败。
- 同一文件实际计数超过基线 = `baseline-exceeded` 失败；引入基线外新 Token = `undefined-token` 失败。
- 实际计数低于基线 = 通过（并提示可收紧）。
- 合法上游 Token（`--dsw-radius-*` / `--dsw-font-*` / `--dsw-elevation-*` / `--dsw-alias-*`）与本包本地定义 = 通过。
- `dsh-ui-kit` 任意未定义 Token = `ui-kit-undefined-token` 失败；基线出现 `dsh-ui-kit` 条目 = `ui-kit-baseline-entry` 失败。
- CSS 块注释里的 `/* --dsw-fake-local: 1 */` 不能放行 `var(--dsw-fake-local)`（失败）；CSS 块注释、JS 行注释与 JSDoc 中的 `var(--dsw-not-real)` / `var(--dsw-alias-*, #fff)` 不误报。
- CSS-in-JS 模板字符串内的 `/* --dsw-fake-local: 1 */` 同样不能放行，`/* var(--dsw-not-real) */` 不误报。
- `var(--dsw-alias-*, #fff)` / `var(--dsw-platform-*, #hex)` 不再被前缀截断提取。
- CSS `url(https://example.com/a.png)` 与 JS 字符串中的 `https://...` 之后，同行 `var(--dsw-not-real)` 仍被正常捕获（`//` 保护未吞有效代码）。
