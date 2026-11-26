<!-- reviewed-through: d471e48ba7ac4d135b42f1010a1b4935ab06211b (2026-11-26) -->
# Lessons from merged work

改动源码或评审 PR 前先读本页活跃条目。本页只留可公开的工程反模式与正反例，**严禁写入密钥、内部地址、本机绝对路径或未公开信息**。

- **预算**：活跃账本上限 `200 行 / 16 KB`（由 [verify-agents-md.test.mjs](plugins/scripts/verify-agents-md.test.mjs) 在 CI 强制校验）。逐日复盘流水留在复盘 PR 正文或 commit body，不写入本页；增量信号由 [analyze-lessons-signals.mjs](plugins/scripts/analyze-lessons-signals.mjs) 定期提取。
- **代谢**：① 能写成脚本 / CI / Hook 守卫的教训优先直接转门禁，门禁上线后从活跃区移入「已毕业」；② 无法机检的规则跨复盘批次命中 `seen ≥ 3` 后压成 1–2 句晋升 [AGENTS.md](AGENTS.md) 或 [子系统文档](docs/subsystems.md)；③ 连续 30 天未再命中的 `seen 1` 条目归档清理。

## 活跃规则

### 验证与门禁

- **新增回归测试必须接入强制门禁并覆盖端到端真实路径**（`seen 2` · 最近 `2026-11-26`）
  - 为什么：只写文件不接 CI 链或只测上层 helper，回归时不会拦截真实故障。
  - 反例：#24（新测试初版未接入 `app` check 链）、#26（未登记 `governance-manifest.json` 致 CI 连红）、#31 初版 `cd4c0dc`（漏掉导入 → 槽位 → readiness 链路）。
  - 正例：#31 `3b642a8`（补端到端 `jsonDocumentExecution.test.mjs`，旧 head 5 fail → 新 head 5 pass）。
  - #299 新增第九个 live QA stage 后合入，必需 CI 仍绿。`live-qa.test.mjs` 在静态门禁测试清单之外，本地 `test:gates` 在主干报 `9 !== 8`。#312 从阶段契约派生集合并验证内容和 adapter，定向测试 10/10。 [#310](https://github.com/omnimux-ai/omnimux-client/issues/310) [#312 评审](https://github.com/omnimux-ai/omnimux-client/pull/312#pullrequestreview-6068166075)

- **样式与布局回归探针不得在夹具层注入宿主不存在的全局 CSS 重置，须还原宿主真实默认盒模型**（`seen 1` · 最近 `2026-11-23`）
  - 为什么：测试夹具全局注入 `* { box-sizing: border-box }` 会在离线探针中静默抹平容器自身漏设 `border-box` 引发的溢出裁切，使缺陷逃过自动化检查直到真实宿主宽视口暴露。
  - 反例：`plugins/scripts/test-fixtures/style-dom-probe.mjs:134` 全局注入 `* { box-sizing: border-box; margin: 0; padding: 0; }`，掩盖了 `.sh-mkt` 只写 `.sh-mkt *` 漏写自身导致的 `+40px` 右侧溢出。
  - 正例：#224 `8d58f0c8`（补 `.sh-mkt { box-sizing: border-box }`，并在 `skills-expert-overflow.e2e.test.js` 用 `:where(...) { box-sizing: content-box }` 显式还原宿主默认盒模型完成双向证伪）。

- **插件入口回归须挂接真实宿主包、代理或所依赖的运行时，覆盖延迟 `inject` 与完整入口执行**（`seen 2` · 最近 `2026-11-26`）
  - 为什么：手写宽松假桩会冻结在旧版服务签名或跳过 Cordis `inject` 代理守卫与不存在的主题 Token，导致单测和 `verify-plugin-load` 全绿而真机直接 `ReferenceError` 或 HTTP 502。
  - 反例：#239 `4327ad1e`（入口漏导入且装载检查未触发 `connection→sessions` 延迟 `inject`）、#253 初版 `17ce47bc`（普通对象桩掩盖越权读 `ctx.headlessSkill`）、#259 `362f88c2`（旧单调用桩掩盖 DSH 批次契约 HTTP 502）。
  - 正例：#239 直接执行真实入口，#253 `f9d27045` 用真实 Cordis 代理证伪，#259 挂接真实 `@deepseek-ai/dsh-tools` 并核对主题 Token。
  - #299 的 IPC 接线引用了发布版不存在的 `profiles.randomize`。#316 改用 `profiles.reseed`，并在隔离目录用 `v0.5.5` 二进制跑通真实 IPC。 [#299](https://github.com/omnimux-ai/omnimux-client/pull/299) [#316](https://github.com/omnimux-ai/omnimux-client/pull/316)

