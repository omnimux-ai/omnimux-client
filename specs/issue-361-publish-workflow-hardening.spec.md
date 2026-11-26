# Issue #361 — npm Trusted Publishing Workflow Hardening

安全加固 `.github/workflows/publish.yml`：
- 真实发布（`dry_run: false` / `matrix.action == 'publish'`）强制限制在 `refs/heads/main`。
- 顶层 `permissions` 收紧为 `contents: read`，将 `id-token: write` 仅下沉至 `publish` job。
- 所有 `actions/*` 固定到完整 40 位 commit SHA；锁定 `npm@11.21.3` 并对依赖安装启用 `--ignore-scripts`。

## 旧标准变更

- `plugins/scripts/publish-workflow.test.mjs` :: `publish workflow keeps the Trusted Publisher identity and only the required permissions`
  - 原断言：校验顶层 `WORKFLOW.permissions` 同时包含 `contents: 'read'` 与 `'id-token': 'write'`，且 `checkoutSteps` 匹配 `actions/checkout@v4`。
  - 必须改的理由：#361 将顶层权限收紧为 `contents: read` 并把 `id-token: write` 下沉至 `publish` job，同时将所有 GitHub Actions 固定为 40 位 commit SHA，消除未受控分支与 `plan` job 持有 OIDC token 写权限及可变 tag 风险。
  - 新期望证据：顶层 `WORKFLOW.permissions` 仅为 `{ contents: 'read' }`，`WORKFLOW.jobs.plan.permissions` 为 `undefined`，`WORKFLOW.jobs.publish.permissions` 为 `{ contents: 'read', 'id-token': 'write' }`，所有 `uses:` 均匹配 40 位 SHA（新用例名 `publish workflow keeps the Trusted Publisher identity and scopes id-token: write to publish job only (issue #361)`）。
- `plugins/scripts/publish-workflow.test.mjs` :: `publish job retains preflight, npm version gate, dry-run actions and propagation verification`
  - 原断言：匹配未锁定版本的 `npm install --global npm@11`。
  - 必须改的理由：#361 锁定精确 npm 版本（`NPM_CLI_VERSION: "11.21.3"`）并添加 `--ignore-scripts`，消除发布时拉取浮动 major tag 的供应链漂移风险。
  - 新期望证据：校验 `WORKFLOW.env.NPM_CLI_VERSION` 匹配 `/^11\.\d+\.\d+$/` 且安装命令为 `npm install --global --ignore-scripts "npm@${NPM_CLI_VERSION}"`。
