# Spec: 彻底下线归档 任务表单（omnimux-forms）与社交采收（omnimux-social-harvest）

- 任务：`retire-forms-social-harvest`
- 日期：2026-11-26
- 风险：中（移除已发布插件源码、桌面壳依赖、契约包与中枢 HTTP/客户端入口；需保住灵感库复刻会话预填通道，并兼容升级后既有用户 Profile）

## 背景

`omnimux-forms`（任务表单）与 `omnimux-social-harvest`（社交采收）确认彻底下线归档：

1. `omnimux-social-harvest` 源码从未迁入 `omnimux-client`，仅在外部旧仓（`omnimux-dsh` commit `563e18cbb`）保留；但本仓仍残留中枢「更多」菜单项与外部 Alpha 名单、官方插件栏卡片、`budget-baseline.json`（含 6 个 `harvest_*` 工具与 2608 字符计数）、工作流 E2E 清单以及 `test-env-bootstrap.mjs` 共享列表。
2. `omnimux-forms` 目前作为内置 preview 插件随本仓构建分发，包含插件本体（`plugins/plugins/omnimux-forms`）、独占契约包（`plugins/packages/form-contract`）以及 `omnimux` 中枢内的 `/omnimux/forms/attachments*` HTTP 路由、`forms/bridge.js`、`window.__omnimuxForms`、`plugin-lifecycle.json`、工作台 `omnimux-forms:tasks` 占位与插件栏卡片。
3. 直接删除 `omnimux/src/client/forms/mount.js` 会误伤同文件挂载的 `SessionPrefillConsumer`（`window.__omnimuxSessionPrefill`），该接缝目前由 `omnimux-inspiration` 的「复刻到对话」功能主动消费。

## 目标

1. 完成下线前可恢复验证：通过 `agent-backup` 核验 Git 可达性（`omnimux-client@b79e801b`、`omnimux-dsh@563e18cbb`）与文件 SHA-256，保留历史可回溯记录。
2. 彻底移除 `plugins/plugins/omnimux-forms` 与 `plugins/packages/form-contract`，同步清理 `plugins/package.json`、`.github/workflows/quality-gate.yml`、`plugins/scripts/*`（许可清单、Token 基线、预算基线、插件注册表、同步/自检/测试引导脚本）。
3. 清理 `omnimux` 中枢与 `omnimux-market` 中两个插件的运行态与 UI 入口：
   - 将 `SessionPrefillConsumer` 与 `session-prefill.js` 从原 `forms/` 目录独立拆出至 `plugins/plugins/omnimux/src/client/session-prefill/`，维持 `omnimux:session-prefill` 与 `window.__omnimuxSessionPrefill` 行为不变；
   - 删除 `forms/bridge.js`、`forms/mount.js`、`host/form-attachments*.js`、`omnimux-forms:tasks` 工作台占位与 `client-window-seams.md` 中的 `__omnimuxForms`；
   - 从 `sidebar-coordinator.js`（`EXPLORE_MENU_ITEMS`、`EXTERNAL_ALPHA_PLUGINS`）、`plugin-lifecycle.json` 与 `omnimux-market/src/client/plugins-column.js` 移除两插件条目。
4. 更新桌面壳与插件档位单真源：
   - `app/config/plugin-tiers.json`：`omnimux-forms` 从 `preview` 迁入 `retired`，`omnimux-social-harvest` 加入 `retired`；
   - `app/dsh-desktop-next/src/profiles.ts` 的 `retireUpstreamBundles` 自动清理旧版本用户 `dsh.profile.bundles` 中未单独安装的 `TIERS.tiers.retired` 插件（写入 recovery 备份，不删用户 `$DSH_HOME` 历史目录）；
   - 更新 `app/dsh-desktop-next/package.json`、`app/dsh-plugin-desktop/preset/{skeleton/package.json,owned-packages.json}`、`app/scripts/build-plugin-index.mjs`、根脚本（`bundle-lock.mjs`、`verify-app-local-plugins.mjs`、`verify-plugin-builds.mjs`、`verify-packaged-plugins.mjs`）、`bundle.lock.json` 与双包管理器锁文件（`pnpm-lock.yaml`、`app/yarn.lock`）。

