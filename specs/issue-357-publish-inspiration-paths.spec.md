# Issue #357 — omnimux-publish 与 omnimux-inspiration 本地文件读取边界与扩展 CORS 加固

- `omnimux-publish`：HTTP 草稿创建/更新接口禁用直接本地路径引用（强制使用通过媒体接口上传的 `media_id`）；`MediaStore.importPath` 增加符号链接、敏感凭据/系统目录、活跃文档扩展名/内容及可选 `allowedRoots` 校验。
- `omnimux-inspiration` & `omnimux`：`POST /omnimux/inspiration/local` 剥离客户端提交的 `local_paths` 与服务端私有状态字段，严格校验自定义 `id` 仅允许 `[A-Za-z0-9_-]` 安全字符（拒绝路径穿越与非法字符）；封面生成、本地分享上传、视频分析和本地媒体流接口均增加 `lstat` 非符号链接与 `realpath` 归属 `mediaDir` 校验；收紧扩展 CORS/请求准入，移除对任意 `chrome-extension://*` / `moz-extension://*` 的匿名写放行，仅放行显式白名单扩展源或携带有效 `ext-bridge-token` 的请求。

## 旧标准变更

- `plugins/plugins/omnimux-inspiration/src/http-security-route.test.js` :: `allows an exact browser-extension origin`
  - 原断言：默认对任意 `chrome-extension://abcdefghijklmnop` 的 `OPTIONS` 预检返回 `Access-Control-Allow-Origin: chrome-extension://abcdefghijklmnop`。
  - 必须改的理由：Issue #357 移除对任意未授权浏览器扩展源的匿名 CORS/写放行，未列入白名单且未携带配对桥接令牌的扩展源必须默认拒绝。
  - 新期望证据：断言未白名单扩展源 `OPTIONS` 不返回 `Access-Control-Allow-Origin` 且 `POST` 返回 `403 not-local`，显式配置 `OMNIMUX_ALLOWED_EXTENSION_ORIGINS` 后返回精确扩展源。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `publishes through the hub capability and stores the link it returns`
  - 原断言：测试夹具通过 HTTP `POST /omnimux/inspiration/local` 直接注入位于 `mediaDir` 之外的 `local_paths.video`。
  - 必须改的理由：Issue #357 禁止客户端经 HTTP `POST /local` 注入 `local_paths`，且分享上传要求文件严格位于 `mediaDir` 内。
  - 新期望证据：测试夹具改由服务端存储 `createLocalStore().add` 写入受管目录 `videos/clip.mp4`，其余分享发布与状态断言全部保持不变，并新增专门安全回归用例验证越界路径和客户端注入均被拒。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `shows the stage the job is really in, not a timer`
  - 原断言：夹具通过 HTTP `POST /local` 注入 `world.root/staged.mp4`。
  - 必须改的理由：同上，受管媒体路径仅由服务端在 `mediaDir` 下写入。
  - 新期望证据：改由服务端存储写入 `videos/staged.mp4`，分阶段状态流转断言保持不变。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `reports a failed publish on the row and keeps no link`
  - 原断言：夹具通过 HTTP `POST /local` 注入 `world.root/nokey.mp4`。
  - 必须改的理由：同上。
  - 新期望证据：改由服务端存储写入 `videos/nokey.mp4`，失败态与空链接断言保持不变。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `refuses the four cases the user can fix before any job starts`
  - 原断言：夹具通过 HTTP `POST /local` 注入 `world.root/*.mp4`。
  - 必须改的理由：同上。
  - 新期望证据：改由服务端存储写入 `paths.videosDir` 下文件，四类可修复预检失败（缺失/超限/空标题/空提示词）断言保持不变。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `says so when the hub exposes no share capability, instead of faking a link`
  - 原断言：夹具通过 HTTP `POST /local` 注入 `world.root/nocap.mp4`。
  - 必须改的理由：同上。
  - 新期望证据：改由服务端存储写入 `videos/nocap.mp4`，中枢缺席返回 503 的断言保持不变。
- `plugins/plugins/omnimux-inspiration/src/http-entry.test.js` :: `answers OPTIONS preflight with 204 and full CORS headers so cross-origin pages can POST`
  - 原断言：无 `Origin` 的 `OPTIONS` 预检返回 `Access-Control-Allow-Origin: *` 和 `Access-Control-Allow-Headers: *`。
  - 必须改的理由：Issue #357 收紧 CORS 边界，禁止返回通配符 `Access-Control-Allow-Origin: *` 或 `Access-Control-Allow-Headers: *`。
  - 新期望证据：无 `Origin` 的 `OPTIONS` 返回 204 且不带通配符 CORS 头；同源 `Origin: http://127.0.0.1` 的 `OPTIONS` 返回精确 `Access-Control-Allow-Origin: http://127.0.0.1` 与允许方法。
- `plugins/plugins/omnimux-browser/extension/tests/save-inspiration-rpc.spec.ts` :: `inspiration server endpoints explicitly allow Private Network Access preflights`
  - 原断言：断言 `omnimux-inspiration/src/http-routes.js` 包含 `'Access-Control-Allow-Private-Network': 'true'`。
  - 必须改的理由：Issue #357 禁止向跨站/公网页面广播 `Access-Control-Allow-Private-Network: true` 以防浏览器 Private Network Access 保护被绕过；合法已配对扩展走精确扩展源白名单或桥接令牌鉴权。
  - 新期望证据：断言 `http-routes.js` 不再输出 `Access-Control-Allow-Private-Network` 头，扩展同源/令牌路径由 `path-and-cors-security.test.js` 完整覆盖。
