# Spec: 迁移 omnimux-browser 至本仓并修复插件端口发现（#57）

- 任务：`issue-57-browser-migration`
- 日期：2026-11-17
- 基线：`3058548046c4758c95f9d455d34679456ea75c00`（origin/main）
- 风险：R2（新插件包、Chrome 扩展构建、实例发现逻辑；不改官方 DSH，不改生产数据）

## 目标

- 把冻结旧树的 `omnimux-browser` 源码逐字节迁入 `plugins/plugins/omnimux-browser`，保留 MIT 与 `omdsh-dev/dsh-browser` 归属，纳入 workspace、registry、tier、desktop bundle 与 CI。
- 插件能发现 Dev 45120、Prod / 遗留 Dev 44120，以及 App 端口冲突后的有界回退端口。43128 无预设名称，43120 的预设名称为 DSH Desktop。
- 实例显示名优先取 bridge-config 的实例身份（`name` / `channel`），取不到才回退端口默认名。
- 面板与后台共用同一份端口列表；保留自定义端口保存机制。

## 迁移证据

- 第一个 commit `815721b` 只做逐字节拷贝：`git archive 021b762e64c83a55124ed65888a76401bc63532e -- plugins/omnimux-browser`（旧仓）→ `plugins/plugins/omnimux-browser`。
- 458 个 tracked 文件；逐文件 `git hash-object` 与旧树 blob 对比 0 mismatch；两侧路径集合 `diff` 为空。
- 不含 `node_modules/`、`dist/`、`.DS_Store` 等未跟踪/构建产物；`LICENSE`、README、`ACKNOWLEDGEMENTS.md` 的 MIT 归属保留。

## 端口与命名设计

- 后台和面板共用同一份[端口清单](../plugins/plugins/omnimux-browser/extension/src/shared/discovery-ports.ts)。
- 9 个基础候选为 `45120, 44120, 43120, 43128, 3080, 3081, 3090, 14389, 43189`。43128 是 DSH Desktop 的历史回退口。
- 两个回退窗口为 `45120–45129` 和 `44120–44129`，合并基础候选并去重后共 27 个本机端口。候选顺序先是 `45120, 44120`，再按 `45121, 44121, …, 45129, 44129` 交替列出回退端口，最后是其余基础候选。45128 由第一个回退窗口覆盖。
- 命名优先级：`bridge-config.name` → `bridge-config.channel`（dev/prod）→ 端口默认名（45120 Dev、44120 Prod、43120 DSH Desktop、未知端口“本地实例”）。
- 有界探测覆盖桌面端已有的顺序回退逻辑，无需新增桌面端接口。默认探测端口从 9 个增至 27 个。每轮请求并行发出，后台按候选优先级读取结果。
- 实际端口超出候选范围时，可在面板输入自定义端口。面板保存该端口并同步到后台。后台优先采用该端口的探测结果，面板将该端口并入并行探测，结果按实例状态和预设顺序展示。

## 范围

- `plugins/plugins/omnimux-browser/**`（新迁入包，含 server、extension、tests、LICENSE、AGENTS）
- `pnpm-workspace.yaml`：登记 `plugins/plugins/omnimux-browser/extension`
- `plugins/plugins.registry.json`：由 `registry:build` 从新 `dsh.manifest.json` 生成
- `app/config/plugin-tiers.json`：`omnimux-browser` 进入 preview
- `app/dsh-desktop-next/package.json` + `app/yarn.lock`：新增 `link:` 依赖，使 desktop payload / bundle lock 覆盖新包
- `scripts/bundle-lock.mjs`、`scripts/verify-app-local-plugins.mjs`、`scripts/verify-plugin-builds.mjs`、`scripts/verify-packaged-plugins.mjs`：12 → 13 个插件
- `bundle.lock.json`：重新生成
- `plugins/README.md`、`plugins/ACKNOWLEDGEMENTS.md`：历史归属改为已迁入
- `plugins/plugins/omnimux-browser/AGENTS.md`：命令路径改为新仓布局
- `specs/issue-57-browser-migration.spec.md`

不碰：`app/dsh-plugin-desktop/src`、`app/dsh-desktop-next/src`、官方 DSH、冻结旧树、Prod `~/.omnimux`、发布流程。

## 验收标准

- [ ] AC-1 第一个 commit 逐字节拷贝，458 文件 0 mismatch；后续 commit 才含逻辑改动。
- [ ] AC-2 `pnpm --filter omnimux-browser build:server` 与 `build:extension` 通过；`build:all` 识别并构建新包。
- [ ] AC-3 后台与面板都从 `discovery-ports.ts` 取端口；44120 在列表内，43128 无 OmniMux PRD 名称。
- [ ] AC-4 实例身份优先：`name` / `channel` 覆盖端口默认名；旧 43128 在线时显示“本地实例”而非 PRD。
- [ ] AC-5 45121 回退在线时被发现并显示实例自身身份，`isCustom=false`。
- [ ] AC-6 自定义端口保存后，后台首个探测端口即保存值；面板 extras 同一端口。
- [ ] AC-7 新包单测、extension 单测、workspace 测试、CI 全绿；`build:all`、`check:boundaries`、`verify:stages`、`verify:plugin-load`、`lint:i18n`、`workspace-check`、`bundle-lock`、`git diff --check` 通过。
- [ ] AC-8 双向证伪：回退 44120 → 发现用例红；回退 43128 命名移除 → 命名用例红；回退回退端口发现 → 回退发现用例红；每次恢复后复绿。
- [ ] AC-9 真实 Chrome unpacked 冒烟（独立 profile）；真实 Dev 45120 / 遗留 44120 / Prod 44120 矩阵在合并后由桌面端统一验收。

