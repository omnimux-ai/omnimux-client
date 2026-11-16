# Spec: #47 会话标题与左上按钮重叠修复 + 桌面补丁审计

- 任务：`issue-47-conversation-title`
- 日期：2026-11-16
- 基线：`origin/main`（`e5e2e32`）
- 风险：R2（legacy advanced 壳的会话面板 chrome；不改后端，不改官方 dsh 源码）

## 目标

- 左侧栏收起（`data-omnimux-left-collapsed`）时，会会话面板 `<header>` 为 topbar 的「打开侧栏 / 新建会话」两个固定按钮让出 `--omnimux-topbar-toggle-end`（当前 164px），标题不与按钮相交。
- 真实 advanced 壳 slot 结构为 `[data-slot="conversation.header"] > header > [data-slot="conversation.session.header"]`；旧补丁把 `conversation.session.header` 当成 header 祖先，选择器全部不命中。
- 建立 `docs/desktop-patches.md` 与 `scripts/desktop-patch-audit.mjs`，升级后按 PASS / MISSING / ORPHAN / UPSTREAM_FIXED / REVIEW_REQUIRED 审计本地补丁。

## 验收

- [ ] AC-1 expanded / collapsed / hidden / fullscreen 四态，980 / 1280 / 1800 三宽度下 header padding 与 titleCluster/topbar 按钮 rect 断言通过，旧 selector 回退用例可复现重叠。
- [ ] AC-2 DP-001~DP-004 登记完整，审计脚本 exit 0；回退 DP-003 selector 时 MISSING 且 exit 1。
- [ ] AC-3 仅改 `plugins/plugins/omnimux` + 新增 docs/scripts/spec；不改 `app/deepseek-harness` 子模块与冻结旧树。
- [ ] AC-4 `pnpm --filter omnimux build`、相关安全套件、`check:boundaries`、`verify:stages` 通过。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/apps-stage-box.test.js` :: `hides the session header and selected-row highlight while a product stage is active`
  - 原断言：`assert.match(PRODUCT_STAGE_CHROME, /data-omnimux-left-collapsed\] \[data-slot="conversation\.session\.header"\] header/)`，把 `conversation.session.header` 当成 `<header>` 的祖先。
  - 必须改：真实 DOM 中它是 `<header>` 内部锚点，原 selector 永远不匹配；改为 `[data-slot="conversation.header"] > header` 与 `[data-slot="conversation.header"] header` 两条真实结构断言。
  - 新期望证据：`conversation-header-patch.test.js` 的真实 slot fixture 四态 × 980/1280/1800 全绿；旧 selector 回退用例变红。

- `plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.test.js` :: `includes topbar toggle fixed geometry, visual-0 rail, tabBar padding, blue dot`
  - 原断言：`assert.match(PRODUCT_STAGE_CHROME, /data-omnimux-left-collapsed\] \[data-slot="conversation\.session\.header"\] header/)` 与不带 fallback 的 `padding-left` 正则。
  - 必须改：同上的 selector drift；同时把 `padding-left` / `padding-top` 断言更新为带实际 fallback `164px` / `4px` 的写法，避免默认值丢失时测试仍通过。
  - 新期望证据：same suite `88 pass / 0 fail`；真实 Dev collapsed 测量 `padding-left:164px`、titleCluster x164 且与两按钮无相交。
