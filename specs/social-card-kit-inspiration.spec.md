# feat(dsh-ui-kit, omnimux, omnimux-inspiration): 共享 6 原型社媒卡片体系、自然列流瀑布流与原生右键菜单

## 问题与目标

当前 `omnimux-inspiration` 的灵感库画廊与爆款趋势全部使用 9:16 纯封面卡片叠加绝对定位悬停遮罩，且依赖基于像素高度估算的绝对定位瀑布流（`RivalMasonry`），存在以下体验与工程问题：

1. X 长文章与普通帖子未做区分，长文章标题、摘要与普通推文混排且封面缺失时退化为大段纯文本或空白，且 X 头像字段未提取 `profile_image_url_https`。
2. 通用公开网页链接（技术博客、开源仓库等）缺少安全的 OG 标题/描述/封面/站点图标兜底，无法形成可读网页链接卡片。
3. TikTok 竖屏视频、Instagram 图文与 YouTube 横屏视频采用同一套默认隐藏正文的纯封面模板，信息密度与内容辨识度偏低；合集详情内嵌成员卡强制裁切为 4:5，丢失长文章与推文的语义结构。
4. 卡片 `⋯` 菜单项偏少且缺少右键原地唤起能力，收藏、分享、打开侧边栏、全屏预览、AI 拆解、一键加入指定合集、打开/复制原链与删除等高频动作链路割裂。
5. 卡片展示层耦合在 `omnimux-inspiration` 内部，后续聊天会话栏社媒搜索结果无法直接复用同一套 6 原型卡片。

本次任务（PR 1）将 6 原型纯展示层下沉至共享组件库 `dsh-ui-kit/social-card`，补齐后端 X 长文章/头像/通用网页 OG 提取，并完成 `omnimux-inspiration` 画廊（灵感库、爆款趋势、合集详情）的自然列流瀑布流与宿主原生 `Menu` 右键菜单集成。账号监控 `RivalTimeline` 与已有 `RivalMasonry` 测试套件保持不变；聊天会话流 `tool.call.toolview` 接入在 PR 1 合并后于 PR 2 紧跟落地。

## 假设

1. 将纯展示层（`SocialPostCard`、`MasonryGrid`、`resolveSocialCardArchetype`、`resolveOutlierBadges`、`SocialPlatformMark`）置于 `plugins/packages/dsh-ui-kit` 的独立按需子路径 `dsh-ui-kit/social-card`，既能让未引入该子路径的插件保持零打包体积增长，又能共享 `dsh-ui-kit` 严格的亮/暗双主题语义 Token 与无裸色门禁校验，同时把业务逻辑（选择、合集拖拽、右键菜单状态、复刻、删除确认）完全留在 `omnimux-inspiration` 内。
2. 后端按协议真源补齐元数据后可准确分流 6 类原型：在 `omnimux` `public-tweet.js` 解析 X `article`/`article_results` 与 `note_tweet`（即使推文 `text` 为空也不丢弃长文章），在 `omnimux-inspiration` `http-handlers.js` 提取 `profile_image_url_https` 与持久化 `content_shape: 'article'` + `excerpt`，并在 `scraper-fallback.js` 为公开外链提供受 SSRF 与超时/字节上限约束的 `fetchWebOgMetadata`，无需任何客户端正文正则猜测即可完成原型路由。
3. 以 CSS Flex 列容器 + `Map<cardKey, colIndex>` 稳定列缓存构建 `MasonryGrid`，在保持每张卡片处于正常文档流（彻底消除绝对定位卡片重叠与裁切）的同时，通过保留 `[data-inspiration-id]` 与 `[data-collection-id]`，使既有的 `useCollectionDrag` 左键拖拽创建/加入合集交互完全兼容。
4. 卡片右键菜单与右上 `⋯` 按钮共用同一菜单项工厂 `buildCardMenuEntries()` 并统一挂接 `@deepseek-ai/dsh-client-ui-primitives` 原生 `Menu`（`contextual` + `portal` + `anchorPoint` + 原生 `submenu`），在遵守实底浮层契约（无 `backdrop-filter`、无透明底）和按钮命名避开 `add` 子串的前提下，能根据卡片归属（本地 vs 云端）与外链状态动态显隐 10 项分组操作。

