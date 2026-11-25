# 资产中心卡片 16:10 横版托盘式重构规格

## 背景与问题定义

当前 `omnimux-assets` 在「本地」与「AI 生成」视图中存在以下可复现的结构性视觉与效率问题：

1. **横图与无封面资产留白严重**：`plugins/plugins/omnimux-assets/src/client/AssetGrid.jsx` 与 `styles.js` 将本地卡片强锁为 `3:4` 竖框（`aspectRatio="3:4"` + `MasonryGrid` `getRatio={() => 3 / 4}`）。16:9 场景图、知识包封面走 `object-fit: contain` 后上下出现大面积空底，无封面知识包变成巨大的空白竖块。
2. **角色立绘横向硬裁切**：`.omnimux-assets-card--character` 对媒体强制 `object-fit: cover; object-position: center top`，导致方图（1:1）或偏宽人物构图左右主体被裁切。
3. **屏效偏低**：`GRID_MIN_COLUMN_WIDTH = 260` 搭配 `3:4` 竖版展台与带外框底栏，单卡总高超过 `400px`，在常规桌面内容区（`~1160px–1280px` 宽 × `~650px–720px` 可视内容高）首屏仅可见约 `1.3` 行。
4. **悬停模糊遮挡与操作入口割裂**：悬停时 `.omnimux-assets-card-overlay` 叠加 `backdrop-filter: blur(4px)` 全屏蒙层遮挡画面；同时本地卡片缺少直达删除与打开文件位置的卡片级入口。
5. **站内各页签视觉与密度不统一**：「本地」为 `3:4` 竖版瀑布流、「产品库」为 `minmax(220px, 1fr)` 横版网格、「AI 生成」为 `minmax(260px, 300px)` 带硬裁切与 3 个未定义 `--dsw-*` 令牌的旧式带框卡、「公共」列宽仍锁定 `260px`。

## 研究与决策依据

### 案例与来源

1. **本仓同域基线**：
   - `plugins/plugins/omnimux-assets/src/asset-hub/styles/asset-hub-styles.js` 已采用 `aspect-ratio: 16 / 10` 作为素材展台基准。
   - `plugins/plugins/omnimux-products/src/client/styles.js` 已采用 `display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` 作为产品库网格基准。
   - `plugins/plugins/omnimux-workflow/src/client/projects/AIAppCard.jsx` 与 `plugins/plugins/omnimux-inspiration/src/client/InspirationCardMenu.jsx` 已确立基于官方 `@deepseek-ai/dsh-client-ui-primitives` `Menu`（`portal` + `align="end"`）和 `dsh-ui-kit` `IconButton` / `IconEllipsisOutline16` 的卡片溢出菜单模式。
2. **宿主主题真源**：
   - 核查 `app/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`（`@deepseek-ai/dsh-client-ui-theme@0.2.2-rc.5`）：浅色模式下 `--dsw-alias-bg-base` 与 `--dsw-alias-bg-layer-1` 均为 `rgb(255, 255, 255)`，只有 `--dsw-alias-bg-module-platform` 为柔和中性浅灰 `rgb(245, 246, 247)`；深色模式下 `--dsw-alias-bg-base` 为 `rgb(21, 21, 23)`，`--dsw-alias-bg-module-platform` 为 `rgb(53, 54, 56)`。因此托盘容器表面必须以 `var(--dsw-alias-bg-module-platform)` 为主色，才能在亮/暗双主题下与页面底色清晰分离且无生硬外框。
3. **专业创作工具视觉层级参考**（按 `docs/development-research.md`）：
   - Higgsfield 等专业创作工作台将素材本体置于无遮挡的视觉主位，次级动作收至角落或溢出菜单，不在悬停时用毛玻璃遮蔽素材细节。

### 数据与真实性（改前基线 vs 改后目标）

- **测量口径**：按桌面端常见内容区宽 `1200px`、滚动可视区高 `680px` 计算（源码实测几何推算，最终以真实浏览器 DOM `getBoundingClientRect()` 实测为准）：
  - **改前（本地 3:4 + `GRID_MIN_COLUMN_WIDTH = 260`）**：`1200px` 宽排 `4` 列，单卡宽 `~291px`，`3:4` 展台高 `388px` + 底栏 `56px` = `444px`，加 `12px` 行距后每行 `456px`，`680px` 首屏仅见 `1.49` 行（含页头工具栏后约 `1.3` 行）。
  - **改后（本地 16:10 + `minmax(220px, 1fr)`）**：`1200px` 宽排 `5` 列（`1000px` 宽排 `4` 列），单卡宽 `227px`（4 列时 `238px`），`16:10` 展台高 `142px`（4 列时 `149px`）+ 无框底栏 `44px` = `186px`，加 `20px` 行距后每行 `206px`，`680px` 首屏可见 `3.3` 行（常规桌面宽屏稳定 `2.5–3.5` 行）。

