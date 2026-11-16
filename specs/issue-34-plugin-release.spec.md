# Issue #34 S3 — 11 个插件包版本对齐与 OIDC 多包发布准备

## 背景

`omnimux-client` 的 12 个活跃插件包中，仅 `omnimux@0.1.8` 已从本仓发布并带有指向
`omnimux-ai/omnimux-client` 的 provenance；其余 11 个包的 npm 最新版仍停留在迁仓前
旧提交，且其中 10 个缺少 `repository` 元数据、1 个目录写错。本单负责版本对齐、
发布元数据修复，以及把 `publish.yml` 改造成可逐包/多包 dry-run 和真实发布的矩阵，
真实 OIDC 发布在 Trusted Publisher 核查完成且用户批准后另行触发。

## 决策与边界

- 基线：`origin/main` = `2f7b2bb9ba2dc4b47b0a24693cce6da796af5f31`（只比
  `839ff5e` 多 #35 docs spec）。
- 本 PR 不改 `app/**`、不生成/修改任何 lockfile；S1 会把 workspace 根上提并把
  app 依赖改成 `portal:` 本仓包，`bundle.lock.json` 由 S1 生成后再回写。
- 不改 Trusted Publisher 四元组：Owner `omnimux-ai` / Repository
  `omnimux-client` / Workflow filename `publish.yml` / Environment 空。
- 不执行任何真实 npm 发布；真实发布必须等绑定确认 + 用户批准。

## 版本矩阵（基线：2026-11-16 `npm view <pkg> version`）

| 包 | 本仓现状 | npm 最新 | 本 PR 目标 |
| --- | --- | --- | --- |
| omnimux-accounts | 0.1.1 | 0.1.2 | 0.1.3 |
| omnimux-analytics | 0.2.0 | 0.2.1 | 0.2.2 |
| omnimux-assets | 0.2.0 | 0.2.1 | 0.2.2 |
| omnimux-clip | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-forms | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-inspiration | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-market | 0.2.13-omni.0 | 0.2.13-omni.1 | 0.2.13-omni.2 |
| omnimux-products | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-publish | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-video | 0.1.0 | 0.1.1 | 0.1.2 |
| omnimux-workflow | 1.0.0-rc.1 | 1.0.0-rc.2 | 1.0.0-rc.3 |
| omnimux | 0.1.8 | 0.1.8 | 0.1.8（已发布，不 bump） |

`omnimux-market` 继续用 `omni.N` 预发布序列，`omnimux-workflow` 继续用 `rc.N`，
不提前把预发布升成稳定版。

## 发布元数据修复

- 11 个包统一补 `repository`：
  `{"type":"git","url":"git+https://github.com/omnimux-ai/omnimux-client.git","directory":"plugins/plugins/<name>"}`；
  market 的旧 `directory: plugins/omnimux-market` 一并修正。
- 11 个包的 `dsh.manifest.json` 版本跟 `package.json` 同步；`omnimux` manifest
  从 `0.1.2` 对齐到 package 的 `0.1.8`（package 版本不变）。
- `plugins.registry.json` 用 `registry:build` 重新生成：从 18 条降到 12 条，
  移除 6 个源码已不存在的陈旧条目（avatar/device/social-harvest/intercept/
  video-preview/viewer）。这是预期 catalog 变化，仓内只有 `registry-tool.mjs` 读它。
- `dsh-ui-kit` 的 `file:../../packages/dsh-ui-kit` 改为 `^0.1.0`；`omnimux-assets`
  的 `omnimux-products` 从 `file:../omnimux-products` 改为 `^0.1.2`。npm publish
  不会重写 `file:`，不修会把机器本地路径带进 tarball；pnpm 仍通过 workspace 链接
  解析这些 semver 范围。`devDependencies` 里的 `@omnimux/form-contract` 不随发布
  生效，保持 `file:`。

## publish.yml

- 输入改为 `packages`（默认 `all`，支持 `all` 或逗号分隔的包名/目录）与
  `dry_run`（默认 `true`）。
- `plan` job 调 `scripts/publish-matrix.mjs`：展开 12 个活跃包，用
  `npm view <name>@<version> version` 判重，输出 `matrix.include` 和 warnings。
- `publish` job 是每包独立 job，`concurrency: publish-${{ matrix.package }}`；
  dry-run 最多并行 4 个，真实发布固定 `max-parallel: 1`，并按依赖拓扑排序，
  保证 `omnimux-products` 先于 `omnimux-assets`。
