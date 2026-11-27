---
title: "插件与宿主运行时安全边界契约"
id: "contract-plugin-security-boundaries"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-27"
---

# 插件与宿主运行时安全边界契约

本契约沉淀全仓安全加固（`#368`）确立的 6 类运行时安全不变量，适用于所有桌面壳 WebServer、执行中枢与业务插件的新增及重构代码。

## 1. Host HTTP / WebSocket 路由鉴权（Fail-Closed）

- 所有非匿名插件路由与社区市场路由必须显式声明 `auth: 'required'`（或 `'deny'`），不得依赖未标注路由默认放行；确需免登录的静态/握手端点须显式标明 `auth: 'anonymous'` 并在评审中说明原因。
- 路由处理器须独立校验 `connection.requestRejection(req)`（兼容已鉴权 `peer` 对象），当 `connection` 服务缺失或抛错时必须 **fail-closed 返回 `503`**，禁止静默放行。
- 回归测试必须覆盖：未鉴权请求 `401`/`403`、`connection` 缺失 `503`、合法 `peer` 放行。

## 2. 公网出站请求 SSRF 与 DNS IP 固定

- 所有接受外部或用户可控 URL 的服务端出站请求（图标代理、网页 OG 抓取、媒体/视频下载等）必须：
  1. 仅允许 `https:`（仅明确需要时允许 `http:`），拒绝内嵌凭据（`user:pass@`）与非预期端口。
  2. 拒绝 IPv4 与完整 8-word IPv6 私有/环回/链路本地/元数据/保留段（含 `100.64.0.0/10`、IPv4-mapped/compatible IPv6、NAT64、6to4 等）及非规范数字 IPv4。
  3. 对域名执行带超时上限的 fail-closed DNS 解析，并将**已校验的 IP 直接固定到 Socket 连接**（`http(s).request` 自定义 `lookup` + TLS `servername` SNI，`agent: false`），杜绝先验 DNS 再调用无固定 `fetch` 的 TTL=0 DNS 重绑定（TOCTOU）窗口。
  4. 禁用自动跳转（`redirect: 'manual'`），限制最大跳数（默认 ≤ 5 跳），每跳重新执行语法 + DNS + IP 固定校验；跨源重定向必须剥离 `Cookie` 与 `Authorization` 头。
  5. 同时校验 `Content-Length` 与流式读取字节上限，超限中止流并返回 `413`。

## 3. 本地文件与受管配置路径边界

- HTTP 写入接口不得接受客户端直接提交本地文件路径（如 `allowLocalPath: false`）或覆盖服务端自有路径字段（如 `local_paths`），必须经受控上传的 `media_id` 等间接标识引用。
- 任何本地文件读写、转码（`ffmpeg`）、自定义安装目录（`installRoot`、`skillsDir`）或子目录拼接，必须检查路径段白名单（拒绝对路径、`..`、空字节、Windows 驱动器前缀），并对**目标及所有祖先目录**执行 `lstatSync`（拒绝符号链接）与 `realpathSync` 受管根包含校验；拒绝 `.ssh`、`.aws`、`.gnupg`、`.env`、`/etc` 等敏感路径。
- 本地 Unix Socket 通信须校验文件权限模式与属主匹配，禁止通过配置覆盖受管二进制可执行路径。

## 4. 媒体输出、Markdown 与不可信网页内容隔离

