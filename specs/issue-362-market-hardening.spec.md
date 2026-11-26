# Issue #362 — `omnimux-market` Request-Guard, Config-Bounds, Body-Cap, and Unzip Hardening

## 背景与目标

修复主安全单 #368 下子单 #362 涉及的 4 类高危问题：
1. `restart.ts`：`trustedRestartRequest` 停止信任可伪造的 `x-forwarded-host`，拒绝 `sec-fetch-site: same-site`（仅允许 `same-origin`、`none` 或缺失），校验精确归一化 `Origin` 与 `Host` 的有效端口匹配。
2. `config-store.ts` 与 `local-api.ts`：`apiBase` / `webBase` 仅允许合法公网 HTTPS 地址（复用 `assertSafeIconUrlSyntax` 拒绝 `http:`、私网/环回/元数据 IP、嵌入式凭据及非 443 端口）；`skillsDir` 严格限定在受管 `dshHome()` 目录内且禁止符号链接与路径穿越；`handleConfigRoute` 保存非法配置返回 HTTP 400。
3. `local-api.ts`：`readBody` 增加 1 MiB 字节上限并在超限时返回 HTTP 413。
4. `unzip.ts`：`unzipToFiles` 在中央目录与本地头双路径实施条目数（1000）、单文件（10 MiB）、总解压字节（50 MiB）、目录深度（16）、压缩比（100x）、zlib `maxOutputLength` 及路径穿越/绝对路径/重复条目校验。

## 旧标准变更

- `plugins/plugins/omnimux-market/src/tests/restart.test.ts` :: `trustedRestartRequest accepts same-origin UI clicks, including reverse proxies`
  - 原断言：允许伪造 `x-forwarded-host` 跨 `Host` 通过同源校验。
  - 必须改的理由：Issue #362 禁止信任客户端可伪造的 `x-forwarded-host`，改为仅比较规范 `Origin` 与真实 `Host` 及其有效端口。
  - 新期望证据：伪造 `x-forwarded-host` 跨 `Host` 两条断言改为返回 `false`，并新增 `market-hardening.test.ts` 验证 `same-site`、端口不匹配及非法 `Origin` 均被拒绝。
- `plugins/plugins/omnimux-market/src/tests/config-store.test.ts` :: `sanitizePatch ignores leftover cosBase and invalid urls`
  - 原断言：期望未展开的相对波浪号字符串 `'~/.dsh/skills'` 原样透传。
  - 必须改的理由：Issue #362 收紧 `skillsDir` 为受管 `DSH_HOME` 内规范非符号链接目录，`sanitizeSafeSkillsDir` 展开 `~` 并校验边界后返回规范绝对路径。
  - 新期望证据：断言 `patch.skillsDir` 为 `join(homedir(), '.dsh', 'skills')`，并在 `market-hardening.test.ts` 验证越界目录、符号链接、空字节与非法 `apiBase`/`webBase` 均被拒绝。
