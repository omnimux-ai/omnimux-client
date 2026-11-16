# Issue #34 S1 — 单一根插件 workspace 与桌面本地插件接线

状态：PR A（Refs #34，不 Closes；不合并，交客户端评审）
基线：`origin/main` = `2f7b2bb9ba2dc4b47b0a24693cce6da796af5f31`

## 目标

1. 仓库根成为插件工作区的唯一 pnpm workspace 根，`plugins/` 保持为 workspace 包；根只保留一个 `pnpm-lock.yaml`。
2. `app/` 仍是独立 Yarn 4 工作区；`app/dsh-desktop-next` 的 12 个 omnimux 依赖改为本仓本地插件引用。
3. 根级生成/校验 `dsh-version.json`（DSH stable pin + submodule）与 `bundle.lock.json`（12 个插件的路径/版本/内容 hash）。
4. CI 增加 workspace metadata 检查与 app 本地插件解析/构建检查；打包前置先构建插件并校验 `lib/dist` 新鲜度。

## 方案决定

- 本地引用采用 **`link:../../plugins/plugins/<pkg>`**，不是 `file:`/`portal:`：
  - `file:` 目录依赖在 `app/yarn.lock` 中带内容 hash，插件 `lib/client.js`/`dist` 是 gitignored 构建产物，每次插件改动都会迫使 app 锁变化（实测 `yarn install --immutable` 报 YN0028）。
  - `portal:` 在 app 现有 `nmHoistingLimits: workspaces` 下触发 YN0071（插件依赖与 app 依赖版本冲突无法嵌套），安装直接失败。
  - `link:` 不安装插件依赖（由插件自己的 pnpm workspace `node_modules` 提供），锁无 hash；实测改插件源码并重建后 `yarn install --immutable` 通过且 `app/yarn.lock` 哈希不变。
- 打包时 `prepare-payload` 把 `link:` 目标视为 workspace 包，按 `files` 列表把本仓插件复制进 payload（去符号链接），因此产物中是真实文件而非链接。
- `app/dsh-desktop-next` 的 8 个打包脚本前置 `scripts/prepare-local-plugins.mjs`：从根触发 `pnpm --dir plugins run build:all`，再跑 `verify-plugin-builds.mjs`。

## 文件

新增：
- `package.json`（根工具脚本：`workspace:check`、`bundle:lock[:check]`、`dsh-version[:check]`、`plugins:build`、`plugins:verify`、`plugins:prepare`）
- `pnpm-workspace.yaml`（`plugins`、`plugins/plugins/*`、`plugins/packages/*`；overrides/allowBuilds/minimumReleaseAge 原样上移）
- `pnpm-lock.yaml`（由 `plugins/pnpm-lock.yaml` 上移：只改 importer 路径，解析版本不漂）
- `dsh-version.json`、`bundle.lock.json`
- `scripts/{dsh-version,bundle-lock,workspace-check,verify-plugin-builds,prepare-local-plugins,verify-app-local-plugins,verify-packaged-plugins}.mjs`
- 本 spec

修改：
- `app/dsh-desktop-next/package.json`：12 个依赖改 `link:`；8 个打包脚本加本地插件构建前置
- `app/yarn.lock`：移除 npm 插件树，加入 12 个 link 解析
- `.github/workflows/ci.yml`：新增 `Workspace metadata and local plugins` job；`Desktop app check` 安装后校验本地插件解析
- `README.md`、`AGENTS.md`：根工作区与构建顺序
- `plugins/scripts/verify-dsh-lockfile-uniform{,.test}.mjs`：默认读取根锁
- `plugins/plugins/omnimux-market/package.json`：`packageManager` 对齐 11.7.0（否则 corepack 在 market 目录选中 11.17.0，与根 workspace 的 11.7.0 冲突，`build:all` 失败）
- 删除 `plugins/pnpm-workspace.yaml`、`plugins/pnpm-lock.yaml`

## 锁与安装路径