- 媒体导入与代理不得轻信扩展名或请求头 `Content-Type`，必须按文件魔数嗅探仅放行安全位图/音视频格式，拒绝 `image/svg+xml`、HTML 与脚本类型（`415`）。
- 所有媒体/图标响应统一附带 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox; default-src 'none'` 与 `Cross-Origin-Resource-Policy: same-origin`；存量非安全文件必须降级为 `application/octet-stream` 并附 `Content-Disposition: attachment`。
- 富文本 / Markdown 渲染禁止直出裸 HTML，须同时具备安全渲染器与白名单 HTML 清洗（防范标签走私与双重转义），且前端不可信 `<a href>` / `src` 必须拦截 `javascript:`、`data:`、`vbscript:`、`file:` 协议。
- 拼入大模型 Prompt 的第三方网页字段必须包裹在显式数据边界标签（如 `<untrusted_page_data>`）中，并剥离内容内的同名闭合标签。

## 5. 同源校验、CSRF 与跨上下文消息隔离

- 变更状态或敏感本地接口的同源守卫仅允许 `sec-fetch-site: same-origin | none`（或缺失且经严格 `Origin`/`Host` 核对），**必须拒绝 `same-site` 与 `cross-site`**；禁止信任可伪造的 `x-forwarded-host`，比对 `Origin` 时须校验规范格式（无路径/凭据）与精确有效端口。
- 审批类交互（如扩展配对）须绑定单请求高熵随机 CSRF Token（`timingSafeEqual` 恒定时间比对）并输出 `X-Frame-Options: DENY`、`CSP: frame-ancestors 'none'` 与 `Referrer-Policy: no-referrer`。
- 浏览器扩展 CORS 禁止无条件放行 `chrome-extension://*` / `moz-extension://*` / 通配 `OPTIONS`，须要求显式来源白名单或恒定时间校验的配对桥接令牌；扩展新装默认权限遵循最小权限（`unrestrictedBrowserAccess: false`）。
- 浮窗 `postMessage` 必须同时校验 `event.source === window.parent` 与 `http(s)` 父页来源（优先 `ancestorOrigins[0]`、回退 `document.referrer`），对载荷字段做白名单与长度约束；涉及特权动作（如 `MEDIA_ATTACH_REQUEST`、DOM 写入 `FILL_FLOAT_HOST_DOM`）须由扩展后台凭 `grant` 令牌或 `isOwnFloatingPanel` 权威校验，不得由页面消息直接携带操作权限或文本载荷。

## 6. 供应链完整性、归档解压与请求体配额

- 客户端更新包与托管运行时归档（如 ComfyUI）必须采用 fail-closed 64-hex SHA-256 校验（空哈希/格式错误直接拒绝，落盘缓存启动前复核）；桌面安装器启动前须校验非符号链接常规文件与 SHA-256，并在 macOS 校验 `codesign --verify --deep --strict` 与 `TeamIdentifier`，在 Windows（当前按 `app/AGENTS.md` 未购付费 Authenticode 签名）校验 PE `VersionInfo`（`ProductName` / `ProductVersion`）。
- 归档解压必须设置条目数、单文件字节数、总解压字节数、路径深度、压缩比上限，并向 zlib 传入 `maxOutputLength` 防内存耗尽，同时拒绝路径穿越与重复条目。
- 本地 JSON / 表单 POST 接口必须对 `Content-Length` 与流式累加字节做双上限控制，超限返回 `413`；磁盘缓存（如头像缓存）须设条目数与总容量 LRU 上限。

## 已知存量差距与收敛方向

- **待补齐的 SSRF 与 DNS IP 固定**：`plugins/plugins/omnimux-inspiration/src/scraper-fallback.js`（`#383`）、`plugins/plugins/omnimux-inspiration/src/downloader.js`、`plugins/plugins/omnimux-workflow/src/workflow/videoExtraction/urlGuard.ts`（`#385`）及 `app/dsh-desktop-next/src/upstream-family/file-actions.ts`（`#377`）当前做 DNS 预检后仍调用无固定 `fetch`；`plugins/plugins/omnimux/src/media/stt-audio.js` 当前尚无 DNS 校验与 IP 固定。同时多个插件存在重复手写的 SSRF/IPv6/固定连接工具，后续应抽为共享安全模块并消除重复实现。
- **待自动化门禁**：路由 `auth` 声明与 `connection.requestRejection` 守卫目前靠人工评审保障，后续可补充静态扫描门禁。