## 非目标

- 不改动外部 `dsh-plugin` 仓旧目录，不执行 `npm deprecate`（用户另有授权再处理）。
- 不清理或改写用户本机 `$DSH_HOME` 历史表单/采收数据目录。
- 不删除既有的历史演示文件 `ui-demo/more-menu-alpha-demo.html` 与 `#3834` 脚本。

## 研究依据

- `app/config/plugin-tiers.json` 已有 `omnimux-automation` 退役先例，`tiers.retired` 表示不再分发、仅作档位防错登记。
- `plugins/plugins/omnimux-inspiration/src/client/session-prefill.js` 消费 `window.__omnimuxSessionPrefill`，不消费 `window.__omnimuxForms`。
- `app/dsh-desktop-next/src/profiles.ts` 的 `retireUpstreamBundles` 已有备份后摘除失效包名的幂等路径，可扩展覆盖 `TIERS.tiers.retired`。
- `scripts/verify-packaged-plugins.mjs`、`scripts/bundle-lock.mjs`、`scripts/verify-app-local-plugins.mjs` 与 `scripts/verify-plugin-builds.mjs` 存在硬编码插件总数校验，必须与 `dsh-desktop-next/package.json` 的实际 `omnimux*` 依赖数（14 → 13）保持一致。

## 验收标准

- 高保真演示页面 `ui-demo/retire-forms-social-harvest-demo.html` 在亮/暗双主题、常规/窄屏下完整展示修改前后菜单、市场卡片与关键接缝状态。
- 全仓运行态、`sidebar-coordinator`、`plugins-column`、`plugin-tiers`、`bundle.lock.json`、`plugins.registry.json` 与 `budget-baseline.json` 不再包含活跃的 `omnimux-forms`、`omnimux-social-harvest` 或 `harvest_*` 引用。
- `SessionPrefillConsumer` 与 `omnimux-inspiration` 复刻到对话单测与集成测试全部通过。
- `dsh-desktop-next` 单测验证旧 Profile 含 `omnimux-forms`/`omnimux-social-harvest` 时在启动时自动摘除、未单独安装时幂等留存恢复备份；手动在 `dependencies` 安装时予以保留。
- 产出端到端回归测试 `plugins/plugins/omnimux/tests/e2e/retire-forms-social-harvest.e2e.test.js` 与真实无头 Chrome 截图/报告证据落盘 `docs/evidence/retire-forms-social-harvest/`。

## 假设

- 仓内及桌面壳仅 `omnimux-forms` 依赖 `@omnimux/form-contract` 与 `/omnimux/forms/attachments`，不存在隐藏的第三方消费方；`omnimux-inspiration` 仅通过 `window.__omnimuxSessionPrefill` 与 `omnimux` 协作。
- 升级后桌面壳不再于 `app/dsh-desktop-next/package.json` 分发 `omnimux-forms`，由 `retireUpstreamBundles` 在用户打开旧 Profile 时先备份再移除已退役且未独立安装的 bundle 名称，即可避免缺失包阻塞启动。

## 证伪方式

- 在工作区全文检索活跃源码、`plugin-lifecycle.json`、`bundle.lock.json` 与 `plugins.registry.json`；若仍存在活跃的 `omnimux-forms`、`@omnimux/form-contract`、`__omnimuxForms` 或 `omnimux-social-harvest` 引用，或 `session-prefill*.test.js` / 灵感复刻单测失败，即证明耦合未彻底切断或误伤预填通路。
- 在 `profiles.spec.ts` 构造包含 `omnimux-forms` 与 `omnimux-social-harvest` 的旧 Profile 夹具并调用 `ensure()` / `loadNextProfile()`：回退 `retireUpstreamBundles` 改动后该断言必失败（`dsh.profile.bundles` 仍残留已退役插件）；恢复后必须摘除成功且再运行呈幂等。
- 运行工作区门禁（`test:gates`、`verify:licenses`、`verify:plugin-load`、`test:agent-tools -- --budget`、`verify-test-standard-declarations.mjs`、`app` `typecheck`/`test`、`workspace-check.mjs --check`）与真实 Chrome E2E 验收；任一门禁失败即阻断合入。