## 测试计划

- 新增/更新 extension 单测：
  - `instance-discovery.spec.ts`：27 端口列表、44120/43128 命名、身份优先、45121 回退发现、offline 只渲染命名端口、custom extras。
  - `background-bridge-lifecycle.spec.ts`：保存自定义端口优先、并发探测不改变 keepalive/socket 所有权。
  - `dsh-instance-selector.spec.ts` / `e2e/instance-presets.e2e.spec.ts`：下拉行数、Prod 44120、43128 不再出现。
- server 单测：`tests/composition.spec.ts` 校验 bridge-config 携带 `channel`/`name`，并单测 `bridgeInstanceIdentity` 的 dev/prod 分支。
- 构建：`build:server`、`build:extension`、`build:all`。
- 报告扩展产物大小与 manifest 版本号。

## 真实浏览器冒烟（独立 profile）

- 环境：Chrome for Testing 149（Playwright 缓存），headless，`--load-extension=extension/dist`，一次性临时 profile，不连用户主 profile。
- 用本地 fake `/ext/bridge-config` 注入身份，未启动/修改任何 Prod 应用或数据；测试结束关闭 Chrome 与临时 profile。
- 观察到的面板 DOM（设置 → 连接实例）：
  - 44120 返回 `channel=dev` → `OmniMux Dev:44120`；
  - 45121 返回 `channel=dev` → `OmniMux Dev:45121`（回退端口被发现）；
  - 44120 切到 `channel=prod` → `OmniMux Prod:44120`；
  - 43128 不出现在列表；43120 显示 `DSH Desktop`；
  - 本机真实 Dev 45120 也被发现并显示 `OmniMux Dev:45120`（在线，带推荐徽章）。
- 未纳入门禁的 `test:e2e` 仍有两个既有问题：`pairing.e2e.spec.ts` 引用已删除的 `PairingSessions`；`bridge-extension.e2e.spec.ts` 在 headless Chrome 下 60s 超时；`media-lit-transition` 的 hover opacity 在 headless 下失败。默认 `test` 明确排除 `tests/e2e/**`，真实 Dev/Chrome 矩阵在合并后由桌面端统一做。

## 旧标准变更

- `plugins/scripts/auto-qa-scan.test.mjs` :: `0 误报：仓库现有插件源码 + 全部扩展清单通过安全维度`
  - 原断言：`manifests.length === 0`，注释写明「client ships no extension manifests（omnimux-browser is not one of the 12）」。
  - 必须改的理由：#57 把 `omnimux-browser` 迁入本仓，仓库现有两个真实扩展清单（`manifest.json` + `manifest.firefox.json`），必须进入安全扫描；继续断言 0 等于把迁移后的扩展排除在门禁之外。
  - 新期望证据：`manifests.length === 2`，`securityFindings(files, root)` 仍为空；扫描器路径继续由反证用例覆盖。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `materializes a local file dependency closure from paths containing spaces`
  - 原断言：development stage 返回 `16` 个包。
  - 必须改的理由：`omnimux-browser` 进入 preview tier 后，fixture 的产品插件从 12 增至 13，stage 结果多 1。
  - 新期望证据：返回 `17`，其余依赖闭包断言不变。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `keeps an incompatible optional-only local package out of the staged output`
  - 原断言：development stage 返回 `13` 个包。
  - 必须改的理由：同上，产品插件新增 1 个。
  - 新期望证据：返回 `14`，被排除的 optional-only 包断言不变。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `defaults to a production preset that excludes every lifecycle Alpha plugin`
  - 原断言：production stage 返回 `9` 个包。
  - 必须改的理由：`omnimux-browser` 是 preview（非 Alpha），production 预设也包含它，数量 +1。
  - 新期望证据：返回 `10`，Alpha 插件仍全部被排除。
- `app/dsh-plugin-desktop/tests/stage-preset-profile.spec.ts` :: `keeps every lifecycle Alpha plugin only for an explicit development stage`
  - 原断言：development stage 返回 `13` 个包。
  - 必须改的理由：同上，产品插件新增 1 个。
  - 新期望证据：返回 `14`，Alpha 插件的包含/排除断言不变。

## 回滚

- 整包回滚：删除 `plugins/plugins/omnimux-browser`，并从 `app/dsh-desktop-next/package.json` / `app/yarn.lock` / `pnpm-workspace.yaml` / `plugin-tiers.json` / registry / bundle lock 移除登记。
- 端口回滚：恢复 `extension/src/shared/discovery-ports.ts` 的旧 9 端口列表与 `KNOWN_INSTANCE_NAMES`（43128→OmniMux PRD），后台恢复本地列表。
- 身份回滚：删除 bridge-config 的 `channel`/`name` 字段，面板只按端口名显示。
