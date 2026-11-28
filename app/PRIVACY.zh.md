# OmniMux 桌面端隐私政策

[English](PRIVACY.md)

- **版本：** 2.0
- **生效及最近更新日期：** 2026 年 11 月 23 日

> OmniMux 全仓权威隐私政策（覆盖桌面壳、产品插件、内置云端资产、官方通道与 BYOK 端点）见根目录 [`../PRIVACY.md`](../PRIVACY.md)（[简体中文](../docs/PRIVACY.zh-CN.md)）。

本页汇总 `app/` 桌面端工作区相关的隐私边界。OmniMux 由 **OmniMux 项目团队**（`https://omnimux.ai`、[`omnimux-ai/omnimux-client`](https://github.com/omnimux-ai/omnimux-client)）独立维护，是独立开源项目，与 DeepSeek 及 Anywhere Labs 均不存在隶属、合作、授权或背书关系。

隐私咨询或权利请求请发送至 [hello@omnimux.ai](mailto:hello@omnimux.ai)。请勿在公开 GitHub Issue 中提交安装标识、日志、凭据或个人信息。

## 桌面壳数据边界摘要

- **默认本地优先：** Profile、设置、工作区、会话、日志和崩溃转储默认保存在本机 `~/.omnimux` 目录（以及 Electron 的 `OmniMux` 用户数据目录），与本机已有的 `~/.dsh` 目录相互隔离。
- **官方版本检查：** 打包后的 macOS 与 Windows 版本会在启动约 60 秒后、此后约每 6 小时或手动点击 **检查更新…** 时请求 `GET https://dl.omnimux.ai/api/desktop/version-stable.json`。请求显式携带 `Accept: application/json`、`X-DSH-Desktop-Installation-Id`（保存在系统 `OmniMux` 用户数据目录 `identity/installation-id` 下的本地随机 UUID v4）、`X-DSH-Desktop-Version` 与 `X-DSH-Desktop-Channel`（如 `stable`）。版本检查无需登录，不会主动附带提示词、文件、工作区路径、会话内容或 API Key。
- **安装包下载：** 从 `https://dl.omnimux.ai` 或 GitHub Releases 下载安装包不会附带 `X-DSH-Desktop-Installation-Id`，但托管与 CDN 基础设施会收到常规网络元数据（IP 地址、请求时间、请求路径）。
- **诊断包导出：** 诊断包（`diagnostics-*.zip`）仅在你主动选择 **导出诊断信息…**（或执行 `--export-diagnostics`）时于本地生成，绝不会自动上传；对外分享前请自行检查内容。
- **可选桌面统计：** 仅当启动环境中同时配置 `OMNIMUX_ANALYTICS_ENDPOINT` 与 `OMNIMUX_ANALYTICS_WEBSITE_ID` 时触发（向配置的 Umami 站点发送 `desktop_app_launch` 启动事件）；设置 `OMNIMUX_ANALYTICS_DISABLED=1`（或 `true`）可全部关闭。
- **可选上游 DSH 遥测：** 上游会话遥测默认保持 `FEEDBACK_ONLY`（日常使用不上传，设置 `DSH_TELEMETRY_DISABLED=1` 可完全关闭）；上游桌面产品分析（`product-analytics` 与 `desktop-product-telemetry`）在启动时关闭。
- **第三方服务与局域网访问：** 模型提供商、插件源（`https://dl.omnimux.ai/plugins/dsh-index.json`、内置社区回退索引 `https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json`、npm、GitHub 或你选择的第三方目录）及其他外部服务受各自条款约束。浏览器访问默认仅限 `127.0.0.1`；局域网访问仅应在完全可信网络中临时开启。

完整的在线服务说明、保留策略、安全边界与用户权利，请阅读权威版 [OmniMux 隐私政策](../docs/PRIVACY.zh-CN.md)。
