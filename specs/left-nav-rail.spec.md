# 左侧固定导航轨与首页专属 Agent 会话栏改造规格

## 1. 背景与问题定义

当前 OmniMux 桌面端与 Web 端沿用单层可折叠左侧栏（由宿主 `@deepseek-ai/dsh-client-ui-sidebar` `SidebarRoot` 与插件侧 `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`、`sidebar-panel-chrome.js`、`sidebar-toggle-topbar.js` 协同驱动）：

1. **一级导航与会话树混排抢占空间**：`项目`、`技能/专家`、`资产库`、`灵感社区`、`更多` 与 `新对话 / 新建项目` 按钮全部挂在 `nav[class*="panelList"]` 上方，挤占会话工作区树的首屏展示，底部又叠加 `应用更新`、`远程控制` 与 `设置`，整体信息密度过载。
2. **折叠后导航失联**：用户点击顶栏折叠钮收起会话栏后，所有一级业务入口随会话栏一并消失（仅剩顶栏折叠钮与新建会话钮），无法从任意工作台直接横向切换模块。
3. **跨模块切换耦合历史会话栏**：切换到 `项目`、`资产库`、`灵感社区` 等全宽工作台时，左侧会话栏与「新建项目」动作的职责与主工作台脱节，缺乏独立的「首页 = Agent 会话工作区」中心锚点。

## 2. 对标研究与决策依据

### 2.1 对标对象与可核查来源

- **OmniMux 现有侧栏基线**：
  - `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`（当前将 `omnimux-workflow`、`omnimux-market`、`omnimux-assets`、`omnimux-inspiration` 挂载至 `panelList`，将 7 项以上工具与开发版 Alpha 项收敛至「更多」菜单）。
  - `plugins/plugins/omnimux/src/client/workbench/sidebar-activation.js`（单激活位仲裁：会话优先，其次右侧工作台聚焦页签）。
  - `specs/sidebar-rc5-layout-align.spec.md` 与 `specs/fix-next-shell-three-column-layout.spec.md`（记录 Next 壳 `AppFrame` 与 Legacy 壳三栏栅格及 `dsh-better-sidebar` 全屏/分屏约束）。
- **同类工作台参考（Codex Desktop 双层左侧栏范式）**：
  - 最左侧独立窄导航轨常驻窗口全生命周期，承担全局模块切换与底部系统设置；次级宽栏仅服务于工作区与会话树，切入独立工具面板或设置视图时聚焦主内容区，收起会话栏时顶栏仅暴露展开钮与新建对话钮。

### 2.2 已对齐的 9 项核心设计决策