## 旧标准变更

- `plugins/plugins/omnimux-forms/src/store.test.mjs` :: `persists stable values through reopening and isolates workspace and template versions`
  - 原断言：验证 `omnimux-forms` 存储隔离模板与工作区草稿版本。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除，对应宿主存储随包删除。
  - 新期望证据：插件目录已从工作区移除，且 `agent-backup` 与 Git 提交记录保留完整快照。
- `plugins/plugins/omnimux-forms/src/store.test.mjs` :: `serializes writes and rejects stale concurrent revision without losing content`
  - 原断言：验证 `omnimux-forms` 并发写入版本冲突校验。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已从工作区移除，相关门禁无残余引用。
- `plugins/plugins/omnimux-forms/src/store.test.mjs` :: `rejects temporary URLs, unexpected metadata and path-shaped ids without writing outside storage`
  - 原断言：验证 `omnimux-forms` 存储拒绝非法路径和元数据。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已从工作区移除，相关门禁无残余引用。
- `plugins/plugins/omnimux-forms/src/http.test.mjs` :: `draft routes enforce origin, optimistic revision and self-contained media ranges`
  - 原断言：验证 `omnimux-forms` 草稿 HTTP 路由与媒体范围。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已从工作区移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `all seven native Chakra fields render labels, controls and escaped text`
  - 原断言：验证表单字段组件渲染。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已从工作区移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `theme emits no document reset or html/body base styling`
  - 原断言：验证表单客户端主题不污染全局样式。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录与 `dsw-token-baseline.json` 对应条目已移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `browser page embeds the real templates and contract without a runtime source dependency`
  - 原断言：验证表单构建内嵌模板与 `@omnimux/form-contract`。
  - 必须改的理由：`omnimux-forms` 与 `@omnimux/form-contract` 同步下线移除。
  - 新期望证据：两包目录与 `plugins/package.json` 相关命令已移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `packaging copies real example bytes and fails if required sources are missing`
  - 原断言：验证表单构建拷贝 `@omnimux/form-contract` 示例视频。
  - 必须改的理由：`omnimux-forms` 与 `@omnimux/form-contract` 同步下线移除。
  - 新期望证据：两包目录与对应构建检查已移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `malformed bundled definition fails closed before reading examples or fields`
  - 原断言：验证损坏表单定义 fail-closed 提示。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/components.test.mjs` :: `page attaches its real workbench store, balances replacement and unmount, and hides inactive content`
  - 原断言：验证表单工作台页签挂载。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档，`omnimux-forms:tasks` 工作台占位同步移除。
  - 新期望证据：`WORKBENCH_OCCUPANTS` 不再包含 `omnimux-forms:tasks`。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `changed prompt creates fresh id and reset retains template defaults`
  - 原断言：验证表单模型提交与重置。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `corrupt restoration fails closed and cannot overwrite original`
  - 原断言：验证损坏草稿恢复阻断。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `double click shares in-flight submission; retry preserves request id after timeout`
  - 原断言：验证表单幂等提交重试。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `intentionally cleared numeric field remains editable after restoration`
  - 原断言：验证表单数字字段恢复可编辑性。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `late import after removal or disposal never repopulates values`
  - 原断言：验证表单异步上传销毁竞态。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `malformed restored field data stays preserved until explicit reset`
  - 原断言：验证表单异常恢复数据保留策略。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `restores and revalidates refs; blocks stale files before creating a session`
  - 原断言：验证表单恢复文件引用校验。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/model.test.mjs` :: `save failures retain edits and prevent session creation`
  - 原断言：验证表单保存失败保留编辑并阻断建会话。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/workbench-seat.test.mjs` :: `client apply keeps the tasks tab but does not mount the left sidebar row`
  - 原断言：验证表单仅注册工作台页签、不挂左侧栏。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录与 `omnimux-forms:tasks` 均已移除。
- `plugins/plugins/omnimux-forms/src/client/workbench-seat.test.mjs` :: `forms workbench seat (hidden from left sidebar)`
  - 原断言：验证表单工作台占位契约。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/plugins/omnimux-forms/src/client/workbench-seat.test.mjs` :: `sidebar entry uses the workbench store and exports standard selectors`
  - 原断言：验证表单侧栏入口选择器契约。
  - 必须改的理由：`omnimux-forms` 插件彻底下线归档并从仓库移除。
  - 新期望证据：插件目录已移除。
