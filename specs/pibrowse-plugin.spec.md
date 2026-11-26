# PiBrowse 指纹浏览器插件（`omnimux-pibrowse`）产品与技术规格

- **状态**：已实现（Phase 1–3 核心能力；Windows / Intel Mac / Linux 预编译内核分发仍为规划中）
- **所属包**：`plugins/plugins/omnimux-pibrowse`
- **工作台入口**：侧边栏官方「更多」菜单入口「指纹浏览器」（通过 `window.__omnimuxSidebar.registerExploreItem` 运行时注册，Tab ID：`omnimux-pibrowse:workbench`）
- **存储域**：`$DSH_HOME/omnimux/pibrowse/`（配置元数据、Sidecar 运行状态、隔离数据目录与按需下载的 Agent / Chromium Core 缓存）
- **上游基线**：[aronhy/pibrowse](https://github.com/aronhy/pibrowse) `v0.5.5`（commit `c72bc3654e7c70d6d5b654c30ee105e99cd60cba`，Chromium `157.0.8103.39`，基于 [furyteamtop/fury-antidetect-browser](https://github.com/furyteamtop/fury-antidetect-browser)）

## 一、目标与核心范围

将开源指纹浏览器 [PiBrowse](https://github.com/aronhy/pibrowse) 以**去壳化 Sidecar + 原生 MCP + 侧边栏 Web UI** 的方式接入 OmniMux / DSH 插件生态，为跨境电商、社媒多账号运营、广告验证与 QA 场景提供可隔离的浏览器配置文件工作区，并支持 Agent 通过 MCP 与 `ctx.tools` 协同操控：

1. **去壳化 Sidecar 运行时管理（当前已实现）**：
   - 舍弃 PiBrowse 原版 Tauri 桌面壳，由 `omnimux-pibrowse` 的 Cordis Host 层托管本地 Rust `fury-agent` 二进制（`serve` 模式），使用独立 `FURY_HOME` 数据目录与本地 `FURY_SOCKET` 换行 JSON IPC（Unix `0600` 短路径 Socket / Windows Owner-DACL Named Pipe），**不开放 `FURY_API_PORT` 本地 TCP 端口**。
   - 不将 Rust 二进制或 Chromium `157.0.8103.39` 内核打包进 npm 插件包；首次使用时由侧边栏 UI 引导用户按需下载固定版本的官方发布产物并执行 SHA-256 校验（macOS `arm64` 从 `.dmg` 只读挂载提取 `fury-agent` 并在 `finally` 强制卸载），落盘至 `$DSH_HOME/omnimux/pibrowse/bin/`。
   - 在 Cordis `ctx.effect` 清理阶段先可靠终止运行中的浏览器与 `fury-agent` 进程树，再释放 Team Server 分布式锁，防止插件重载、profile 切换或宿主退出时产生孤儿进程或锁漂移。
2. **Agent 双工具面协同（当前已实现）**：
   - 通过宿主原生 `@deepseek-ai/dsh-mcp-manager`（`ctx.mcpManager.register('pibrowse', ...)`）注册 `fury-agent mcp`（stdio 模式，注入隔离的 `FURY_HOME`/`FURY_SOCKET` 且清空 `FURY_API_PORT`/`FURY_API_TOKEN`），自动向 DSH Agent 暴露 `v0.5.5` 实测的 19 个 `mcp__pibrowse__fury_*` 工具（覆盖配置列表、启停、导航、页面快照、点击/输入与账号预热）。
   - 通过 `ctx.tools` 补齐 8 个不重叠的 `pibrowse_*` 管理面与守卫工具（运行环境状态/启停/安装、配置维护与回收站、代理出口校验/诊断/轮换、域名规则、扩展与多窗镜像、自托管 Team Sync），所有破坏性操作强制要求显式 `confirm: true`。
   - 保持凭据边界：代理账号密码、移动代理轮换链接、Team 会话令牌与组织根密钥（ORK）仅驻留宿主与本地 Agent 进程内，不向大模型上下文、前端页面或日志暴露明文凭据。
3. **侧边栏「更多」菜单工作台 UI 注册（当前已实现）**：
   - 通过 `window.__omnimuxSidebar.registerExploreItem` 将「指纹浏览器」入口注册至官方侧边栏「更多」菜单（`omnimux` 的 `sidebar-coordinator.js` 将 `omnimux-pibrowse` 收敛进 `CONVERGED_ROWS` 而非固定在主侧栏），并保留 `createSidebarEntry` 维持 `CONVERGED_ROWS` 与 `verify:stages` 契约一致；点击后在主工作台打开指纹浏览器管理页面，兼容 DSH Desktop 与 `dsh web` 模式。
   - UI 页面涵盖四大核心视图：
     - **配置文件（Profile）工作区**：列表展示、分组/状态筛选、新建/批量创建/克隆、绑定 Persona 指纹模板（32 套真实设备配置）与代理、启动/停止窗口、启动指纹探测页（`detect-suite`）、回收站恢复/永久清除与多窗口同步开关。
     - **代理池与域名规则**：批量导入代理、经代理校验出口 IP/国家/时区（支持离线 MaxMind `.mmdb` GeoIP）、分段诊断、移动代理轮换链接触发、按配置文件配置域名黑/白名单（`@allow-only`）。
     - **扩展与团队同步**：`.crx` 扩展包 / 32 位商店 ID 扩展管理；自托管 Team Server 登录（含 TOTP）、邀请注册、管理员 8 位公钥核验码交接、组织根密钥（ORK）轮换、分布式锁加锁启动与审计日志查看。
     - **环境与运行状态**：检测平台兼容性、本地 `fury-agent` 二进制、Chromium `157.0.8103.39` Core、本机 Chrome（Widevine CDM 复用检测）与 MCP 连接状态，提供按需下载、SHA-256 校验、自定义路径配置、复用独立安装与 Sidecar / MCP 启停控制。

## 二、系统架构与集成方案

### 1. 模块分层

```text
DSH 侧边栏 UI (React 18 + dsh-ui-kit)
   │  Local HTTP (/omnimux/pibrowse/*, 同源 Host:Port + Sec-Fetch-Site 校验)
   ▼
Cordis 插件宿主 (plugins/plugins/omnimux-pibrowse/src/index.js)
   ├── Sidecar 管理器：SHA-256 下载校验、FURY_HOME / FURY_SOCKET 隔离、ctx.effect 进程回收
   ├── 领域调度器（dispatcher.js）：HTTP 路由与 8 个 ctx.tools 共享同一状态源与红线脱敏
   ├── Team Sync 客户端（team-crypto.js / team-client.js）：Argon2id + X25519 + XChaCha20-Poly1305
   └── MCP 注册桥接（mcp-bridge.js）：向 @deepseek-ai/dsh-mcp-manager 注册 fury-agent mcp (stdio)
   │
   ├── (Local FURY_SOCKET 换行 JSON IPC) ──▶ PiBrowse fury-agent (Rust Sidecar)
   └── (MCP stdio, 19 个 fury_* 工具)    ◀── DSH Agent (@deepseek-ai/dsh-mcp-client)
                                                │
                                                └── Spawn + Proxy Relay ──▶ Chromium 157 Core (41 项 C++ 补丁)
```

### 2. 与 `omnimux-browser` 的职责边界

| 维度 | `omnimux-browser`（已实现） | `omnimux-pibrowse`（已实现） |
| :--- | :--- | :--- |
| 核心定位 | 通过 MV3 扩展连接用户日常 Chrome/Firefox 的受控标签页 | 独立多账号指纹浏览器工作区（内核级伪装 + 独立代理中继） |
| 隔离与防检测 | 复用宿主日常浏览器环境，不做内核指纹伪装 | 基于 Chromium 157 + 41 项 C++ 补丁，跨上下文一致与确定性噪声 |
| 通信通道 | 扩展 ↔ DSH WebSocket Bridge | 本地 `fury-agent` `FURY_SOCKET` IPC + 原生 `mcpManager` stdio + 插件 HTTP |
| 典型场景 | 日常网页伴随阅读、素材采集、单账号即时辅助 | 多店铺/多社媒账号隔离、独立代理出口、批量预热、多窗同步与团队协作 |

两者互不覆盖、并行共存，插件文案与工具命名严格区分，避免用户与 Agent 混淆调用目标。

### 3. 平台与进程隔离设计

- **数据目录与通信隔离**：启动 Sidecar 与 MCP 子进程时显式注入独立 `FURY_HOME`（`$DSH_HOME/omnimux/pibrowse/data`）与短路径 `FURY_SOCKET`，并清空 `FURY_API_PORT` / `FURY_API_TOKEN`，避免开放本地 TCP 端口或与独立安装的 `PiBrowse.app` 产生锁冲突。
- **平台兼容策略**：
  - 上游 [PiBrowse 0.5.5](https://github.com/aronhy/pibrowse) 当前仅提供 macOS Apple Silicon（`darwin-arm64`）预编译包（ad-hoc 签名）；插件在运行时显式检测 `process.platform` 与 `process.arch`。
  - 对未提供预编译包的平台（Windows、Intel Mac、Linux）显式展示「当前平台暂未提供预编译内核」的不可用说明与手动指定本地二进制路径入口，禁止静默失败或假装就绪。
  - 在 macOS 环境下若遇到未公证二进制被 Gatekeeper 拦截，UI 与探针明确返回错误码与系统授权指引。

## 三、架构边界与硬约束

- **DSH 官方契约优先**：插件不依赖 Desktop 私有内部接口（如 `desktopRuntime`、Electron `BrowserWindow` 或私有 shim），遵循 `app/docs/plugin-development.md` 规范；UI 与 Host 通信仅走标准 DSH Web routes 与官方 UI slots。
- **视觉与滚动契约**：Client UI 100% 消费 `dsh-ui-kit` 与宿主真实定义的 `--dsw-alias-*` / `--dsw-specific-*` 语义 Token，遵循 `.omx-stage-scroll` / `.omx-stage-sticky` 滚动契约，浮层容器使用实体背景禁止透底；遵循 Show, Don't Tell 原则，仅对错误、需介入异常或无视觉变化的剪贴板回执使用 Toast。
- **双面同源与破坏性守卫**：侧边栏 UI 调用的插件 HTTP 路由（`/omnimux/pibrowse/*`）与暴露给 Agent 的 8 个 `pibrowse_*` 工具共享同一 `dispatcher` 与校验逻辑；永久删除配置、删除代理、删除域名规则、移除扩展、清空下载缓存、轮换 ORK 与断开团队同步均要求显式 `confirm: true`。
- **安全与凭据红线**：
  - Sidecar 仅监听 `0600` 本地 `FURY_SOCKET`（零本地 TCP 监听端口）；插件 HTTP 写路由校验严格匹配的本地 `Origin`/`Referer`（含端口）与 `Sec-Fetch-Site: same-origin` 并限制请求体大小（2 MiB）。
  - 代理密码、内联 URL 凭据、移动代理轮换链接、Team 会话令牌、TOTP 挑战令牌与各类加密密钥在输出层（HTTP / `ctx.tools` / 错误与日志）统一脱敏，不得写入前端状态树、明文日志或 Git 仓库。
  - Team Server 端到端加密与上游 `shared-rs/src/keys.rs` 逐字节对齐（Argon2id `m=262144,t=3,p=1` + X25519 + XChaCha20-Poly1305 + 单调 `key_generation` 防回滚 + 成员 8 位核验码强制校验）。
- **许可证与 Widevine 合规红线**：
  - [PiBrowse](https://github.com/aronhy/pibrowse) 主体（`agent/`、`server/`、`desktop/`、`tools/` 等）采用 **AGPL-3.0-or-later**，`core/patches/` 为 **BSD-3-Clause**，`shared/` Schema 为 **Apache-2.0**；与本仓根 `LICENSE`（AGPL-3.0）兼容。插件包 `LICENSE`、`NOTICE` 与 `plugins.registry.json` 如实声明许可与归属。
  - **严禁再分发 Widevine CDM**：下载源与构建产物中绝对不得包含 `WidevineCdm` 专有二进制；沿用 Agent 复用本机已安装 Chrome CDM 的机制，并在 UI 状态页对未安装 Chrome 的设备明确提示「无 DRM 支持，部分高风控站点可能检测到缺失 Widevine」。
  - **可接受使用边界**：插件定位为多账号工作区隔离、合规运营与测试工具，不得在 UI 或预设脚本中引导欺诈、撞库、钓鱼等违规用途。

## 四、假设与证伪结果

| 假设 | 证伪结果与实现落点 |
| :--- | :--- |
| PiBrowse 本地 Agent 是否可不经 Tauri 覆盖侧边栏 UI 全部管理能力 | **已实证并修正**：上游 `fury-agent` 的 HTTP 接口仅开放 15 个自动化子集路由，完整配置/代理/规则/扩展/镜像/停机控制面位于 `agent/src/ipc.rs` 的本地 `FURY_SOCKET` 换行 JSON IPC；插件直接对接 `FURY_SOCKET`，无需 Tauri 且无需开放本地 TCP 端口。 |
| DSH 宿主 `@deepseek-ai/dsh-mcp-manager` 能否稳定拉起并复用 `fury-agent mcp` 且不泄漏凭据 | **已实证**：基于 `v0.5.5` 真实 `fury-agent mcp` stdio 握手实测返回 19 个 `fury_*` 工具；宿主经 `ctx.mcpManager.register('pibrowse', ...)` 托管并在 `dispose` 时完整撤回，同时清空 `FURY_API_PORT`/`FURY_API_TOKEN` 并对代理响应与错误行做统一脱敏。 |
| Cordis 生命周期销毁与插件重载时，Agent 及其子进程能否完整回收 | **已实证**：单元生命周期测试与真机 `v0.5.5` 冒烟实测均验证 `dispose()` 先停运行中配置再有序关停 `fury-agent`，退出后无孤儿 PID 与残留 Socket 文件，随后释放 Team Server 分布式锁。 |
| 跨平台缺口与无 Chrome（缺失 Widevine）场景下，UI 能否诚实降级 | **已实证**：在非 `darwin-arm64` 平台与无 Widevine 环境下，环境页明确展示不可用原因、本地路径配置入口与 DRM 提示，无无限 loading。 |

## 五、分阶段实施状态

- **Phase 1（MVP 闭环：Sidecar 托管 + 原生 MCP 接入 + 环境状态页）**：**当前已实现**
  - 完成 `plugins/plugins/omnimux-pibrowse` 包结构、侧边栏固定入口（`PINNED_ENTRY_PREFIXES`）与环境状态页。
  - 完成 `fury-agent` 与 Chromium Core 的按需下载、强制 SHA-256 校验、自定义路径配置、独立安装复用与 `ctx.effect` 进程回收。
  - 打通 `ctx.mcpManager` 原生注册 `fury-agent mcp`（19 个 `mcp__pibrowse__fury_*` 工具）与 8 个 `pibrowse_*` 管理面工具。
- **Phase 2（完整侧边栏工作台 UI）**：**当前已实现**
  - 完成配置文件工作区（筛选/新建/批量/克隆/重随机/回收站/指纹探测/多窗同步）、代理池（批量导入/出口校验/诊断/移动轮换/离线 GeoIP）与域名黑/白名单（`@allow-only`）。
  - 高保真 HTML 演示与真实 React 构建产物均在真实浏览器完成亮/暗双主题、窄屏与模态浮层验收。
- **Phase 3（团队端到端加密同步与跨平台增强）**：
  - **自托管 Team Server 端到端加密同步（当前已实现）**：支持登录/TOTP、邀请注册、Argon2id（原生优先 + Worker 线程 `@noble/hashes` 回退）、X25519 密钥交接与 8 位核验码强制校验、ORK 密钥轮换（保留现有 Cookie 密钥）、分布式锁加锁启动与失败自动解锁、单调代次防回滚与审计日志。
  - **Windows / Intel Mac / Linux 预编译内核分发流水线（规划中）**：待上游或发布流水线提供对应平台签名产物后接入校验清单；当前通过手动路径配置入口提供降级支持。

## 六、验收清单

- [x] `plugins/plugins/omnimux-pibrowse` 单元测试（Sidecar 生命周期、下载校验、加密矢量、Team Sync、MCP 桥接、HTTP/工具脱敏与客户端渲染）全绿。
- [x] `corepack pnpm --dir plugins run build:all` 构建成功并产出 `lib/client.js`。
- [x] 全仓门禁通过：`check:boundaries`、`verify:product-baseline`、`verify:silent-catch`、`check:package-files`、`verify:licenses`、`test:licenses`、`verify:dsw-tokens`、`verify:tools`、`test:agent-tools`、`verify:stages`、`verify:stage-scroll`、`verify:slots`、`guard:popover`、`lint:i18n`、`verify:plugin-load`、`registry:verify`、`doc-lint`、`workspace-check`。
- [x] 真实浏览器演示与实时 React 工作台验证（亮/暗双主题、窄屏与模态浮层）及 Apple Silicon 上游 `v0.5.5` 真机 Sidecar/IPC/MCP 冒烟验证通过（注：真机 Chromium Core 下载拉窗与真实远端 Team Server 联调未在本轮执行）。
- [x] 许可证与合规核查通过：未打包 Chromium 源码、Rust 二进制或 Widevine CDM，`LICENSE` / `NOTICE` 与 `plugins.registry.json` 归属完整。

## 关联契约变更记录

- `plugins/plugins.registry.json`：已登记 `omnimux-pibrowse` 插件条目、许可类别与归属信息。
- `plugins/scripts/license-registry.json` 与 `plugins/scripts/verify-license-consistency.test.mjs`：已同步更新全仓插件总数与许可快照。
- `plugins/docs/contracts/plugin-agent-tools-inventory.md`：已登记 8 个 `pibrowse_*` 静态 `ctx.tools` 工具并说明动态注册的 `mcp__pibrowse__fury_*` MCP 命名空间。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.js` 与 `focus-state.js`：已将 `omnimux-pibrowse` 从常驻侧栏前缀收敛至官方「更多」菜单（由 `omnimux-pibrowse` 经 `registerExploreItem` 运行时挂载）并保留工作台回退标题映射。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `omnimux-pibrowse 在常驻侧栏白名单内，作为独立行挂入侧栏而不被收敛`
  - **原断言**：要求 `omnimux-pibrowse` 位于 `PINNED_ENTRY_PREFIXES` 白名单并作为独立行直接挂入侧栏。
  - **必须变更的理由**：用户明确要求将「指纹浏览器」收归至官方侧边栏「更多」菜单，不再占用主侧栏常驻位；改为将其从 `PINNED_ENTRY_PREFIXES` 移除，由插件自身经 `window.__omnimuxSidebar.registerExploreItem` 动态注册到「更多」菜单。
  - **新期望证据**：`plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` 更新为断言 `omnimux-pibrowse-entry` 进入收敛集合且 `registerExploreItem` 注册的 `pibrowse` 项出现在 `resolveExploreMenuItems()`；`plugins/plugins/omnimux-pibrowse/src/client-stage.test.js` 校验 `registerMoreMenuEntry` 注册与注销闭环。

- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：15 个插件全部登记且通过`
  - **原断言**：用例名与断言固定要求真实仓库 `plugins/plugins/` 共 15 个插件且按分类计数为 `{ original: 10, fork: 3, vendor: 2 }`。
  - **必须变更的理由**：本 PR 按已批准规划新增第 16 个工作区插件 `plugins/plugins/omnimux-pibrowse`（AGPL-3.0 自主开发插件，并在 `plugins/scripts/license-registry.json` 登记为 `original`），原 15 个插件 / `original: 10` 快照计数随插件总数增加自然更新为 16 个插件 / `original: 11`，用例同步更名为 `真实仓库：16 个插件全部登记且通过`。
  - **新期望证据**：`plugins/plugins/omnimux-pibrowse/LICENSE` 与 `NOTICE` 已与 `plugins/LICENSE` / `plugins/NOTICE` 逐字节一致，`corepack pnpm --dir plugins run verify:licenses` 与 `corepack pnpm --dir plugins run test:licenses`（16/16）全部通过。

- `plugins/plugins/omnimux-pibrowse/src/paths-and-platform.test.js` :: `resolveAgentBinary and probeCoreInstallation detect managed, custom, and standalone paths`
  - **原断言**：在 `data/core/FuryCore.app` 创建空目录并断言 `probeCoreInstallation` 返回 `{ installed: true, path: fakeCoreApp }`。
  - **必须变更的理由**：上游 `v0.5.5` `agent/src/main.rs::core_leaves()` 与 `core_binary()` 实际只识别包含可执行体的真实路径（如 `Fury.app/Contents/MacOS/Fury`、`PiBrowse.app/Contents/MacOS/PiBrowse`），空 `.app` 目录会导致误报已安装并在启动时报错；修复后 `probeCoreInstallation` 改为严格校验真实可执行体并解析 `.app` / `core.bundle` 至内部可执行文件。
  - **新期望证据**：同用例现显式断言空 `Fury.app` 目录返回 `installed: false`，并在写入真实可执行叶文件 `core.bundle/Fury.app/Contents/MacOS/Fury` 后断言 `managed` / `custom` 均返回准确可执行路径（同时覆盖 Windows `Fury/chrome.exe`）。