- dry-run：未发布版本跑 `npm publish --tag latest --dry-run`，已发布版本跑
  `npm pack --dry-run`；真实发布：跑 `npm publish --access public --tag latest`。
  market/workflow 是 prerelease（`omni.N` / `rc.N`），npm 会拒绝不带 `--tag` 的
  prerelease；显式 `latest` 保持安装链路的默认解析，`omni` dist-tag 不在本 PR 改动。
- `all` 真实发布时已发布版本（当前为 `omnimux@0.1.8`）跳过并打 `::warning::`；
  显式点名已发布包则 preflight 失败。
- 保留 `persist-credentials: false`、`verify-publish-source`、npm >= 11.5.1 检查、
  15 分钟传播窗口、`gitHead` 与 workflow commit 一致性校验；`permissions` 仍只有
  `contents: read` + `id-token: write`，无 `environment`，无 npm token。

## release-check

- `parseArguments` 修正迁仓后的路径：单包统一为仓库相对路径
  `plugins/plugins/<name>`（原 `plugins/<name>` 在现布局下读不到 package.json）。
- 新增 `--all`（逐包校验）与 `--list [--json]`（给发布矩阵复用）。
- `checkManifest` 新增本地说明符校验：`dependencies` / `optionalDependencies` /
  `peerDependencies` 中不得出现 `file:` / `link:` / `portal:` / `workspace:` / 相对路径。

## dist-tag 结论

`npm view` 显示两个包都停在旧版：`omnimux-market` 的 `omni` = `0.2.13-omni.1`，
`omnimux-workflow` 的 `omni` = `1.0.0-rc.2`。仓内 app、安装链路和文档都没有使用
`@omni` 这个 dist-tag（app 用 semver range，`latest` 也指向同一版本），因此本 PR
把 `omni` 标为 **legacy**，不扩到 publish job，也不在 PR C 里改 dist-tag。若后续
确认有外部使用者，单独提方案迁移，不在本 PR 悄悄改。

## 假设

版本 bump 必须同时覆盖 `package.json` 和 `dsh.manifest.json`，否则 registry 与
runtime 读到的版本会和 npm tarball 不一致；发布前的 `npm view` 判重与
`release-check` 的提交可复现性检查能在触发 workflow 前拦住重复版本和脏工作区；
把 `file:` 依赖改成已发布的 `^0.1.0` / `^0.1.2` 后，pnpm workspace 仍能解析本地
包，而 npm tarball 不再携带机器本地路径。

## 证伪方式

- 在 base `2f7b2bb` 上跑 `node scripts/release-check.mjs plugins/plugins/omnimux-accounts`，
  应因缺 `repository` + 已发布而失败；本分支应通过。
- 用 `node scripts/publish-matrix.mjs --packages all --dry-run true` 检查 12 个
  entry、`omnimux` 为 `pack-dry-run`、其余 11 个为 `publish-dry-run`；用
  `--dry-run false` 检查 `omnimux` 被跳过且 `omnimux-products` 排在
  `omnimux-assets` 前。
- 对 12 个包各跑 `npm publish --dry-run`（已发布的 `omnimux` 另用
  `npm pack --dry-run`），任何版本重复、`file:` 依赖或打包失败都应暴露。
- 连续跑两次 `registry:build` 并 `cmp`，应字节一致；registry 应为 12 条而不是 18 条。
- 静态测试应锁住 workflow 文件名、matrix、`id-token: write`、无 `environment`、
  `dry_run` 默认 true；如果这些被改坏，`publish-workflow.test.mjs` 会失败。

## 验证

```bash
cd plugins
corepack pnpm install --frozen-lockfile
node --test scripts/release-check.test.mjs
node --test scripts/publish-matrix.test.mjs scripts/publish-workflow.test.mjs
node scripts/publish-matrix.mjs --packages all --dry-run true
node scripts/publish-matrix.mjs --packages all --dry-run false
node scripts/release-check.mjs --all --allow-published
corepack pnpm registry:build
corepack pnpm registry:verify
node scripts/verify-governance-registry.test.mjs
node scripts/verify-plugin-boundaries.mjs
corepack pnpm -r build
```

## 回滚

版本 bump、manifest、registry 和 workflow 都是普通 PR 回滚（revert 本 PR 即可）；
`publish.yml` 的 matrix 分支不改变 npm 上已有版本，回滚不影响已发布包。真实发布
尚未发生，因此没有需要撤销的 npm 版本或 dist-tag。