- `plugins/packages/form-contract/test/cli.test.mjs` :: `*`
  - 原断言：验证 `@omnimux/form-contract` CLI 命令、模板初始化与报错行为。
  - 必须改的理由：`@omnimux/form-contract` 随唯一消费方 `omnimux-forms` 一并下线归档删除。
  - 新期望证据：包目录与根脚本中的 `form:` / `verify:forms` 命令已移除。
- `plugins/packages/form-contract/test/contract.test.mjs` :: `*`
  - 原断言：验证 `@omnimux/form-contract` 表单校验、插值与原型污染防护。
  - 必须改的理由：`@omnimux/form-contract` 随唯一消费方 `omnimux-forms` 一并下线归档删除。
  - 新期望证据：包目录已移除且全仓工作区无任何剩余引用。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `same request races create one session, imports one set, sets one draft and never sends`
  - 原断言：验证 `createFormsBridge` 并发幂等建会话。
  - 必须改的理由：`forms/bridge.js` 仅服务于已下线的 `omnimux-forms`，随任务表单一并移除（共用 `session-prefill.js` 已拆出独立测试）。
  - 新期望证据：`forms/bridge.js` 删除；`session-prefill.test.js` 独立通过。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `materialization retry retains preallocated session identity`
  - 原断言：验证表单桥接失败重试保留预分配会话标识。
  - 必须改的理由：`forms/bridge.js` 随 `omnimux-forms` 下线移除。
  - 新期望证据：`window.__omnimuxForms` 不再挂载，`session-prefill` 独立运行正常。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `protects target text before any attachment write`
  - 原断言：验证表单桥接写附件前保护目标输入文本。
  - 必须改的理由：`forms/bridge.js` 随 `omnimux-forms` 下线移除（输入栏文本保护契约由 `session-prefill.test.js` 继续覆盖）。
  - 新期望证据：`session-prefill.test.js` 与 `session-prefill-consumer.test.js` 通过。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `rolls back only newly attached files when official draft write throws`
  - 原断言：验证表单桥接回滚新增附件。
  - 必须改的理由：`forms/bridge.js` 随 `omnimux-forms` 下线移除。
  - 新期望证据：`forms/bridge.js` 与 `forms/mount.js` 已移除。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `rejects reuse of request id for different content`
  - 原断言：验证表单桥接拦截同 `requestId` 跨内容复用。
  - 必须改的理由：`forms/bridge.js` 随 `omnimux-forms` 下线移除。
  - 新期望证据：`forms/bridge.js` 已移除。
- `plugins/plugins/omnimux/src/client/forms/bridge.test.js` :: `timeout after write can recover on retry after a bridge reload with the same session identity`
  - 原断言：验证表单桥接重载后同会话恢复。
  - 必须改的理由：`forms/bridge.js` 随 `omnimux-forms` 下线移除。
  - 新期望证据：`session-prefill.test.js` 对 `omnimux-inspiration` 的同构重试契约持续通过。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `imports real immutable bytes and resolves across service reads without exposing paths`
  - 原断言：验证 Hub 表单附件存储导入字节并屏蔽路径。
  - 必须改的理由：Hub `/omnimux/forms/attachments` 运行时随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除且无路由或调用方残留。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `rejects forged MIME, missing refs and path traversal`
  - 原断言：验证表单附件存储拦截伪造 MIME 与路径穿越。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `materializes through composer into verified session workspace and reuses a durable receipt`
  - 原断言：验证表单附件物化与回执幂等。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `receipt retry rebuilds changed bytes under a new name and preserves user edits`
  - 原断言：验证表单附件回执重建不覆盖用户修改。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `receipt retry rebuilds deleted file and rejects symlinks without touching their targets`
  - 原断言：验证表单附件物化拒绝符号链接。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `materialization refuses symlink import directories before writing outside workspace`
  - 原断言：验证表单附件导入目录符号链接防护。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments.test.js` :: `long ASCII and Chinese display names never become filesystem basenames`
  - 原断言：验证表单附件展示名不作为磁盘文件名。
  - 必须改的理由：Hub 表单附件存储随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments-http.test.js` :: `form attachment routes require Host authentication`
  - 原断言：验证 `/omnimux/forms/attachments` 路由要求鉴权。
  - 必须改的理由：Hub `/omnimux/forms/attachments` HTTP 路由随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments-http.js` 与 `http.js` 注册调用已移除。
- `plugins/plugins/omnimux/src/host/form-attachments-http.test.js` :: `write requests reject absent and foreign browser origins`
  - 原断言：验证 `/omnimux/forms/attachments` 写请求 Origin 校验。
  - 必须改的理由：Hub `/omnimux/forms/attachments` HTTP 路由随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments-http.js` 已移除。