| 编号 | 决策项 | 选定方案与取舍理由 |
| --- | --- | --- |
| D1 | 双栏联动结构 | 最左侧新增 `52px` 固定纯图标窄轨；**仅「首页」展示第二层 Agent 工作区会话栏（`264px`）**，切到业务模块（项目、技能/专家、资产库、灵感社区及「更多」子页）自动收起次级栏让内容区占满，并保留页内拉出对话分屏能力。 |
| D2 | 固定轨一级入口顺序 | macOS 顶栏安全区下方首位直放：**首页（对话）** → **项目** → **技能/专家** → **资产库** → **灵感社区** → **更多（`…`）**，这 6 项固定不变；官方「插件」「自动化任务」与扩展工具（应用、图像生成、视频剪辑、指纹浏览器、跟爆选品及开发版 Alpha 项）保留在「更多」右侧弹出浮层，支持由用户按需从「更多」固定到左侧栏「更多」下方快捷区。 |
| D3 | 底部全局系统入口 | 原会话栏底部的 **应用更新**（有更新时带提示点）、**远程控制**、**账号设置** 全部迁入固定左侧栏底部（纯图标 + Tooltip）；次级 Agent 会话栏底部清空，保证任意业务页面均可一键触达系统配置。 |
| D4 | 首页次级会话栏精简 | 顶部保留 `OmniMux` 品牌标识，下方仅保留满宽 **「新对话」** 按钮与 Agent 工作区会话树；原并排的 **「新建项目」** 按钮移出首页会话栏，收口至固定轨 **「项目」** 页内，消除入口职责交叉。 |
| D5 | 固定轨视觉形态与品牌位 | `52px` 纯图标窄轨 + 右侧悬停 Tooltip；红绿灯下方首位直接放置 **「首页」** 图标（不在窄轨顶部另放重复 Brand Logo），`OmniMux` 品牌标识留在首页次级会话栏顶部标题位。右侧竖向分隔线与栏内横向分隔线均采用 `0.5px` `--dsw-alias-border-l2-darkmode-thin`（回退 `--dsw-alias-border-l1`）柔和描边，竖线上下内缩并对齐最上方与最下方图标按钮外边缘（不贯通红绿灯安全区与窗口底边）。 |
| D6 | 「首页」点击与折叠钮状态机 | 点击固定轨「首页」始终幂等：退出全屏业务页/全局面板回到 Agent 对话并**确保展开**会话栏（已在首页时不误触收起）；折叠/展开仅走顶栏折叠钮（macOS 红绿灯右侧）与快捷键；进入非首页业务页时同步隐藏次级栏与顶栏折叠钮。 |
| D7 | 首页收起态快捷入口 | 在首页手动收起会话栏后，顶栏折叠钮右侧出现 **「新对话」** 图标钮（`[红绿灯] [展开会话栏] [新对话]`），最左 `52px` 固定轨保持纯粹导航。 |
| D8 | 分屏模式配合 | 对话 + 右栏工作台分屏时，固定轨高亮 **「首页」**（延续会话优先仲裁规则）；次级会话栏默认收起以让渡工作台宽度，顶栏保留折叠钮供用户按需拉出会话栏。 |
| D9 | 「更多（`…`）」激活态与落地边界 | 固定轨上方 6 项核心图标保持锁定不变；从「更多」打开未固定子页或官方面板时高亮 **「更多（`…`）」** 图标，再次展开「更多」浮层时内部对应行标出选中态。实现全部落在插件层（`plugins/plugins/omnimux` 与 `plugins/packages/dsh-ui-kit`），不改动只读的 `app/deepseek-harness`，兼容 Legacy / Next 双桌面壳与 Web；窄屏（`< 768px`）保持 `52px` 固定轨常驻，首页会话栏从其右侧（`left: 52px`）抽屉滑出。 |
| D10 | 「更多」菜单入口固定与取消固定 | 参考图 2，在「更多」弹出菜单的每个可导航业务入口（官方面板白名单 `自动化任务`/`插件`、内置工具及运行时动态插件 `跟爆选品` 等，不含顶部一次性动作 `浏览更多插件`/`创建你的插件`）提供右侧图钉按钮：未固定项仅在鼠标悬停或键盘聚焦行时显现空心图钉，点击即固定且**保持菜单不关闭**（不弹冗余 Toast）；已固定项即使未悬停也常显实心图钉，再次点击即可取消固定。存在任意可用固定项时，固定轨「更多（`…`）」正下方出现水平分隔线与可纵向滚动的 `36×36` 快捷入口图标（支持右键弹出「取消固定」菜单）；当前页属于已固定入口时直接高亮左侧栏该固定图标而非「更多」。固定顺序持久化于 `localStorage`（`omnimux:nav-rail:pinned-more:v1`），兼容异步注册延迟挂载与正式版/开发版渠道过滤。 |

## 3. 信息架构与交互状态机

| 当前场景 | 固定左轨（52px）高亮 | 次级会话栏（264px） | 顶栏左侧控件（x ≈ 84px） | 主工作区宽度范围 | 底部系统动作可达性 |
| --- | --- | --- | --- | --- | --- |
| 首页（默认展开） | 首页 | 展开显示（品牌 + 新对话 + 会话树） | 折叠会话栏钮 | `100vw - 52px - 264px` | 固定轨底部直达 |
| 首页（手动收起） | 首页 | 隐藏 | 展开会话栏钮 + 新对话钮 | `100vw - 52px` | 固定轨底部直达 |
| 首页（分屏：对话 + 右栏工作台） | 首页 | 默认收起（可手动点击展开） | 折叠/展开会话栏钮（收起时含新对话钮） | 对话列 + 右栏工作台平铺 `100vw - 52px`（展开时减去 `264px`） | 固定轨底部直达 |
| 首页（窄屏 `< 768px`） | 首页 | 默认收起；展开时从 `left: 52px` 抽屉滑出并带遮罩 | 展开会话栏钮 + 新对话钮 | `100vw - 52px` | 固定轨底部直达 |
| 一级直出业务页（项目 / 技能专家 / 资产库 / 灵感社区） | 对应入口图标 | 自动隐藏 | 隐藏（不留空按钮） | `100vw - 52px` 全宽占用（支持页内「展开对话分屏」） | 固定轨底部直达 |
| 「更多」子页或官方面板（未固定，如插件 / 自动化任务 / 未固定工具） | 更多（`…`）图标 | 自动隐藏 | 隐藏 | `100vw - 52px` 全宽占用；点开「更多」内部对应项标为当前态 | 固定轨底部直达 |
| 「更多」已固定入口页（点击固定快捷图标或「更多」内已固定项） | 对应已固定快捷图标 | 自动隐藏 | 隐藏 | `100vw - 52px` 全宽占用；点开「更多」内部对应项仍标为当前态且常显实心图钉 | 固定轨底部直达 |

