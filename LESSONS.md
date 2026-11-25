<!-- reviewed-through: ba51fda433df5483345c3dc3f48beb7dd0d279ce (2026-11-24) -->
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
