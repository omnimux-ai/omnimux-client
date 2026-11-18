# Spec: Windows 云端构建插件脚本可移植性

- 任务：`issue-80-windows-build`
- 日期：2026-11-18
- 基线：`origin/main` `27699f2`
- 风险：R1（发布链路；只改构建脚本/测试，不改运行时行为与 `files` 声明）

## 目标

修复 2.0.24 `Release` workflow `mode=release` 在 Windows `build-win` 的 `Install plugin workspace dependencies` 阶段被插件脚本阻断的两个根因，并全量核对同类问题：

1. `omnimux-market`：`build` 不再使用 POSIX `rm -rf` / `mkdir -p` / `cp` / `for ... case`，迁到 `scripts/build.mjs`，用 Node `fs` 保持原产物结构与 `*.test.js` 排除规则。
2. `omnimux-clip`：`build-client.mjs` 的 Tailwind 配置动态 import 使用 `pathToFileURL(...).href`，避免 Windows 盘符被 ESM 当作 URL scheme。
3. 扫描全部插件 `prepare/build`（含嵌套 extension package），修复发现的其他 Windows 路径/PATH 分隔符问题（`omnimux-browser/extension/scripts/build.mjs`）；`build-all.mjs` 不再直接 spawn Windows 不可解析的裸 `npm` shim，统一复用 pnpm JS 入口；打包前置 `scripts/prepare-local-plugins.mjs` 在 Windows 通过 shell 解析 corepack/pnpm `.cmd` shim。
4. 打包前置 `scripts/verify-plugin-builds.mjs` 不把 `omnimux-clip/tailwind.openreel.config.js` 这个构建输入误判为 build 输出，避免 Windows checkout 时间戳导致 clean build 被误报 stale；`omnimux-browser` 的 `build:server` 在复制 `lib/client.js` 后刷新 mtime，避免 Windows `CopyFileEx` 保留旧时间戳。

## 非目标

- 不改任何运行时行为、模型/路由逻辑、插件 `files` 声明或打包产物内容。
- 不改 mac 产物内容；不改变 release 参数或发布授权。

## 验收

- [ ] `omnimux-market` 的 `build` 仅执行 `node scripts/build.mjs`；产物 `lib/` 结构不变，`lib/expert` 排除 `*.test.js`，`lib/tests/fixtures` 保留。
- [ ] `omnimux-clip` 的 `build-client.mjs` 不再用裸 `join(...)` 动态 import，`pathToFileURL(...).href` 在 Windows 盘符路径下可用。
- [ ] 全部插件 `prepare/build` 脚本通过可移植性扫描，无 POSIX-only 命令与裸路径动态 import；extension build 的 PATH 使用 `fileURLToPath` + `path.delimiter`。
- [ ] `corepack pnpm --dir plugins run build:all` 本地等价验证通过；Windows release `build-win` 能进入 install/build 后续步骤。
- [ ] `node --test plugins/scripts/windows-build-portability.test.mjs` 通过并登记在 governance/quality-gate。

## 验证命令

- `corepack pnpm --filter omnimux-market test`
- `corepack pnpm --filter omnimux-clip build`
- `corepack pnpm --dir plugins run build:all`
- `node --test plugins/scripts/windows-build-portability.test.mjs`
- `node scripts/workspace-check.mjs --check`
- `node scripts/bundle-lock.mjs --check`
- `git diff --check`
