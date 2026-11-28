# 修复 TikTok Shop 实测暴露的列表/详情/视频解析与 v1 回退问题（#438）

- **工单**：[#438](https://github.com/omnimux-ai/omnimux-client/issues/438)
- **影响范围**：`plugins/plugins/omnimux-tiktok-selection`、`plugins/plugins/omnimux-products`、`bundle.lock.json`

## 背景与根因

在线联调 TikTok Shop 选品与链接导入全链路时，暴露以下 5 个客户端解包、默认检索与失败回退问题：

1. **搜索/榜单列表解包与字段映射缺口（`omnimux-tiktok-selection/src/datasource.js`）**：
   - `extractItemsFromHubResponse` 未覆盖 `data.data.component_data.products`（及同级 `component_data.products`）嵌套路径，导致接口返回商品时桌面端仍解包为 0 条；且对空数组 `[]` 的判空缺失时易提前返回空数组。
   - `normalizeHubShopItem` 需补全 `image`（避开浏览器不可渲染的 `.heic` 链接）、`product_price_info`、`rate_info`、`sold_info`、`seller_info`、`brand_info`、`seo_url`、`sku_info` 的真实字段映射。
2. **热销榜「全部类目」默认检索词无数据（`omnimux-tiktok-selection/src/datasource.js`）**：
   - `queryRank` 在未选类目时固定传 `search_word: "trending best seller"`，上游稳定返回空列表；改为使用预设类目词序列依次请求并在首个非空类目结果命中后返回，不伪造缺失指标。
3. **商品详情缺少 `shop_product_v1` 回退及双层 `product_info` 解包（`omnimux-tiktok-selection/src/datasource.js`）**：
   - 部分真实商品调用 `shop_product`（v3）返回 HTTP 400（或 `exists: false` / `region_match: false` / 非零 `error_code`），而 `shop_product_v1` 可返回完整详情。
   - v1 详情主体位于双层 `global_data.product_info.product_info`（外层含 `error_code` 与 `categories`），`findProductInfoNode` 此前停留在外层而未解析内层 `product_model`。
4. **带货参考视频未解包 `search_item_list[].aweme_info`（`omnimux-tiktok-selection/src/datasource.js`）**：
   - 上游返回 `aweme_list: []` 且将真实视频置于 `search_item_list[].aweme_info`，旧逻辑直接停在空 `aweme_list` 导致解析为 0 条。
5. **TikTok Shop 链接导入字段错位与失效商品误报成功（`omnimux-products/src/tiktok-shop-import.js`、`link-importer.js`）**：
   - 对 v1 双层 `global_data.product_info.product_info` 未定位到内层 `product_model`，落入全树兜底遍历后误命中推荐区（如 `You may also like`）、触发标题 `-` 后缀误填 `brand`，且图片提取未优先避开 `.heic` 导致主图无法下载展示。
   - 当 v3 与 v1 均失败或返回 `exists: false` / `region_match: false` / 非零 `error_code` 时，`mapShopDetailToFields` 仍生成占位名称 `"TikTok Shop <id>"` 并被 `link-importer.js` 当作有效商品或落入网页抓取回退，造成前端误报绿色成功提示。

## 假设

1. 在 `datasource.js` 中补全非空列表挑选、`component_data.products` 与真实字段提取、默认热销类目回退、`shop_product -> shop_product_v1` 回退及双层 `product_info` / `search_item_list[].aweme_info` 解包，同时保留既有 `CHANNEL_UNAVAILABLE` / `needs-omnimux` / `quota-exceeded` 错误契约，即可打通选品工作台榜单、检索、详情、视频与评价全链路。
2. 在 `tiktok-shop-import.js` 与 `link-importer.js` 中精确解包内层 `product_info`（排除推荐区块、防止标题后缀污染品牌、避开 `.heic` 优先选 `.webp`/`.jpg`）并让无效或双端失败的 TikTok Shop 链接显式抛出 `LinkImportError('link-import-empty' | 'link-import-failed')`，即可准确回填产品表单并在失效/跨区链接场景给出明确失败提示。

## 证伪方式

1. 在 `plugins/plugins/omnimux-tiktok-selection/src/store-and-datasource.test.js` 与 `plugins/plugins/omnimux-products/src/tiktok-shop-import.test.js` 新增基于脱敏真实响应结构的回归用例。
2. 临时将 `datasource.js`、`tiktok-shop-import.js`、`link-importer.js` 回退至 `origin/main` 后重跑新增回归测试，确认全部新增用例均真实断言失败；恢复修改后两个插件测试、构建、`bundle-lock.mjs` 与门禁全绿。

## 验收标准

- 不改动任何 `.jsx` UI 布局与样式，不泄露内部凭据、部署路径或环境实值。
- 选品工作台「热销榜」「关键词检索」「详情与视频」「评价」及产品库 TikTok Shop 链接「智能解析」（含有效链接与无效/跨区链接）在单测与桌面开发版真实联调中均符合预期。
