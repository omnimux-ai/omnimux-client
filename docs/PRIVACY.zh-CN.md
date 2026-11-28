# OmniMux 隐私政策

[English](../PRIVACY.md)

- **版本：** 2.0
- **生效及最近更新日期：** 2026 年 11 月 23 日

OmniMux 是一个本地优先的开源 AI 内容电商桌面工作台。本政策说明 OmniMux 官方客户端分发版本及 OmniMux 官方在线服务会处理哪些信息、为什么处理、信息会发送给谁，以及你可以如何作出选择。

本政策中的“我们”指在 GitHub 组织 [`omnimux-ai`](https://github.com/omnimux-ai) 下维护和发布 OmniMux 官方版本、并运营 `omnimux.ai` 与 `dl.omnimux.ai` 官方服务的 **OmniMux 项目团队**。OmniMux 是独立的开源项目，与 DeepSeek 及 Anywhere Labs 均不存在隶属、合作、授权或背书关系。

隐私问题、数据咨询或权利请求请发送至 [hello@omnimux.ai](mailto:hello@omnimux.ai)。请不要在公开的 GitHub Issue 中提交安装标识、日志、API Key、凭据或其他私密信息。

---

## 1. 适用范围

本政策适用于：

- 通过 [`omnimux-ai/omnimux-client`](https://github.com/omnimux-ai/omnimux-client)、`https://omnimux.ai` 及 `https://dl.omnimux.ai` 提供的 OmniMux 官方桌面安装包与客户端；
- `omnimux.ai` 及 `dl.omnimux.ai` 下的官方版本检查、插件索引、安装包下载与登录后使用的官方通道服务；
- 你主动发送至 `hello@omnimux.ai` 的隐私请求、支持邮件或反馈材料。

本政策不控制第三方 Fork、自行修改的构建、第三方分发渠道、你自行配置的 BYOK 模型服务商、第三方插件、外部 MCP 服务、第三方社区目录源，以及你连接的外部电商或社交媒体平台。这些服务各自按其条款与隐私政策处理数据。

---

## 2. 核心摘要

- **默认本地优先：** 你的产品库、本地创作资产、灵感合集、工作流画布、多轨剪辑工程、Profile、设置、会话、日志和崩溃文件默认保存在本机 `~/.omnimux` 目录（以及系统应用数据目录 `OmniMux`）中。OmniMux 不会读取或修改你本机已有的 `~/.dsh` 目录。
- **版本更新检查：** 打包后的 macOS 和 Windows 客户端会检查 `https://dl.omnimux.ai/api/desktop/version-stable.json`，并携带本地随机生成的伪匿名安装 UUID（`X-DSH-Desktop-Installation-Id`）、当前版本号（`X-DSH-Desktop-Version`）与发布通道（`X-DSH-Desktop-Channel`）。版本检查无需登录，不会主动附带提示词、文件内容、工作区路径、会话内容或 API Key。
- **安装包下载：** 从 `https://dl.omnimux.ai` 或 GitHub Releases 下载安装包时，客户端不会附带上述安装 UUID，但下载承载方与 CDN 基础设施仍会收到常规网络元数据（如 IP 地址与请求时间）。
- **诊断包导出：** 诊断 ZIP 仅在你主动点击 **导出诊断信息…** 时于本地生成，绝不会由应用自动上传。
- **外部 AI 与平台服务：** 云端模型调用（官方通道或 BYOK）、内置云端资产浏览下载、浏览器伴侣采集、插件安装及海外社媒发布，仅在你登录、配置或主动触发时向对应目标服务发送请求。

---

## 3. 官方版本检查与安装包下载

### 3.1 何时触发版本检查

打包后的 macOS 与 Windows 应用会在启动约 60 秒后检查稳定版更新，此后约每 6 小时检查一次；你也可以随时手动点击 **检查更新…**：

```text
GET https://dl.omnimux.ai/api/desktop/version-stable.json
```

开发运行、未打包启动及 Linux 构建当前不使用上述打包自动更新流程。

### 3.2 请求包含的信息

客户端在请求中显式添加：

- `Accept: application/json`
- `X-DSH-Desktop-Installation-Id: <随机 UUID v4>`
- `X-DSH-Desktop-Version: <当前已安装的规范稳定版本号>`
- `X-DSH-Desktop-Channel: <发布通道，如 stable>`

请求不附带查询参数或请求体。与所有 HTTPS 网络请求一样，分发 CDN 与网络基础设施还会接收到常规连接元数据（IP 地址、请求时间、TLS 握手信息与标准请求头）。版本检查代码不会主动发送提示词、模型回复、文件内容、工作区路径、Profile 名称、会话历史、凭据、MAC 地址或硬件序列号。

### 3.3 安装 UUID 的生成与存续

安装 UUID 具有以下特征：

- 当 Electron 用户数据目录中不存在有效持久化值时，在本地以加密随机方式生成 UUID v4；
- 保存在应用用户数据目录的 `identity/installation-id` 文件中：
  - macOS：`~/Library/Application Support/OmniMux/identity/installation-id`
  - Windows：`%APPDATA%\OmniMux\identity\installation-id`
- 不包含也不会推导出用户名、主机名、MAC 地址、硬盘序列号或其他硬件信息；
- 仅用于标识单个应用用户数据目录，不代表物理设备；
- 在文件被删除或损坏前持续保留。删除该文件只会导致下次启动重新生成一个新的 UUID，不会停止后续版本检查。

版本检查数据仅用于提供更新提示、统计去重后的聚合版本分布与更新可用性、保障服务安全与防滥用，以及履行适用法律义务。我们不出售该标识，也不将其用于跨服务广告画像。

### 3.4 安装包下载与官网访问

当你从 `https://dl.omnimux.ai` 下载安装包或访问 `https://omnimux.ai` 时，托管与 CDN 服务商会接收常规网络元数据（IP 地址、请求时间、请求路径及浏览器/客户端标准请求头），用于交付文件、防范滥用和排查故障。下载请求不会附带 `X-DSH-Desktop-Installation-Id`。

---

## 4. 本地数据、日志与诊断包导出

- **本地工作区与状态：** 默认情况下，OmniMux 将运行时 Profile、本地凭据、会话记录、产品库、资产库、工作流与剪辑工程保存在本机 `~/.omnimux` 目录，并将窗口与桌面壳状态保存在系统的 `OmniMux` 用户数据目录中。
- **日志与崩溃转储：** 本地应用日志与 Crashpad `.dmp` 文件均仅保留在本机，不会自动上传。
- **手动导出诊断包：** 当你选择 **导出诊断信息…**（或执行 `--export-diagnostics`）时，应用会在本地生成 `diagnostics-*.zip`，其中包含近期日志、Crashpad 转储文件、当前运行标记及 `system-info.txt`。日志会对可识别的凭据进行脱敏，但本地路径、工作区/会话 ID 及崩溃时的内存片段仍可能存在。请务必在对外分享前自行审阅，切勿将原始诊断包直接上传至公开 Issue。

---

## 5. 在线服务、AI 模型与可选功能

### 5.1 OmniMux 官方通道与内置云端资产

- **官方通道：** 当你登录 OmniMux 账号并使用官方通道时，执行中枢会向 OmniMux 网关及实际承接请求的模型服务发送你的账号鉴权令牌、模型/通道参数，以及该次生成所需的提示词、媒体素材或工具载荷。
- **内置云端资产：** 当你在资产中心浏览、试听、预览或一键保存内置云端商业资产时，客户端会向配置的云端资产服务请求目录元数据与媒体文件；你选择保存的资产会下载到你的本地工作区。

### 5.2 BYOK 自定义模型端点与外部服务商

当你自行配置 API Key 或自定义模型端点（BYOK）时，模型凭据保存在本机，请求直接发往你配置的目标端点，并受对应服务商的条款与隐私政策约束。

上游 DeepSeek Harness 还在数据目录中维护一个独立的 `.anonymous-user-id`。当你调用上游默认 DeepSeek 适配器时，可能会在 `x-deepseek-harness-user-id` 请求头中将其发往你配置的 DeepSeek 或兼容 `baseURL`。该标识与 `X-DSH-Desktop-Installation-Id` 彼此独立。

### 5.3 浏览器伴侣、素材采集、MCP 连接器与海外社媒发布

- **浏览器伴侣与灵感导入：** 仅在你主动触发商品页解析、爆款帖导入或 Chrome 悬停采集时，本地宿主与浏览器扩展才会读取并保存你指定的页面信息与媒体素材。
- **MCP 连接器与海外社媒发布：** 仅在你显式授权账号或执行相关任务时，应用才会连接外部 MCP 服务或海外社交平台（如 TikTok、Instagram、Facebook、YouTube），相关数据处理遵循对应平台的隐私政策。

### 5.4 插件市场与软件包服务

- 打开插件市场或检查更新时，应用可能请求官方插件索引（`https://dl.omnimux.ai/plugins/dsh-index.json`）、内置社区回退索引（`https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json`），以及你主动添加或选择的其他目录端点。
- 当你预览或明确确认安装插件时，内置包管理器可能访问 `registry.npmjs.org`、GitHub 或你配置的软件源，以获取包清单与压缩包。
- 已安装的第三方插件会以当前系统用户权限在本地运行；目录收录不构成隐私或安全审计。

### 5.5 可选桌面统计与上游遥测

- **可选 OmniMux 桌面统计：** 仅当启动环境中同时配置了 `OMNIMUX_ANALYTICS_ENDPOINT` 与 `OMNIMUX_ANALYTICS_WEBSITE_ID` 时，OmniMux 桌面端才会使用本地伪匿名安装 UUID 向配置的 Umami 站点发送启动事件（`desktop_app_launch`：首次启动标记、应用版本、操作系统及版本）。在启动环境中设置 `OMNIMUX_ANALYTICS_DISABLED=1`（或 `true`）即可全部关闭。
- **可选上游 DSH 遥测：** 上游 DeepSeek Harness 会话遥测保持默认 `FEEDBACK_ONLY` 模式——日常使用不会上传会话内容，仅在你主动提交会话反馈时才会将该会话日志发送至上游配置的遥测端点；设置 `DSH_TELEMETRY_DISABLED=1` 可完全关闭。上游桌面产品分析（`product-analytics` 与 `desktop-product-telemetry`）已在启动时关闭。

---

## 6. 浏览器与局域网访问

在本地浏览器中打开 OmniMux 默认仅监听本机回环地址 `127.0.0.1`，不会将会话内容上传至 OmniMux 服务器。如果你在兼容模式下主动开启局域网访问，同一局域网内的设备将可连接本地 Host 并以你的本机权限调用工具，且局域网 HTTP 并非端到端加密通道。请仅在完全可信的网络中临时开启，并在使用后及时关闭。

---

## 7. 共享、保留、安全与你的权利

- **不出售个人信息：** 我们不会出售你的个人信息，也不会将安装标识提供给第三方用于广告画像。
- **基础设施与跨境路由：** 托管、CDN、软件源及你选择的模型服务商（如 Cloudflare、GitHub、npm 或第三方 AI 厂商）可能在不同国家或地区处理网络请求，具体取决于网络路由与你的配置。
- **数据保留：** 本机工作区数据完全由你掌控。服务端请求日志（含 IP 地址与版本检查元数据）仅在交付更新、保障安全、防滥用与排查故障所需的最短合理期限内保留，之后删除或进行不可逆匿名化聚合（法律另有要求除外）。
- **安全措施：** 官方在线端点均使用 HTTPS，本机安装标识文件采用受限权限（POSIX 下 `0700`/`0600`），诊断包导出需用户明确确认。但任何安全措施都非绝对；第三方插件、公开分享的诊断包或未鉴权的局域网访问均可能越过本地边界。
- **你的选择与权利：** 依据适用法律，你可通过 [hello@omnimux.ai](mailto:hello@omnimux.ai) 咨询或请求查阅、更正、删除或限制 OmniMux 官方服务持有的个人信息。我们无法远程删除你本机的文件；在应用退出后，你可以直接删除 `~/.omnimux` 或系统 `OmniMux` 用户数据目录。
- **未成年人说明：** OmniMux 面向成年内容创作者、电商运营人员与开发者，不专门面向儿童提供。未成年人应在监护人指导下使用。
- **政策变更：** 若收集类别、用途、官方端点或用户选择发生实质变化，我们将在本仓库更新本政策及生效日期。

本政策的英文版与简体中文版具有同等效力；如发现两版存在表述差异，请联系 [hello@omnimux.ai](mailto:hello@omnimux.ai) 以便我们及时更正。
