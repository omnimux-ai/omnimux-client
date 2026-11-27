# Issue #367 — Cross-plugin SSRF, Legacy Desktop Updater Integrity, and External Href Guards

## 背景与目标

修复主安全单 #368 下子单 #367 覆盖的 5 类问题：
1. `omnimux-products` 无头浏览器 CDP 截图（`cdp-client.js` / `site-shots.js`）增加绑定 `127.0.0.1:0` 的临时 HTTP/CONNECT 公网校验与 IP 固定代理（配合 `--proxy-server`、`--proxy-bypass-list=<-loopback>`、`--disable-quic` 与 `--host-resolver-rules`），并在 `attachPage` 中先注册监听再启用 `Fetch.enable` + `Target.setAutoAttach` 拦截子目标（OOPIF/Worker/弹窗），阻断重定向、子资源、WebSocket、DNS Rebinding 及 `file://` SSRF。
2. `omnimux-inspiration` 媒体下载（`url-policy.js` / `downloader.js` / `http-routes.js`）将验证后的 DNS 解析结果固定（IP pinning）到实际 socket 连接、补齐非全局 IPv6 保留段与多尾点/zone-id 拦截并拒绝跨源重定向透传 `Cookie`/`Authorization`。
3. `omnimux-video` 远端素材物化（`engine/remote-media.js` / `engine/job.js` / `engine/ffmpeg.js` 及全部 8 个兄弟能力）增加公网目标 + DNS 校验、IP pinning、手动重定向校验（上限 5 跳）、非 `http(s)` URI scheme 拦截、流式写盘与 512 MiB 上限，并为 `ffmpeg` 每个 `-i` 输入及 `ffprobe` 强制注入 `-protocol_whitelist file,pipe`。
4. `omnimux` 音频下载（`media/stt.js` / `media/stt-audio.js`）增加公网目标 + DNS 校验、IP pinning、手动重定向校验，并将 `Authorization: Bearer` 严格限定为 `https://*.omnimux.ai`。
5. `app/dsh-plugin-desktop` 遗留桌面更新链路（`host-runtime-bridge.ts` / `update-lifecycle.ts` / `update-download.ts` / `electron-runtime.ts`）改为强制要求 `installerSha256`（不再可选或经 IPC 丢弃），在 `rename` 前经 `verifyArtifact` 校验并在安装执行前再次校验 SHA-256 及原生代码签名（macOS `codesign -R` Designated Requirement + `TeamIdentifier` / Windows Authenticode `Valid` + 已安装可执行文件指纹绑定）；`omnimux-tiktok-selection` 与 `omnimux-inspiration` 前端 `<a href>` 校验协议白名单。

## 旧标准变更

由于 `omnimux` 音频下载（`stt-audio.js`）收紧为拒绝环回/私网/局域网 HTTP 目标、`omnimux-video` 为 `ffmpeg` 每个 `-i` 输入强制注入 `-protocol_whitelist file,pipe` 以阻断 SSRF，以及 `app/dsh-plugin-desktop` 更新下载收紧为强制要求 64 位十六进制 SHA-256 摘要，以下原有测试用例的夹具与断言已按新安全契约同步更新：

- `plugins/plugins/omnimux-video/src/engine/ffmpeg.test.js` :: `spawnFfmpeg prepends -hide_banner -loglevel error -y`
  - 原断言：`seen.args` 严格等于 `['-hide_banner', '-loglevel', 'error', '-y', '-i', 'x.mp4', 'out.mp4']`。
  - 必须改的理由：Issue #367 要求 `spawnFfmpeg` 在每个 `-i` 输入前强制注入 `-protocol_whitelist file,pipe`，避免 FFmpeg 触发网络/嵌套协议 SSRF。
  - 新期望证据：同步更新断言为包含 `-protocol_whitelist file,pipe`，并在 `job-security.test.js` 增加多 `-i` 与 `spawnFfprobe` 协议白名单回归测试。

- `plugins/plugins/omnimux/src/media/stt-fallback.test.js` :: `STT adapts local HTTP audio to Whisper before submission`
  - 原断言：允许通过 HTTP GET 下载 `http://127.0.0.1` / `http://localhost` / `http://[::1]` / `http://192.168.1.10` 音频地址并上传 Whisper。
  - 必须改的理由：Issue #367 禁止 `loadAudioBytes` 访问环回/私网/元数据 HTTP 地址以消除 SSRF 漏洞（本地音频走本地文件路径或 `data:` URI）。
  - 新期望证据：该具名用例更新为 `STT rejects loopback and private HTTP audio URLs before fetching`，断言在发起任何 HTTP 请求前以 `omnimux-invalid-request` 拒绝且 `calls` 为空；`wire primitive retries an unrecognized URL-first model and reuses loaded bytes` 夹具改用公网 `audioUrl` 保持全部字节复用断言不变，并新增 `stt-audio-security.test.js` 覆盖 DNS/重定向/凭据边界。
- `app/dsh-plugin-desktop/tests/update-download.spec.ts` :: `*`
  - 原断言：允许省略 `expectedSha256` 跳过摘要校验。
  - 必须改的理由：Issue #367 将 `expectedSha256` 收紧为强制门禁，缺失或格式错误必须 fail-closed 拒绝下载。
  - 新期望证据：各下载夹具补充匹配字节的 `expectedSha256`，并新增 `updater-security.spec.ts` 断言缺失摘要时零网络请求拒绝。
- `app/dsh-plugin-desktop/tests/updates.spec.ts` :: `*`
  - 原断言：版本响应不含 `sha256` 时仍调用 `downloadAndOpen` 且省略第 4 参数。
  - 必须改的理由：Issue #367 要求更新生命周期仅在确认到已发布 SHA-256 摘要时才触发下载。
  - 新期望证据：模拟版本响应补齐有效 `sha256`，原无摘要用例更新为断言拒绝启动下载（`downloadAndOpen` 不被调用）。
- `app/dsh-plugin-desktop/tests/electron-runtime.spec.ts` :: `*`
  - 原断言：`downloadAndOpen` 未传 `installerSha256` 也可调用。
  - 必须改的理由：Issue #367 要求 Electron 运行时在弹出保存框与下载前强制校验平台 `installerSha256` 并在打开/启动前二次校验摘要与原生签名。
  - 新期望证据：各 `downloadAndOpen` 夹具补充平台有效 `installerSha256` 并在 `updater-security.spec.ts` 独立验证摘要与签名门禁。