## 证伪方式

1. **双向证伪单元与后端回归测试**：
   - `plugins/packages/dsh-ui-kit` 执行 `corepack pnpm --dir plugins --filter dsh-ui-kit run check`：校验 TypeScript 严格模式、`tsdown` 子路径打包产物 `lib/social-card.js` 与 `lib/social-card.d.ts`、Token 契约（零未定义 `--dsw-*`）及无裸色/无虚构离群徽标单元测试全绿。
   - `plugins/plugins/omnimux` 与 `plugins/plugins/omnimux-inspiration` 新增真实 Syndication X 长文章/`note_tweet`/`profile_image_url_https`、安全 OG 解析与私网 SSRF 拦截、6 原型分类、瀑布流列稳态与右键菜单动作单元测试；将核心解析代码回退至修改前时，新增断言必须真实失败。
2. **全仓门禁验证**：
   - 运行 `corepack pnpm --dir plugins run build:all`、`corepack pnpm --filter omnimux test`、`corepack pnpm --filter omnimux-inspiration test`、`verify:dsw-tokens`、`guard:popover`、`verify:silent-catch`、`verify:stages`、`verify:licenses`、`check:boundaries`、`test:ui`、`verify-anti-slop.test.mjs` 与 `node scripts/workspace-check.mjs --check`，任一报错或新增基线外 `--dsw-*` Token 即证伪失败。
3. **真实 Chromium 双主题、窄屏与交互几何核验**：
   - 在真实 Chromium 中同时验证高保真 HTML 演示与 Worktree 构建运行态，覆盖亮/暗双主题、宽/中/窄视口（1440px / 1024px / 640px）、6 类卡片布局、打开态右键菜单与「加入合集」子菜单、导入 X 长文章/普通帖/TikTok/YouTube/网页链接、拖拽进合集与 E2E 强断言探针（`inspiration-6-archetypes.e2e.test.js`）。出现任意卡片重叠、横向滚动条、内容裁切遮挡、浮层透明或菜单超视口边界，即证伪失败。

## 需求契约与边界

### 1. 6 类内容原型映射

| 原型标识 | 适用来源与判定条件 | 卡片默认结构（无全卡暗遮罩） |
| --- | --- | --- |
| `article` | `content_shape === 'article'`、X 长文章或 Substack 文章 | 顶置 16:9 封面 → 3 行粗体标题 → 2 行摘要 → 底置作者行 → 数据栏与 16px 平台标 |
| `social-post` | X 普通帖、Threads、LinkedIn | 顶置作者行 → 正文（5/10 行）→ 可选 8px 内嵌圆角媒体框 → 数据栏与 16px 平台标 |
| `short-video` | TikTok、抖音、YouTube Shorts（`/shorts/` 或竖屏比 < 0.85）、Instagram 竖屏单视频 | 全出血竖屏封面（左上时长、右侧竖排白字数据、底部渐变 `@handle` + 2 行文案）→ 独立实底作者底栏 + 24px 圆形平台标 |
| `photo-feed` | Instagram 与小红书单图/轮播/4:5 图文 | 顶置作者行 → 贴边媒体（4:5 至 1.91:1，多图 `1/N`）→ 数据行 → 行内粗体 `handle` + 3 行文案 + 16px 平台标 |
| `landscape-video` | YouTube 横屏视频、带元数据的 B站视频 | 16:9 封面（右下时长）→ 双栏底栏（左头像；右 2 行标题 → 频道名 → 间距分隔的时间与播放量）+ 16px 平台标 |
| `web-link` / `raw-media` | 其余外链网页 / 无外链本地纯媒体 | `web-link` 顶置 16:9 OG 封面（缺图显示中性站点标识）→ 2 行标题 → 14px favicon + 域名；`raw-media` 干净圆角媒体（视频带播放标） |

