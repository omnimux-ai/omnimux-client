# omnimux-products

OmniMux **产品库**（P0）：一条产品是名称 + 怎么卖 + 可选主图路径引用，不是资产库第七类。

- **媒体只记 `real_path`**：不拷贝、不移动、不改原文件。保存时拒绝无效、相对、不存在、非文件或不可读路径；校验失败不改变商品。已保存的文件后来消失时，该素材不显示
- **删除只删 JSON 行**：`products_delete`（破坏性操作需 `confirm: true`）与页面删除均仅移除记录，永不 `rm` 用户原文件
- **链接导入**：二级表单页左栏顶部粘贴商品落地页 → `POST /omnimux/products/import-from-link`，由本插件直接抓取页面（title/meta/OpenGraph/JSON-LD + 列表与正文），过滤导航噪音后回填名称、卖点、受众、品牌、特性、价格、SKU、促销、链接、分类。解析失败只给温和提示，不阻塞手填；仅本机 POST 可用，且不写库；不调用 OmniMux 云、不读任何 `OMNIMUX_*` 凭据
- **二级表单页**：添加/编辑产品是同 Tab 内的整屏子视图（`position:absolute; inset:0`），不是弹窗：顶部常驻返回栏与面包屑，底部常驻动作条，中间双栏（左：解析 / 基础信息 / 商业化 / 品牌战略；右：双端首屏截图 / 分类标签 / 素材列表）。有未保存修改时，返回、取消与 Esc 会先弹三选一确认（继续编辑 / 放弃修改 / 保存并返回）；未修改则直接返回列表
- **脏数据指纹**：`useProductFormState` 用 canonical 指纹比对初始快照，字段域与 `buildPayload` 严格对齐（数字产品不比对价格/SKU/促销，实体产品不比对隐藏战略），纯 UI 状态（标签草稿、面板展开）不参与判定
- **草稿截图只读预览**：创建态下截图已写盘但产品记录还不存在，走 `GET /omnimux/products/draft-media/{id}`（内存登记表，TTL 15 分钟、容量 200，只放行本插件媒体目录内的文件）
- **引用**：`@产品/{name}`
- **Agent 七工具**：`products_list` / `products_search` / `products_get` / `products_read_media` / `products_create`（显示名称 1–40 字符且不含 `/`）/ `products_update` / `products_delete`（需 `confirm: true`）
- **UI 挂载**：本插件不独立声明 `dsh.client` bundle，客户端入口 `src/client/ui.js`（`./ui`）由 `omnimux-assets` 在资产中心产品库视图中挂载（对应 `products` Tab）

## 安装与验证

日常进 App：

```sh
cd <omnimux-client 检出目录>/app
corepack yarn omnimux:sync omnimux-products omnimux-assets
corepack yarn omnimux:restart dev
```

开发：

```sh
pnpm test # node --test src/*.test.js src/client-form-subscreen.test.js src/client/*.test.js tests/e2e/*.spec.js
```

## 数据位置

全部落 `$DSH_HOME || ~/.dsh` → `omnimux/products/`（本插件唯一可写区；目录 `0700`、JSON `0600`）：

```text
omnimux/products/
└── library.json     # schema 1：products[] + revision（媒体只有 real_path）
```

## 内置技能

- `skills/products-brand-strategy/SKILL.md`
- `skills/products-physical-import/SKILL.md`
