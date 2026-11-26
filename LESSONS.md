<!-- reviewed-through: 07ebba0626c64682b9a337def272dea1305d91d0 (2026-11-25) -->
# Lessons from merged work

改动源码或评审 PR 前先读本页活跃条目。本页只留可公开的工程反模式与正反例，**严禁写入密钥、内部地址、本机绝对路径或未公开信息**。

- **预算**：活跃账本上限 `200 行 / 16 KB`（由 [verify-agents-md.test.mjs](plugins/scripts/verify-agents-md.test.mjs) 在 CI 强制校验）。逐日复盘流水留在复盘 PR 正文或 commit body，不写入本页；增量信号由 [analyze-lessons-signals.mjs](plugins/scripts/analyze-lessons-signals.mjs) 定期提取。
- **代谢**：① 能写成脚本 / CI / Hook 守卫的教训优先直接转门禁，门禁上线后从活跃区移入「已毕业」；② 无法机检的规则跨复盘批次命中 `seen ≥ 3` 后压成 1–2 句晋升 [AGENTS.md](AGENTS.md) 或 [子系统文档](docs/subsystems.md)；③ 连续 30 天未再命中的 `seen 1` 条目归档清理。

## 活跃规则

### 验证与门禁

- **新增回归测试必须接入强制门禁并覆盖端到端真实路径**（`seen 1` · 最近 `2026-11-15`）
  - 为什么：只写文件不接 CI 链或只测上层 helper，回归时不会拦截真实故障。
  - 反例：#24（新测试初版未接入 `app` check 链）、#26（未登记 `governance-manifest.json` 致 CI 连红）、#31 初版 `cd4c0dc`（漏掉导入 → 槽位 → readiness 链路）。
  - 正例：#31 `3b642a8`（补端到端 `jsonDocumentExecution.test.mjs`，旧 head 5 fail → 新 head 5 pass）。

- **样式与布局回归探针不得在夹具层注入宿主不存在的全局 CSS 重置，须还原宿主真实默认盒模型**（`seen 1` · 最近 `2026-11-23`）
  - 为什么：测试夹具全局注入 `* { box-sizing: border-box }` 会在离线探针中静默抹平容器自身漏设 `border-box` 引发的溢出裁切，使缺陷逃过自动化检查直到真实宿主宽视口暴露。
  - 反例：`plugins/scripts/test-fixtures/style-dom-probe.mjs:134` 全局注入 `* { box-sizing: border-box; margin: 0; padding: 0; }`，掩盖了 `.sh-mkt` 只写 `.sh-mkt *` 漏写自身导致的 `+40px` 右侧溢出。
  - 正例：#224 `8d58f0c8`（补 `.sh-mkt { box-sizing: border-box }`，并在 `skills-expert-overflow.e2e.test.js` 用 `:where(...) { box-sizing: content-box }` 显式还原宿主默认盒模型完成双向证伪）。

- **宿主契约与插件入口回归须挂接真实宿主包/真代理并覆盖延迟 `inject` 与完整入口执行，禁止仅靠手写旧契约假桩**（`seen 1` · 最近 `2026-11-24`）
  - 为什么：手写宽松假桩会冻结在旧版服务签名或跳过 Cordis `inject` 代理守卫与不存在的主题 Token，导致单测和 `verify-plugin-load` 全绿而真机直接 `ReferenceError` 或 HTTP 502。
  - 反例：#239 `4327ad1e`（`omnimux/src/client/index.js` 漏导入 `createGenerationFeedback` 致桌面启动崩溃，因无入口测试且 `verify-plugin-load` 未触发嵌套 `connection→sessions` 延迟 `inject` 潜伏 10 天）、#253 一轮 `17ce47bc`（未注入 `headlessSkill` 却直读 `ctx.headlessSkill`，被普通 JS 对象桩掩盖）、#259 `362f88c2`（`omnimux-publish` 5 套单测手写旧单调用 `ctx.tools.execute` 假桩，掩盖 DSH `0.2.2-rc.5` 批次契约 HTTP 502 及宿主不存在的 `--dsw-alias-label-inverse`）。
  - 正例：#239（补 `client/index.test.js` 直接执行真实入口）、#253 `f9d27045`（改走 `readSeat(ctx, 'headlessSkill')` 并用真实 `@deepseek-ai/cordis` 探针证伪）、#259（新增 `hubtools-runtime.test.js` 挂接真实 `@deepseek-ai/dsh-tools` 并校验真实主题 Token）。

