# 剪辑工坊同步 OpenReel v1.0.0

对应 [#154](https://github.com/omnimux-ai/omnimux-client/issues/154)。用同一个旧剪辑工程、同一段首导视频和同一个画布视频合成节点验证升级。OpenReel 来源为 [v1.0.0](https://github.com/Augani/openreel-video/tree/v1.0.0)，旧版本来源记录在同步前的 `UPSTREAM_SHA` 中。

| 验收项 | 操作 | 可观察结果 |
| --- | --- | --- |
| AC-1 独立工作区 | 打开旧项目，将首个视频加入空时间轴，切换剪辑、调色和音频工作区，缩放宿主面板 | 保留旧工程内容和视频尺寸匹配。常规宽度可使用素材、预览和属性三栏。时间轴随面板高度变化，窄屏用上游紧凑布局。 |
| AC-2 画布导出 | 从合成节点打开已连上游素材的工程，在普通分栏下打开和关闭导出窗并导出短 MP4，返回画布，再次打开 | 素材进库并上轨。顶栏保留导出和退出操作。1280 × 840、1480 × 840、900 × 720 下，导出窗在当前 Clip 容器内完整显示，关闭、快速导出、取消、正式导出均可点击。导出进度随编码更新，无系统保存窗。画布收到主机保存确认，成片可读且有 MP4 `moov`，重开不重复导入。 |
| AC-3 授权边界 | 退出画布剪辑，切到独立工坊，从「视图 → 项目 JSON 与评论」导入带自定义表达式的旧工程，验证审批与工程切换 | 工坊仅打开一层可点击的模态窗口。导入后展示旧工程并恢复指针交互。Motion Creator 独立工作区已退役。未审批代码返回原属性值，授权仅对当前工程有效，导入和切换清空授权，脚本查看器有安全提示。 |
| AC-4 主题和语言 | 在宿主亮色、暗色及窄屏中打开菜单、面板、弹窗和导出；切换中英文及 Clip 路由 | 控件与浮层跟随宿主主题，切换后仍可读可操作。宿主 URL、主题属性和 Clip 外的样式保持一致。中文显示界面和状态，用原文显示用户输入及格式、编解码器等标准名称。 |
| AC-5 可分发 | 构建插件，检查工作区元数据、预设文件和加载合同 | 保留六个 OpenReel 预设路径及 Windows 配置导入。记录同环境下升级前后的包体积、构建耗时和内存。 |
| AC-6 浏览器服务边界 | 加载带旧连接配置、协作布局与未完成生成素材的项目，检查打包入口和可达网络调用 | 剪辑对话、自备密钥直连、浏览器生成提交及轮询和外部协作均退出工作区。旧素材保留引用，可恢复或重新链接。 |

设计对照依据为两个固定版本的编辑器源码与上游工作区布局。演示用合成媒体复走导入、选择片段、菜单、导出和返回画布。实际导出、样式隔离、旧工程兼容和跨平台交付以工作树中的实现测试及运行记录为准。

## 假设

上游三栏可以随宿主容器缩放。新导出入口可继续使用画布的编码流缓冲和持久化。构建时作用域及 Clip 内部浮层容器可以隔离宿主样式。

## 证伪方式

- 缩放宿主面板后，检查素材、预览、属性和时间轴的尺寸及控件命中。在 900 × 720 的紧凑布局尝试创建项目、打开素材菜单并添加视频，再切到时间轴，确认可打开导出弹窗。按钮不可操作或布局无法滚动到完整内容说明适配有缺口。
- 从画布合成节点真实编码并检查落盘字节、宿主回执和下游版本。出现系统保存窗、MP4 缺少 `moov` 或失败却发出保存成功事件均为失败。保持分栏尺寸不变，将已打开的导出窗随分栏移向视口边缘，复查四个操作的完整按钮区域和命中。
- 退出画布剪辑后保留编辑器挂载，再从工坊菜单打开项目 JSON。检查只有当前工坊挂载模态层，实际点击关闭、导入及文件选择后能继续使用编辑器。画布在切换 Tab 后可能保留绑定，隐藏实例仍须释放模态层。反向切回画布时，隐藏工坊也不得消费共享的导出模态状态。
- 按 [#160 的绑定和回执验收](clip-phase1-160.spec.md#证伪方式)复测 v1 导出入口。编码完成后，上传按开始时的工作区、节点和工程结算。退出可释放编辑器以便重试。新版回写后，迟到的旧回执不会覆盖成片或切换当前编辑器的导出状态。
- 用旧项目 JSON 导入窗口核对安全提示。浏览器夹具调用底层显式审批后渲染，核对未经审批的代码、同 ID 的其它代码与重新导入都保持暂停，内置表达式及关键帧继续起效。
- 在 Clip 外放置同名样式探针。比较亮暗切换、菜单和弹窗打开前后的计算样式、宿主根属性与 URL。拖动时间轴分隔条、移动和修剪片段时检查 `body.style.cssText`，并验证组件手势状态在松开、取消和窗口失焦时清理。
- 用实际素材目录、预设、转场、缓动、着色器和导出设置检查中文名称。切换语言后验证项目、片段和显示内容的身份。
- 对编码输出核对时间码烧录后的完整帧数。检查源流快速导出和逐帧 MP4 都经过宿主回执写入同一个合成节点。
- 检查产物中裸文档选择器或浏览器直连模块的回归用例能报错。

分栏和双实例的自动化回归以 `build:all` 产物为输入。安装工作区依赖和桌面工作区 Playwright 的 Chromium 后，从仓库根运行 `node --test plugins/plugins/omnimux-clip/tests/e2e/editor-dialogs.e2e.test.mjs`。用 `CLIP_TEST_BUNDLE` 指定升级前的客户端产物可复现两个失败。Electron 隔离验收另检查实际窗口尺寸、导出落盘和画布回执。

## 旧标准变更

上游 1.0 删除了独立 Motion 工作区。顶栏的项目切换移到应用菜单所在的左段。升级后的静态断言按实际组件和产物检查相同的画布显隐、导出配色与宿主语言契约。

- `plugins/plugins/omnimux-clip/src/client/canvas-toolbar-mode.test.js` :: `canvas-toolbar-mode: MotionCreatorShell.tsx 三段标记齐全`
  原用例读取独立 Motion 壳的三段。该组件随上游退役，改查功能开关为 false，保留编辑器三段用例及旧工程表达式审批测试。
- `plugins/plugins/omnimux-clip/src/client/canvas-toolbar-mode.test.js` :: `canvas-toolbar-mode: canvas 隐藏中段（项目名称 + 项目切换器）`
  上游将项目切换器放到左段，中段仍要求画布下 `display:none !important`，两段的子控件分别核对。
- `plugins/plugins/omnimux-clip/src/client/canvas-toolbar-mode.test.js` :: `canvas-toolbar-mode: canvas 隐藏左段（模式切换）`
  应用菜单和项目切换器接替原模式切换位置，原画布隐藏规则及备用类名断言继续检查。
- `plugins/plugins/omnimux-clip/src/client/canvas-toolbar-mode.test.js` :: `canvas-toolbar-mode: 中段标记确实包住项目名称输入与项目切换器`
  中段仍检查真实项目名称输入，切换器移至新左段断言。
- `plugins/plugins/omnimux-clip/src/client/canvas-toolbar-mode.test.js` :: `canvas-toolbar-mode: 左段标记确实包住 WorkspaceModeTabs`
  上游菜单取代独立工作区切换控件，左段改查 `EditorMenuBar` 和 `ProjectSwitcher`。
- `plugins/plugins/omnimux-clip/src/client/clip-i18n.test.js` :: `every t("...") call in vendored openreel code resolves to a dictionary entry`
  将文本匹配改成 TypeScript 语法树，扫描 `t`、`clipT`、`clipNow()()` 的字面量调用，避免把样式和标点识别成调用。
- `plugins/plugins/omnimux-clip/src/client/clip-i18n.test.js` :: `every zh dict file uses English-literal keys (no pinyin/keyed ids)`
  词典仍使用源字面量键，校验允许 `0.1x` 之类规格，继续拒绝命名空间键并验证译文非空、占位符一致。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Export 按钮文字色与箭头色同源（不出现游离白色）`
  导出图标改为公用头部图标，检查按钮前景 `--accent-fg` 和图标 `currentColor`。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Export 文件无硬编码 border-white/25`
  实际导出组件和图标检查白色边线类，已删除的 Motion 壳退出扫描。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Export 文件无硬编码 stroke="#fff"`
  检查导出调用的公用图标无固定白描边，并解析桌面导出规则中的 stroke。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Export 文件无硬编码 text-white`
  检查新导出组件和图标源码，并解析桌面和窄屏样式的真实前景声明。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Motion 导出按钮 hover 消费 bg-accent-strong`
  独立 Motion 导出退役。针对桌面与窄屏导出的可用空闲态解析 hover 背景 `--accent-strong`。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: Toolbar 内联箭头 SVG 消费 stroke="currentColor"`
  导出图标从顶栏内联移至 `EditorHeaderIcon`，核对实际组件引用和共享 SVG 的 `currentColor`。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: dsw-map.css 不引入裸色值作为 accent 主色`
  采用 CSS 解析器读取 `--accent` 声明，检查其从 `--dsw-*` 取值。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: dsw-map.css 定义 --accent-divider`
  解析根作用域中的分隔 token，继续要求根据前景色计算。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: dsw-map.css 的 accent 三件套映射完整`
  解析 `--accent`、`--accent-strong`、`--accent-fg` 三项，每项均要求从宿主 token 取值。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: tailwind accent 调色板字段齐全`
  读取 Tailwind 配置对象并实际求值四个颜色函数，检查 `divider` 及其源 CSS 声明。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: tailwind 配置补齐 accent.divider`
  通过实际配置值核对 `var(--accent-divider)`。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: token 类名写在静态字符串里（Tailwind 能扫到）`
  上游导出以静态 `workspace-export` 和 `mobile-editor-export` 类选中样式。检查两类实际写入 JSX，并解析它们的常态和 hover 声明。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: token 链路闭合（CSS 变量 → tailwind → 组件类名）`
  新导出直接消费 CSS token，检查宿主映射、组件样式与仍供其他控件使用的 Tailwind 配置。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: 下拉箭头分隔线消费 border-accent-divider`
  上游单导出按钮移除旧的并排箭头和分隔线，继续校验共享分隔 token 及 Tailwind 配置。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: 主导出按钮消费 text-accent-fg`
  改查实际桌面、窄屏按钮选择器的 `color: var(--accent-fg)`。
- `plugins/plugins/omnimux-clip/src/client/export-theme-token.test.js` :: `export-theme-token: 无已废弃的 --omx-* 变量残留`
  继续扫描新导出组件、共享图标、桌面和窄屏样式及宿主映射。
- `plugins/plugins/omnimux-clip/src/client/host-locale.test.js` :: `both Clip surfaces receive and subscribe to host locale without locale-key remounts`
  保留双入口收到并订阅宿主语言的断言。导出改由共享组件渲染，右段重新核对导出与退出的顺序、退出事件参数及中英文值。

静态扫描的真实 vendor 样本从已删除的 Motion 时间轴迁移到 `Preview.tsx`。保留裸色样本存在、扫描跳过 vendor 及同批拦截宿主胶水三个判定。

原表达式浏览器夹具通过已退役的曲线编辑器触发审批。更新后，真实项目 JSON 窗口负责导入，夹具控件分别调用项目 Store 与底层审批函数，继续检查渲染像素、准确代码授权、撤销、克隆导出帧、重复 ID、重新导入和内置动画。
