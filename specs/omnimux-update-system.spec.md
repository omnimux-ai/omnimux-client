# OmniMux Desktop Update System

## 目标与架构

将 `dsh-desktop-next` 内置更新从上游 `next` 通道与 `anywhere-labs` 残留彻底迁移到 OmniMux 自有更新体系：

- 独立引擎 `app/dsh-desktop-next/src/omnimux-updater/`：消费 `https://dl.omnimux.ai/api/desktop/v2/<channel>.json` 与同级 `.sig`（Ed25519 原始字节签名），在正式公钥未配置前对 HTTP 404 回退到历史 `api/desktop/version-<channel>.json`；配置公钥后严格 fail-closed 并禁用 v1 降级。
- 默认 `stable` 通道（修复 `2.0.25` 稳定版被硬编码为 `next` 通道导致本地直接失败的缺陷），支持 `updateChannel` 存储在 `desktop-preferences-extra.json`（兼容旧版降级启动）。
- 版本固化产物直链（`releases/v<ver>/...`）、并发 Range 分片与空闲超时重试、SHA-256 强制校验、macOS App Translocation / 写入权限 / 磁盘空间预检、Host 活跃任务检查与准入锁（`host/update-tasks.ts`）以及生产包 Profile 插件版本对账保护。

## 旧标准变更

- `app/dsh-desktop-next/tests/updates.spec.ts` :: `*` — 原断言绑定上游 `next` 通道默认值、`dsh-desktop-next-updates` 临时目录、`next-updates` 状态目录与 `https://github.com/anywhere-labs/dsh-desktop/releases`；本次切换为 OmniMux 稳定版默认通道、`omnimux-updates` 目录与 `https://github.com/omnimux-ai/omnimux-client/releases`，并以新增的 `tests/omnimux-updater/*.spec.ts` 全套用例覆盖 Manifest v2、签名、预检、分片重试与协调器状态机。
- `app/dsh-desktop-next/tests/recovery-support.spec.ts` :: `*` — 问题反馈链接由上游 `https://github.com/anywhere-labs/dsh-desktop/issues` 更新为本仓 `https://github.com/omnimux-ai/omnimux-client/issues`。
- `app/dsh-desktop-next/tests/update-transport.spec.ts` :: `*` — 更新下载隔离分区由 `dsh-next-update` 更名为 `omnimux-update`，其余所有 HTTPS / 重定向 / Range / 取消断言保持不变。
- `app/dsh-desktop-next/tests/update-installer.spec.ts` :: `*` — macOS 独立安装器环境变量由 `DSH_UPDATE_*` 切换为 `OMNIMUX_UPDATE_*`。
- `app/dsh-desktop-next/tests/main-lifecycle.spec.ts` :: `*` — 发布页跳转链接由 `anywhere-labs/dsh-desktop` 切换为 `omnimux-ai/omnimux-client`。
- `app/dsh-desktop-next/tests/desktop-state.spec.ts` :: `*` — `EXTRA_PREFERENCES` 新增 `updateChannel: 'stable'` 以保证 `desktop-preferences.json` 对旧版降级安全。
- `app/dsh-desktop-next/tests/desktop-runtime-startup-limit.spec.ts` :: `*` — `desktop-preferences-extra.json` 断言同步包含新增的 `updateChannel: 'stable'` 默认项。