- **测试与冒烟脚本不得原地覆写已跟踪文件或写入未忽略目录，产物必须落临时目录或 `.gitignore` 路径**（`seen 1` · 最近 `2026-11-24`）
  - 为什么：测试或冒烟脚本每次运行就弄脏已跟踪文件或未忽略目录，会持续阻断 `sync-main` 净室物化门禁。
  - 反例：#247 之前 `chat-media-gallery-rail-height.e2e.test.js` 原地覆写已跟踪的 `plugins/.agent-reports/gallery-rail-height-2101/e2e-evidence.json`，且 `dev-smoke.mjs` 落盘到未忽略目录。
  - 正例：#247 `39a96534`（单测证据默认写入 `os.tmpdir()` 并于用例结束清理，冒烟产物统一落 `.gitignore` 已忽略的 `.workbuddy/evidence/dev-smoke/`）。

- **测试汇总必须把 skip 当作独立判定维度：环境性 skip 必须显式标记并判非通过，设计性 skip 只能显示类别；非 TAP runner（Vitest）必须单独解析，任何未分类 skip 都按 fail-closed 处理**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：`judge()` 只统计 `fail`/`cancelled` 时，探针缺失或 Vitest skip 会以 `ok` 收场，直接违反「环境不可用不得伪装成 pass」；只用自由文本猜原因又会误伤合法平台跳过。
  - 反例：#284 `4002111a` 合入时 `run-workspace-tests.mjs` 仍不把 `tap.skipped` 计为失败，`omnimux-analytics` 的 `{ skip: probe.skipped === true }` 在无 Chrome 时被汇总为通过；#286 由此另立，#298 `0c54711f` 补齐 `[environment-unavailable]` 标记、`skippedSuites` 与 Vitest summary 解析（评审 PASS，待合入）。
  - 正例：#298 的 `parseTap()` 将 `describe.skip` 的 `type:'suite'` 单独计数，`parseVitestSummary()` 对 `Tests ... skipped/todo` fail-closed；真实无 Chrome 运行 `omnimux-analytics` 为 `skip=3 (environment=3, by-design=0)` exit 1，真实 Chrome 为 136/136 exit 0。

- **脚本/物化夹具必须复现生产目录布局与最低运行时（含 macOS bash 3.2），不能只用扁平夹具或 CI 默认 bash 版本**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：扁平 `plugins/<name>` 夹具会把真实单仓 `plugins/plugins/<name>` 的解析错误藏到运行时；CI bash 5 也会掩盖 `set -u` 空数组在 bash 3.2 的崩溃。
  - 反例：#269 `121cb7bc` 合入 #268 后触发 `materialize=failed`；#272 `22bc22e1` 在 0.4h 内修 B1 混合改动漏装、B2 bash 3.2 空数组、B3 `plugins/.agents` 等目录误判，旧 worktree.sh 在新增 3 条用例上 8 pass / 3 fail。
  - 正例：#272 使用真实 `plugins/plugins/<name>` 路径、`/bin/bash` 3.2 与混合改动用例，`worktree-primary-cleanliness 12/12`、`worktree-delivery + cleanup 62/62`。

