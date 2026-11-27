# feat(dsh-ui-kit, omnimux, omnimux-inspiration): 对话流社媒搜索结果 6 原型卡片视图（`tool.call.toolview`）

## 目标与范围

PR 1 已将 6 原型纯展示卡片（`SocialPostCard`、`MasonryGrid`、`SocialPlatformMark`、`resolveSocialCardArchetype`、`resolveOutlierBadges`、`estimateArchetypeWeight`）沉淀到共享 UI 包 `dsh-ui-kit/social-card`，并完成了灵感社区画廊改造。

本次 PR 2 在**不重复实现卡片 UI**、且**不破坏插件隔离边界**的前提下，将该卡片能力复用到对话流（`tool.call.toolview` keyed slot）中：

1. **共享 UI 包扩展（`plugins/packages/dsh-ui-kit/src/social-card/`）**：
   - 新增纯解析器 `toolview-parser.ts`（零 DOM、零网络依赖），将真实工具调用块（TikHub 社媒搜索/作品/单帖、X Syndication、YouTube renderer/平铺响应、`omnimux_social_data`、本地/云端灵感与对标帖子）映射为统一视图模型，完整区分 `running` / `ready` / `empty` / `error` / `passthrough` 五态。
   - 新增聊天结果视图组件 `SocialSearchToolView.tsx` + `SocialSearchToolView.module.css`：紧凑状态行（平台标/搜索标、动作标题、关键词/对象摘要、结果计数徽标 `×N`、折叠/展开、原始 JSON 查看与轨迹检查按钮）+ 2 列自适应自然瀑布流（窄屏或单条详情自动降为 1 列），直接渲染 `density="compact"` 的 6 原型 `SocialPostCard`，支持渐进展开（默认展示 6 条，超出后可切换展开全部）与卡片悬停快捷操作（安全打开原帖 + 按能力开启「存为灵感」）。
   - 微调 `[data-density="compact"]` 下的紧凑边距与媒体高度上限，不影响默认画廊密度。
2. **中枢插件接入（`plugins/plugins/omnimux/`）**：
   - 注册 15 个社媒/云端灵感相关 `tool.call.toolview` key，覆盖关键词搜索、账号内容流、单帖详情与云端灵感列表/详情；对非帖子能力（如 `user`、`shop_*`、`creator_*` 等）自动退回可展开的原始 JSON `passthrough` 视图。
   - 对非灵感库工具卡片提供同源「存为灵感」操作（调用 `/omnimux/inspiration/local/import-url`）。
3. **灵感插件接入（`plugins/plugins/omnimux-inspiration/`）**：
   - 注册 `inspiration_search`、`inspiration_get`、`inspiration_rival_posts`、`inspiration_rival_post` 共 4 个 `tool.call.toolview` key（与 `omnimux` 的 15 个 key 及已有 `display_file` / `read_image` / `skillhub_*` / `plaza_search` 零冲突）。
   - 为 `inspiration_search` 与 `inspiration_rival_posts` 返回值做**向后兼容的增量字段补齐**（保留全部既有字段），让聊天卡片能真实渲染封面、作者头像、正文摘要与发布时间，而不必二次请求。

### `tool.call.toolview` Key 归属矩阵

| 归属插件 | 注册 Key |
|---|---|
| `omnimux`（15 个） | `omnimux_x_search`, `omnimux_x_posts`, `omnimux_x_tweet`, `omnimux_tiktok_search`, `omnimux_tiktok_posts`, `omnimux_tiktok_video`, `omnimux_instagram_search`, `omnimux_instagram_posts`, `omnimux_instagram_post`, `omnimux_youtube_search`, `omnimux_youtube_posts`, `omnimux_youtube_video`, `omnimux_social_data`, `omnimux_inspiration_list`, `omnimux_inspiration_get` |
| `omnimux-inspiration`（4 个） | `inspiration_search`, `inspiration_get`, `inspiration_rival_posts`, `inspiration_rival_post` |

## 假设