- `plugins/plugins/omnimux/src/host/form-attachments-http.test.js` :: `JSON metadata requests have a bounded body and reject malformed input`
  - 原断言：验证 `/omnimux/forms/attachments` JSON 请求体上限与解析错误。
  - 必须改的理由：Hub `/omnimux/forms/attachments` HTTP 路由随 `omnimux-forms` 下线移除。
  - 新期望证据：`form-attachments-http.js` 已移除。
- `plugins/plugins/omnimux/src/client/forms/session-prefill.test.js` :: `registers in the official input dock, which remains mounted for a blank-session Hero`
  - 原断言：读取同目录下 `./mount.js` 验证 `SESSION_PREFILL_SLOT`。
  - 必须改的理由：将共用 `session-prefill` 从即将删除的 `forms/` 目录迁移至独立 `plugins/plugins/omnimux/src/client/session-prefill/`，原 `forms/session-prefill.test.js` 迁移改名。
  - 新期望证据：`plugins/plugins/omnimux/src/client/session-prefill/session-prefill.test.js` 继续执行该完全一致的源码正则断言并全绿。
- `plugins/plugins/omnimux/src/client/forms/session-prefill.test.js` :: `wires queued intents into the mounted official composer consumer`
  - 原断言：读取同目录下 `./mount.js` 验证 `useSyncExternalStore` 接线。
  - 必须改的理由：同上，测试随 `session-prefill` 模块一并迁往 `src/client/session-prefill/`。
  - 新期望证据：迁移后的 `session-prefill/session-prefill.test.js` 继续通过该断言。
- `plugins/plugins/omnimux/src/client/forms/session-prefill.test.js` :: `*`
  - 原断言：旧路径下全部 `session-prefill` 用例。
  - 必须改的理由：随 `forms/` 目录拆除，原文件迁往 `plugins/plugins/omnimux/src/client/session-prefill/session-prefill.test.js`（若 Git 未配对为重命名，旧路径将呈删除态）。
  - 新期望证据：新路径 `plugins/plugins/omnimux/src/client/session-prefill/session-prefill.test.js` 运行全部同等用例并全绿。
- `plugins/plugins/omnimux/src/client/forms/session-prefill-consumer.test.js` :: `mounted official consumer appends a queued intent to the existing draft`
  - 原断言：从 `forms/mount.js` 导入 `SessionPrefillConsumer`。
  - 必须改的理由：`SessionPrefillConsumer` 与测试一并从 `forms/` 迁至独立目录 `plugins/plugins/omnimux/src/client/session-prefill/`。
  - 新期望证据：迁往 `plugins/plugins/omnimux/src/client/session-prefill/session-prefill-consumer.test.js` 后继续通过。
- `plugins/plugins/omnimux/src/client/forms/session-prefill-consumer.test.js` :: `mounted consumer refuses append while the composer is not plain`
  - 原断言：从 `forms/mount.js` 导入 `SessionPrefillConsumer`。
  - 必须改的理由：同上，迁至独立目录 `session-prefill/`。
  - 新期望证据：迁移后继续通过。
