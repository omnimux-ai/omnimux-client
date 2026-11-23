# 退役 `--dsh` 同步入口与 `~/.dsh/profiles/omnimux` 受管映射

## 背景与目标

OmniMux 桌面受管 Profile 的构建、重建（`rebuild-managed-profile.ts`）与运行验收已全面收敛到两个受管目标：

- 开发版：`~/.omnimux-dev/profiles/omnimux`（对应 `OmniMux Dev.app`）
- 正式版：`~/.omnimux/profiles/omnimux`（对应 `OmniMux.app`）

官方 DSH 底座（`~/.dsh`）不再承载本地受管快照物化：`rebuild-managed-profile.ts` 仅支持 `dev` 与 `prod`，且官方 DSH 与 OmniMux 桌面壳存在宿主包路径与代际差异，继续保留 `--dsh` / `--target=dsh` 入口及 `--all` 对 `~/.dsh` 的广播只会制造必然受阻的死路。

本次改动正式退役 `--dsh` 同步目标与 `.dsh` 默认目标应用推导，使同步、回滚、预检与自检脚本统一围绕受管的 `dev` / `prod` 目标工作。

## 变更范围

1. `plugins/scripts/sync-to-app.sh`、`plugins/scripts/sync-stable.sh`、`plugins/scripts/materialize-with-rollback.sh`：
   - 显式传入 `--dsh`、`--target=dsh` / `--target=dsh-desktop` 或 `OMNIMUX_SYNC_TARGETS=dsh` 时以非零退出码明确报错退役，不写入任何目标目录。
   - `--all` / `--broadcast` 仅广播至 `~/.omnimux-dev` 与 `~/.omnimux`，不再触碰 `~/.dsh`。
2. `plugins/scripts/sync-agent-presets.sh`、`plugins/scripts/omnimux.mjs`、`plugins/scripts/dev-doctor.sh`：
   - 清理 `--dsh` 参数声明与帮助文案；`dev-doctor.sh` 默认检查目标切换至 `~/.omnimux-dev`（可用 `OMNIMUX_DOCTOR_HOME` 覆盖）。
3. `plugins/scripts/verify-profile-preflight.mjs`、`plugins/scripts/verify-profile-dependency-snapshots.mjs`：
   - 从 `TARGET_APP_BY_HOME_NAME` 移除 `.dsh -> /Applications/DSH Desktop.app` 映射，仅保留 `.omnimux-dev` 与 `.omnimux`。

## 验收标准

- `sync-to-app.sh --help` 仅展示 `--prod` / `--all` / `--target`，不再宣传 `--dsh`。
- `sync-to-app.sh`、`sync-stable.sh`、`materialize-with-rollback.sh` 收到 `--dsh`、`--target=dsh`、`--target=dsh-desktop` 或 `OMNIMUX_SYNC_TARGETS=dsh` 时硬失败并输出退役提示，且不修改 `~/.dsh/profiles/omnimux`。
- `sync-stable.sh --all` 仅物化 `~/.omnimux-dev` 与 `~/.omnimux`，不写入 `~/.dsh`。
- `resolveTargetApp` 对 `.omnimux-dev` 与 `.omnimux` 返回对应 OmniMux 应用路径，对 `.dsh` 返回 `null`。
- `pnpm test:gates` 及相关同步回归单测全绿。

## 旧标准变更

- `plugins/scripts/sync-release-policy.test.mjs` :: `keeps Alpha in non-production profiles during a mixed-target sync`
  - 原断言：`--all` 同时向 `.omnimux-dev`、`.dsh` 保留 Alpha 插件并向 `.omnimux` 剔除 Alpha。
  - 变更理由：`--dsh` 与 `~/.dsh/profiles/omnimux` 同步目标已正式退役，`--all` 不再向 `~/.dsh` 广播。
  - 新期望与证据：更名为 `keeps Alpha in non-production profiles during a mixed-target sync and excludes retired ~/.dsh`，验证 `--all` 仍在 `.omnimux-dev` 保留 Alpha（`development`）、在 `.omnimux` 剔除 Alpha（`production`），同时显式断言 `.dsh` 输出与文件均未被触碰。

- `plugins/scripts/sync-targets.test.mjs` :: `sync-to-app.sh help shows target parameter options`
  - 原断言：帮助文本包含 `--prod`、`--dsh`、`--all`。
  - 变更理由：`--dsh` 已退役，帮助文案不得继续暴露失效参数。
  - 新期望与证据：更名为 `sync-to-app.sh help shows managed target parameter options without retired --dsh`，断言包含 `--prod` 与 `--all`，且不再包含 `--dsh`。

- `plugins/scripts/sync-targets.test.mjs` :: `sync-stable.sh targets ~/.dsh when --dsh is passed`
  - 原断言：传入 `--dsh` 时以退出码 0 同步至 `~/.dsh/profiles/omnimux`。
  - 变更理由：`--dsh` 同步入口正式退役，改为响亮拒绝而非写入 `~/.dsh`。
  - 新期望与证据：替换为 `sync entrypoints fail loudly when retired --dsh / dsh target is requested`，覆盖 `sync-stable.sh`、`sync-to-app.sh`、`materialize-with-rollback.sh` 的 `--dsh` / `--target=dsh` / `--target=dsh-desktop` / `OMNIMUX_SYNC_TARGETS=dsh`，验证全部非零退出、输出退役提示且不改动 `~/.dsh/profiles/omnimux/package.json`。

- `plugins/scripts/sync-targets.test.mjs` :: `sync-stable.sh broadcasts to all profiles when --all is passed`
  - 原断言：`--all` 同时写入 `.omnimux-dev`、`.omnimux` 与 `.dsh`。
  - 变更理由：`--all` 收敛为全部受管 Profile（`dev` + `prod`），排除已退役的 `~/.dsh`。
  - 新期望与证据：更名为 `sync-stable.sh broadcasts to managed profiles (~/.omnimux-dev and ~/.omnimux) when --all is passed, excluding ~/.dsh`，断言 `.omnimux-dev` 与 `.omnimux` 被同步、`.dsh` 不被同步。

- `plugins/scripts/sync-targets.test.mjs` :: `sync-agent-presets.sh --dsh skips desktop/web and never retires user presets`
  - 原断言：向只读校验脚本 `sync-agent-presets.sh` 传入 `--dsh` 时不写盘、不改动用户预设。
  - 变更理由：`sync-agent-presets.sh` 已移除 `--dsh` 参数声明，仅保留 `--prod` / `--all` / `--skip-build`。
  - 新期望与证据：更名为 `sync-agent-presets.sh --prod skips disk writes and never retires user presets`，以 `--prod` 验证相同的不写盘与保护用户预设不变量，同时保留 `--all` 用例继续验证不触碰任何宿主应用与用户预设目录。