- **测试与冒烟脚本不得原地覆写已跟踪文件或写入未忽略目录，产物必须落临时目录或 `.gitignore` 路径**（`seen 1` · 最近 `2026-11-24`）
  - 为什么：测试或冒烟脚本每次运行就弄脏已跟踪文件或未忽略目录，会持续阻断 `sync-main` 净室物化门禁。
  - 反例：#247 之前 `chat-media-gallery-rail-height.e2e.test.js` 原地覆写已跟踪的 `plugins/.agent-reports/gallery-rail-height-2101/e2e-evidence.json`，且 `dev-smoke.mjs` 落盘到未忽略目录。
  - 正例：#247 `39a96534`（单测证据默认写入 `os.tmpdir()` 并于用例结束清理，冒烟产物统一落 `.gitignore` 已忽略的 `.workbuddy/evidence/dev-smoke/`）。

- **清理仍可能被异步任务写入的测试目录时，等待可控的写入方退出，为暂态文件系统错误设置有限重试，耗尽后保留失败**（`seen 1` · 最近 `2026-11-26`）
  - 递归删除期间继续写入会让最后的 `rmdir` 报 `ENOTEMPTY`。#298 与 #312 的首次队列 CI 均因此出队，归为同一清理竞态。 [#298 的 CI](https://github.com/omnimux-ai/omnimux-client/actions/runs/45745200645) [#312 的 CI](https://github.com/omnimux-ai/omnimux-client/actions/runs/45749401355)
  - #313 汇总 73 处清理到有限重试的 `fs.rm`。持续写入对照中旧路径 3/3 失败，新路径 3/3 清理成功。 [#313](https://github.com/omnimux-ai/omnimux-client/pull/313)

- **测试汇总必须把 skip 当作独立判定维度：环境性 skip 必须显式标记并判非通过，设计性 skip 只能显示类别；非 TAP runner（Vitest）必须单独解析，任何未分类 skip 都按 fail-closed 处理**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：`judge()` 只统计 `fail`/`cancelled` 时，探针缺失或 Vitest skip 会以 `ok` 收场，直接违反「环境不可用不得伪装成 pass」；只用自由文本猜原因又会误伤合法平台跳过。
  - #284 `4002111a` 的 runner 在无 Chrome 时仍汇总通过。#298 已合入 `c5d64961`，补齐 `[environment-unavailable]`、suite skip 与 Vitest summary 解析，延续 #286 同一事件。
  - 正例：#298 的 `parseTap()` 将 `describe.skip` 的 `type:'suite'` 单独计数，`parseVitestSummary()` 对 `Tests ... skipped/todo` fail-closed；真实无 Chrome 运行 `omnimux-analytics` 为 `skip=3 (environment=3, by-design=0)` exit 1，真实 Chrome 为 136/136 exit 0。

- **脚本/物化夹具必须复现生产目录布局与最低运行时（含 macOS bash 3.2），不能只用扁平夹具或 CI 默认 bash 版本**（`seen 1` · 最近 `2026-11-25`）
  - 为什么：扁平 `plugins/<name>` 夹具会把真实单仓 `plugins/plugins/<name>` 的解析错误藏到运行时；CI bash 5 也会掩盖 `set -u` 空数组在 bash 3.2 的崩溃。
  - 反例：#269 `121cb7bc` 合入 #268 后触发 `materialize=failed`；#272 `22bc22e1` 在 0.4h 内修 B1 混合改动漏装、B2 macOS bash 3.2 空数组、B3 `plugins/.agents` 等目录误判，旧 worktree.sh 在新增 3 条用例上 8 pass / 3 fail。
  - 正例：#272 使用真实 `plugins/plugins/<name>` 路径、`/bin/bash` 3.2 与混合改动用例，`worktree-primary-cleanliness 12/12`、`worktree-delivery + cleanup 62/62`。

- **PR 入队前须留下绑定最终 head 的独立评审通过记录**（`seen 2` · 最近 `2026-11-26`）
  - 为什么：合后评审只能靠追加 PR 修复，且会把问题与正常演进混在同一提交窗口，增加回归和审计成本。
  - 反例：#271 `6ef9fd6e`（04:25 合入）后独立评审提出 13 项缺陷，#274 `928f9785`（04:51，0.4h）修复其中影响正确性、契约一致性与门禁覆盖面的部分；两 PR 改同一 `omnimux-analytics` / `omnimux/src/text` / `verify-plugin-boundaries` 面。
  - #317 的可查 head PASS 晚于入队，#319 的可查 head PASS 晚于合入。同日计一次。 [#317 评审](https://github.com/omnimux-ai/omnimux-client/pull/317#pullrequestreview-6068448954) [#319 评审](https://github.com/omnimux-ai/omnimux-client/pull/319#pullrequestreview-6068426036)
  - #298 的最终 head `3265044d` 在首次入队前已有 PASS。 [#298 评审](https://github.com/omnimux-ai/omnimux-client/pull/298#pullrequestreview-6067904102)

