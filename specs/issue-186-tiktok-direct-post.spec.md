# 规格：TikTok Direct Post 表单与 Host 提交合规整改（Issue #186）

## 背景与目标

为满足 TikTok Content Sharing Guidelines（`video.publish` Direct Post 二次审核）并补齐只读审计识别的 5 处代码级隐患与 2 项二阶护栏，本规格收敛 `plugins/plugins/omnimux-publish/**` 的全链路整改：

1. **§2.b 隐私级别无默认值（AC-01 / AC-02）**：`DEFAULT_TIKTOK_OPTIONS.privacy_level = ''`，`normalizeTikTokOptions` 不再回落 `'SELF_ONLY'`；移除 Composer 自动回填 `allowed[0]` 的副作用；切账号或交集变化使已选值失效时清空为 `''` 并行内提示重选。
2. **§2.c 互动默认全关、账号禁用态与图文裁剪（AC-03 / AC-04 / AC-05）**：`allow_comment` / `allow_duet` / `allow_stitch` 默认全 `false`；`creator_info` 返回 `*_disabled: true` 时前端禁选灰显且提交强制 `false`；图文（`type === 'image'`）DOM 彻底不渲染 Duet/Stitch 且 `buildCreateTikTokOptions` 省略两字段。
3. **§3 商业内容披露独立多选与 `SELF_ONLY` 双向冲突闭环（AC-06 / AC-07 / AC-08）**：修复 `Your Brand` 与 `Branded Content` 互斥单选 Bug，改为独立复选框支持单选、双选与全不选（总开关关闭时清空两子项）；展示官方 `Promotional content` / `Paid partnership` 标注提示；开开关未选子项时禁用发布按钮并在可聚焦/悬停包裹容器上展示原因提示；正向（勾 `Branded Content` 时下拉禁用 `SELF_ONLY`）与逆向（先选 `SELF_ONLY` 再勾 `Branded Content` 立刻清空隐私并内联提醒）；**拍板口径 #2 方案 A**：当聚合后可用隐私仅含 `['SELF_ONLY']`（Sandbox 场景）时前置禁用 `Branded Content` 并给出说明，同时保留后端兜底拦截。
4. **§4 动态合规声明与外链（AC-09 · 拍板口径 #1 方案 A）**：所有 Direct Post 在发布按钮上方常驻官方外链声明（未勾 `Branded Content` 展示 `Music Usage Confirmation`，勾选 `Branded Content` 或双选动态切换为 `Branded Content Policy` + `Music Usage Confirmation`）；点击「发布」即视作同意并由前端写入 `music_usage_confirmed: true` 提交；Host 端 `validate.js` / `submit.js` 强校验 `music_usage_confirmed === true`，封死 Agent/API 绕过。
5. **§1 创作者信息、限流阻断与纯 JS 视频时长双层拦截（AC-10 / AC-11）**：新增纯 JS `src/media-duration.js`（解析 MP4/MOV `mvhd` 与 WebM/MKV EBML，零 `ffprobe` 强依赖），`media.js` 入库探测并持久化 `duration_sec`、历史视频懒补探；Composer 展示 `creator_nickname` 与 `max_video_post_duration_sec`，`can_post === false` 或上游限流/错误时 fail-closed 展示红色阻断 Banner 与重试按钮；Host `prepareNow()` 对所有 `direct` 账号校验 `creator_info`、可用隐私交集与视频时长，超限报 `video-duration-exceeded`，不可发布报 `creator-cannot-post`。
6. **§5.d 发布后处理可见性提示与历史兼容（AC-12）**：提交前操作栏与 `RecordDetail.jsx` 明确提示发布后需数分钟处理方可于 TikTok 主页可见，且与 `inboxNotice` 隔离；`detail-notice.js` 同步兼容 `privacy === '' || privacy === 'SELF_ONLY'` 保护历史旧直发记录。
7. **`is_aigc` 双支持（拍板口径 #3）**：Direct Post 下视频与图文均暴露默认关闭的 `is_aigc` 开关，`submit.js` 视频与图文直发均透传 `is_aigc`。
8. **多账号聚合与 `draft_only` 零回归（AC-13 / AC-14）**：多 `direct` 账号隐私取交集、时长取最小、互动禁用取并集；`direct + draft_only` 混选仅对 `direct` 账号拉取 `creator-info` 并按账号能力分流；纯 `draft_only` 严格 0 次 `creator-info` 请求且零 `tiktok_options`。
9. **二阶护栏与结构化错误闭环**：
   - `creator_info` 60s 短 TTL 内存缓存（合并并发 in-flight 请求；仅缓存健康成功响应，`success:false` / 非 `ok` 的 `code` / `upstream_code` / `degraded:true` / `can_post:false` / 空或非法 `privacy_level_options` 一律不缓存，支持 `force=1` / `force: true` 破缓存），供 UI 与 `prepareNow()` 共享以保护 6 次/分钟限频；
   - `SOCIAL_TIKTOK_*` 结构化错误分类严格按 `upstream_code` → `SOCIAL_TIKTOK_*` → 文本兜底，映射 HTTP 429/409/502，并保留 `upstream_code` / `upstream_log_id` 到 Host 任务错误、HTTP 错误体与 UI 阻断 Banner，避免被误判为 `quota-exceeded` / `needs-omnimux`；
   - `privacyChoices(null|undefined)` 仅供 `legacy_unknown` 兼容态回退官方四级；显式空数组或未知值一律返回 `[]` 并 fail-closed；
   - 更新 `src/index.js` 中 `PUBLISH_PROMPT` 与工具参数描述，以及 `validate.js` 错误提示，使 Agent 能自助补齐合规参数。

