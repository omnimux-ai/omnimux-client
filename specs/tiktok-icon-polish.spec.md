# Spec: TikTok 及社媒品牌图标深浅双主题可见性与视觉优化

- Issue: #322
- 任务：`tiktok-icon-polish`
- 基线：`origin/main` (`d69f5438`)

## 背景与问题

在 `omnimux-accounts` 的「连接新账号」弹窗（`ConnectModal.jsx`）深色主题下，TikTok 品牌图标呈现黑底黑字，几乎不可见；同弹窗底部「即将支持」条中的 X 也呈黑底黑字，Instagram / YouTube / Facebook 的图标轮廓也错误显示为黑色而非白色。

经核查上游宿主主题真源（`app/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`）与兄弟插件源码，定位出三处同源缺陷：

1. **`omnimux-accounts` 品牌图标前景 Token 误用**：`styles.js` 中 5 个 `.omnimux-accounts-brand-icon--*` 规则均使用 `color: var(--dsw-alias-label-primary-foreground, #ffffff)`。该 Token 在浅色模式下为白色（`--dsw-static-neutral-bluish-00`），但在深色模式（`body[data-ds-dark-theme]`）下为近黑色（`--dsw-static-neutral-bluish-1000`，`rgb(15, 17, 21)`），导致品牌深色/彩色底块内的 `currentColor` 矢量图标全部变黑。宿主题中专门用于固定深色/饱和填充上的白字 Token 是 `--dsw-alias-label-on-color`（双主题下均为 `--dsw-static-neutral-bluish-00`）。
2. **TikTok 图标视觉辨识度不足**：`omnimux-accounts/src/client/icons.jsx` 中 `PlatformBrandIcon` 的 `tiktok` 分支仅渲染单色音符，缺乏 TikTok 标志性的青（`#25F4EE`）/ 品红（`#FE2C55`）/ 白三色故障错位特征，且应采用 `simple-icons`（CC0-1.0）标准比例与防裁切 `viewBox` 留白。
3. **兄弟路径同源缺陷**：
   - `omnimux-accounts/src/client/styles.js` 中 `.omnimux-accounts-chip--solid`（TikTok / X 账号平台标签）使用 `background: var(--dsw-alias-bg-module-platform)` 搭配 `color: var(--dsw-alias-label-primary-foreground)`，在浅色模式呈白字浅灰底（几乎不可读）、深色模式呈黑字深灰底（低对比度），应改为 `color: var(--dsw-alias-label-primary)`。
   - `omnimux-publish/src/client/styles.js` 中 `.omnimux-publish-plat-tag` 使用 `color: var(--dsw-alias-label-primary, #ffffff)` 搭配 `.tiktok` 黑色底 `#000000`，在浅色模式下呈现黑底黑字；且 `omnimux-publish/src/client/icons/cards.js` 的 `IconTikTokMusic` 使用了通用双音符而非 TikTok 品牌音符轮廓。应统一改为 `color: var(--dsw-alias-label-on-color, #ffffff)` 并升级 `IconTikTokMusic` 为标准 TikTok 单色品牌矢量轮廓。

## 假设

1. 根因假设：在深色主题下 `ConnectModal` 中 TikTok 与 X 图标不可见的直接原因是 `.omnimux-accounts-brand-icon--*` 继承了在暗色模式下解析为 `rgb(15, 17, 21)` 的 `--dsw-alias-label-primary-foreground`；将其统一改为上游真源 Token `--dsw-alias-label-on-color`，并为 `PlatformBrandIcon('tiktok')` 采用青/红/白三色矢量层次，即可在亮/暗双主题与 `22px`/`14px` 尺寸下同时获得高对比度与高品牌辨识度。
2. 兄弟路径假设：`omnimux-accounts` 的 `.omnimux-accounts-chip--solid` 与 `omnimux-publish` 的 `.omnimux-publish-plat-tag` 存在同一类前景/背景 Token 错配缺陷，同步改用 `--dsw-alias-label-primary` 与 `--dsw-alias-label-on-color` 不会引入未定义 `--dsw-*` Token，且能消除双主题对比度隐患。

## 改动范围

- `ui-demo/tiktok-icon-polish-demo.html`：亮/暗双主题修改前后对照与尺寸/交互高保真演示。
- `plugins/plugins/omnimux-accounts/src/client/styles.js`：修复 `.omnimux-accounts-brand-icon--*` 与 `.omnimux-accounts-chip--solid` 前景色 Token。
- `plugins/plugins/omnimux-accounts/src/client/icons.jsx`：升级 `PlatformBrandIcon` 的 `tiktok` 图标为高保真三色矢量结构。
- `plugins/plugins/omnimux-publish/src/client/styles.js`：修复 `.omnimux-publish-plat-tag` 前景色 Token。
- `plugins/plugins/omnimux-publish/src/client/icons/cards.js`：将 `IconTikTokMusic` 升级为 TikTok 品牌矢量轮廓（保持导出名与 props 不变）。
- 回归测试与端到端测试：`omnimux-accounts` 与 `omnimux-publish` 补充含真实宿主主题样式表的 DOM/计算色对比度双向证伪用例。
- `bundle.lock.json`：构建后重算更新受影响插件的 `contentHash`。

## 证伪方式

以下任一可观测结果即证明上述假设不成立：
1. 在真实 Chromium 中加载 `app/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` 并切换 `body`（浅色）与 `body[data-ds-dark-theme]`（深色）时，任一 `.omnimux-accounts-brand-icon--*`、`PlatformBrandIcon('tiktok')`、`.omnimux-accounts-chip--solid` 或 `.omnimux-publish-plat-tag.tiktok` 的计算前景色与背景色对比度仍低于 4.5:1（图形 3:1），或 TikTok 三色层发生边缘裁切/混色失真。
2. 回退 `styles.js` / `icons.jsx` / `cards.js` 修复后，新增回归测试未失败（无法区分修复前后），或恢复修复后全量单测、E2E、UI 静态门禁与 `--dsw-*` Token 门禁存在失败项。
3. 可执行验证命令：`corepack pnpm --dir plugins run build:all && node scripts/workspace-check.mjs --check && corepack pnpm --dir plugins --filter omnimux-accounts test && corepack pnpm --dir plugins --filter omnimux-publish test && node plugins/scripts/verify-dsw-tokens.mjs && node plugins/scripts/scan-ui-gates.mjs && node plugins/scripts/verify-fix-regression-test.mjs . origin/main`。
