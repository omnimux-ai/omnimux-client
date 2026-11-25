# 资产中心「本地」列表视图重构规格

## 背景与目标

资产中心「本地」标签页的列表视图（`AssetListRow`）当前退化为原生后台表格：名称列硬编码统一白纸图标、左侧勾选列无表头全选且未选中态为空白洞、操作列每行常驻「查看详情 / 添加到会话」双按钮且表头左对齐与内容右对齐错位、缺少「更新时间」列、描述列直接裸露 `云端分类 / 云端来源` 等机器元数据，且缺乏悬停大图预览、表头排序、键盘导航、Shift 范围连选与拖拽调用等桌面高频效率能力。

本次在保持现有四层页头骨架、网格视图与宿主设计系统（`dsh-ui-kit` + `--dsw-alias-*` Token）不变的前提下，将列表视图升级为现代桌面资产列表体验（对标 Finder 列表视图、Linear 列表行交互与 Frame.io 媒体微缩略图体验）。

## 研究与决策依据

1. **案例与来源**
   - **Finder / Linear 列表视图交互模式**：行高保持 `52–56px` 承载 `16:10` 缩略图与单行名称；默认态隐藏次要文字按钮、仅在 hover / focus-within 显露主操作，降低整屏文字噪音；支持表头点击升降序、表头全选（含半选 `mixed`）、`Shift+Click` 范围连选及 `↑ / ↓ / Space / Enter` 键盘导航。
   - **本仓相邻实现与契约核查**：
     - 封面解析与预览 URL 真源：`plugins/plugins/omnimux-assets/src/client/add-to-chat.js`（`pickCoverFile`）与 `api.js`（`previewUrl`、`revealAssetEntry`）。
     - 相对时间格式真源：`plugins/plugins/omnimux-assets/src/client/format.js`（`formatTimeAgo`、`formatDateTime`）。
     - 机器元数据来源：`plugins/plugins/omnimux-assets/src/cloud-catalog.js:631-637`（保存云端素材时会以换行拼接 `云端分类：...` 与 `云端来源：...`）。
     - 表格与复选框基座：`plugins/packages/dsh-ui-kit/src/table/Table.tsx`（`TableHead` 已内置 `align`、`sortable`、`sortDirection` 与排序箭头）与 `DataTable.tsx`（无障碍 `role="checkbox"` + `aria-checked="true|false|mixed"`，不引入原生 `<button>` / `<input>`）。
     - 画布拖拽投放契约：`plugins/plugins/omnimux-workflow/src/canvas/editor/CanvasEditor.tsx:911-935` 与 `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/assetImportAdapter.ts:50-87`（识别 `application/json` 的 `{ type: 'omnimux-asset', asset }`）；同步写入 `text/plain`（`@type/name` 引用）以适配会话输入框拖放。
     - 浮层与 Token 硬门禁：`plugins/scripts/guard-no-transparent-popover.mjs`（禁止浮层 `backdrop-filter` 与未定义 `--dsw-alias-bg-elevated`）、`plugins/scripts/verify-dsw-tokens.mjs`（450 个宿主真源 Token 白名单）与 `plugins/scripts/scan-ui-gates.mjs`（UI01~UI10）。

2. **基线现状与取舍**
   - **现状基线**：当前 `AssetListRow` 6 列（40px 空洞勾选 + 白纸图标名称 + 类型 + 裸描述 + 素材数 + 160px 常驻双按钮），无更新时间列、无排序、无缩略图、无悬停预览、无拖拽与键盘行导航。
   - **方案取舍**：
     - 复用 `dsh-ui-kit` 的 `<Table>` 族组件而非替换为新表格库，避免破坏既有 `AssetGrid.test.js` 契约及引入第二套样式体系；通过 `border-collapse: separate` 与列对齐选择器修正表头/内容错位和圆角行 hover 质感。
     - 行内 `...` 更多菜单通过 `createPortalSafe` 渲染到 `document.body` 的实体背景浮层（`AssetListMoreMenu`，`background: var(--dsw-alias-bg-layer-2)`，无 `backdrop-filter`，内置 `dsh-ui-kit` `Button` 项及 `↑ / ↓ / Escape` 与外部点击/滚动关闭），确保不被列表 `overflow-x: auto` 裁切且亮暗主题不透底。
     - 缩略图悬停大图预览通过 `createPortalSafe` 渲染到 `document.body` 的固定定位实体卡片（`background: var(--dsw-alias-bg-layer-2)`，无 `backdrop-filter`，`pointer-events: none`），200ms 延迟触发并在离开、点击、滚动或按 `Escape` 时立即销毁，避免遮挡与闪烁。
     - 批量操作栏新增「批量加入会话」按钮，与表头全选及 `Shift+Click` 范围连选闭环；不改动网格视图（`AssetGridCard`）既有 3:4 展台契约。

## 假设