### 关键交互迁移细节

1. **幂等「首页」触发**：
   - 若当前处于全屏业务 Tab（`omnimux-workflow:library`、`omnimux-market:plaza`、`omnimux-assets:library`、`omnimux-inspiration:library` 或「更多」子页）或官方全局面板（`plugins` / `schedules`），点击固定轨「首页」先退出全屏/切回对话视图（`selectPanel(null)` / 收起全屏右栏 / 清空 `data-dsh-product-stage`），并强制展开次级会话栏。
   - 若当前已在首页且会话栏已收起，点击「首页」展开会话栏；若已在首页且会话栏已展开，保持展开不变（不闪烁、不折叠）。
2. **「新建项目」收口**：
   - 移除 `omnimux-workflow` 在会话栏注册的 `kind: 'inline'` 并排「新建项目」按钮；保留 `ProjectLibraryPage` 页头内的「新建项目」主动作与空状态引导。
3. **「更多」浮层锚定与材质**：
   - 锚点从原会话栏 `panelList` 末行迁移至固定轨「更多（`…`）」图标按钮，弹出位置紧贴固定轨右侧（`left: 52px + 8px`），菜单顶边与「更多」按钮对齐且钳制在视口内；保持实体不透明底色（`--dsw-alias-bg-layer-2`），按白名单区分正式版与开发版（开发版展示带 `Alpha` 独立胶囊的测试项）。

## 4. 阶段 2 技术实现蓝图（待演示确认后实施）

1. **禁止修改范围**：`app/deepseek-harness/` 只读不改；所有视觉令牌继续消费 `dsh-ui-kit` 与宿主 `--dsw-alias-*` / `--dsw-specific-sidebar-*` / `--omnimux-motion-*`。
2. **新建 `plugins/plugins/omnimux/src/client/nav-rail.js`（含独立单测 `nav-rail.test.js`）**：
   - 在 `installHubChrome(ctx)` 生命周期内挂载固定 `52px` 导航轨容器（`data-omnimux-nav-rail="1"`）并在 `document.documentElement` 设置标记（`data-omnimux-nav-rail-active="1"`，暴露 `--omnimux-nav-rail-width: 52px`）。
   - CSS 偏移策略：将 `#root`（Next `.frame` 与 Legacy `.dshDesktopFrame`）、全屏右栏面板（`[data-dsh-better-sidebar] [data-sidebar-right-panel="fullscreen"]`）、`[data-slot="shell.overlay"]` 产品舞台及浮动输入框投射坐标左基准统一切换为 `var(--omnimux-nav-rail-width, 52px)`；非首页全屏页顶栏左侧须避让跨出 `52px` 轨的 macOS 绿色红绿灯（起始内容左界 `x >= 84px`，即主区左内边距 `>= 32px`）；保证窄屏抽屉 `[data-sidebar-drawer] .sidebarCol` 从 `left: 52px` 滑出。
   - 底部系统动作桥接：隐藏原会话栏内 `.footArea` 冗余内容或通过代理/Portal 迁入固定轨底部（更新提示角标、远程控制弹窗触发、设置模态打开），保持 `ctx.slots` 原始注册不中断旧宿主兼容。
3. **改造 `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`**：
   - 一级固定入口不再往 `nav[class*="panelList"]` 插入 `.omnimux-sidebar-nav-entry` DOM 行，改为注册至固定导航轨条目表；同步下线 `placeInline` 中首页并排「新建项目」样式与折叠菜单分流。
   - 收起态下 `nav[class*="panelList"]` 与官方冗余行全部收敛后，次级会话栏彻底回归「品牌 + 新对话 + 工作区会话树」。