- `plugins/plugins/omnimux/src/client/explore-more-menu.test.js` :: `Alpha 内测项带行内标识，非 Alpha 项保持纯字符串文案（Issue #3823）`
  - 原断言：`alphaLabels` 期待包含 `'任务表单'` 与 `'社交采收'`（共 6 项）。
  - 必须改的理由：任务表单与社交采收已从 `EXPLORE_MENU_ITEMS` 下线移除。
  - 新期望证据：`alphaLabels` 精确断言为 `['发布', '账号', '手机管理', '数据分析']`（与 `TRUTH` 顺序一致）并通过。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `开发版：Alpha 内测项不挂 DOM，核心常驻项挂回侧栏`
  - 原断言：行清单示例包含 `'forms'`。
  - 必须改的理由：`omnimux-forms` 已下线移除，不再作为示例 Alpha 插件。
  - 新期望证据：剔除 `'forms'` 后核心常驻项（`workflow`、`inspiration`）与剩余 Alpha/收敛项断言继续通过。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `发布渠道过滤：开发版保留全部入口，正式版只过滤 Alpha 测试版`
  - 原断言：开发版清单期待包含 `'任务表单'` 与 `'社交采收'`。
  - 必须改的理由：`EXPLORE_MENU_ITEMS` 已移除任务表单与社交采收。
  - 新期望证据：开发版断言剩余 7 项（`'应用', '图像生成', '视频剪辑', '发布', '账号', '手机管理', '数据分析'`），正式版仍保留非 Alpha 3 项。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `正式版渠道：Alpha 行注册不创建元素、不进收敛集合，菜单只剩非 Alpha 项`
  - 原断言：`alphaNames` 列表包含 `'forms'` 与 `'social-harvest'`。
  - 必须改的理由：两插件已从 `plugin-lifecycle.json` 与 `EXTERNAL_ALPHA_PLUGINS` 下线。
  - 新期望证据：使用活跃 Alpha 列表 `['accounts', 'publish', 'analytics', 'device', 'avatar']` 继续验证正式版零创建零收敛行为。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `侧栏全局 seam 暴露 Alpha 判定与统一说明，供插件自注册菜单复用`
  - 原断言：`api.isAlphaEntry('omnimux-social-harvest')` 与 `api.isAlphaEntry('omnimux-social-harvest-entry')` 返回 `true`。
  - 必须改的理由：`omnimux-social-harvest` 已从 `EXTERNAL_ALPHA_PLUGINS` 彻底清除。
  - 新期望证据：补充断言 `api.isAlphaEntry('omnimux-social-harvest') === false` 与 `api.isAlphaEntry('omnimux-forms') === false`，且活跃 Alpha 判定继续通过。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `非核心插件（video, products 旧入口, device, clip, social-harvest, apps 等）收敛，不渲染独立行`
  - 原断言：测试列表中包含 `omnimux-social-harvest-entry`。
  - 必须改的理由：社交采收已彻底下线归档，不再作为现役非核心入口保留名录（标题与列表同步移除 `social-harvest`）。
  - 新期望证据：其余非核心收敛入口断言通过。
- `plugins/plugins/omnimux/src/client/workbench.test.js` :: `default focus matrix: canvas and all libraries default to gui (Issue #2006)`
  - 原断言：`WORKBENCH_OCCUPANTS` 包含 `'omnimux-forms:tasks'` 且 `WORKBENCH_OCCUPANTS.length === 10`。
  - 必须改的理由：`omnimux-forms` 彻底下线，`omnimux-forms:tasks` 从工作台占位真源移除，长度变为 9。
  - 新期望证据：断言不含 `'omnimux-forms:tasks'`、长度为 9 且其余 9 项默认聚焦模式校验通过。
- `plugins/plugins/omnimux/src/auth/http-routes.test.js` :: `apply mounts auth routes when webServer arrives through inject`
  - 原断言：注册路由清单期待包含 `'prefix:/omnimux/forms/attachments'`。
  - 必须改的理由：Hub `/omnimux/forms/attachments` 路由已随 `omnimux-forms` 移除。
  - 新期望证据：剔除该前缀后对其余全部 Hub 路由的精确集合断言继续通过。