- **独立评审必须在 PR 入队前完成；合并后再评审会以 follow-up 承担整批契约/正确性回归**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：合后评审只能靠追加 PR 修复，且会把问题与正常演进混在同一提交窗口，增加回归和审计成本。
  - 反例：#271 `6ef9fd6e`（04:25 合入）后独立评审提出 13 项缺陷，#274 `928f9785`（04:51，0.4h）修复其中影响正确性、契约一致性与门禁覆盖面的部分；两 PR 改同一 `omnimux-analytics` / `omnimux/src/text` / `verify-plugin-boundaries` 面。
  - 正例：#277 `abfc670a`、#281 `d3144835`、#284 `2f46824e` 均在入队前完成独立评审（前者 PASS / 后者两轮 PASS）；#298 `0c54711f` 本轮也已在入队前完成净室复审。

- **公开仓每个合并 PR 必须绑定可追踪 Issue（`Closes/Fixes #...`）或在正文记录明确豁免；完整新插件、发布链与大范围改动不得以无 Issue 状态进入合并队列**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：无 Issue 时无法回溯需求、验收边界、责任与回滚决定；本区间 36 个业务/文档 PR 中 29 个正文没有 closing Issue，包含 #299 的 56 文件新插件。
  - 反例：#299 `a6482ddb`（PiBrowse 完整插件，正文仅引用 `specs/pibrowse-plugin.spec.md`，无 closing issue）、#291 `ff3c77d1`（只新增 spec）、#288/#292/#304 更新器与发布链、#294/#295/#306 资产改版均无 closing Issue。
  - 正例：#266（#264）、#267（#237）、#270（#199）、#273（#186）、#277（#275）、#281（#279）、#284（#280）均绑定 closing Issue。