- `publish.yml` / `quality-gate.yml` 的 install 仍以 `plugins/` 为 working-directory；实测删除 `plugins/pnpm-workspace.yaml`/`plugins/pnpm-lock.yaml` 后，从 `plugins/` 执行 `pnpm install --frozen-lockfile`（含 `--ignore-scripts`）会向上找到根 workspace 与根锁，scope 为 17 个 workspace 项目，无需改 workflow 路径。
- 保留 `plugins/package.json` 为 workspace 包（`packages` 首项），其 devDependencies 与脚本不变。
- `plugins/scripts/guard-worktree.mjs` 的 `PROTECTED_ROOT_FILES` 已包含 `pnpm-lock.yaml`，且 `gitRoot(cwd)` 返回仓库根；根锁天然受保护。本 PR 不改该文件，但请插件端 co-review。
- `plugins/scripts/verify-dsh-lockfile-uniform*.mjs` 已改为定位仓库根 `pnpm-lock.yaml`。

## 验证命令与证据

```bash
# 1. 根 workspace 安装
corepack pnpm install --frozen-lockfile

# 2. 插件全量构建
corepack pnpm --dir plugins run build:all

# 3. 工作区元数据（dsh-version + bundle.lock）
node scripts/workspace-check.mjs --check

# 4. app 安装与解析
cd app && corepack yarn install --immutable
node ../scripts/verify-app-local-plugins.mjs

# 5. app 检查
cd app && corepack yarn check

# 6. 打包 smoke
corepack yarn workspace dsh-desktop-next package:dir
# 检查 .desktop-build/payload/node_modules/omnimux*：版本=本仓 source、哈希=本仓构建产物

# 7. 锁负向校验
node scripts/bundle-lock.mjs --check          # 0
# 临时改 bundle.lock.json 一项后
node scripts/bundle-lock.mjs --check          # 非 0
```

## S2 出包验证（本次已在同 worktree 跑通）

```bash
node scripts/prepare-local-plugins.mjs
cd app/dsh-desktop-next && node scripts/prepare-payload.ts --platform darwin
cd ../.. && node scripts/verify-packaged-plugins.mjs
```

真实输出（`prepare-payload` 是 electron-builder 归档的唯一 node_modules 来源）：

- `verify-plugin-builds: OK — 12 plugins have fresh build outputs`
- `Materialized 1009 packages for darwin arm64/x64`
- `Sealed the prepared payload: 51007 files; OmniMux 2.0.23, dsh 0.2.1-rc.3, Electron 44.7.0, pnpm 11.28.5`
- `verify-packaged-plugins: OK — 12 plugins packaged from this repository`
  - payload 与 checkout 的版本 + `main` 文件 sha256 全部一致（omnimux 0.1.8、accounts 0.1.1、market 0.2.13-omni.0、workflow 1.0.0-rc.1 …）
  - 同一时刻 npm 最新版是 accounts 0.1.2 / market 0.2.13-omni.1 / workflow 1.0.0-rc.2 / omnimux 0.1.6，可排除“打包读的是 npm 缓存”
  - 12 个目录均非符号链接；market 的 `!lib/tests`、`!catalog/covers` 排除生效（payload 无 `lib/tests`，仓内存在）
- `prepare-payload` 新增 npm `files` 否定项支持（`!path`）：此前遇到 market 的 `!lib/tests` 会直接抛 `unsupported files pattern`，打包无法完成。

## 回滚

1. 恢复 `plugins/pnpm-workspace.yaml`、`plugins/pnpm-lock.yaml`（从合并前提交检出）。
2. 删除根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`package.json`、`dsh-version.json`、`bundle.lock.json` 与 `scripts/*.mjs`。
3. `app/dsh-desktop-next/package.json` 的 12 个依赖恢复 npm semver；`app/yarn.lock` 从合并前提交检出。
4. 还原 `.github/workflows/ci.yml`、README/AGENTS、插件脚本路径与 market `packageManager`。

## 注意事项

- 本 PR 的 `app/dsh-desktop-next/package.json` / `app/dsh-plugin-desktop/package.json` diff 只含依赖与打包脚本，**不含** electron-builder `dmg` 段变化；`dmg` 重复键清理不在 S1 范围。
- 本仓 11 个插件版本低于 npm 最新（issue #34 已列）；S1 后 app 打包使用本仓源码，版本/内容对齐在 S2/PR C。
- 插件端 PR C 只 bump `plugins/plugins/*` 版本与 `publish.yml`；`link:` 会自动读到新版本，`bundle.lock.json` 由 S2/PR C 回写。