10. **窄屏布局与可访问性（AC-15）**：`max-width: 960px` 时 Composer 改为文档流堆叠（账号栏 → 表单 → 预览 → 操作栏），编辑区/预览区不再互相覆盖；muted 文案改用 `--dsw-alias-label-secondary`，合规外链使用 `--dsw-alias-label-primary` 文本 + `--dsw-alias-link` 下划线，状态徽标文字使用 `--dsw-alias-label-primary`；390px 实测 `scrollWidth == clientWidth`、0 横向溢出，亮/暗主题独立评审实测对比度合规声明 `19.8 / 18.97`、发布后处理提示 `4.74 / 7.66`（均达 WCAG AA ≥ 4.5:1），0 `backdrop-filter`。

## 假设

1. 网关 `omnimux-gateway` 已支持 `tiktok_options`（`privacy_level` / `allow_comment` / `allow_duet` / `allow_stitch` / `commercial_content` / `your_brand` / `branded_content` / `music_usage_confirmed`）、`is_aigc`（视频与图文双支持）及 `omnimux_accounts_creator_info` 查询，无需本 PR 修改网关代码。
2. 本地视频文件以 MP4/MOV/M4V（ISO BMFF `moov/mvhd`）与 WebM/MKV（EBML `Segment/Info`）为主；纯 JS 二进制头解析可在不依赖本机 `ffprobe` 的前提下覆盖主流视频时长探测，损坏或未知封装安全返回 `null` 不崩溃。
3. 既有 `legacy_unknown`（缺少 `capabilities` 的历史网关响应）在不传 `tiktok_options` 时保持旧兼容路径不变；当显式进入 `direct` 模式或携带 `tiktok_options` 时，统一执行全量合规校验。

## 证伪方式

