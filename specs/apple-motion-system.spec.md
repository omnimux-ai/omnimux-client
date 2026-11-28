# 全仓 Apple 级动效与状态变化统一系统规范（Issue #421）

## 背景与问题定义

针对 OmniMux 客户端单仓（`dsh-ui-kit`、Hub 壳层 `omnimux`、工作流画布 `omnimux-workflow`、10 个业务插件、浏览器扩展 `omnimux-browser`、剪辑桥接层 `omnimux-clip` 及桌面双壳 `dsh-desktop-next` / `dsh-plugin-desktop`）按 **12 类状态变化**（出现、消失、移动、变大小、换内容、换图标、数值跳动、按下、悬停、加载、完成、出错）进行全仓审计，发现以下系统性问题：

1. **动效语言分裂**：全仓混用 17+ 种 `cubic-bezier(...)`（含画布手柄过冲弹跳 `(0.34, 1.56, 0.64, 1)`、Material `(0.4, 0, 0.2, 1)`、Expo-out `(0.16, 1, 0.3, 1)` 及裸 `ease`/`ease-out`），且上游 450 个 `--dsw-*` 主题 Token 不含动效语义且门禁禁止新增未定义 `--dsw-*`。
2. **直接操作拖影与性能隐患**：全仓存在 180+ 处 `transition: all` / `transition-all`（含可拖拽改宽的 `AssetsDrawer` 内 14 处）；画布分组框 `.wf-group-node` 在 `pointermove` 拖拽缩放期对 `width/height` 做 `0.2s` 过渡；媒体查看器 `.omx-mv-display` 在拖拽缩放期对 `transform` 做 `0.05s linear` 过渡；停靠输入框在分割拖拽期对 `left/width` 做 `200ms` 过渡；市场/PiBrowse/桌面端进度条与脉冲动画过渡 `width` / `margin-left` 引发重排；节点手柄常驻 5 属性 `will-change`。
3. **关键状态硬切与实现缺陷**：
   - `dsh-ui-kit` `Drawer` 声明了 `transition: transform 240ms`，但渲染直接 `if (!open) return null` 且无离屏初始位移，导致所有抽屉实际瞬移，并存在遮罩 `backdrop-filter` 与 `opacity` 动画叠加风险。
   - `Tabs`（`pill` 与 `underline`）选中指示器瞬移，且激活态切换 `font-weight: 500 -> 600` 引发横向宽度抖动。
   - `PageHeader` 刷新按钮手动切为静态 `<IconLoadingOutline16 />` 且漏传 `loading={refreshing}`，导致刷新旋转图标冻死。
   - `CopyButton`、`SelectableTile`、`SearchField`、`SocialSearchToolView` 图标/勾选硬切，且复制文案变化（`复制` → `已复制`）造成按钮宽度跳动。
   - 全仓存在 7 处未定义或冲突 `@keyframes`（`omx-pop`、`omx-fade-in`、`wf-fade-in`、`wfCustomSelectFadeIn`、`omni-fade-in`、`omnimux-rival-skel-pulse`、重复 `wf-popover-in`）、居中 Toast 位移覆盖（`.omnimux-toast-pill`）、全屏背景遮罩被 `scale` 缩放（`CreativeDimensionModal`）、`AuthorizeModal` 折翼图标硬切、发布表行过渡挂在 `tr` 而背景色改在 `td` 等缺陷。
4. **`prefers-reduced-motion` 覆盖断裂与假死**：多个业务插件、`dsh-plugin-desktop` native-ui 主题与 `welcome.css` 缺失减弱动态规则；`omnimux-browser/extension/src/panel/styles.css` 在第 3530 行的全局 `reduced-motion` 规则被后续 7 条 `!important` 声明覆盖；`Button.module.css` 在减弱动态下将加载转圈设成 `animation: none` 导致加载态看似卡死。

## 统一动效语言（`--omnimux-motion-*` 单一真源）

严禁定义或发明未在宿主注册的 `--dsw-*` Token；全仓统一通过 `dsh-ui-kit` 注入与跨边界 CSS 变量回退使用 `--omnimux-motion-*`（所有无状态/孤立上下文携带字面量 fallback）：