### 取舍与范围边界

1. **「本地」与「本地钻取浏览」（`AssetGrid.jsx`、`AssetBrowse.jsx`）**：全面迁移为标准等高 CSS Grid（`repeat(auto-fill, minmax(220px, 1fr))`）+ `16:10` 独立圆角托盘（`border-radius: 12px; padding: 8px`）+ 全类型媒体 `object-fit: contain; width: auto; height: auto; max-width: 100%; max-height: 100%; border-radius: 8px` + 无外框双行底栏 + 右上角轻量快捷动作 + 标题行右侧 `...` 官方 `Menu`。
2. **「AI 生成」（`GenerationsView.jsx`、`styles.js`）**：同步收敛至完全一致的 `16:10` 横版托盘卡片与 `minmax(220px, 1fr)` 标准网格，移除嵌套重复水平内边距，并清零该区块 3 处未定义 `--dsw-*` 令牌。
3. **「公共」（`CloudAssetsView.jsx`、`grid-columns.js`）**：
   - 收敛 `grid-columns.js` 最小列宽至 `220px`、间距 `16px`（上限 `5` 列、下限 `2` 列），使「公共」分类网格在桌面常规宽度（`1024px–1280px`）同样呈现 4–5 列密度，与「本地」「产品库」「AI 生成」对齐。
   - 保留「公共」单行流发现货架（`CloudCategoryRow` 9:16 竖版数字人/钩子 + 16:9 风格/声音）与公共分类自然比例瀑布流（覆盖既有 `category-row-layout.e2e.test.js`、`cloud-bare-video-card.e2e.test.js`、`CloudAssetsView.test.js` 契约），避免将纯 9:16 公共数字人/钩子发现流强压成 35% 宽度的横框。

## 假设

1. 将本地与 AI 生成网格收敛为 `repeat(auto-fill, minmax(220px, 1fr))` + `aspect-ratio: 16 / 10` 托盘展台（`padding: 8px`、媒体 `width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px`），可在亮/暗双主题下消除 16:9 场景图上下黑边压迫感、消除角色图横向裁切，并将首屏可见行数提升至 `≥ 2.5` 行。
2. 移除 `.omnimux-assets-card-overlay` 全屏模糊遮罩，改为左上角多选圆圈 + 右上角类型角标与悬停快捷「加入会话」图标 + 标题行右侧 `...` 溢出菜单（查看详情、加入会话、打开文件位置、移除），既保持悬停时画面 100% 清晰无遮挡，又完整覆盖并补齐所有资产级高频操作与键盘无障碍可达性。
3. 以 `var(--dsw-alias-bg-module-platform)` 承载托盘底色、无外框底栏直接落在 `var(--dsw-alias-bg-base)`，同时配合官方 `Menu` 与 `dsh-ui-kit` 控件，可通过全部 UI01–UI10、`verify:dsw-tokens` 与 `guard:popover` 门禁。

## 证伪方式

若以下任一可观测结果成立，即证明上述假设不成立，必须修正实现：

1. 在 `1280×800` 或 `1440×900` 桌面视口真实渲染中，「本地」网格任意同排卡片展台高度差 `> 1px`、展台宽高比偏离 `16 / 10` 超过 `0.02`，或首屏可见完整/有效行数 `< 2.5` 行。
2. 任意类型素材（含 `character` 角色 1:1 / 9:16 / 16:9 图片、场景 16:9 图片、视频）出现 `object-fit: cover` 裁切、缺少 `8px` 媒体圆角或缺少 `8px` 托盘呼吸边距；或在浅色主题下托盘底色与页面底色完全相同无法分辨。
3. 悬停卡片时仍存在 `backdrop-filter` 模糊遮罩或全屏暗幕遮挡主体画面；或点击展台、左上角多选、右上角加入会话、标题行右侧 `...` 菜单（查看详情 / 加入会话 / 打开文件位置 / 移除）任一操作失效、误触发父卡点击或被容器裁剪。
4. 自动化验证命令任一项失败：
   - `corepack pnpm --filter omnimux-assets build && corepack pnpm --filter omnimux-assets test`
   - `corepack pnpm --dir plugins run verify:dsw-tokens`
   - `corepack pnpm --dir plugins run test:ui`
   - `corepack pnpm --dir plugins run guard:popover`
   - `corepack pnpm --dir plugins run verify:stages && corepack pnpm --dir plugins run verify:stage-scroll`
   - `node plugins/scripts/verify-plugin-load.mjs`
   - 工作树真实浏览器（亮/暗双主题、宽/窄视口、悬停态与打开 `...` 菜单态）截图与几何检查。