- **主干动过锁文件或插件包后，合并/变基禁止沿用自动合并的 `bundle.lock.json`，须取主干版本并在构建后重算**（`seen 2` · 最近 `2026-11-25`）
  - 为什么：`bundle.lock.json` 按包记录 `contentHash`，自动三方合并只按文本行拼装；主干与本分支各改不同槽位时文本不冲突，但「合并结果里每个哈希是否对应真实内容」只能靠按当前树重算来证明，沿用合并结果会让 `workspace-check` 与后续安装拿到的清单同实际产物脱节。
  - 反例：#186 的 PR #273（分支自 `f9d27045` 切出、落后主干 4 个提交，期间 #262/#266 改了 `dsh-ui-kit` 与 `bundle.lock.json`；分支变基到 `91e15206` 后，publish 槽哈希必须在合并后的树上重算，分支自身未改 `dsh-ui-kit`）、#275 的 PR #277（本分支改 `omnimux-inspiration` 槽，主干 #276 改 `omnimux` 槽，槽位正交但文本可自动合并）。
  - 正例：PR #277 `abfc670a`、PR #281 `d3144835`（先 `git checkout origin/main -- bundle.lock.json`，`build:all` 后 `pnpm run bundle:lock` 重算，`git diff origin/main -- bundle.lock.json` 只剩本任务单槽，再 `bundle:lock:check`）。
  - 入口：[AGENTS.md · 工作区元数据](AGENTS.md#验证按改动边界选最小集)。

### 契约与运行时边界

- **异步交接、共享状态作用域与宿主主线程边界：跨会话/跨节点交接须带作用域与代际取消，Host 主线程严禁同步文件 I/O**（`seen 2` · 最近 `2026-11-22`）
  - 为什么：异步回执缺少作用域或代际取消，会导致草稿丢失、导入串节点或共享路由卡在加载态；Host 主线程同步扫盘会卡死桌面交互。
  - 反例：#129（新建会话 remount 丢失技能创建草稿）、#144（重选文件/JSON 未取消旧读取导致落到错误节点）、#162（画布与剪辑绑定串上下文）、#177（托管工坊共享路由停在无工程 `editor` 态导致欢迎页卡死）、#182（工程列表与文件读取阻塞 Host 主线程）。
  - 正例：#144（按当前节点隔离导入并取消过期 JSON 读取）、#177（无打开工程时将托管工坊路由收敛到 `welcome` 并禁用非法跳转）、#182（工程扫描与文件读取全部异步化移出主线程）。

### 打包与基线

- **打包与恢复归档必须用真实物理产物树验证，防 `.asar` 虚拟视图、稀疏文件与误裁 `node_modules`**（`seen 2` · 最近 `2026-11-20`）
  - 为什么：Electron Node 模式默认将 `.asar` 当虚拟目录、`tar --format=pax` 默认写入 GNU sparse 路径，按目录名裁剪还会误删包内 `dist/node_modules`，均须在真实物理产物树上校验。
  - 反例：#73 旧 head `74c10c2`（误裁 `pnpm/dist/node_modules` 致 `node-gyp` 失败）、#139→#142（`upgrade-dev` 缺 `ELECTRON_NO_ASAR=1` 且 `tar` 缺 `--no-read-sparse` 导致恢复归档校验失败）。
  - 正例：#73 `6980f56`（仅过滤 workspace 包并实跑 `preparePayload`）、#142 `deefbea0`（加 `ELECTRON_NO_ASAR=1` 与 `tar --no-read-sparse`/`-S` 并校验物理树哈希）。

- **移植旧分支或外部基线前先确认源树测试跑绿，元数据指纹必须指向本仓真实对象**（`seen 1` · 最近 `2026-11-14`）
  - 为什么：以发布快照或未跑绿 WIP 当开发基线会把隐藏回归带入主干；悬空 commit 指纹会导致审计与复现失败。
  - 反例：#1（以精简发布导出作开发基线致测试缺失）、#13（直接搬运未跑绿 WIP 暴露 4 条回归）、#14 初版（`PROVENANCE.json` 保留旧仓 commit）。
  - 正例：#4（恢复完整开发基线）、#14 `45aa422`（用 `git cat-file -t` 核对本仓真实提交）。

## 已毕业（已转规则或门禁）

| 主题 | 落地位置 |
|---|---|
| 发布链路预演（`seen 3`） | [AGENTS.md · 发布链路预演](AGENTS.md#发布链路预演) · [verify-plugin-index.mjs](app/scripts/verify-plugin-index.mjs)（PR #97 / #130） |
| 合并前实测必验桌面交互（`seen 3`） | [AGENTS.md · 合并前实测必验桌面交互](AGENTS.md#合并前实测必验桌面交互) · [verify-desktop-acceptance.mjs](app/scripts/verify-desktop-acceptance.mjs)（PR #97 / #131） |
| `fix:` 回归测试存在性门禁 | [AGENTS.md · 一坑一测试](AGENTS.md#一坑一测试) · [verify-fix-regression-test.mjs](plugins/scripts/verify-fix-regression-test.mjs)（PR #207） |
| 真实非空载荷与双向证伪回归测试（`seen 3`） | [AGENTS.md · 一坑一测试](AGENTS.md#一坑一测试)（#18/#49/#53/#90/#107/#132/#142） |
| UI 真实渲染几何、连续操作与浮层防透底（`seen 3`） | [AGENTS.md · 合并与复核](AGENTS.md#合并与复核) · [guard-no-transparent-popover.mjs](plugins/scripts/guard-no-transparent-popover.mjs)（#45/#54/#112→#116/#155/#171） |
| 公开文档 DSH 运行时版本声明一致性 | [verify-docs-dsh-version.mjs](scripts/verify-docs-dsh-version.mjs) · [workspace-check.mjs](scripts/workspace-check.mjs)（PR #256） |
| 网关、目录与宿主运行时契约单一真源（`seen 3`） | [AGENTS.md · 硬约束](AGENTS.md#硬约束) · [verify-dsw-tokens.mjs](plugins/scripts/verify-dsw-tokens.mjs)（#264 / PR #266） |
