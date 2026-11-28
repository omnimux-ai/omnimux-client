# TikTok 跟爆选品发现页与商品详情交互、缓存及信息秩序重构（#453）

- **工单**：[#453](https://github.com/omnimux-ai/omnimux-client/issues/453)
- **影响范围**：`plugins/plugins/omnimux-tiktok-selection`、`plugins/docs/contracts/plugin-agent-tools-inventory.md`、`bundle.lock.json`

## 背景与根因

1. **重复请求与连带扣费缺陷（`plugins/plugins/omnimux-tiktok-selection/src/datasource.js`）**：
   - 详情抽屉内点击「加载带货视频」或「加载评论」均复用 `getProductDetail`，会无条件先重跑 `shop_product`（v3）与回退 `shop_product_v1`（v1），再拉取视频或评论，造成单品多次重复触发云端网关调用。
   - 榜单翻页、排序切换每次都重发 `shop_search_v2` 请求，无会话级 TTL 缓存；浏览本地快照时打开详情抽屉仍尝试请求云端实时详情。
   - `assets-pipeline.js` 为生成脚本拉取参考视频时同样未跳过实时详情请求。
2. **销量字段口径失真（`datasource.js`）**：
   - `normalizeHubShopItem` 将 `periodSales` 回退为 `sales7d ?? salesTotal`，经 `normalizeProductInput` 传播后导致缺少 7 天销量时把总销量显示为「7 天销量」。
3. **页面信息秩序与交互错位（`DiscoveryPanel.jsx`、`TiktokSelectionStage.jsx`、`locales.js`、`styles.js`）**：
   - 抽屉头部缺失商品主图与直接入库/外链动作，反而在正文置放两个高权重命令按钮；实时详情失败以醒目错误条拦截注意。
   - 发现页工具栏重复出现模式切换与快照下拉框，实时源下存在无效「榜单粒度」「榜单期次」控件与整排空占位列（`—`），将有效字段挤出横向视口。
   - 顶层页签存在「风控与配置」（`与` 拼接）与「素材中心」（容器后缀）等不对齐命名。

## 研究依据

- **案例对照**：参考 CreatOK / Higgsfield 的渐进式披露模式与 OmniMux `dsh-ui-kit` 工作台规范（`plugins/docs/contracts/ui-copy-naming.md`、`plugins/packages/dsh-ui-kit/README.md`）：主工作区直出核心筛选与列表，次级详情与扩展维度通过切换抽屉 Tab 自然按需触发，非破坏性/低成本状态切换不加确认阻断或冗余 Toast。
- **数据证据**：在源码实查中，实时 `shop_search_v2` 未提供 `sales28d`、`commissionRate`、`channelMetrics`；拆解调用路径后，单个失效商品点开抽屉 + 视频 + 评论会触发 8 次 `socialData.fetch`（打开详情 2 次 + 视频按钮重跑详情 2 次再拉视频 1 次 + 评论按钮重跑详情 2 次再拉评论 1 次），重构后降至最多 4 次且切回/重开 0 次。

## 假设

1. 将 `getProductDetail` 的详情、带货视频与商品评价拆分为独立作用域并引入有界会话 TTL 缓存、并发去重（in-flight dedupe）、确定性无效详情短时负缓存（不缓存瞬态网络/鉴权/额度错误）、本地列表翻页排序及快照源隔离，可在保持现有工具契约兼容的前提下消除连带重复调用。
2. 修正 `periodSales: sales7d` 映射并在 `sortProducts` 对全空字段安全回退 `totalSales`，可消除总销量冒充 7 天销量的误导。
3. 将发现页收敛为单行自适应筛选栏 + 按数据源切换默认列 + 整行点开抽屉 + 抽屉三 Tab（`概览` / `带货视频` / `商品评价`）自动懒加载 + 底部直达入库与原商品页，并对齐顶层页签命名和官方 `--dsw-*` Token，可明显提升信息秩序与操作效率。

## 证伪方式

1. **后端缓存与拆解双向证伪**：在 `store-and-datasource.test.js` 新增用例覆盖列表翻页/排序缓存、独立作用域拉取（`includeDetail: false` 时零详情调用）、负缓存与不缓存鉴权/额度错误、快照防误调与 `sales7d === null`。临时用 `origin/main` 的 `datasource.js` 对照运行新增回归用例，验证其真实失败；恢复改动后全部通过。
2. **前端与门禁证伪**：`client-stage.test.js` 校验移除手动加载按钮、统一 `全部` 首项与顶层 Tab 短命名；在真实无头浏览器（亮/暗主题 + 桌面/窄屏视口）运行高保真 HTML 演示与编译后 `lib/client.js`，逐项核验渲染几何、浮层不透底、零横向溢出与真实请求次数变化。

## 验收标准

- `omnimux-tiktok-selection` 单测与新增回归测试全部通过，双向证伪有效。
- `corepack pnpm --dir plugins run build:all`、`node scripts/bundle-lock.mjs`、`node scripts/workspace-check.mjs --check` 及所有适用静态/UI 门禁（`verify:dsw-tokens`、`guard:popover`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`verify:tools`、`test:agent-tools`、`verify:plugin-load`、`test:plugin-load`、`verify-anti-slop`、`copy-lint`）全绿。
- 真实浏览器验收覆盖发现页初始空态、榜单查询、本地翻页排序 0 请求、列设置浮层、抽屉三 Tab 按需加载与缓存复用、加库状态同步及快照模式自适应列，亮/暗主题及窄屏均无溢出错位。