- 仅当后端提供真实倍增率或百分位数据时展示离群徽标；无数据时不渲染徽标。
- 所有新增文案与界面排版禁止出现中点分隔符，状态直接体现在控件上时不弹冗余 Toast。

### 2. 右键菜单与 `⋯` 菜单 10 项清单（动态显隐）

1. 组 1：`收藏 / 取消收藏`（仅本地）、`分享公共链接`
2. 组 2：`全屏打开`、`在侧边栏打开`、`添加到会话`、`立即复刻`、`AI 拆解`、`打开原始链接`（有外链）、`复制链接地址`（有外链）
3. 组 3：`加入合集`（仅本地，原生 `submenu` 列出全部合集 + `新建合集...`）、`移出合集`（仅合集详情）
4. 组 4：`删除`（仅本地，`danger: true`，触发确认弹窗）

## 旧标准变更

因灵感库画廊卡片由旧绝对定位纯封面 `InspirationCoverCard` + `RivalMasonry` 迁移为共享 6 原型 `SocialPostCard` + 自然列流 `MasonryGrid`（卡片外层类名 `.omx-card-*`，语义原型属性 `data-archetype`，正文槽位 `[class*="SocialPostCard-socialBodyText"]` / `[class*="SocialPostCard-shortVideoCaption"]`），以下既有测试用例需同步更新 DOM 选择器与结构断言以反映新组件契约（业务流、轮询、筛选与去重规则保持等价）：

- `plugins/plugins/omnimux-inspiration/src/client/import-landing-render.test.js` :: `settles a pinned import absent from an empty feed into a selectable four-image card without opening detail`
  - 原断言：`data-card-type="text-media"`、`.omnimux-rival-card-title`、`.omnimux-inspiration-cover-img`、`.omnimux-inspiration-card-check`
  - 变更理由：旧 4 宫格/多图普通帖子在 6 原型下统一映射为 `data-archetype="social-post"`（卡片主体正文渲染于 `SocialPostCard-socialBodyText`、缩略图渲染于 `.omx-card-cover-media`、复选控件为 `.omx-card-check`），同时继续断言角标不叠加、轮询不误开详情、本地来源可选中。
- `plugins/plugins/omnimux-inspiration/src/client/import-landing-render.test.js` :: `refreshes the unfiltered library so a completed import survives its bounded pin expiry`
  - 原断言：`.omnimux-rival-card-title` 与 `.omnimux-inspiration-card-check`
  - 变更理由：同上，替换为 `SocialPostCard-socialBodyText` 与 `.omx-card-check`，保留 pin 过期后由后端列表接管并可多选的完整行为验证。
- `plugins/plugins/omnimux-inspiration/src/client/import-landing-render.test.js` :: `continues polling a filtered-out pin through pending updates without inserting it into the filtered list`
  - 原断言：`.omnimux-rival-card-title` 与 `.omnimux-inspiration-card-failure`
  - 变更理由：正文与失败态图标随新卡片迁至 `SocialPostCard-socialBodyText` 与 `.omx-card-failure`（保留 `title` 携带失败原因与不侵入不匹配筛选列表的核心断言）。
- `plugins/plugins/omnimux-inspiration/src/client/import-landing-render.test.js` :: `keeps a detail update on the pinned card even when the current list has no matching row`
  - 原断言：`.omnimux-rival-card-title`
  - 变更理由：TikTok 视频详情回写标题对应 `short-video` 原型底部的 `SocialPostCard-shortVideoCaption`，继续验证详情同步回 pin 且关闭详情不回退旧状态。
- `plugins/plugins/omnimux-inspiration/src/client/styles.test.js` :: `delegates card sizing to the shared masonry and keeps loading placeholders below it`
  - 原断言：`assert.match(sectionSrc, /<RivalMasonry/)`
  - 变更理由：主画廊（`InspirationSection.jsx`）已从旧绝对定位 `<RivalMasonry>` 升级为自然列流 `<MasonryGrid>`（保留独立测试 `<RivalMasonry>` 的既有行为测试不变），故断言更新为 `assert.match(sectionSrc, /<MasonryGrid/)`。
