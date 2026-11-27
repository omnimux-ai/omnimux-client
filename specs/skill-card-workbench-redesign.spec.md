# Spec: Skill Card Workbench Redesign (Issue #410)

## 假设

将 Skill Plaza（`omnimux-market`）以及同源会话引导/首页探索卡片（`omnimux` / `omnimux-inspiration`）升级为「氛围微光 + 常驻左对齐工作台卡」并独立作用域隔离 CSS 后：
1. 消除非法属性 `inset-x: 0`、无描边纯黑 `<svg>`、未定义变量 `--dsw-alias-border-hover` / `--dsw-alias-mask-92` / `--dsw-alias-mask-55` 与跨插件裸 `.omnimux-creatify-card` 覆写问题；
2. 卡片静息态即左对齐展示标题、常驻 2 行简介、低对比场景分类名称与清晰的试用 CTA 按钮（`corner-shape: round` 且紧凑最小尺寸 `28px`），取消伪造使用次数与非持久化本地收藏星标，亮暗双主题文字对比度与键盘聚焦可达性均满足工作台验收要求。

## 证伪方式

1. 构建 `plugins` 并同时注入 `omnimux-market/lib/client.js` 与 `omnimux/src/client/session-guide/styles.js` 样式至真实 Chromium，核验暗色宽屏（`1480x900`）与浅色窄屏（`780x900`）：`inset-x` 断层、纯黑 SVG 脏块、纯白硬边框与浅色白遮罩吞字全部消失，0 控制台报错，0 横向溢出；
2. 校验交互点击整卡打开详情、点击试用按钮触发对话试用不冒泡开详情、键盘 `Tab` + `Enter` 可达；
3. 新增并运行 CI 发现测试 `plugins/plugins/omnimux-market/tests/e2e/skill-card-workbench-redesign.spec.js` 与 `plugins/plugins/omnimux/src/client/session-guide/skills/skill-card-workbench-redesign.e2e.test.js`，以及三插件全量单测、`verify-dsw-tokens.mjs`、`verify-test-standard-declarations.mjs`、`doc-lint.mjs` 与 `workspace-check.mjs --check`。

## 旧标准变更

由于卡片结构从「静息居中大标题 + 悬停 `-28px` 上移黑底遮罩抽屉 + 本地星标 + 下载图标使用次数 + 静态封面占位图」升级为「全左对齐常驻工作台卡 + 右上角柔和氛围微光 + 独立作用域样式 + `28px` 圆角试用按钮（`@container` 内容盒阈值 `max-width: 172px`，对应约 `<= 206px` 标准卡宽 / `<= 202px` 货架卡宽）」，以下既有用例按方案 A 新标准同步更新：

- `plugins/plugins/omnimux-market/tests/e2e/market-card-hover-title-shift.spec.js` :: `E2E-1 样式规则核验：技能市场 CSS 中标题中心区悬停上移与平滑过渡生效`
  - 原断言校验悬停 `-28px` 上移；改为校验左对齐常驻标题、简介与柔和卡片悬停反馈（方案 A 取消悬停隐藏描述，无需上移标题避让抽屉）。
- `plugins/plugins/omnimux-market/tests/e2e/market-card-hover-title-shift.spec.js` :: `E2E-2 跨模块对齐核验：首页推荐卡片样式中标题悬停上移与平滑过渡完全一致`
  - 原断言校验 `styles.js` 中的 `.omnimux-creatify-card:hover .omnimux-creatify-card-center`；改为校验作用域隔离后的 `.omnimux-skill-card` 标题与摘要常驻排版、悬停微光与 `:focus-visible` 样式。
- `plugins/plugins/omnimux-market/tests/e2e/market-card-hover-title-shift.spec.js` :: `E2E-4 几何间隙断言：长文本换行两行时，上移后标题底边与描述顶边保持充足留白`
  - 原断言为基于悬停上移与 `drawerTopAtHover = 75` 抽屉顶距的纯算术占位推导；方案 A 取消悬停遮罩抽屉与标题上移，改为直接校验 `.omx-skill-card-desc` 常驻流式 `margin:6px 0 0` 与抽屉选择器彻底清理。