4. **改造 `plugins/plugins/omnimux/src/client/workbench/sidebar-activation.js` 与 `sidebar-controller.js`**：
   - 仲裁输出扩展固定轨目标映射：`winner === 'session'`（含对话 + 右栏分屏态）→ 固定轨高亮 `home`；`winner === 'row'` → 若为一级直出 `tabId` 则高亮对应图标，若属于 `EXPLORE_MENU_ITEMS` / `EXTRA_EXPLORE_ITEMS` / 官方面板（`plugins` / `schedules`）则固定轨高亮 `more` 并向「更多」菜单传递 `activeItemId`。
   - 从首页切入直出业务 Tab 或「更多」子页时自动设置次级会话栏为收起态并隐藏顶栏折叠钮；切入分屏模式时默认收起次级会话栏但保留顶栏折叠钮可见；点击「首页」幂等展开会话栏。
5. **改造 `plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.js`**：
   - 在 macOS 红绿灯右侧（`x ≈ 84px`）固定计算折叠钮与收起态「新对话」钮位置（补偿 `52px` 固定轨后的 tabBar 安全内边距）；在非首页全屏业务态下自动隐藏折叠钮与「新对话」钮。
6. **改造 `plugins/plugins/omnimux/src/client/explore-more-menu.jsx` 与 `sidebar-panel-chrome.js`**：
   - 由固定轨「更多」按钮直接驱动官方 `sidebar.panellist.actions` 菜单内容或同源弹出层；保留官方「插件」「自动化任务」与探索清单真源，补充当前选中项高亮标记。
7. **并排新建项目收口策略（`sidebar-coordinator.js` 集中接管，向后兼容）**：
   - 在固定轨激活态（`html[data-omnimux-nav-rail-active="1"]`）下由 `sidebar-coordinator.js` 的 `placeInline()` 集中拆掉首页并排 `[data-omnimux-inline-row]` 并隐去内联「新建项目」按钮，保持 `omnimux-workflow/src/client/sidebar-new-project.js` 注册链路与 `ProjectLibraryPage` 页内「新建项目」不变，未启用固定轨时仍可平滑回退。
8. **协同改造与回归测试文件清单**：
   - 主控、固定状态与 chrome 装配：`plugins/plugins/omnimux/src/client/nav-rail.js`、`nav-rail-pins.js`、`chrome.js`。
   - 协调与几何联动：`sidebar-coordinator.js`（新增 `subscribeExploreItems` 支撑动态插件注册同步）、`workbench/sidebar-activation.js`、`workbench/geometry.js`、`explore-more-menu.jsx`、`sidebar-panel-chrome.js`、`sidebar-toggle-topbar.js`、`conversation-box.js`、`conversation-collapse.js`、`rightbar-collapsed-fill.js`。
   - 单元与真实浏览器 E2E 测试：`nav-rail-pins.test.js`、`nav-rail.test.js`、`nav-rail.e2e.test.js`、`explore-more-menu.test.js` 及上述联动模块单测。
9. **契约与回归门禁同步**：
   - 更新 `plugins/docs/contracts/client-window-seams.md` 中 `__omnimuxSidebar` 接口说明（补充 `activatePinnedEntry`）。
   - 跑齐 `verify-next-shell-selectors.mjs`、`verify-dsw-tokens.mjs`、`verify-silent-catch.mjs`、`verify-anti-slop.test.mjs`、`three-column-layout-contract.test.js`、`sidebar-coordinator.test.js`、`sidebar-toggle-topbar.test.js`、`sidebar-rc5-layout.e2e.test.js` 与隔离工作树真实浏览器多视口验证。

## 5. 假设、证伪方式与验收标准

### 5.1 假设

当固定 `52px` 左侧导航轨承载全部一级业务切换、「更多」入口及底部系统动作，且次级 `264px` 栏收敛为仅「首页」专属的 Agent 会话栏后：
1. 任意页面切换一级功能模块均为单次点击直达，不再依赖先展开旧会话栏；
2. 首页会话栏不再被导航入口与底部设置挤占，首屏工作区会话树可见行数明显增加；
3. 非首页业务工作台（项目 / 技能专家 / 资产库 / 灵感社区 / 更多子页）天然独占 `100vw - 52px` 宽度，且分屏态下默认收起次级栏保障对话与右栏可用空间。

### 5.2 证伪方式

