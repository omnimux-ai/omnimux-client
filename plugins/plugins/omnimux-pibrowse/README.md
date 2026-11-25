# omnimux-pibrowse

OmniMux 指纹浏览器插件，将开源指纹浏览器 [aronhy/pibrowse](https://github.com/aronhy/pibrowse)（上游基于 [furyteamtop/fury-antidetect-browser](https://github.com/furyteamtop/fury-antidetect-browser)）以**无壳 Sidecar + 本地 IPC Socket + 原生 MCP 托管 + 侧边栏四视图工作台 + Team Server 端到端加密同步**方式接入 OmniMux 客户端。

## 与 `omnimux-browser` 的边界

| 维度 | `omnimux-browser` | `omnimux-pibrowse` |
|---|---|---|
| 定位 | 接管用户日常 Chrome 标签页（扩展桥接） | 多账号隔离指纹浏览器（Chromium 157 Core 补丁内核 + 本地代理中继） |
| 数据域 | 用户当前浏览器会话 | 严格隔离于 `$DSH_HOME/omnimux/pibrowse/data` |
| 协议面 | Chrome Extension Native Messaging | `fury-agent` 本地 `0600` Unix Socket / Named Pipe + 原生 `ctx.mcpManager` stdio MCP |

## 核心能力（当前已实现）

- **去壳 Sidecar 与本地 IPC 托管**：通过隔离 `FURY_HOME` 与短路径 `FURY_SOCKET` 管理 `fury-agent serve` 进程，不开放 `127.0.0.1` TCP HTTP 端口；插件卸载时自动注销 MCP、停止隔离域内浏览器配置、触发 `agent.shutdown` 并清理 Socket。
- **按需安装与 SHA-256 校验**：锁定上游 `v0.5.5`（commit `c72bc3654e7c70d6d5b654c30ee105e99cd60cba`，Chromium `157.0.8103.39`），支持 `darwin-arm64` `.dmg` 只读挂载提取 `fury-agent`、复用本机 `/Applications/PiBrowse.app`、下载安装 Core 与手动指定二进制/内核路径；非 `darwin-arm64` 平台显式降级并提供手动路径与自构建说明。
- **双工具面协同**：自动通过 `ctx.mcpManager.register('pibrowse', ...)` 托管上游 `fury-agent mcp`（`v0.5.5` 实测暴露 19 个 `mcp__pibrowse__fury_*` 页面/配置/预热/养号工具及上游 `SKILL.md`）；同时提供 8 个不重叠的 `pibrowse_*` 宿主管理面工具（破坏性操作强制 `confirm: true`）。
- **四视图侧边栏工作台**：提供「配置」「代理与规则」「扩展与团队」「环境与运行态」四个工作区，支持 32 套 Persona 模板、批量创建、指纹重随机与 `detect-suite` 探测、多窗口镜像同步、代理池批量导入/检测/诊断/轮换、离线 MaxMind `.mmdb` 路径绑定、域名黑白名单（含 `@allow-only`）及扩展管理。
- **Team Server 端到端加密同步**：按上游 `shared-rs/src/keys.rs` 线协议实现 Argon2id（`256 MiB / t=3 / p=1`，Node 24+ 原生异步 `crypto.argon2`，Node 22 自动退回 `worker_threads` 内的 `@noble/hashes/argon2`）、XChaCha20-Poly1305、X25519 封包与 8 位公钥核验码、组织密钥交接与轮换、分布式锁启停、密钥代次防回滚与审计日志。

## 合规与安全声明

- **上游归属与许可**：本插件全部 Node/React 代码为 OmniMux 原创实现，不打包或修改上游 Rust/Tauri 源码，与外部进程仅通过本地 IPC / MCP 进程间通信交互。外部按需下载运行的 `fury-agent` 与 Chromium Core 来自 [aronhy/pibrowse](https://github.com/aronhy/pibrowse)（AGPL-3.0-or-later）及 [furyteamtop/fury-antidetect-browser](https://github.com/furyteamtop/fury-antidetect-browser)。
- **Widevine CDM**：本插件严禁打包、托管或再分发任何 Google Widevine CDM 二进制文件，仅只读探测本机已安装的 Chrome CDM 并在缺失时诚实提示 DRM 受限。
- **零凭据泄漏**：代理密码、Team 登录密码、TOTP、会话 Token、组织根密钥（ORK）与派生密钥均经 `src/redact.js` 严格剥离，不透传给前端 HTTP 响应、Agent 工具返回或日志。