- `plugins/plugins/omnimux-market/tests/e2e/market-aurora-gradient-cards.spec.js` :: `E2E-3 视觉算法全量技能覆盖：120+ 技能卡片随机/散列生成高颜值极光流光`
  - 原断言强绑定底部高饱和中心 `radial-gradient(ellipse 115% 82% at 50% 120%`；改为校验右上角柔和氛围微光 `radial-gradient(ellipse 88% 80% at 96% 0%`、合规 `accent` 与亮暗双主题适配色相覆盖。
- `plugins/plugins/omnimux-market/src/client/card-compact-cta.e2e.test.js` :: `3:2营销精选卡：卡片自身宽度驱动快捷试用 CTA 退化，窄栏(<=288px)隐藏文字保留24px图标按钮与气泡提示，宽栏显示文字`
  - 原断言要求 `<= 288px` 隐藏文字并缩小到 `24px`；方案 A 将按钮热区提升为 `28px`（配 `corner-shape: round`）且仅在内容盒 `<= 172px`（约 `<= 206px` 卡片宽）时退化为 `28px` 圆形纯图标按钮，常规宽度（`>= 220px`）展示精炼文案 `去试试` / `Try` 且不裁切。
- `plugins/plugins/omnimux-market/src/client/card-compact-cta.e2e.test.js` :: `专家市场精选卡：退化由具名容器查询判定，且声明落在卡片根节点上`
  - 原断言正则绑定裸 `.omnimux-creatify-card` 容器声明；因方案 A 清理 `css.js` 中跨插件撞名的裸 `.omnimux-creatify-card` 规则，改为校验独立作用域 `.omx-skill-card` 根节点的 `container-type: inline-size` 与 `container-name: market-featured-card`。
- `plugins/plugins/omnimux-market/tests/e2e/market-creatify-cards.spec.js` :: `css.js 确保网格布局为严格一行五个 (repeat(5, minmax(0, 1fr)))`
  - 原断言正则校验裸 `.omnimux-creatify-card { ... aspect-ratio:3 / 2 }`；因方案 A 将市场卡片样式收敛至 `.omx-skill-card` 以消除对会话引导 `SkillCard` 的跨插件容器查询劫持，改为校验 `.omx-skill-card { ... aspect-ratio:3 / 2 }`。
- `plugins/plugins/omnimux-market/tests/e2e/market-cards-5-columns.spec.js` :: `E2E-3 卡片内部排版与极光流光算法适配：标题与胶囊尺寸和谐`
  - 原断言正则匹配裸 `.omnimux-creatify-center-title {`；方案 A 将市场卡片标题规则收敛至 `.omx-skill-card-title` 以消除跨插件样式串扰，同步更新选择器断言。
- `plugins/plugins/omnimux-inspiration/src/explore/templates/home-skill-cards-aurora.test.js` :: `首页 Skills 技能库货架卡片：100% 对齐图 2 技能插件高颜值极光样式`
  - 原断言校验 `.omnimux-creatify-star-btn`、`.omnimux-creatify-card-hover-drawer` 与 `.omnimux-creatify-drawer-uses`；按 Issue #410 方案 A 移除非持久化星标、破损遮罩抽屉与伪使用次数后，更新为校验常驻简介 `.omnimux-skill-card-summary`、分类文案 `.omx-skill-card-category` 与 `.omnimux-skill-card-btn`。
- `plugins/plugins/omnimux-inspiration/src/explore/skills/skills-tab.test.js` :: `TrendingReplicateSection: 头部渲染「创作灵感 / Skill」双 Tab 并支持平滑切换`
  - 原断言要求渲染容易 404 的静态图片 `.omnimux-skill-card-cover-img` 并断言按钮直出长文案；方案 A 改为氛围微光背景层 `.omx-skill-card-aura` 与简洁按钮文案 `.omnimux-skill-card-btn-label`（`aria-label` 保留完整 `使用 Skill` 语义）。
- `plugins/plugins/omnimux/tests/e2e/creatify-skills-library-refactor.e2e.test.mjs` :: `默认呈现全部技能，置顶热门精选(3)、新品上市(6)与探索更多(103)分区`
  - 原断言校验卡片内存在 `.omnimux-creatify-star-btn` 与 `.omnimux-creatify-card-hover-drawer`；方案 A 移除后更新为校验常驻简介 `.omnimux-skill-card-summary`、场景分类 `.omx-skill-card-category` 与 `.omnimux-skill-card-btn`。