在真实 Chromium（覆盖 `1440×900` 桌面宽屏与 `720px` 窄屏、亮/暗双主题、无全局盒模型重置）中对演示及后续真实产物实测以下不变量，任一项失败即推翻实现：
1. 任一业务页（项目 / 技能专家 / 资产库 / 灵感社区 / 更多子页）激活时，次级会话栏宽度 > `0px` 或顶栏仍暴露折叠/展开钮；
2. 点击「首页」图标两次，第二次错误将已展开的会话栏收起；
3. 打开「更多」子页后，固定轨出现第 7 颗动态图标，或「更多（`…`）」图标未高亮，或浮层出现半透明底透字；
4. macOS 红绿灯安全区（`x: 16..68, y: 0..48`）与固定轨首颗「首页」图标或顶栏折叠钮产生碰撞重叠；
5. 对话 + 右栏分屏态下，固定轨错误高亮为右侧模块图标而非「首页」，或次级会话栏未默认收起导致对话列被压扁。

### 5.3 验收标准

- **AC-1 固定轨布局与红绿灯避让**：`52px` 固定导航轨全生命周期常驻，上区严格按「首页 → 项目 → 技能/专家 → 资产库 → 灵感社区 → 更多」排列 6 颗图标，下区放置「应用更新（带角标）→ 远程控制 → 账号设置」，首颗图标起始于顶栏 `48px` 安全线之下，亮/暗双主题对比度达标；右侧竖向与栏内横向分隔线均为 `0.5px` 柔和细线，且竖线上/下端点精确对齐顶部与底部按钮外缘。
- **AC-2 首页专属会话栏与极简结构**：仅「首页」显示 `264px` 次级会话栏；顶部保留 `OmniMux` 品牌标识与满宽「新对话」按钮，底部清空，不再渲染「新建项目」或一级导航行。
- **AC-3 幂等回首页与顶栏折叠联动**：在首页手动收起会话栏后，顶栏仅在红绿灯右侧展示 `[展开会话栏] [新对话]`；从任意页面点击固定轨「首页」幂等返回对话并展开会话栏。
- **AC-4 业务全屏与页内新建项目**：切入「项目」「技能/专家」「资产库」「灵感社区」及「更多」子页时自动隐藏次级会话栏与顶栏折叠钮，主区占满 `100vw - 52px`；「新建项目」可在「项目」页内直接完成。
- **AC-5 「更多」右侧弹出与选中态**：「更多」菜单在固定轨右侧实底弹出且顶边对齐，内部清晰分隔官方面板（插件、自动化任务）与扩展工具（支持正式版/开发版渠道过滤）；子页打开时固定轨高亮「更多（`…`）」，重开菜单内对应项呈选中态。
- **AC-6 分屏协同**：在首页或业务页触发对话 + 右栏工作台分屏后，固定轨高亮「首页」，次级会话栏默认收起留出分屏宽度，顶栏折叠钮可用并支持手动拉出会话栏。
- **AC-7 窄屏抽屉**：视口窄屏（`< 768px`）下 `52px` 固定轨常驻，首页点击展开钮后会话栏从 `left: 52px` 抽屉式滑出，点击遮罩或按 `Esc` 收起。
- **AC-8 无障碍与品味门禁**：所有图标按钮具备可访问名称与清晰 `:focus-visible` 焦点环，点击热区达标，界面零中点 `·`、零 Emoji 图标、零 `transition: all`、支持 `prefers-reduced-motion` 且无横向溢出。
- **AC-9 「更多」菜单固定到左侧栏**：
  1. 未固定的可固定菜单项默认隐藏图钉，悬停或键盘聚焦行时在右侧居中显现空心图钉（与分组分隔线及 `Alpha` 标识互不重叠），点击后立刻切换为常显实心图钉并保持「更多」菜单打开。
  2. 存在 ≥1 个可用固定项时，「更多（`…`）」按钮正下方展示水平分隔线与对应顺序的 `36×36` 快捷入口图标（支持 Tooltip 与超长可内部滚动，不挤出底部系统入口）；无固定项时不显示空分隔线。
  3. 点击固定快捷图标可一键进入对应业务页或官方面板，且直接高亮该固定图标（互斥取消「更多」高亮）；通过再次点击实心图钉或右键固定图标选择「取消固定」移除后，高亮平滑交还「更多」。
  4. 固定列表按操作顺序持久化到 `localStorage`，兼容延迟 `registerExploreItem` 插件挂载与正式版/开发版 Alpha 渠道过滤，降级菜单保持同源能力。
