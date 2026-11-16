# 桌面补丁登记（Desktop Patches）

本文件是 OmniMux 客户端桌面壳本地补丁的唯一登记表。每次升级 dsh（`dsh-version.json` 的 commit 变化）或升级桌面壳后，先运行：

```bash
node scripts/desktop-patch-audit.mjs
```

审计脚本解析本文件并扫描源码里的 `desktop-patch:DP-xxx` 标记与登记的选择器。输出分类：

- `PASS`：补丁存在且 `verified_against` 与当前 `dsh-version.json` 一致。
- `MISSING`：登记的补丁文件或选择器/标记在源码里找不到（升级后被冲掉，需要补回）。
- `ORPHAN`：源码中有 `desktop-patch:DP-xxx` 标记，但本文件没有登记。
- `UPSTREAM_FIXED`：本表标记上游已修复——必须删除本地补丁，以官方实现为准。
- `REVIEW_REQUIRED`：`verified_against` 与当前 dsh commit 不一致，需人工复核。

退出码 0 表示全部 `PASS`；任何其他状态均非 0，可直接接入 CI。

## 登记表

| ID | 状态 | 问题 | 位置 | 标记/选择器 | 影响状态 | 上游是否已修复 | verified_against | 回归方式 | 删除条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DP-001 | active | macOS 展开态侧栏 brand/logo 行上提到 52px 红绿灯条，避免顶部留白 | app/dsh-desktop-next/src/client/styles.ts:13-37 | text:html[data-platform='darwin'] [class*='_topStrip']；text:[class*='_topStrip'] + [class*='_logoRow'] | expanded、fullscreen（macOS） | 不适用 | 1f81c047fc48fa190a683e469daa699857e9afe8 | cd app && corepack yarn workspace dsh-desktop-next verify:window-controls；四态截图 | 官方 AppFrame 自带 52px brand row 且 verify:window-controls 覆盖后删除 |
| DP-002 | active | Settings 左侧导航保持 40×164 并独立滚动 | app/dsh-desktop-next/src/client/styles.ts:39-58 | text:body [data-shortcut-modal='settings'] > nav；text:padding-right: calc(10px - var(--dsh-scrollbar-width, 5px)) | settings 弹窗 | 不适用 | 1f81c047fc48fa190a683e469daa699857e9afe8 | cd app && corepack yarn workspace dsh-desktop-next verify:window-controls；Settings 导航滚动截图 | 上游设置导航自带宽高/滚动实现后删除 |
| DP-003 | active | 左侧栏收起时 conversation header 未给 topbar 按钮让位，会话标题与「打开侧栏/新建会话」重叠 | plugins/plugins/omnimux/src/client/conversation-box.js | marker:desktop-patch:DP-003；text:[data-slot="conversation.header"] > header；text:[data-slot="conversation.header"] header | collapsed、hidden、fullscreen（980/1280/1800） | 否 | 1f81c047fc48fa190a683e469daa699857e9afe8 | node --test plugins/plugins/omnimux/src/client/conversation-header-patch.test.js；node scripts/desktop-patch-audit.mjs | 当前壳真实发布 --dsh-frame-leading-clearance 或官方 ConversationRoot 自带对位，且四态 DOM 测试无需本地规则后删除 |
| DP-004 | active | 官方侧栏 toggle 困在 sidebar 低 stacking context，需注入 topbar toggle/new-session 并固定几何 | plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.js | marker:desktop-patch:DP-004；text:export const SIDEBAR_TOGGLE_TOPBAR_ATTR = 'data-omnimux-sidebar-toggle-topbar'；text:export const TOPBAR_NEW_SESSION_ATTR = 'data-omnimux-topbar-new-session' | collapsed、hidden、fullscreen（980/1280/1800） | 否 | 1f81c047fc48fa190a683e469daa699857e9afe8 | node --test plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.test.js；verify:window-controls（Next）；四态截图 | 官方 AppFrame 在 topbar 提供稳定可点击的 toggle + new-session 且不再被遮挡后删除 |

## 升级流程

1. 更新 dsh pin（`dsh-version.json` / `PROVENANCE.json`）后运行 `node scripts/desktop-patch-audit.mjs`，确认没有 `MISSING` / `ORPHAN` / `UPSTREAM_FIXED` / `REVIEW_REQUIRED`。
2. `REVIEW_REQUIRED`：逐条核对 `verified_against` 与新 commit 的差异；确认补丁仍必要后更新本表 `verified_against`。
3. `UPSTREAM_FIXED`：删除对应本地补丁与登记行，以官方实现为准；删除前必须跑对应回归。
4. 每次桌面发版前跑四态检查：expanded / collapsed / hidden / fullscreen × 窗口宽度 980 / 1280 / 1800；至少保留 header padding、titleCluster 与 topbar 两按钮 rect 不相交的截图与 DOM 数值。
5. 插件侧改动按根 `AGENTS.md` 验证：根 `corepack pnpm install --frozen-lockfile && corepack pnpm --dir plugins run build:all`；相关包 `pnpm --filter <pkg> test`。