1. **无默认隐私证伪**：临时恢复 `DEFAULT_TIKTOK_OPTIONS.privacy_level = 'SELF_ONLY'` 或自动回填 `allowed[0]`，验证新增单测与 Composer 测试必红，还原后全绿。
2. **超长视频双层拦截证伪**：临时移除 `validateForSubmit` 中 `video-duration-exceeded` 判定或 `media-duration.js` 解析逻辑，验证超长合成 MP4/WebM 单测与 `submit.test.js` 必红，还原后全绿。
3. **`SELF_ONLY` × `Branded Content` 双向联动证伪**：临时移除逆向清空逻辑或 `tiktokOptionProblems` 的 `branded-requires-public` 检查，验证单测与 UI 测试必红，还原后全绿。
4. **`prepareNow()` 防 Agent 绕过证伪**：临时在 `validate.js` 恢复 `isObject(draft.settings.tiktok_options)` 前置条件，验证对 `direct` 账号提交空 `settings` 的测试必红，还原后全绿。
5. **`creator_info` 60s 缓存与 `force` 破缓存证伪**：临时跳过缓存命中判断或忽略 `force: true`，验证缓存复用次数与强制刷新次数断言必红，还原后全绿。
6. **Worktree 真实浏览器视觉与交互验收（AC-15）**：在隔离 worktree 编译真实 `omnimux-publish` client bundle 并在无头 Chromium 挂载验证 Light/Dark × 1280/768/390px 全部关键状态，确认 0 console/pageerror、0 水平溢出、对比度合规并留存截图。

## 旧标准变更

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `drops unknown privacy levels back to SELF_ONLY`
  - 原断言：断言未知或空 `privacy_level` 由 `normalizeTikTokOptions()` 回落为 `'SELF_ONLY'`。
  - 变更理由：TikTok Content Sharing Guidelines §2.b 严禁预设隐私默认值，空值与非法值必须归一为空字符串 `''` 强制创作者手动选择。
  - 新期望证据：断言未知或空 `privacy_level` 归一为 `''`，且 `DEFAULT_TIKTOK_OPTIONS.privacy_level === ''`。

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `accepts the default combination`
  - 原断言：断言 `tiktokOptionProblems(normalizeTikTokOptions(undefined))` 返回空数组 `[]`。
  - 变更理由：依据 §2.b（隐私必选无默认）与 §4（所有 Direct Post 必须确认音乐条款），未填写的默认选项不可直接提交。
  - 新期望证据：断言默认空选项返回 `['privacy-level-required', 'music-confirmation-required']`，显式提供合法 `privacy_level` 与 `music_usage_confirmed: true` 时返回 `[]`。

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `requires a commercial kind and music confirmation`
  - 原断言：断言 `{ commercial_content: true }` 仅返回 `['commercial-brand-required', 'music-confirmation-required']`（依赖旧版自动回填 `SELF_ONLY`）。
  - 变更理由：移除 `privacy_level` 自动回填后，未传 `privacy_level` 同样必须报 `privacy-level-required`。
  - 新期望证据：断言 `{ commercial_content: true }` 返回 `['privacy-level-required', 'commercial-brand-required', 'music-confirmation-required']`。

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `refuses branded content with SELF_ONLY`
  - 原断言：调用 `normalizeTikTokOptions({ commercial_content: true, branded_content: true, music_usage_confirmed: true })` 依赖默认填充 `SELF_ONLY` 触发 `['branded-requires-public']`。
  - 变更理由：默认不再填充 `SELF_ONLY`，测试该冲突组合需显式传入 `privacy_level: 'SELF_ONLY'`。
  - 新期望证据：显式传入 `privacy_level: 'SELF_ONLY'` 时返回 `['branded-requires-public']`，未传 `privacy_level` 时返回 `['privacy-level-required']`。

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `includes commercial disclosure and music confirmation only when chosen`
  - 原断言：断言普通直发默认省略 `music_usage_confirmed` 且互动项（`allow_comment` / `allow_duet` / `allow_stitch`）默认为 `true`、隐私默认为 `SELF_ONLY`。
  - 变更理由：依据 §2.b（无默认隐私）、§2.c（互动默认全 `false` 且图文省略 Duet/Stitch）及 §4（所有 Direct Post 均携带 `music_usage_confirmed`），商业披露项仅在开启 `commercial_content` 时输出，`music_usage_confirmed` 则在所有直发勾选确认时输出。
  - 新期望证据：非商业直发输出显式 `privacy_level`、`allow_comment/allow_duet/allow_stitch` 默认 `false` 与 `music_usage_confirmed: true`（不含 `commercial_content`/`your_brand`/`branded_content`）；商业直发完整包含 `commercial_content`、独立多选的 `your_brand`/`branded_content` 与 `music_usage_confirmed: true`。