- `plugins/scripts/package-preparation.test.mjs` :: `*`
  - 原断言：循环检查 `test:gates` / `check:package-files` 执行 `omnimux-forms/scripts/build-client.mjs`，并验证复制 `packages/form-contract/examples`。
  - 必须改的理由：`omnimux-forms` 与 `@omnimux/form-contract` 均已下线移除，对应前置准备脚本与测试用例整文件移除。
  - 新期望证据：`plugins/package.json`、`governance-manifest.json` 不再引用该文件，`verify-package-files.mjs` 对现役插件全部通过。
- `plugins/scripts/release-check.test.mjs` :: `checkManifest rejects machine-local specifiers that npm would ship verbatim`
  - 原断言：夹具包含 `devDependencies: { '@omnimux/form-contract': 'file:../../packages/form-contract' }`。
  - 必须改的理由：`@omnimux/form-contract` 已从仓库移除，替换为现役工作区私有/本地开发依赖名以继续覆盖同等断言语义。
  - 新期望证据：校验规则与错误条数断言（3 项报错、忽略 `devDependencies`）保持不变并通过。
- `plugins/scripts/release-check.test.mjs` :: `checkManifest accepts published semver ranges for workspace packages`
  - 原断言：夹具 `devDependencies` 引用 `@omnimux/form-contract`。
  - 必须改的理由：`@omnimux/form-contract` 已下线移除，改用通用工作区夹具名或 `@omnimux/generation-capabilities`。
  - 新期望证据：`checkManifest` 返回 `[]` 断言继续通过。
- `plugins/scripts/sync-release-policy.test.mjs` :: `uses the lifecycle registry as the exact Alpha plugin and tool-prefix source`
  - 原断言：`alphaPluginIds` 期待包含 `'omnimux-forms'`。
  - 必须改的理由：`plugin-lifecycle.json` 已移除 `omnimux-forms`。
  - 新期望证据：`alphaPluginIds` 精确匹配 `['omnimux-accounts', 'omnimux-publish', 'omnimux-analytics']` 并通过。
- `plugins/scripts/verify-profile-preflight.test.mjs` :: `preflight provides its own DSH_HOME and cleans it on success and failure`
  - 原断言：合成测试夹具名使用了 `'omnimux-forms'`。
  - 必须改的理由：消除对已下线插件 ID 的残留引用，改为 `'omnimux-accounts'`。
  - 新期望证据：预检 `DSH_HOME` 隔离与清理逻辑完全不变并通过。
- `plugins/scripts/verify-fix-regression-test.test.mjs` :: `路径与标题分类覆盖产品源码、测试、构建产物与标签`
  - 原断言：使用 `'plugins/plugins/omnimux-forms/scripts/build-client.mjs'` 作为 `isProductCodePath` 正例。
  - 必须改的理由：`omnimux-forms` 目录已删除，改用现役插件路径 `'plugins/plugins/omnimux/scripts/build-client.mjs'`。
  - 新期望证据：全部路径分类断言保持不变并通过。
- `plugins/scripts/guard-quality-loop.test.mjs` :: `isBusinessSourceFile identifies business source vs exemptions`
  - 原断言：使用 `'/repo/packages/form-contract/src/index.js'` 测试 `packages/*/src/` 判定。
  - 必须改的理由：`form-contract` 已下线，改用现役工作区共享包 `'/repo/packages/generation-capabilities/src/index.ts'`。
  - 新期望证据：`isBusinessSourceFile` 返回 `true` 断言不变并通过。
- `plugins/plugins/omnimux-workflow/tests/e2e/preset-operation-3206.journey.mjs` :: `*`
  - 原断言：`FIRST_LEVEL_APPS` 列表包含 `'任务表单'` 与 `'社交采收'`。
  - 必须改的理由：两插件彻底下线，不再作为一级应用入口存在。
  - 新期望证据：保留现役有效一级应用清单并通过检查。
