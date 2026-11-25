# PiBrowse 指纹浏览器插件（`omnimux-pibrowse`）产品与技术规格

- **状态**：草案（规划中）
- **所属包**：`plugins/plugins/omnimux-pibrowse`
- **工作台入口**：侧边栏独立入口「指纹浏览器」（Tab ID：`omnimux-pibrowse:workbench`）
- **存储域**：`$DSH_HOME/omnimux/pibrowse/`（配置元数据、Sidecar 运行状态、按需下载的 Agent 与 Chromium Core 缓存）
- **上游参考**：[aronhy/pibrowse](https://github.com/aronhy/pibrowse)（基于 [furyteamtop/fury-antidetect-browser](https://github.com/furyteamtop/fury-antidetect-browser)）

## 一、目标与核心范围

将开源指纹浏览器 [PiBrowse](https://github.com/aronhy/pibrowse) 以**去壳化 Sidecar + MCP + 侧边栏 Web UI** 的方式接入 OmniMux / DSH 插件生态，为跨境电商、社媒多账号运营、广告验证与 QA 场景提供可隔离的浏览器配置文件工作区，并支持 Agent 通过 MCP 直接操控：

1. **去壳化 Sidecar 运行时管理**：
   - 舍弃 PiBrowse 原版 Tauri 桌面壳，由 `omnimux-pibrowse` 的 Cordis Host 层托管本地 Rust `agent` 二进制（`serve` 模式）与独立数据目录、随机本地监听端口及 Bearer Token。
   - 不将 Rust 二进制或 Chromium `157.0.8103.39` 内核打包进 npm 插件包；首次使用时由侧边栏 UI 引导用户按需下载官方/可信发布产物并执行 SHA-256 校验，落盘至 `$DSH_HOME/omnimux/pibrowse/bin/`。
   - 在 Cordis `ctx.effect` 清理阶段可靠终止 Agent 及其派生的代理中继和浏览器子进程，防止插件重载、profile 切换或宿主退出时产生孤儿进程。
2. **Agent 通过 MCP 统一操控**：
   - 将 PiBrowse 内置的 MCP Server（`mcp` 模式）自动注册至宿主 `@deepseek-ai/dsh-mcp-manager` / `@deepseek-ai/dsh-mcp-client`，供 DSH Agent 通过标准 MCP 协议创建/查询/启停配置文件、管理代理、访问网页、点击/输入、截图及执行账号预热（Warm-up）。
   - 保持凭据边界：代理账号密码与加密配置文件密钥仅驻留在本地 Rust Agent 进程内，不向大模型上下文、前端页面或日志暴露明文凭据。
   - 规划与 `ctx.tools` 的工具面协同：对删除配置文件、清空代理池、强制终止运行中窗口等破坏性操作强制要求显式确认（`confirm: true`）。
3. **侧边栏工作台 UI 注册**：
   - 通过 `dsh-ui-kit` 的 `createSidebarEntry` 与 `window.__omnimuxWorkbench` 注册侧边栏一级入口，点击后在主工作台打开指纹浏览器管理页面，同时兼容 DSH Desktop 与普通 `dsh web` 模式。
   - UI 页面涵盖四大核心视图：
     - **环境就绪引导与状态栏**：检测本地 Agent 二进制、Chromium 157 Core、本机 Chrome（用于 Widevine CDM 复用检测）与 MCP 连接状态，提供一键下载、校验与启动/重启操作。
     - **配置文件（Profile）工作区**：列表展示、新建/批量创建/克隆、绑定 Persona 指纹模板（32 套真实设备配置）与代理、启动/停止窗口、启动指纹探测页（`detect-suite`）与多窗口同步开关。
     - **代理池与域名规则**：批量导入代理、经代理校验出口 IP/国家/时区（支持离线 MaxMind `.mmdb` GeoIP）、移动代理轮换链接触发、按配置文件配置域名黑/白名单（`@allow-only`）。
     - **扩展与团队模式（可选）**：`.crx` 扩展安装（保留扩展 ID）、可选配置自托管 Team Server 地址（单二进制 + PostgreSQL）以启用端到端加密同步。

## 二、系统架构与集成方案

### 1. 模块分层

```text
DSH 侧边栏 UI (React 18 + dsh-ui-kit)
   │  HTTP / WebSocket (/omnimux/pibrowse/*)
   ▼
Cordis 插件宿主 (plugins/plugins/omnimux-pibrowse/src/index.js)
   ├── Sidecar 管理器：下载校验、端口分配、环境变量隔离、ctx.effect 进程回收
   ├── API 网关代理：转发 UI 请求至本地 Agent（附带 Bearer Token，屏蔽 Tauri IPC 差异）
   └── MCP 注册桥接：向 @deepseek-ai/dsh-mcp-manager 注册本地 Agent MCP Server
   │
   ├── (Local HTTP / Socket) ──▶ PiBrowse Local Agent (Rust Sidecar)
   └── (MCP stdio)           ◀── DSH Agent (@deepseek-ai/dsh-mcp-client)
                                      │
                                      └── Spawn + TCP Proxy Relay ──▶ Chromium 157 Core (41 项 C++ 补丁)
```

### 2. 与 `omnimux-browser` 的职责边界

| 维度 | `omnimux-browser`（现有） | `omnimux-pibrowse`（规划中） |
| :--- | :--- | :--- |
| 核心定位 | 通过 MV3 扩展连接用户日常 Chrome/Firefox 的受控标签页 | 独立多账号指纹浏览器工作区（内核级伪装 + 独立代理中继） |
| 隔离与防检测 | 复用宿主日常浏览器环境，不做内核指纹伪装 | 基于 Chromium 157 + 41 项 C++ 补丁，跨上下文一致与确定性噪声 |
| 通信通道 | 扩展 ↔ DSH WebSocket Bridge | 本地 Rust Sidecar + 内置 MCP Server + 插件 HTTP 转发 |
| 典型场景 | 日常网页伴随阅读、素材采集、单账号即时辅助 | 多店铺/多社媒账号隔离、独立代理出口、批量预热与自动化 |

两者互不覆盖、并行共存，插件文案与工具命名严格区分，避免用户与 Agent 混淆调用目标。

### 3. 平台与进程隔离设计

- **数据目录隔离**：启动 Sidecar 时显式注入独立数据目录与内核路径（如 `FURY_CORE` / PiBrowse 对应环境变量及随机本地 `API_PORT`），避免与用户本机独立安装的 PiBrowse/Fury 桌面端产生端口或锁文件冲突。
- **平台兼容策略**：
  - 当前上游 [PiBrowse 0.5.5](https://github.com/aronhy/pibrowse) 仅提供 macOS Apple Silicon 预编译包（ad-hoc 签名）；插件必须在运行时显式检测 `process.platform` 与 `process.arch`。
  - 对未提供预编译包的平台（如 Windows、Intel Mac、Linux）显式展示「当前平台暂未提供预编译内核」的不可用说明与手动指定本地二进制路径入口，禁止静默失败或假装就绪。
  - 在 macOS 环境下若遇到未公证二进制被 Gatekeeper 拦截，UI 需提供清晰的错误说明与系统授权指引。

## 三、架构边界与硬约束

- **DSH 官方契约优先**：插件不依赖 Desktop 私有内部接口（如 `desktopRuntime`、Electron `BrowserWindow` 或私有 shim），遵循 `app/docs/plugin-development.md` 规范；UI 与 Host 通信仅走标准 DSH Web routes / RPC 与官方 UI slots。
- **视觉与滚动契约**：Client UI 100% 消费 `dsh-ui-kit` 与宿主真实定义的 `--dsw-alias-*` / `--dsw-specific-*` 语义 Token，遵循 `.omx-stage-scroll` / `.omx-stage-sticky` 滚动契约，浮层容器使用实体背景禁止透底；遵循 Show, Don't Tell 原则，避免冗余状态 Toast 播报。
- **双面同源与破坏性守卫**：侧边栏 UI 调用的插件 HTTP 路由（`/omnimux/pibrowse/*`）与暴露给 Agent 的管理能力共享同一状态源与校验逻辑；删除配置文件、清理缓存内核、重置代理池等破坏性动作必须带显式确认。
- **安全与凭据红线**：本地 Agent HTTP 端口仅绑定 `127.0.0.1` 并强制 Bearer Token 鉴权；代理密码、TOTP 密钥与加密 Bundle 密钥不得写入插件前端状态树、本地明文日志或 Git 仓库。
- **许可证与 Widevine 合规红线**：
  - [PiBrowse](https://github.com/aronhy/pibrowse) 主体（`agent/`、`server/`、`desktop/`、`tools/` 等）采用 **AGPL-3.0-or-later**，`core/patches/` 为 **BSD-3-Clause**，`shared/` Schema 为 **Apache-2.0**；与本仓根 `LICENSE`（AGPL-3.0）完全兼容。若在插件内复用或修改 PiBrowse 源码，必须在 `LICENSE`、`NOTICE` 及 `plugins.registry.json` 中如实声明上游来源与 AGPL-3.0 许可。
  - **严禁再分发 Widevine CDM**：下载源与构建产物中绝对不得包含 `WidevineCdm` 专有二进制；沿用 Agent 复用本机已安装 Chrome CDM 的机制，并在 UI 状态页对未安装 Chrome 的设备明确提示「无 DRM 支持，部分高风控站点可能检测到缺失 Widevine」。
  - **可接受使用边界**：插件定位为多账号工作区隔离、合规运营与测试工具，不得在 UI 或预设脚本中引导欺诈、撞库、钓鱼等违规用途。

## 四、假设与证伪方式

| 假设 | 证伪方式与通过条件 |
| :--- | :--- |
| PiBrowse 本地 Agent 暴露的 HTTP/Socket 接口足以覆盖侧边栏 UI 的日常管理，无需引入 Tauri 运行时 | 在本地启动 `agent serve` 并核对配置 CRUD、代理校验、启停与状态查询端点；若存在仅通过 Tauri IPC 暴露的操作，须先在 Rust Agent 侧补齐本地 HTTP 路由后再接入 UI，不得在 Electron Renderer 中模拟 Tauri API。 |
| DSH 宿主 `@deepseek-ai/dsh-mcp-manager` 可稳定拉起并复用 PiBrowse 内置 MCP Server，且不泄漏代理密码 | 端到端集成测试中通过 DSH Agent 调用 MCP 列出/创建/启动配置并抓取快照，断言工具调用成功且模型收到的响应与日志中不包含代理明文密码。 |
| Cordis generation 销毁与插件重载时，Agent 及其拉起的代理中继/浏览器进程可被完整回收 | 自动化生命周期测试中连续执行插件启动 → 启停配置 → generation dispose，断言无残留 Agent 进程与端口占用。 |
| 跨平台缺口与无 Chrome（缺失 Widevine）场景下，UI 能诚实降级而非静默报错 | 在不支持的平台/架构 mock 与无 Chrome 环境 mock 下，断言状态页明确展示缺失原因与可操作指引，且不陷入无限 loading。 |

## 五、分阶段实施计划

- **Phase 1（MVP 闭环：Sidecar 托管 + MCP 接入 + 状态引导页）**
  - 建立 `plugins/plugins/omnimux-pibrowse` 包结构、侧边栏入口与环境状态页。
  - 实现 Agent 与 Chromium Core 的按需下载、SHA-256 校验、路径配置与 `ctx.effect` 进程生命周期管理。
  - 打通 `pibrowse-agent mcp` 自动注册，验证 DSH Agent 通过 MCP 完成配置创建、打开页面与截图。
- **Phase 2（完整侧边栏工作台 UI）**
  - 完成配置文件列表/创建/克隆、Persona 选择、代理池管理与出口校验、域名黑/白名单、窗口启停与指纹自测入口。
  - 交付高保真 HTML 演示并通过亮/暗双主题、窄屏与浮层验收后合入插件代码。
- **Phase 3（跨平台与团队协作增强）**
  - 评估接入上游 Windows / Intel Mac 预编译构建与代码签名流水线。
  - 侧边栏设置页支持接入自托管 Team Server（PostgreSQL + 客户端端到端加密同步）。

## 六、验收清单

- [ ] `plugins/plugins/omnimux-pibrowse` 单元测试（Sidecar 生命周期、下载校验、API 代理、降级态）与 MCP 集成测试全绿。
- [ ] `corepack pnpm --dir plugins run build:all` 构建成功并产出 `lib/client.js`。
- [ ] 全仓门禁通过：`check:boundaries`、`verify:product-baseline`、`verify:silent-catch`、`check:package-files`、`verify:licenses`、`verify:tools`、`test:agent-tools`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`guard:popover`、`registry:verify`。
- [ ] 真实桌面端 / 浏览器端到端验证通过：覆盖侧边栏入口打开、首次下载/配置本地二进制路径、Agent 通过 MCP 操控配置文件、亮/暗双主题与窄屏布局，以及插件卸载后的进程回收检查。
- [ ] 许可证与合规核查通过：确认未打包 Chromium 源码或 Widevine CDM，`LICENSE` / `NOTICE` 与上游归属声明完整。

## 关联契约与旧标准变更说明

在正式实施并新增 `plugins/plugins/omnimux-pibrowse` 目录的 PR 中，需同步更新以下仓库契约与快照测试：

- `plugins/plugins.registry.json`：登记新插件条目、许可类别与归属信息。
- `plugins/scripts/verify-license-consistency.test.mjs`：同步更新全仓插件总数与对应许可类别计数快照。
- `plugins/docs/contracts/plugin-agent-tools-inventory.md`：若除 MCP 外同步暴露了 `ctx.tools` 工具，需同 PR 补齐工具契约清单。