## 验收标准

- [x] 资产中心「本地」网格所有卡片展台统一为 `16:10` 横版，同排高度严格齐平，常规宽屏下首屏可见 `≥ 2.5` 行。
- [x] 横图、方图、竖图及视频在展台内均完整呈现、不裁切主体，媒体具备独立 `8px` 内圆角与 `8px` 托盘呼吸边距，亮/暗主题下均无生硬黑边。
- [x] 无封面知识包/文档类卡片与上传中进度态在 `16:10` 托盘内视觉平衡，无大面积空白压迫感。
- [x] 悬停卡片不模糊/遮挡预览画面；点击展台可预览/打开，左上角多选、右上角快捷操作与标题行右侧 `...` 菜单可完成全部既有操作（查看详情、加入会话、打开文件位置、多选、删除）。
- [x] 「AI 生成」卡片同步收敛为 `16:10` 横版托盘网格并清理未定义 DSW 令牌；「公共」网格最小列宽收敛至 `220px` 保持 4–5 列密度。
- [x] 相关单测、E2E 样式契约测试、静态门禁与真实浏览器亮/暗双主题验证全部通过。

## 旧标准变更

本次产品规范主动将资产中心本地与 AI 生成卡片由旧版 `3:4` 竖版瀑布流 + 角色 `object-fit: cover` 裁切 + 全屏毛玻璃遮罩 CTA，整体重构为 `16:10` 横版托盘展台 + 全类型 `object-fit: contain` 内圆角 + 展台右上角快捷动作与标题行 `...` 溢出菜单，同时将网格最小列宽由 `260px` 收敛至 `220px`（间距 `16px`）。因此以下绑定旧视觉/交互标准的既有测试按新产品契约同步替换，并新增真实 DOM 行为回归测试 `AssetGrid.behavior.test.js`：

- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `AssetGrid cover preview and card CTA actions contract`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `implements image cover preview with fallback to FileIcon in AssetGrid.jsx`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `implements View and AddToConversation buttons in grid card actions`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `completely removes copyCite and remove buttons from card actions and list rows`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `contains complete i18n locales for card actions with Add to Conversation updated`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `migrates card CTA buttons into thumb hover overlay with EyeIcon and ChatIcon`
- `plugins/plugins/omnimux-assets/src/client/AssetGrid.test.js` :: `conforms to 3:4 vertical card ratio and relative time subtitle contract (Issue 2229)`
- `plugins/plugins/omnimux-assets/src/client/assets-vertical-cards.e2e.test.js` :: `本地资产统一 3:4 展台模式：外框统一 3:4，角色 cover，非角色 contain`
- `plugins/plugins/omnimux-assets/src/client/card-compact-cta.e2e.test.js` :: `资产库卡片：卡片自身宽度驱动 CTA 退化，紧凑只留图标、充足显示文字且永不裁切`
- `plugins/plugins/omnimux-assets/src/client/card-compact-cta.e2e.test.js` :: `资产库卡片：退化由具名容器查询判定，且容器只落在带 CTA 浮层的卡片上`
- `plugins/plugins/omnimux-assets/src/client/card-compact-cta.e2e.test.js` :: `资产库卡片：文字标签由源码渲染，无障碍名称与交互保持原样`
- `plugins/plugins/omnimux-assets/src/client/grid-columns.test.js` :: `gridColumnsFor: 目标断点逐个成立 (Issue #2149 AC-1)`
- `plugins/plugins/omnimux-assets/src/client/grid-columns.test.js` :: `gridColumnsFor: 列宽与间距的常量契约`
- `plugins/plugins/omnimux-assets/src/client/GenerationsIntegration.test.js` :: `injects generations styles into ASSETS_CSS without raw hex or broken template escapes`