1. 将名称列升级为 `40×28`（16:10）`object-fit: contain` 圆角微缩略图（无封面按资产类型显示语义图标）并配合 200ms 悬停原比例大图浮层，可在保持列表高密度（一屏 12–15 条）的前提下直接完成找图辨认，无需反复进出详情页。
2. 将操作列重构为「默认克制、hover / focus-within / 菜单打开时浮现主按钮 + `...` 菜单」并统一表头与单元格右对齐，可显著降低整屏重复文字噪音，同时保留完整可达性（整行点击预览/进入详情、菜单内覆盖查看详情/打开文件位置/复制引用/移除）。
3. 补齐表头全选（支持 `mixed` 半选）、可见行内复选框、`Shift+Click` 范围连选、批量加入会话、列头升降排序、键盘 `↑ / ↓ / Space / Enter` 导航及标准 `draggable` 载荷，能够闭环高密度检索、批量整理与创作中高频调用三类核心桌面场景。
4. 全部样式严格消费宿主已定义 `--dsw-alias-*` / `--dsw-shadow-*` Token，浮层使用实体不透明表面，可在亮/暗双主题与窄视口下保持对比度、对齐与无裁切，并通过所有静态与真实浏览器门禁。

## 证伪方式

以下任一可观测结果出现，即证明上述设计或实现假设失败，必须返工修复：

1. **对齐与几何证伪**：在真实 Chromium 浏览器中测量列表表头与数据单元格，若操作列表头右边缘与操作列内容右边缘对齐偏差 > 2px、微缩略图尺寸偏离 `40×28`（圆角非 `6px` 或 `object-fit` 非 `contain`）、或行高不在 `52px–56px` 区间，则视觉几何不达标。
2. **交互状态证伪**：默认静止态若仍满屏展示常驻「查看详情 / 添加到会话」文字按钮，或 hover/focus-within 时主动作与 `...` 菜单不可见/被裁切，或点击表头全选/`Shift+Click`/列排序/键盘 `↑↓SpaceEnter`/拖拽事件未产出预期状态与 `dataTransfer` 载荷，则交互闭环不成立。
3. **双主题与浮层门禁证伪**：若在亮/暗双主题或窄屏下出现裸色、未定义 `--dsw-*` Token、透明/毛玻璃透底浮层，或任一门禁命令失败，即判定不通过。
4. **可执行验证命令**：
   - `corepack pnpm --dir plugins --filter omnimux-assets build`
   - `corepack pnpm --dir plugins --filter omnimux-assets test`
   - `corepack pnpm --dir plugins run verify:dsw-tokens && corepack pnpm --dir plugins run guard:popover && corepack pnpm --dir plugins run test:ui && corepack pnpm --dir plugins run verify:stages`
   - 真实浏览器 E2E 测试：`node --test plugins/plugins/omnimux-assets/src/client/assets-list-view.e2e.test.js`

## 验收项

- [x] 列表视图每行显示 `40×28`（约 16:10）圆角微缩略图（托盘浅底、`6px` 圆角、`object-fit: contain`）；无封面或加载失败时按资产类型展示区分语义图标（角色/场景/风格包/道具/知识包/自定义）。
- [x] 行高 `52px–56px`，名称 `13px–14px / font-weight: 500`；描述列过滤弱化 `云端分类 / 云端来源` 机器元数据并保留完整 `title` tooltip；素材列右对齐 `tabular-nums` 且紧凑展示缺失文件警示。
- [x] 勾选列 `36px`，表头含全选 Checkbox（支持全选 / 取消 / 半选 `aria-checked="mixed"`），行内复选框默认清晰可见且支持 `Shift+Click` 连续多选，联动顶部批量操作栏（批量加入会话、批量移除）。
- [x] 新增「更新时间」列（`104px` 右对齐，复用 `formatTimeAgo`），支持点击表头按名称、类型、素材数、更新时间升/降序切换。
- [x] 操作列默认态克制干净，hover / focus-within / 菜单打开时浮现主操作「添加到会话」（胶囊高对比，点击反馈「已添加」）与 `...` 菜单（查看详情、打开文件位置、复制引用、移除），移除每行重复「查看详情」常驻文字按钮；表头与内容右对齐一致。
- [x] 悬停微缩略图（~200ms 延迟）弹出按原比例自适应的大图预览浮层（最大边 `320px–360px`，实体不透明底色，不裁切、不溢出视口，支持 `Escape`/离开/滚动销毁）。
- [x] 整行点击按文件夹/单媒体分流打开详情或预览；支持列表行 `draggable` 拖拽载荷（画布 `application/json` + 会话 `text/plain`）；支持键盘 `↑ / ↓` 移动焦点行、`Space` 触发快速预览、`Enter` 打开详情。
- [x] 亮/暗双主题、打开态浮层菜单与窄屏布局均在真实浏览器实测通过，全部使用宿主真源 `--dsw-alias-*` Token，无硬编码裸色。

## 旧标准变更

- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `completely removes copyCite and remove buttons from card actions and list rows`

原断言对整个 `AssetGrid.jsx` 文件执行 `assert.doesNotMatch(gridJsx, /\{t\('card\.copyCite'\)\}/)` 与 `/\{t\('mapping\.remove'\)\}/`，因旧版将两者平铺在行内常驻按钮而一并禁止。本次按需求将「复制引用」与「移除」收纳进列表行 `...` 更多菜单（`AssetListMoreMenu` 浮层），网格卡片与列表行内本身仍禁止平铺这两个常驻按钮；因此将该用例收窄为分别校验 `AssetGridCard` 与 `AssetListRow` 主体不含行内 `copyCite`/`remove`/`card.view` 按钮，并在新增的 `AssetListRow.test.js`（JSDOM）与 `assets-list-view.e2e.test.js`（真实 Chromium）中验证 `...` 菜单行为。

