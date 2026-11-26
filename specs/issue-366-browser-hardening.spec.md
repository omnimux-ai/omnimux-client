# Issue #366 — omnimux-browser 安全加固

- 加固 `/ext/pair`、`/ext/pair/approve`、`/ext/pair/cancel` 宿主会话鉴权（`auth: 'required'`）、一次性 CSRF token 生命周期、内联脚本 JSON 转义、点击劫持响应头及 `/ext/pair/request`、`/ext/pair/status` 来源与方法边界。
- 收口首次安装 `unrestrictedBrowserAccess` 默认值为 `false`。
- 加固浮动模式 `postMessage` 来源/父帧校验，移除面板侧所有通配符 `'*'` 目标来源，将 `DomFillButton` 改走受控扩展后台通道，补齐网页文本提示词不可信边界。

## 旧标准变更

- `plugins/plugins/omnimux-browser/extension/tests/float-dock.spec.ts` :: `opens the native side panel and collapses the workstation with unload`
  - 原断言：校验 `dockFloatToNativeSidePanel` 以通配符 `'*'` 调用 `window.parent.postMessage`。
  - 必须改的理由：Issue #366 安全加固移除悬浮面板侧所有 `postMessage(..., '*')` 通配符目标，改为基于 `ancestorOrigins` / `document.referrer` 精确绑定父页面源。
  - 新期望证据：传入显式 `location.ancestorOrigins: ['https://example.com']` 断言精确 origin 投递，并在 `float-message-and-defaults.spec.ts` 覆盖缺省来源不触发 `postMessage`。
- `plugins/plugins/omnimux-browser/extension/tests/float-dock.spec.ts` :: `can collapse without unloading when unload is false`
  - 原断言：校验 `postMessage` 使用通配符 `'*'`。
  - 必须改的理由：同上，移除悬浮面板通配符目标来源。
  - 新期望证据：断言精确投递至 `'https://example.com'`。
- `plugins/plugins/omnimux-browser/extension/tests/float-dock.spec.ts` :: `still posts collapse when sidePanel.open is missing`
  - 原断言：校验 `postMessage` 使用通配符 `'*'`。
  - 必须改的理由：同上，移除悬浮面板通配符目标来源。
  - 新期望证据：断言精确投递至 `'https://example.com'`。
- `plugins/plugins/omnimux-browser/extension/tests/float-dock.spec.ts` :: `swallows open failures without throwing`
  - 原断言：校验 `postMessage` 使用通配符 `'*'`。
  - 必须改的理由：同上，移除悬浮面板通配符目标来源。
  - 新期望证据：断言精确投递至 `'https://example.com'`。