| Token | 值 | 物理职责 |
|---|---|---|
| `--omnimux-motion-ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 瞬发微交互、悬停/按下、浮层/菜单/弹窗/提示入场及原地淡出 |
| `--omnimux-motion-ease-spatial` | `cubic-bezier(0.32, 0.72, 0, 1)` | 临界阻尼空间位移（Tabs 滑块、Drawer 抽屉、Switch 拇指、折叠展开、轮播） |
| `--omnimux-motion-ease-exit` | `cubic-bezier(0.32, 0, 0.67, 0)` | 仅限 Drawer / Toast 离开视口边缘的加速退场（禁用于原地淡出） |
| `--omnimux-motion-ease-linear` | `linear` | 连续旋转加载圈与线性进度条 |
| `--omnimux-motion-dur-press` | `90ms` | 按下缩放、悬停色彩/描边、单复选响应、右键/下拉菜单快速收起（`90–100ms`） |
| `--omnimux-motion-dur-fast` | `140ms` | Popover/Menu/Tooltip 入场、`IconSwap`（`150ms`）、开关/按钮过渡、Modal 退场 |
| `--omnimux-motion-dur-base` | `200ms` | Tabs 滑块、Modal 入场、手风琴展开、Drawer 退场（`190ms`） |
| `--omnimux-motion-dur-sheet` | `260ms` | Drawer 与大面板入场（桌面交互硬上限 `280ms`） |
| `--omnimux-motion-press-scale` | `0.96` | 按钮与图标按钮按压反馈（下限不低于 `0.95`） |
| `--omnimux-motion-press-scale-subtle` | `0.985` | 大型可选卡片按压反馈 |

- **`prefers-reduced-motion: reduce` 策略**：将 `--omnimux-motion-dur-press/fast/base/sheet` 折叠为 `0ms`，`--omnimux-motion-press-scale` / `--omnimux-motion-press-scale-subtle` 折叠为 `1`；严禁任何 `infinite` 动画引用会被折叠为 `0ms` 的时长变量；不定长加载圈由旋转降级为低频柔和呼吸（`1.6s ease-in-out infinite`，`opacity: 0.42 <-> 1`），绝不冻死；禁用位移、缩放、模糊、背景飘动与 JS 平滑滚动。

## 12 类状态变化编排与禁动红线

1. **出现**：Popover/Menu 用 `@starting-style` 或 `@keyframes`（带 `--omnimux-motion-origin` 锚向微位移 `4px` + `scale(0.96 -> 1)`，`140ms --omnimux-motion-ease-out`）；Modal 遮罩淡入 `140ms`、面板 `scale(0.97 -> 1)` `200ms`；Drawer `translate3d` `260ms --omnimux-motion-ease-spatial`。浮层稳态严禁 `opacity < 1` 或 `backdrop-filter`（遵守 `guard-no-transparent-popover.mjs`）。
2. **消失**：退场时长 `<= 75%` 入场；Popover/Menu 用 `@keyframes ... forwards` `100ms` 退场；Drawer 在 `open=false` 首帧即置 `pointer-events: none` 并立即归还焦点与滚动锁（焦点与滚动锁绑定 `open` 而非 `mounted`），退场 `190ms`。
3. **移动**：Tabs 滑块使用 `translate3d(var(--ind-x), 0, 0)` + `width`（禁用 `scaleX` 防圆角变形）及 `data-indicator="ready"` 下一帧开启动画（防止首帧飞入并保留隐藏态/`JSDOM` 兜底）；画布拖拽/节点移动/视口平移缩放 **0ms 零过渡**。
4. **变大小**：折叠区用 `grid-template-rows` 过渡；所有鼠标拖拽改尺寸（`.wf-group-node`、可拖宽 `AssetsDrawer`、停靠输入框、分割栏拖拽）**严禁对几何属性写 `transition`**。
5. **换内容**：轻提示淡入 `120ms`；高频 Tab 主体、流式文本、实时搜索过滤 **0ms 直出**；文案切换通过 CSS Grid 幽灵槽锁定宽度，防按钮左右跳动。
6. **换图标**：`IconSwap` 双层叠放纯 GPU 合成 `scale(0.65 -> 1) + opacity`（`150ms --omnimux-motion-ease-out`，**禁止 `blur()`**）；`PageHeader` 刷新保持单图标连续旋转，不切静态图标。
7. **数值跳动**：全仓指标、表格数值、倒计时/步数与徽标计数统一加 `font-variant-numeric: tabular-nums`；`AnimatedNumber` 仅限同指标实时增量显式 Opt-in（`180ms`），普通筛选与静态看板直接刷新。
8. **按下**：按钮与图标按钮 `:active` `scale(var(--omnimux-motion-press-scale))` `90ms`（提供 `staticScale` 退出开关）；表格整行、纯文本链接、Tab 项、拖拽手柄与画布节点本体**不缩放**。
9. **悬停**：仅限 `background-color`、`border-color`、`color` 与浮现按钮 `opacity`（`90–140ms`）；键盘方向键列表导航高亮必须 **0ms 瞬切**。
10. **加载**：保留几何占位；无旋转冻死，旋转图标与 GPU `transform` 进度波在 `reduced-motion` 下均有对应安全降级；`omnimux-market` / `omnimux-pibrowse` 进度条改用合成层 `transform`。
11. **完成**：`SelectableTile` / `DataTable` 复选框 SVG `stroke-dashoffset` 描边（`180ms`）+ 单选圆点缩放（`160ms`）；`CopyButton` 原地切换绿勾与等宽文案 `2000ms` 回弹，UI 已直观呈现变化时不叠成功 Toast（遵守 Show, Don't Tell）。
12. **出错**：表单错误行与非布局抖动提示就地呈现原因与重试路径，不阻断已有局部内容；`omnimux-analytics` 热力图提示悬浮不引起下方卡片布局跳动。

## 假设

1. 将动效语言收敛为 `--omnimux-motion-*` 语义变量（3 条物理曲线 + `linear`、4 档时长）并在 `dsh-ui-kit` 提供可打断原语（`usePresence`、`IconSwap`、`AnimatedNumber`、防抖动滑块 `Tabs`、连续旋转刷新按钮与无 width 跳动的 `CopyButton`）后，真实 Chromium 实测在 `1440×900` 与 `390×844`、亮暗双主题下的状态切换均可达到 `CLS === 0`、交互中位帧率 `>= 55fps`，且 `Tabs` 切换激活标签宽度变化 `<= 0.5px`、`CopyButton` 复制态按钮宽度变化为 `0px`。
2. 全仓清除所有受管源码中的 `transition: all` / `transition-all`、修复 7 处失效/冲突 `@keyframes`、消除拖拽缩放热路径（`.wf-group-node`、`.omx-mv-display`、`AssetsDrawer`、进度条 `margin-left`/`width`）的布局过渡，并修复 `prefers-reduced-motion: reduce` 覆盖失效后，可在保持全部现有门禁（`verify-dsw-tokens`、`guard-no-transparent-popover`、`guard-ui-rules`）与单测契约全绿的前提下，通过新增自动化静态门禁校验且无新增性能或可访问性回退。

## 证伪方式

1. **静态动效契约门禁（`plugins/scripts/verify-motion-contract.test.mjs`）**：扫描全仓受管前端源码（`dsh-ui-kit/src`、`plugins/plugins/*/src/client`、`omnimux-workflow/src/canvas`、`omnimux-browser/extension/src`、`app/dsh-desktop-next/src`、`app/dsh-plugin-desktop/src`），任一文件残留 `transition: all` / `transition-all`、引用未定义 `@keyframes`、存在动画/过渡却缺失 `@media (prefers-reduced-motion: reduce)`，或在 `omnimux-browser/extension/src/panel/styles.css` 的减弱动态规则之后再出现 `!important` 过渡覆盖，立即失败退出。
2. **真实 Chromium E2E 几何与帧率探针（`plugins/tests/e2e/apple-motion-system.e2e.test.mjs`）**：在真实无头 Chrome 中分别以 `1440×900` / `390×844`、亮/暗双主题、正常/`prefers-reduced-motion: reduce` 驱动高保真演示与实际工作树构建页面，校验 Drawer 可打断开关（退场即 `pointer-events: none`）、Tabs 滑块跟随与激活态零字宽跳动、CopyButton 零宽度跳动、PageHeader 刷新持续旋转及减弱动态下切为柔和呼吸、500 行列表与交互过程 `PerformanceObserver` `CLS === 0` 且 rAF 中位帧率 `>= 55fps`。
3. **全仓构建与既有测试门禁矩阵**：按顺序执行 `dsh-ui-kit check`、`build:all`、`bundle-lock.mjs`、`workspace-check.mjs --check`、`verify:dsw-tokens`、`guard:popover`、`test:ui`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`verify:slots`、`verify:plugin-load`、`test:all`、`presets:verify`、`app` `typecheck` & `test` 及 `test:worktree-web`，任一报错即阻塞交付。
