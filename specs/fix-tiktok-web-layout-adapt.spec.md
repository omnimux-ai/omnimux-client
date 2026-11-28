# 修复 TikTok Web 新版影院布局锚点错位、弹窗箭头失效与活跃作品解析问题（#455）

- **工单**：[#455](https://github.com/omnimux-ai/omnimux-client/issues/455)
- **影响范围**：`plugins/plugins/omnimux-browser/extension`（`src/platform/anchor.ts`、`src/platform/registry.ts`、`src/content/tiktok-scene/coexist.ts`、`src/content/tiktok-scene/index.ts`、`src/content/tiktok-scene/active-post.ts`、`tests/`）

## 实测 DOM 事实与问题拆解

在 `https://www.tiktok.com/` 实测新版 Web DOM 结构，确认以下四类页面差异与三处故障：

1. **新版影院式推荐流（Cinema Feed，`/` 与 `/foryou`，覆盖桌面宽屏、窄屏、竖屏及评论抽屉展开态）**
   - TikTok 将作者头像移入左下角简介覆盖层（`[data-e2e="anchoring-description-layer"]` → `[data-e2e="cinema-creator-avatar"]` → `a[data-e2e="video-author-avatar"]`，24×24），同时将点赞/评论/收藏/分享放入右下角 `[data-e2e="anchoring-engagement-vertical"]`。
   - 中右部上下切换箭头由专属容器 `[data-e2e="anchoring-scroll-controls"]` 承载，内部包含 `button[data-e2e="feed-navigation-prev"]` 与 `button[data-e2e="feed-navigation-next"]`（宽屏 48×48、窄屏/竖屏 32×32；评论抽屉 `[data-e2e="anchoring-side-panel"]` 展开时随播放列同步左移）。
   - 竞品（`#creatok-video-trigger`，`data-placement="stable-action-bar"`）固定水平居中停在 `feed-navigation-prev` 正上方 8px；而当前 OmniMux 因回退匹配左下角 24×24 作者头像，错停在页面左下角。
2. **个人主页/搜索/探索点开作品弹窗（Browse Modal，`[data-e2e="browse-video"]`）**
   - TikTok 将切换箭头从 `#arrow-left` 改为 `data-e2e="arrow-left"` / `data-e2e="arrow-right"`（首条作品仅显示 `arrow-right`，第二条起两者均可见）。
   - 竞品（`#creatok-video-trigger`，`data-placement="spa-navigation-action-above"`）水平居中停在最上方可见切换箭头正上方 8px；当前 `placeAtModalPrevArrow` 仅查询 `#arrow-left` 而落空，退回 `modal-panel-left` 后压住 `arrow-right` 且位于竞品下方。
3. **推荐流活跃作品解析失效（`active-post.ts` 返回 `null`）**
   - 新版将携带 `data-more-menu-item-id` 的 `button[data-e2e="more-menu-icon"]` 与作者主页链接移入卡片外的同级覆盖层 `[data-e2e="anchoring-chrome-host"]`。
   - 同时作品卡片内 `div[id^="xgwrapper-0-"]` 高度为 `0`（父容器高度为卡片全高），导致 `resolveActivePostUrl()` 在首页推荐流返回 `null`，三个快捷按钮报「当前页面没有可操作的作品」。
4. **必须保留的经典布局（不可回归）**
   - 直开单作品页（`/@user/video/<id>`）与 `/following` 无 `[data-e2e="anchoring-scroll-controls"]` 与 `[data-e2e="anchoring-chrome-host"]`，仍使用右侧 `SectionActionBarContainer` 顶部 48×48 作者头像列（虽然页边同样存在单独的 `feed-navigation-prev`）。此处竞品停在作者头像上方，OmniMux 已位于竞品上方 8px，必须保持不变。
   - 网格页（`/@profile`、`/explore`、`/search`）仍由 `media-trigger.ts` 承接。

## 方案与布局契约

1. **布局识别与链式锚定（`anchor.ts` + `registry.ts`）**
   - 新增布局枚举 `'cinema-feed'`，仅当 `[data-e2e="anchoring-scroll-controls"]` 或 `[data-e2e="anchoring-chrome-host"]` 可测量时命中（严禁只凭 `[data-e2e="feed-navigation-prev"]` 判定，以免误伤直开单作品页与 `/following`）。
   - 优先级：`browse-modal` > `cinema-feed` > `side-rail` > `unknown`。
   - `cinema-feed` 链为 `['feed-nav-above', 'engagement-bar-above', 'viewport-corner-right']`：优先水平居中停在 `[data-e2e="anchoring-scroll-controls"]` 内 `feed-navigation-prev`（或 `feed-navigation-next` / 容器本身）正上方 8px；缺少导航控件时居中停在 `[data-e2e="anchoring-engagement-vertical"]` 正上方 8px；仍无则停在右下角。
   - 排除左下角 `anchoring-description-layer` / `cinema-creator-identity` / `cinema-creator-avatar` 内的头像，防止污染经典 `findActiveFeedAvatar`。
   - `placeAtModalPrevArrow` 改为按 `['[data-e2e="arrow-left"]', '#arrow-left', '[data-e2e="arrow-right"]', '#arrow-right']` 取第一个可测量箭头，复用统一的水平居中对齐辅助函数，保证在所有视口宽度内左右不越界。
2. **竞品避让与动态重排（`coexist.ts` + `index.ts` + `menu.ts`）**
   - `RIVAL_SELECTORS` 补充 `'[data-placement*="navigation-action"]'`，与 `#creatok-video-trigger` 共同纳入检测；当竞品已停在导航箭头或作者头像上方时，OmniMux 自动向上顺延 8px（不写竞品 DOM）。
   - `index.ts` 增加被动 `transitionend` 监听并在 `dispose()` 中解绑，确保评论抽屉等 CSS 平滑展开/收起动画结束时锚点重新贴齐最终位置。
   - `menu.ts` 的 `menuWidth()` 优先读取不受收起态 `scale(0.97)` 缩放影响的 `menu.offsetWidth`（未布局时再回退 `getBoundingClientRect().width` 与 `MENU_FALLBACK_WIDTH_PX`），消除向左展开时右缘压住触发圆钮 5px 的错位。
3. **活跃作品解析修复（`active-post.ts`）**
   - 当中心卡片自身不含 `data-more-menu-item-id` 与作品链接时，读取可见的同级 `[data-e2e="anchoring-chrome-host"]` 中的作品 ID 与作者 handle，结合卡片类型（含后代 `feed-video` / `feed-photo` 判定）合成规范 URL。
   - 同时支持卡片内及兜底路径中高度为 0 但父容器可见的 `xgwrapper-` / `xgmedia-` 节点。

## 假设

1. 根因假设：TikTok 新版影院流将导航箭头收入 `[data-e2e="anchoring-scroll-controls"]`、将作者头像移至左下角简介层、将作品 ID/作者移至同级 `[data-e2e="anchoring-chrome-host"]` 并让 `xgwrapper` 高度归零，同时弹窗用 `data-e2e="arrow-left"/"arrow-right"` 替代 `#arrow-left`，导致现有锚点链与作品解析均命中错误目标或返回空值。
2. 修复假设：在 `anchor.ts` 中以 `anchoring-scroll-controls` / `anchoring-chrome-host` 识别 `'cinema-feed'` 并在 `feed-navigation-prev` 上方居中锚定、在弹窗兼容 `data-e2e` 箭头选择器、在 `active-post.ts` 关联可见 `anchoring-chrome-host` 与 0 高度播放器，即可在全场景下使触发器准确位于竞品上方 8px、保持经典单作品页/关注页不回归，并恢复首页推荐流下载与入库能力。

## 证伪方式

1. 真实 Chromium 未打包扩展加载验证：在 `extension-e2e.mjs` 驱动的真实 Chrome 中加载工作树构建出的 `extension/dist`，分别对新版 Cinema 推荐流（宽屏/评论展开/窄屏竖屏、含与不含竞品）、Browse 弹窗（首条与第二条视频）以及经典直开单作品页进行注入与交互验证，断言触发器几何坐标严格位于目标箭头/竞品上方 8px 且零重叠、悬停菜单向左展开不出屏、快捷动作解析到正确作品 URL；若任一场景落在左下角头像、压住箭头/竞品或返回 `noTarget`，则假设不成立。
2. 双向证伪回归测试：执行 `cd plugins/plugins/omnimux-browser/extension && corepack pnpm test` 与 `corepack pnpm --filter omnimux-browser test`；将上述核心源码修改临时回退至 `origin/main` 后重跑新增回归测试，确认新增测试用例均真实断言失败，恢复后全绿。

## 验收标准

- **AC-1**：Cinema 首页/For You（桌面宽屏、评论抽屉展开、窄屏与竖屏）有竞品时，OmniMux 位于竞品正上方 8px 且水平对齐，不改写竞品 DOM；无竞品时位于 `feed-navigation-prev` 正上方 8px。
- **AC-2**：Cinema 推荐流缺失 `anchoring-scroll-controls` 时，退至右下 `anchoring-engagement-vertical` 正上方 8px，绝不落回左下角 24×24 作者头像上方。
- **AC-3**：Browse 弹窗无论显示 `[data-e2e="arrow-left"]`、`#arrow-left` 还是首条仅显示 `[data-e2e="arrow-right"]`，均对齐最上方可见箭头并叠加在竞品上方 8px，不与导航箭头重叠。
- **AC-4**：直开单作品页与 `/following` 保持经典右侧 `SectionActionBarContainer` 作者头像上方锚定（有竞品时位于竞品上方 8px），不受影响。
- **AC-5**：触发器位于右侧列时悬停工具栏自动向左展开，完整留在视口内且不遮挡触发圆钮。
- **AC-6**：Cinema 推荐流视频卡与图文卡在点击下载/原声/入库时均能从 `anchoring-chrome-host` 或 0 高度 `xgwrapper` 正确解析规范 URL，不再误报 `noTarget`。