- `app/scripts/plugin-tiers.test.mjs` :: `reads the shipped config with the expected tiers`
  - 原断言：`tiers.preview.includes('omnimux-forms')` 为 `true`。
  - 必须改的理由：`omnimux-forms` 已从 `preview` 迁至 `retired`，`omnimux-social-harvest` 已加入 `retired`。
  - 新期望证据：断言 `tiers.preview` 不含 `omnimux-forms`，且 `tiers.retired` 同时包含 `omnimux-automation`、`omnimux-forms` 与 `omnimux-social-harvest`。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `*`
  - 原断言：`PRODUCT_PLUGINS`、`ALPHA_PLUGINS`、`LIFECYCLE`、`declared` 与 staged manifest 夹具均引用 `omnimux-forms` 或 `@omnimux/form-contract`。
  - 必须改的理由：`omnimux-forms` 与 `@omnimux/form-contract` 均已下线移除，替换为现役 `@omnimux/generation-capabilities` 等等价夹具保持原有路径校验强度。
  - 新期望证据：`dsh-plugin-desktop` 全套单测通过。
- `app/dsh-plugin-desktop/tests/better-sidebar/verify-pipeline.mjs` :: `*`
  - 原断言：包名列表包含 `'omnimux-forms'`。
  - 必须改的理由：`omnimux-forms` 已迁至 `retired` 并从 `preview` 移除。
  - 新期望证据：列表仅保留 `preview + beta` 现役包。
- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：16 个插件全部登记且通过`
  - 原断言：`onDisk.length` 为 `16`，且 `counts` 断言为 `{ original: 11, fork: 3, vendor: 2 }`（含已改名用例）。
  - 必须改的理由：`omnimux-forms` 已随本次归档从 `plugins/plugins/` 与 `license-registry.json` 移除，工作区实际在仓插件数为 15 个（`original: 10`）。
  - 新期望证据：改名并更新断言为 `真实仓库：15 个插件全部登记且通过`（`onDisk.length === 15`，`{ original: 10, fork: 3, vendor: 2 }`）并通过。
- `plugins/scripts/verify-agents-skills-symlinks.test.mjs` :: `真实仓库：4 个仓库自有技能以真实目录入库`
  - 原断言：循环校验包含 `omnimux-form-authoring`。
  - 必须改的理由：`plugins/.agents/skills/omnimux-form-authoring` 仅服务于已下线的 `packages/form-contract` 与 `omnimux-forms`，已同步清理移除。
  - 新期望证据：从断言列表移除 `'omnimux-form-authoring'`。

## 验证

- `node --test plugins/plugins/omnimux/src/client/session-prefill/*.test.js`
- `node --test plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js plugins/plugins/omnimux/src/client/explore-more-menu.test.js plugins/plugins/omnimux/src/client/workbench.test.js plugins/plugins/omnimux/src/auth/http-routes.test.js`
- `node --test plugins/plugins/omnimux/tests/e2e/retire-forms-social-harvest.e2e.test.js`
- `corepack pnpm --dir plugins run build:all`
- `corepack pnpm --dir plugins run test:gates`
- `corepack pnpm --dir plugins run verify:licenses`
- `corepack pnpm --dir plugins run verify:plugin-load`
- `corepack pnpm --dir plugins run verify:stages`
- `corepack pnpm --dir plugins run test:agent-tools -- --budget`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node scripts/workspace-check.mjs --check`
- `node scripts/verify-app-local-plugins.mjs`
- `cd app && corepack yarn check`
- 无头 Chrome 对真实改动与演示页做亮/暗、窄屏截图与 DOM 验证并落盘 `docs/evidence/retire-forms-social-harvest/`

## 文档影响

- `plugins/README.md`：移除 `omnimux-forms` 描述。
- `plugins/docs/contracts/client-window-seams.md`：移除 `__omnimuxForms`，并将 `__omnimuxSessionPrefill` 生产者路径更新为 `plugins/plugins/omnimux/src/client/session-prefill/mount.js`（总数 43 → 42，按节更新）。
- `app/docs/*`、`docs/subsystems.md`：经检索均无两插件提及，无需改动。