1. 宿主 `ui-tool` 按工具线名精准调度 `tool.call.toolview`（`preparing` / `start` / `result` 三态，其中运行态通过 `'kind' in block === false` 区分，结算态 `block.kind === 'tool-result'` 携带 `block.call.argsRaw` 与 `block.content`），插件通过 `ctx.slots.inject('tool.call.toolview', ...)` 惰性注册后即可在支持该槽位的新宿主生效并在老宿主安全 no-op，无需将 `@deepseek-ai/dsh-client-ui-tool` 写入 `dsh.client.inject` 导致老壳卡激活。
2. 社媒接口返回载荷在真实运行中存在多层异构信封（`{ platform, capability, data }`、`{ code, data }`、`aweme_list[].aweme_info`、`timeline[]`、`contents[].videoRenderer`、`items[]`、`edges[].node` 等），通过有限容器白名单解包与严格 URL 安全校验（拒绝 `javascript:` / `data:` / `file:`），可以在聊天界面稳定复原 6 原型而不引入跨插件内部依赖或盲目递归误抓无关数组。
3. 当 `omnimux_social_data` 执行非帖子能力（如 `user`、`shop_search`、`shop_product`、`shop_reviews`）或搜索返回账号/标签列表而无帖子实体时，退回折叠式 `passthrough` 原始输出比强行拼装空卡片或报错更符合信息保真原则。
4. 在 `inspiration_search` 与 `inspiration_rival_posts` 中仅增量附加卡片所需字段，不删除或改名任何既有返回键，现有工具契约与测试断言可保持兼容。

## 证伪方式

1. **后端/解析器双向证伪单测**：
   - 在 `dsh-ui-kit` 新增 `toolview-parser.test.js`，使用 X 长文章（Syndication `article_results`）、X 搜索与普通图帖、TikTok 视频/搜索/作品列表、Instagram 图集/仅账号搜索降级、YouTube `videoRenderer`/平铺响应/Shorts、云端与本地灵感、`omnimux_rival_posts`、运行态/错误态/空列表及恶意 `javascript:` 链接夹具执行严格断言；任意一条解析或安全过滤失效即判失败。
   - 在 `omnimux` 与 `omnimux-inspiration` 新增客户端组件与注册矩阵测试（查重 19 个 key 无碰撞、jsdom 渲染多态切换、`savePostToInspiration` 202/409/500 状态流转、增量工具字段返回测试）。
2. **宿主装载与全仓静态门禁**：
   - 运行 `corepack pnpm --dir plugins --filter dsh-ui-kit run check`、`corepack pnpm --dir plugins run build:all`、`env -u OMNIMUX_API_KEY -u OMNIMUX_TOKEN corepack pnpm --dir plugins --filter omnimux test`、`corepack pnpm --dir plugins --filter omnimux-inspiration test`。
   - 运行 `verify:plugin-load`（真实 Cordis 环境验证客户端 bundle 懒加载）、`verify:slots`、`verify:dsw-tokens`、`check:boundaries`、`check:package-files`、`verify:licenses`、`scan-ui-gates.mjs`（PR 触及包 0 命中）及 `node scripts/workspace-check.mjs --check`。
3. **真实 Chromium（`ego-browser`）HTML 演示与 Live Bundle 验收**：
   - 在实际产品改码前先交付高保真 HTML 演示并在真实 Chromium 验证亮/暗双主题、宽屏 2 列瀑布流、窄屏（360px）单列无横向溢出，以及 `running` / `empty` / `error` / `passthrough` 状态切换。
   - 在产品构建产物就绪后，用真实编译生成的 `plugins/plugins/omnimux/lib/client.js` 与 `plugins/plugins/omnimux-inspiration/lib/client.js` 在真实 Chromium 中通过 `window.__ModuleLoader__.load` 装载并执行 `apply(ctx)`，实测折叠/展开、原始 JSON 查看、展开更多、保存灵感交互、亮暗主题与窄屏布局，截图逐张人工审阅留证。
