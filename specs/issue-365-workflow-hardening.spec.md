# Issue #365 — omnimux-workflow 安全加固

- 加固 ComfyUI 托管后端源码归档 SHA-256 强制校验（fail-closed）、受管 `installRoot` 目录约束与就绪态边界校验、YAML 安全编码。
- 加固社媒视频提取远程下载 URL/DNS/IP 私网与环回 SSRF 拦截、逐跳重定向校验、Content-Type 与下载体积上限。
- 加固 `MarkdownPreview` HTML 渲染消毒，禁止原始 HTML 与危险 URI 协议执行。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/workflow/comfyBackend/comfyBackendPreflight.test.mjs` :: `设置解析与安装根：坏文件回落默认值，用户值优先`
  - 原断言：`resolveInstallRoot('/root', { installRoot: '/custom/backend', ... }) === '/custom/backend'`（允许指向受管目录 `dataRoot` 之外的任意路径）。
  - 必须改的理由：Issue #365 安全修复将 `installRoot` 严格收口至受管 `dataRoot` 目录内，防止通过修改安装目录在 `start()` 时执行任意路径脚本。
  - 新期望证据：受管内路径 `/root/custom/backend` 继续受支持，越界路径 `/custom/backend` 回落到默认受管目录 `/root/comfyui-backend`，并由 `comfyBackendSecurity.test.mjs` 补充越界目录/符号链接/篡改 `settings.json` 回归用例。