- `plugins/plugins/omnimux-publish/src/shared/tiktok-options.test.js` :: `falls back to all levels when creator-info is missing or empty`
  - 原断言：`privacyChoices(null)` 与 `privacyChoices({ privacy_level_options: [] })`、`privacyChoices({ privacy_level_options: ['UNKNOWN'] })` 均返回官方四级。
  - 变更理由：Direct Post 必须严格消费上游 `privacy_level_options`；显式空数组或未知值必须 fail-closed，不能伪造官方可选项。仅 `null`/`undefined` 的 `legacy_unknown` 兼容路径允许回退。
  - 新期望证据：`privacyChoices(null|undefined)` 返回官方四级，显式 `[]`、`['UNKNOWN']`、`{}` 返回 `[]`；新增 `aggregateCreatorInfo` 单账号空选项 `privacy-options-empty` 阻断断言。

- `plugins/plugins/omnimux-publish/src/submit.test.js` :: `passes settings.tiktok_options into the create tool`
  - 原断言：对 `type: 'image'` 草稿仅传 `{ privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: false }`（未传 `music_usage_confirmed`），并断言 `create.arguments.tiktok_options.allow_duet === true`。
  - 变更理由：按 §2.c 互动项默认必须全为 `false` 且图文直发不输出 `allow_duet`/`allow_stitch`，按 §4 所有直发必须携带 `music_usage_confirmed: true`。
  - 新期望证据：补齐 `music_usage_confirmed: true` 后，图文直发断言 `privacy_level === 'PUBLIC_TO_EVERYONE'`、`allow_comment === false`、省略 `allow_duet`/`allow_stitch`；并新增视频直发用例断言未勾选的 `allow_duet`/`allow_stitch` 默认 `false`。

## 验证记录（2026-11-25 本机与真实浏览器）

- `corepack pnpm --dir plugins --filter omnimux-publish test`：399 pass / 0 fail（含新增 `creator-info-cache`、`tiktok-options`、`hubtools`、`http-routes`、`validate`、`submit`、`composer-direct-post` 回归）。
- `node plugins/scripts/verify-dsw-tokens.mjs`：18 个插件/包、450 上游 Token、651 存量未定义引用、`dsh-ui-kit 0`。
- `corepack pnpm --dir plugins run test:gates`：通过（末尾 768 + 27 项门禁测试 0 fail，DSH 宿主兼容声明通过）。
- `corepack pnpm --dir plugins run build:all`：13/13 成功；`bundle.lock.json` 仅 `omnimux-publish` 单槽 `contentHash` 变化。
- `workspace:check` / `bundle:lock:check` / `plugins:verify` / `git diff --check` / `gitleaks`：本机通过。
- 真实浏览器（工作树最终源码经 esbuild 打包后挂真实 Chromium；仓外证据不提交）：覆盖视频/图文/沙箱/超时长/限流重试/空隐私/纯草稿草稿箱/多账号/RecordDetail 两态，1280 / 768 / 390px × Light / Dark；0 pageerror、0 console.error、0 横向溢出、0 `backdrop-filter`，独立评审实测合规声明对比度 `19.8`（亮）/ `18.97`（暗）、发布后处理提示 `4.74`（亮）/ `7.66`（暗）；19 张截图保存在仓外本地证据目录。
- 真实 TikTok 线上网关调用：未执行（离线 mock）。真实发布、OAuth、账号数据与线上限流状态需人工/发布环境确认。