- **公开仓每个合并 PR 必须绑定可追踪 Issue（`Closes/Fixes #...`）或在正文记录明确豁免；完整新插件、发布链与大范围改动不得以无 Issue 状态进入合并队列**（`seen 2` · 最近 `2026-11-26`）
  - 为什么：无 Issue 时无法回溯需求、验收边界、责任与回滚决定。
  - #299 `a6482ddb` 交付完整 PiBrowse 插件，仅引用 spec。#316 `a9ec0206` 修订同插件的 IPC 契约和用户入口，正文仍无工单关联或豁免。 [#299](https://github.com/omnimux-ai/omnimux-client/pull/299) [#316](https://github.com/omnimux-ai/omnimux-client/pull/316)
  - #312 关联 #310 并随合入闭环，#308 为纯文档复盘记录了明确豁免。

- **主干动过锁文件或插件包后，合并/变基禁止沿用自动合并的 `bundle.lock.json`，须取主干版本并在构建后重算**（`seen 2` · 最近 `2026-11-25`）
  - 为什么：`bundle.lock.json` 按包记录 `contentHash`，自动三方合并只按文本行拼装；主干与本分支各改不同槽位时文本不冲突，但「合并结果里每个哈希是否对应真实内容」只能靠按当前树重算来证明，沿用合并结果会让 `workspace-check` 与后续安装拿到的清单同实际产物脱节。
  - 反例：#186 的 PR #273（分支自 `f9d27045` 切出、落后主干 4 个提交，期间 #262/#266 改了 `dsh-ui-kit` 与 `bundle.lock.json`；分支变基到 `91e15206` 后，publish 槽哈希必须在合并后的树上重算，分支自身未改 `dsh-ui-kit`）、#275 的 PR #277（本分支改 `omnimux-inspiration` 槽，主干 #276 改 `omnimux` 槽，槽位正交但文本可自动合并）。
  - 正例：PR #277 `abfc670a`、PR #281 `d3144835`（先 `git checkout origin/main -- bundle.lock.json`，`build:all` 后 `pnpm run bundle:lock` 重算，`git diff origin/main -- bundle.lock.json` 只剩本任务单槽，再 `bundle:lock:check`）。
  - PR 自身改动锁文件时执行重算流程；基线落后且未改锁文件时，按入队口径核对当前 head 和合并树。 [AGENTS.md 工作区元数据](AGENTS.md#验证按改动边界选最小集) [#334](https://github.com/omnimux-ai/omnimux-client/pull/334)

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
| 合并前实测必验桌面交互（`seen 3`） | [AGENTS.md 合并前实测必验桌面交互](AGENTS.md#合并前实测必验桌面交互) · [verify-desktop-acceptance.mjs](app/scripts/verify-desktop-acceptance.mjs)（#97 / #131）。#323 的隔离 Dev 验收推迟至合入后，#327 / #335 的无头 Chromium 测试模拟原生拖拽命中，实际桌面点击仍须另验。 |
| `fix:` 回归测试存在性门禁 | [AGENTS.md · 一坑一测试](AGENTS.md#一坑一测试) · [verify-fix-regression-test.mjs](plugins/scripts/verify-fix-regression-test.mjs)（PR #207） |
| 真实非空载荷与双向证伪回归测试（`seen 3`） | [AGENTS.md · 一坑一测试](AGENTS.md#一坑一测试)（#18/#49/#53/#90/#107/#132/#142） |
| UI 真实渲染几何、连续操作与浮层防透底（`seen 3`） | [AGENTS.md · 合并与复核](AGENTS.md#合并与复核) · [guard-no-transparent-popover.mjs](plugins/scripts/guard-no-transparent-popover.mjs)（#45/#54/#112→#116/#155/#171） |
| 公开文档 DSH 运行时版本声明一致性 | [verify-docs-dsh-version.mjs](scripts/verify-docs-dsh-version.mjs) · [workspace-check.mjs](scripts/workspace-check.mjs)（PR #256） |
| 网关、目录与宿主运行时契约单一真源（`seen 3`） | [AGENTS.md · 硬约束](AGENTS.md#硬约束) · [verify-dsw-tokens.mjs](plugins/scripts/verify-dsw-tokens.mjs)（#264 / PR #266） |
