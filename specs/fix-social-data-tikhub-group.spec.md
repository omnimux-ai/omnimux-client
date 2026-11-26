# 修复 OmniMux Hub `socialData` 分组路由与 TikTok 选品插件 TikHub 响应解析（#379）

- **工单**：[#379](https://github.com/omnimux-ai/omnimux-client/issues/379)
- **影响范围**：`plugins/plugins/omnimux`、`plugins/plugins/omnimux-tiktok-selection`

## 背景与根因

1. **Hub `socialData` 分组头缺失**：在 `plugins/plugins/omnimux/src/official/social-data.js` 中，`fetchSocialData` 仅在 `(platform === 'x' || platform === 'tiktok') && (capability === 'user' || capability === 'posts')` 时附加 `X-Omnimux-Group: social-data-tikhub`。其余 34 个社媒与 TikTok Shop 模型（包含 `tiktok-shop-search-v2`、`tiktok-shop-product-v3`、`tiktok-shop-reviews-v2`、`tiktok-creator-search-videos`）请求未附带分组头而落入默认分组，在线上网关侧返回 `CHANNEL_UNAVAILABLE`（HTTP 502/503「该模型当前不可用，请换一个试试」）。
2. **TikHub 真实返回结构归一化缺口**：在 `plugins/plugins/omnimux-tiktok-selection/src/datasource.js` 中：
   - `extractItemsFromHubResponse` 缺少 `data.data.product_list`、`data.data.list`、`data.search_result`、`data.data.search_result`。
   - `normalizeHubShopItem` 对 TikHub 对象型 `price: { sale_price, currency }` 未解包标量价格而将对象直接传入 `normalizeProductInput`，导致价格字段退化为 `null`/`—`；同时缺少 `product_info` / `product_base`、`cover.url_list[0]`、`sold_info.sold_count`、`rate_info.score` 等嵌套字段。
   - `getProductDetail` 未解析 TikHub `tiktok-shop-product-v3` 常见的嵌套 `product_data.page_config.components_map[].component_data.product_info` 结构；`normalizeHubVideos` 未覆盖 `video_list` / `data.video_list` / `data.data.video_list`；`loadReviews` 未覆盖 `product_reviews` 数组及 `review_rating`、`review_text`、`review_time`、`reviewer_name`。
3. **详情抽屉未展示已加载评论**：`plugins/plugins/omnimux-tiktok-selection/src/client/DiscoveryPanel.jsx` 点击「加载评论」后会覆盖此前拉取的 `referenceVideos`，且抽屉 JSX 未渲染 `detailData.reviews`。

## 假设

1. 网关侧 `social-data-tikhub` 分组承载 `SOCIAL_DATA_CATALOG` 全部 38 个 TikHub 社媒与 TikTok Shop 采集模型；所有云端 `fetchSocialData` 调用按次携带 `X-Omnimux-Group: social-data-tikhub` 且不污染共享 `client` 的其他路由，可消除选品实时查询在默认分组下命中 `CHANNEL_UNAVAILABLE` 的客户端路由缺口。
2. 补齐 TikHub Shop 搜索/V3 详情/创作者视频/评价真实字段归一化与详情抽屉评论渲染后，真实上游返回的商品价格、销量、评分、视频与评价可在列表中及详情抽屉完整呈现，且不影响现有快照导入与平滑降级逻辑。

## 证伪方式

1. 临时撤回 `plugins/plugins/omnimux/src/official/social-data.js` 的 `SOCIAL_DATA_GROUP` 请求头后，`social-data.test.js` 针对 `tiktok/shop_search_v2`、`tiktok/shop_product`、`tiktok/shop_reviews_v2`、`tiktok/creator_search_videos` 的新增用例与 38 模型全量断言必然失败；恢复后全绿。
2. 临时撤回 `plugins/plugins/omnimux-tiktok-selection/src/datasource.js` 的 TikHub 对象价格、V3 嵌套 `product_info`、`video_list` 与 `product_reviews` 解析逻辑后，`store-and-datasource.test.js` 新增 TikHub 真实载荷用例必然失败；恢复后全绿。
3. 合并前完成本地构建、跨插件测试与静态门禁；合并并同步 Dev 后通过 `ego-browser` 从侧栏「更多 -> 跟爆选品」发起真实在线榜单、关键词检索及详情链路验证并记录响应结果（如服务端分组本身仍无可用渠道，显式回报实测证据）。

## 实施范围

- `plugins/plugins/omnimux/src/official/social-data.js`：导出 `SOCIAL_DATA_GROUP = 'social-data-tikhub'`，并在所有云端 `/v1/chat/completions` 请求头固定按次发送 `X-Omnimux-Group: social-data-tikhub`。
- `plugins/plugins/omnimux/README.md`：补充 `omnimux_social_data` / `socialData` 的 `X-Omnimux-Group: social-data-tikhub` 说明。
- `plugins/plugins/omnimux/src/official/social-data.test.js`：覆盖全量 38 个模型按次携带 `social-data-tikhub` 且非社媒请求不残留分组头，并新增 TikTok Shop / Creator 请求体回归测试。
- `plugins/plugins/omnimux-tiktok-selection/src/datasource.js`：补齐 TikHub Shop 搜索、V3 详情、参考视频与评价归一化提取函数（带深度上限与去重环保护）。
- `plugins/plugins/omnimux-tiktok-selection/src/client/DiscoveryPanel.jsx`：在详情抽屉保留同商品已加载视频/评价状态并新增「商品评价」渲染区块（复用既有样式类与 `dsh-ui-kit` `Badge`，不使用中点分隔符）。
- `plugins/plugins/omnimux-tiktok-selection/src/store-and-datasource.test.js` & `client-stage.test.js`：补充 TikHub 真实载荷测试与构建包评价渲染检查。

## 旧标准变更

- `plugins/plugins/omnimux/src/official/social-data.test.js` :: `binds only the four account collection capabilities to their dedicated group per request`
  原断言：仅 `x-user`、`x-posts`、`tiktok-user`、`tiktok-posts` 四个账号采集模型附带 `X-Omnimux-Group: social-data-tikhub`，其余 34 个社媒采集模型不附带该分组头。
  必须改的理由：OmniMux 网关将 TikHub 社媒与 TikTok Shop 通道隔离在 `social-data-tikhub` 分组下，未附带该分组头的 `tiktok-shop-search-v2` 等 34 个模型在默认分组路由下直接返回 `CHANNEL_UNAVAILABLE`（HTTP 502/503）；参照 `data-reader` 隔离分组机制，所有云端 `fetchSocialData` 请求须按次附带 `X-Omnimux-Group: social-data-tikhub` 且不影响共享 `client` 后续请求。
  新期望证据：`social-data.test.js` 验证 `SOCIAL_DATA_CATALOG` 全部 38 个云端模型均按次携带 `X-Omnimux-Group: social-data-tikhub`，紧随其后的非社媒 `client.withSk('/v1/models')` 不带 `X-Omnimux-Group`，并新增 Shop 搜索/详情/评价/视频 4 项定向用例全部通过。
