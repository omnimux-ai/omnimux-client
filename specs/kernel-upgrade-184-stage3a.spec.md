# DSH 0.2.2-rc.5 内核升级阶段 3A：画布插件适配与工作区元数据收口

工单 [#184](https://github.com/omnimux-ai/omnimux-client/issues/184) 阶段 3A。在 `feat/kernel-upgrade-184` 上合并最新 `origin/main`（`34a60f15`，含 `#58`、`#191`、`#111`），把 `omnimux-workflow` 剩余的 `DSH 0.2.2-rc.5` 适配补齐（路由级鉴权、raw bytes 路由的 peer-aware 双态准入、HMR 样式原地更新），并让宿主兼容门禁与工作区元数据自动跟随本分支的出货 pin（`dsh 0.2.2-rc.5` / `cordis 4.1.0` / `schemastery 3.19.0`）。

## 假设

- 本分支出货的宿主代际由 `dsh-version.json`（`dsh.runtimePackageVersion = 0.2.2-rc.5`）与 `app/dsh-desktop-next/package.json`（`cordis 4.1.0`、`schemastery ^3.19.0`）共同确定；`app/upstream.json` 的 `activeChannel = next` 指向该代际，`stable`（`dsh-plugin-desktop`，`0.2.1-rc.3`）仍是冻结的旧线。因此 `scripts/dsh-version.mjs` 必须按 `activeChannel` 生成，而不是写死 `stable`。
- DSH 0.2.3+ 由 WebServer 按路由声明执行鉴权并把已准入的 `Peer` 作为第三个实参交给 handler；0.2.1-rc.3 / 0.2.2-rc.5 仍只给 `connection.requestRejection`。两种形态需要并存：有 `Peer` 时直接凭它准入，没有 `Peer` 时回落到连接座，两者都缺时失败关闭（503）。
- 路由级 `auth: 'required'` 是显式契约，不是默认值；`/omnimux-workflow` 与遗留别名 `/dsh-workflow` 都必须声明。
- pnpm / npm 解析 peer 范围时**不开** `includePrerelease`，预发布版本只有在范围内存在同 `major.minor.patch` 且自身带预发布标签的比较符时才被满足；因此宿主升到 `0.2.2-rc.5` 时，`>=0.2.1-rc.3 <0.3.0-0` 这一支**不**容纳它，必须追加 `>=0.2.2-rc.5 <0.3.0-0`。宿主运行时自己的准入判定（`includePrerelease: true`）不受影响，两者都要成立。
- HMR 安全：同一 bundle 在宿主热更新时会被重新执行，运行时 `<style>` 注入器必须按 id **原地更新**内容；只判断「已存在就 return」会让样式永远停在旧版本。`injectCanvasStyles` 早已是原地更新，`injectWorkflowStyles` / `injectFolderStyles` 与之对齐。
- 测试标准门禁（`verify-test-standard-declarations`）只允许「具名用例的断言改写/删除」与「整文件退役」两类经 spec 声明放行；`evaluation-made-unparseable`、`dynamic-test-options-needs-review`、`test-execution-selector-needs-review` 必须撤回改动。因此既有 app 侧兼容测试不做原地重写，DP-003 守卫按「整套用例随补丁退役」处理。

## 验收标准

1. `origin/main`（`34a60f15`）已干净合并进 `feat/kernel-upgrade-184`，`#58` 目录快照、`#191` `X-Omnimux-Group: data-reader`、`#111` 画布优化与分支上的 `0.2.2-rc.5` 适配、路线 B 修复同时存在，无冲突残留。
2. `omnimux-workflow` 的三条 raw 路由与 prefix 注册完成双态适配：`canvasRoutes` 两条 `webServer.register` 显式 `auth: 'required'`，`/api/capabilities`、导演路由、`directorBytesRoutes`、`audioBytesRoutes` 在有 `Peer` 时凭 `Peer` 准入（`signal.aborted` 仍拒绝）、无 `Peer` 时回落到 `connection.requestRejection` 并保留 503 失败关闭；跨源请求仍被 `assertAudioRequestOrigin` 拒绝且不读请求体。
3. `injectWorkflowStyles` / `injectFolderStyles` 在 `<style>` 已存在时原地更新内容，二次调用仍只有一份节点；`injectCanvasStyles` 行为不变。
4. 插件 peer 声明在 pnpm 语义下真正容纳 `0.2.2-rc.5`，同时保留至少一个旧世代代表版本（`0.1.0-rc.6` / `^0.1.5-rc.3` / `>=0.0.0 <0.2.1-0`），`verify-dsh-declaration-range` 的宿主代际从出货元数据解析且夹具回落常量不变。
5. `scripts/dsh-version.mjs` 按 `activeChannel` 生成 `dsh-version.json`，`node scripts/dsh-version.mjs --check` 通过；`node scripts/workspace-check.mjs --check`、`node scripts/bundle-lock.mjs --check`、`corepack pnpm --dir plugins install --frozen-lockfile` 全绿。
6. `corepack pnpm --dir plugins run build:all` 11/11、`omnimux-workflow` typecheck 与全量单测（含新增 `routeAuthDualAdmission.test.mjs` 与 `#111` 用例）全绿；`test:gates`、`check:boundaries`、`verify:product-baseline`、`verify:stages`、`verify:slots`、`guard:popover`、`verify:tools`、`verify:model-contracts`、`verify:plugin-load`、`test:plugin-load`、`verify-anti-slop`、`verify-test-standard-declarations`、`gitleaks`、`git diff --check` 全绿。
7. 改动只在本地 `feat/kernel-upgrade-184` 提交，工作区 `0 dirty`；不推送、不开 PR、不物化共享 Dev。

## 证伪方式

- 若合并后 `#111` 的 `configPanelPlacement` / `canvasUiPolish111.test.mjs`、`#58` 的 `pricing.json` 快照或 `#191` 的 `data-reader` 分组头任一缺失，或有冲突标记残留，则合并失败。
- 去掉 `Peer` 分支后，`routeAuthDualAdmission.test.mjs` 中「无 connection 座但有 `Peer` 时 200」「`Peer.signal.aborted` 时 401」两条会变红；把 `auth: 'required'` 删掉后该文件的挂载断言会变红。
- 把 `injectWorkflowStyles` 改回「存在即 return」，`routeAuthDualAdmission.test.mjs` 的 HMR 用例会看到旧 `textContent` 不变而变红。
- 把任一新 peer 分支删掉后 `node plugins/scripts/verify-dsh-declaration-range.mjs` 会点名该 manifest；把目标代际改回 `0.2.1-rc.3` 时该脚本会打印「夹具回落常量」而不是「来自出货元数据」。
- `dsh-version.mjs` 若仍写死 `stable`，`--check` 会报 `app/upstream.json stable commit 1f81c047 != gitlink 9c2670d3`。
- 任一上述门禁非零退出即视为未通过。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/apps-stage-box.test.js` :: `hides the session header and selected-row highlight while a product stage is active`
  原断言要求 `PRODUCT_STAGE_CHROME` 含 DP-003 的 `[data-omnimux-left-collapsed] [data-slot="conversation.header"] > header` 折叠内边距规则。0.2.2-rc.5 采用路线 B：DP-003 的 `!important` 覆盖整体退役，折叠态标题避让改由官方 `--dsh-frame-leading-clearance` 承担，故改为断言该选择器**不再存在**（`assert.doesNotMatch`）。新期望证据：`apps-stage-box.test.js` 同用例其余断言不变并通过，`sidebar-toggle-topbar.test.js` 新增用例用 jsdom 几何模型验证官方 clearance 与 DP-004 按钮簇不重叠。
- `plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.test.js` :: `includes topbar toggle fixed geometry, visual-0 rail, tabBar padding, blue dot`
  原断言要求同一 DP-003 折叠 header 选择器与 `--omnimux-topbar-toggle-end` / `--omnimux-topbar-toggle-top` 注入规则存在。同属 DP-003 退役，改为断言该选择器与 `desktop-patch:DP-003` 标记**不再存在**；DP-004 的几何契约（`--omnimux-topbar-toggle-end` 164/88、`--omnimux-topbar-new-session-left` 124/48）由该文件新增的整屏 / Next 平台用例继续覆盖。新期望证据：新增三个用例覆盖 `[data-shell-leading]` 隐藏与恢复、`html[data-fullscreen]` 下的 84px 安全区、`html[data-platform="darwin"]` 识别。
- `plugins/plugins/omnimux/src/client/conversation-header-patch.test.js` :: `*`
  该文件整套用例（12 个宽度 × 状态矩阵用例 + 1 个反向对照）建立在 DP-003 的 `!important` 覆盖上，随 DP-003 退役不可保留；文件内断言多为无具名主，按文件级声明处理。原断言核对 `header.padding-left` 为 `var(--omnimux-topbar-toggle-end, 164px)` 并复现旧选择器导致的重叠。新期望证据：`sidebar-toggle-topbar.test.js` 新增用例验证官方 20px/10px 内边距不被覆盖、折叠态窗口 160px / 全屏 84px 安全区内标题与两颗按钮不重叠，并反向证明仍用 84px 偏移会在全屏重叠。
