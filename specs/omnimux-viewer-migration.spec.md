# Spec: omnimux-viewer 源码迁入 omnimux-client

- 任务：`omnimux-viewer-migration`
- 日期：2026-11-23
- 风险：R2（新增插件包，桌面依赖清单、发布索引与许可登记同步变化）

## 背景

「图像生成」工作台 Tab（`omnimux:media-viewer`）由 `omnimux-viewer` 插件注册，但该插件源码仍留在已归档的 `omnimux-dsh` 仓；`omnimux-client` 的菜单入口、媒体查看器样式与多份测试却已经引用 `plugins/omnimux-viewer/...`，形成悬空依赖。源码迁入本仓后，构建、测试与 Dev 物化才能闭环。

## 目标

1. 将旧仓 HEAD `563e18cbb` 的 `plugins/omnimux-viewer`（140 个跟踪文件，上游 `Crosery/dsh-viewer` 的 MIT fork）完整迁入 `plugins/plugins/omnimux-viewer`，随本仓构建与发布。
2. 接入本仓插件清单：`app/dsh-desktop-next/package.json` 依赖、`bundle.lock.json`、`plugins.registry.json`、`app/config/plugin-tiers.json`、`plugins/scripts/license-registry.json`、`app/dsh-plugin-desktop/preset/owned-packages.json`。
3. 同步落地已确认的图像生成顶栏按钮优化：打开、下载统一为 28×28 图标按钮，移除分栏切换按钮。

## 非目标

- 不改 viewer 的媒体渲染、生成执行、模型目录与存储逻辑。
- 不发布 npm、不更新正式版；只做源码迁移与 Dev 物化。

## 研究依据

- 旧仓 HEAD `563e18cbb` 的 `plugins/omnimux-viewer` 文件清单与 `VENDOR.md`（上游基线 `4a913a476f8a7554de90e9382b4e7adb354831fa`）。
- 旧仓 Dev 物化快照（2026-11-22）的 `MediaViewerTab.jsx` 与 HEAD 一致，说明 HEAD 即当前运行基线。
- `plugins/README.md`、`plugins/ACKNOWLEDGEMENTS.md` 原先把 viewer 标为“不在本仓构建或内置”，本次迁移后必须改为“源码已迁入并随产品构建”。
- 演示：`ui-demo/image-viewer-toolbar-buttons-demo.html`（修改前后、亮/暗主题、窄屏）。

## 验收标准

- `plugins/plugins/omnimux-viewer` 含完整源码与构建脚本；`corepack pnpm --dir plugins run build:all` 成功产出 `lib/index.js` 与 `lib/client.js`。
- `node scripts/verify-app-local-plugins.mjs`、`node scripts/bundle-lock.mjs --check`、`node plugins/scripts/registry-tool.mjs verify`、license consistency 测试通过。
- 顶栏为：100% 缩放、打开（外链图标）、下载（图标）；分栏按钮不存在；打开/下载同款 `.omx-mv-btn--icon` 样式。

## 假设

- 旧仓 HEAD `563e18cbb` 是当前 Dev 运行的 viewer 基线；Dev 物化快照的 `MediaViewerTab.jsx` 与 HEAD 一致（952 行，含生成历史）。
- 本仓 0.2.2-rc.5 的 peer 覆盖 viewer 声明的 `>=0.2.1-rc.3 <0.3.0-0`，无需改 peer 范围。

## 证伪方式

- 逐文件比对旧仓 HEAD 与新仓迁移目录的 140 个文件哈希，任何缺失、多余或内容不一致即失败。
- 构建后检查 `lib/client.js` 含 `omx-mv-btn--icon` 且不含「切换两栏/三栏」；不满足即失败。
- 运行 `verify-app-local-plugins`、`bundle-lock --check`、`registry verify`、license consistency，任一失败即证伪迁移接入完整性。

## 验证

- `corepack pnpm --dir plugins run build:all`
- `corepack pnpm --filter omnimux-viewer test`
- `corepack pnpm --dir plugins verify:tools`
- 演示页与 worktree 浏览器证据（亮/暗、窄屏）

## 旧标准变更

- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：13 个插件全部登记且通过`
  - 原断言：插件总数 `13`，counts `{ original: 9, fork: 2, vendor: 2 }`。
  - 必须改的理由：本次迁入 `omnimux-viewer`（MIT fork），插件总数与 fork 数必然增加；保持旧数字会把新插件误判为未登记。
  - 新期望证据：`onDisk.length === 14`，counts `{ original: 9, fork: 3, vendor: 2 }`，测试通过。
- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：fork 类保持 MIT，原创类不残留 MIT`
  - 原断言：forks 精确等于 `['omnimux-browser', 'omnimux-market']`。
  - 必须改的理由：`omnimux-viewer` 是 MIT fork，必须出现在 fork 清单中。
  - 新期望证据：forks 精确等于 `['omnimux-browser', 'omnimux-market', 'omnimux-viewer']`，测试通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `materializes a local file dependency closure from paths containing spaces`
  - 原断言：`stagePresetProfile(...)` 返回 `17`。
  - 必须改的理由：`plugin-tiers.json` 新增 `omnimux-viewer`，staged package 数增加 1。
  - 新期望证据：返回值 `18`，测试通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `keeps an incompatible optional-only local package out of the staged output`
  - 原断言：返回 `14`。
  - 必须改的理由：同上，product plugin 数增加 1。
  - 新期望证据：返回值 `15`，测试通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `defaults to a production preset that excludes every lifecycle Alpha plugin`
  - 原断言：返回 `10`。
  - 必须改的理由：正式版仍包含非 Alpha 的 `omnimux-viewer`，staged package 数增加 1。
  - 新期望证据：返回值 `11`，测试通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `keeps every lifecycle Alpha plugin only for an explicit development stage`
  - 原断言：返回 `14`。
  - 必须改的理由：开发版新增 `omnimux-viewer`，staged package 数增加 1。
  - 新期望证据：返回值 `15`，测试通过。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `stages a fresh development preset without replacing or backing up the input`
  - 原断言：返回 `14`。
  - 必须改的理由：开发版新增 `omnimux-viewer`，staged package 数增加 1。
  - 新期望证据：返回值 `15`，测试通过。

## 文档影响

- 更新 `plugins/README.md`、`plugins/ACKNOWLEDGEMENTS.md` 的 viewer 归属与构建状态说明。
- 更新 `plugins/docs/contracts/plugin-agent-tools-inventory.md`，登记 `display_file` 工具。
