---
title: "OmniMux 全量插件 Agent 工具与双面交付清单契约"
id: "contract-plugin-agent-tools-inventory"
type: "contract"
status: "living"
authority: "L1"
date: "2026-08-30"
updated: "2026-11-22"
authors: ["qi-huolin", "xu-qingchu", "gao-jianyuan", "lin-shen", "yan-guoguan"]
subsystem: "global"
tags: ["agent-tools", "dual-surface", "inventory", "verification", "governance"]
supersedes: []
superseded_by: null
---

# OmniMux 全量插件 Agent 工具与双面交付清单契约

本页数字、`Implemented` 与“双面就绪”是既有源码注册记录，不是当前上线或真实业务可用证明，不作为正式版宣传数量。发布阶段读[生命周期清单](../../plugins/omnimux/src/plugin-lifecycle.json)，运行可用性需当前版本证据；现行产品范围见[产品说明](../../README.md#工程结构与能力状态)。

> **版本**：v1.0.0 | **权威级别**：L1（工程契约）  
> **适用范围**：`plugins/` 下插件的 UI 交互与 Agent Tool 注册规范。
> **持续治理**：由 `scripts/verify-plugin-agent-tools.mjs`（`pnpm verify:tools`）执行静态扫描。CI 拦截注册源码与本清单新增的不一致，已存在的差异作为告警。

---

## 1. 治理原则与双面交付铁律

1. **双面交付铁律 (Dual-Delivery Invariant)**：
   在 OmniMux 插件生态中，任何业务功能必须同时具备：
   - **人类交互面 (UI Surface)**：Web Client UI (Stage / Overlay / Tab / Modal / Card)；
   - **智能体契约面 (Agent Tool Surface)**：Host 通过 `ctx.tools` 注册工具，声明 JSON Schema 参数与结果契约。
   两者共享领域模型与服务层。Clip 工具的业务失败抛 `ClipDomainError`。保存、实时命令和导出回执见[剪辑工具契约](clip-live-control.md#工具入参与编辑行为)。
2. **单一事实来源 (Single Source of Truth)**：
   HTTP 路由处理函数与 `ctx.tools.register` 的 `execute` 函数必须作为对等薄适配器，直接调用底层同一个 `Dispatcher` / `Store` 方法。
3. **破坏性操作二次确认守卫 (Destructive Action Guard)**：
   涉及物理删除、级联清理、覆盖破坏的工具必须声明必填 `confirm` 布尔参数。未传 `confirm: true` 时拒绝执行，结果为 `{ ok: false, error: 'confirmation-required', message: '...' }`。Clip 的批量编辑按实际操作校验，删除非空轨或清空已有时间轴须提供 `confirmDestructive: true`。Clip 导出要求 `confirm: true`。Clip 的确认拒绝抛出结构化领域错误。
4. **工具分级标准 (L1 / L2 / L3 / UI-Only)**：
   - **L1 (Mandatory Tool)**：核心业务数据流与 CRUD（创建、删除、修改、发布、执行）。必须 100% 暴露 Tool。
   - **L2 (Standard Tool)**：辅助查询、多维搜索、状态拉取、统计聚合、配置探查。必须暴露 Tool。
   - **L3 (Diagnostic Tool)**：高级探针、流媒体元数据查询、内部运行诊断。按需暴露 Tool。
   - **UI-Only (Exempted)**：纯前端视口平移缩放、弹窗开闭、光标聚焦、本地高亮。**严禁暴露 Tool**，防止上下文膨胀。

---

## 2. 历史 13 插件概览统计

| 统计指标 | 数值 | 说明 |
|---|---|---|
| **体检插件总数** | 13 个 | 当时纳入体检的插件 |
| **已注册 Agent 工具总数** | 101 个 | 历史源码快照。各插件的工具状态以对应条目和实际注册为准。 |
| **双面齐备标杆插件 (A+)** | 4 个 | `omnimux-workflow` (12 tools), `omnimux-publish` (9 tools), `omnimux-market` (15 tools), `omnimux-avatar` (9 tools) |
| **需补齐写操作工具插件 (B)** | 4 个 | `omnimux-assets`, `omnimux-products`, `omnimux-inspiration`, `omnimux-accounts` |
| **纯后端/纯中枢/纯视图插件** | 5 个 | `omnimux` (中枢 29 tools), `omnimux-video` (4 tools), `omnimux-video-preview` (2 tools), `omnimux-analytics` (0 tools), `omnimux-clip` (9 个注册工具，见下文剪辑限制) |

---

## 3. 全量插件功能与 Agent 工具全景矩阵

### 3.1 `omnimux`（执行中枢 Hub）
- **功能域**：中枢官方服务、品牌/设置、社媒路由、模型调用、官方 Seams。
- 已注册官方工具和工作台工具。中枢通过同一事件 WebSocket 识别已认证窗口。对话首轮采用新鲜且唯一的剪辑视口摘要。剪辑实时指令按窗口定向，`clip_*` 不走工作面自动切换。[实时控制契约](clip-live-control.md#可见入口编辑权和对话上下文)
- **线路目录**：中枢按网关目录向画布提供官方线路顺序及默认标记。兼容未选线的媒体调用时，中枢从同一目录读取默认线路。请求指定可用线路时优先采用该线路。[目录和协议](canvas-generation.md#目录和协议)

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 查询社媒平台与平台对数据 | 中枢内部 API | `omnimux_social_data` | L1 | `Implemented` | 否 |
| 获取已授权账号列表 | 账号管理 / 中枢设置 | `omnimux_accounts_list` | L1 | `Implemented` | 否 |
| 获取账号授权连接 URL | 连接弹窗 | `omnimux_accounts_connect` | L2 | `Implemented` | 否 |
| 解除账号授权关联 | 解绑按钮 | `omnimux_accounts_disconnect` | L1 | `Implemented` | 是 (`confirm: true`) |
| 社媒发布媒体文件预签名 | 发布中心上传 | `omnimux_publish_presign` | L2 | `Implemented` | 否 |
| 向指定社媒平台创建发布任务 | 发布中心一键发布 | `omnimux_publish_create` | L1 | `Implemented` | 否 |
| 查询社媒发布任务状态与流水 | 发布中心状态卡片 | `omnimux_publish_get` | L1 | `Implemented` | 否 |
| 灵感社区列表多维查询 | 灵感社区一级页瀑布流 | `omnimux_inspiration_list` | L1 | `Implemented` | 否 |
| 获取单条灵感详情与 5D 拆解 | 灵感详情弹窗 | `omnimux_inspiration_get` | L1 | `Implemented` | 否 |
| 采集/新建灵感记录 | URL 抓取导入弹窗 | `omnimux_inspiration_create` | L1 | `Implemented` | 否 |
| 更新灵感元数据与标签 | 灵感详情编辑 | `omnimux_inspiration_update` | L1 | `Implemented` | 否 |
| 删除指定灵感记录 | 灵感卡片删除按钮 | `omnimux_inspiration_delete` | L1 | `Implemented` | 是 (`confirm: true`) |
| 上传灵感封面/媒体素材 | 灵感上传组件 | `omnimux_inspiration_upload_media` | L2 | `Implemented` | 否 |
| 查询灵感全量标签分类 | 灵感筛选栏 | `omnimux_inspiration_tags` | L2 | `Implemented` | 否 |
| 查询灵感社区服务与抓取状态 | 灵感社区状态指示 | `omnimux_inspiration_status` | L2 | `Implemented` | 否 |
| 提交视频生成任务。官方 H3 对口型接收一张图片和一段驱动音频 | 工作流视频生成节点 | `omnimux_video_submit` | L1 | `Implemented` | 否 |
| 提交图片生成任务 | 工作流生图节点 | `omnimux_image_submit` | L1 | `Implemented` | 否 |
| 提交音频生成任务，向执行中枢传递 `style` 与 `instrumental`（含显式 `false`）。Suno 灵感模式接收主提示词和纯音乐开关，音频时长由模型决定 | 工作流生音频节点 | `omnimux_audio_submit` | L1 | `Implemented` | 否 |
| 查询音频模型可用音色库 | 属性面板音色选择器 | `omnimux_audio_voices` | L1 | `Implemented` | 否 |
| 查询社媒多维日频核心指标 | 分析看板概览 | `omnimux_analytics_daily_metrics` | L2 | `Implemented` | 否 |
| 分析账号最佳发帖时间热力图 | 最佳发帖时间卡片 | `omnimux_analytics_best_time` | L2 | `Implemented` | 否 |
| 分析发帖频次与效果关系 | 频次分析组件 | `omnimux_analytics_frequency` | L2 | `Implemented` | 否 |
| 分析内容生命周期与互动衰减 | 衰减曲线图表 | `omnimux_analytics_content_decay` | L2 | `Implemented` | 否 |
| 统计粉丝画像与增长漏斗 | 粉丝画像卡片 | `omnimux_analytics_follower_stats` | L2 | `Implemented` | 否 |
| 查询历史帖子表现明细表 | 帖子表现明细列表 | `omnimux_analytics_posts` | L2 | `Implemented` | 否 |
| 手动触发外部平台数据同步 | 手动同步按钮 | `omnimux_analytics_sync_external` | L2 | `Implemented` | 否 |
| 查询分析中心收件箱与系统通知 | 通知抽屉 | `omnimux_analytics_inbox` | L2 | `Implemented` | 否 |
| 抓取网页并解析 Markdown | 灵感/知识库采集 | `omnimux_page_fetch` | L2 | `Implemented` | 否 |
| 统一多模型文本与结构化生成 | 文本节点与大模型中继 | `omnimux_text_complete` | L2 | `Implemented` | 否 |
| TypeSafe Jev 结构化决策与量化评估 | 智能体决策路由器与评估门禁 | `omnimux_jev_decision` | L2 | `Implemented` | 否 |
| 读取右侧工作台的 Tab、视图和选中项 | 右侧工作台视口 | `workbench_get_active_view` | L2 | `Implemented` | 否 |
| 打开或切换右侧工作台 Tab | 左栏 / Tab 条 / 对话内「打开」 | `workbench_open_tab` | L1 | `Implemented` | 否（受工作台设置、配额及撤销约束） |

---

### 3.2 `omnimux-assets`（创作资产库）
- **功能域**：角色、场景、风格包、道具、知识包、自定义 6 大类资产与产物管理。
- **存储**：`$DSH_HOME/omnimux/assets/data/files/<id>/`。
- **状态**：已实装查询与上传，已规划增改删 3 个写操作补齐。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 列出全部或按类目过滤资产 | 一级 Stage 资产网格 | `assets_list` | L1 | `Implemented` | 否 |
| 跨类目模糊搜索资产与标签 | 顶部搜索栏 | `assets_search` | L1 | `Implemented` | 否 |
| 获取单个资产详情与本地物理文件 | 资产详情抽屉 | `assets_get` | L1 | `Implemented` | 否 |
| 上传/导入物理文件到资产库 | 资产导入弹窗 | `assets_upload` | L2 | `Implemented` | 否 |
| 结构化创建新资产实体 | 新增资产模态框 | `assets_create` | L1 | `Implemented` | 否 |
| 更新资产元数据、标签与描述 | 资产编辑模态框 | `assets_update` | L1 | `Implemented` | 否 |
| 删除指定资产及其关联物料 | 资产卡片删除确认弹窗 | `assets_delete` | L1 | `Implemented` | 是 (`confirm: true`) |
| 资产网格视图切换 (Grid/List) | 顶部视图切换按钮 | — | UI-Only | `UI-Only` | 豁免 (前端纯排版状态) |

---

### 3.3 `omnimux-products`（产品库）
- **功能域**：要卖的货（商品名称、卖点、目标受众、品牌策略、主图引用）。
- **存储**：`$DSH_HOME/omnimux/products/library.json`。
- **状态**：已实装 6 个工具，需补齐 `products_delete`。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 列表查询全部产品 | 一级 Stage 商品列表 | `products_list` | L1 | `Implemented` | 否 |
| 条件搜索商品 | 顶部搜索过滤栏 | `products_search` | L1 | `Implemented` | 否 |
| 获取单项商品详情与策略参数 | 商品详情面板 | `products_get` | L1 | `Implemented` | 否 |
| 读取商品绑定的主图/媒体流 | 媒体预览抽屉 | `products_read_media` | L2 | `Implemented` | 否 |
| 创建新商品与带货策略 | 新增商品弹窗 | `products_create` | L1 | `Implemented` | 否 |
| 更新商品信息与营销卖点 | 编辑商品弹窗 | `products_update` | L1 | `Implemented` | 否 |
| 删除指定商品条目 | 商品卡片删除按钮 | `products_delete` | L1 | `Implemented` | 是 (`confirm: true`) |
| 商品多选状态维护 | 表格 Checkbox | — | UI-Only | `UI-Only` | 豁免 (前端纯交互状态) |

---

### 3.4 `omnimux-inspiration`（灵感社区）
- **功能域**：爆款短视频/图文采集、5D 结构化拆解、复刻至工作流。
- **存储**：`$DSH_HOME/omnimux/inspiration/local/`。
- **状态**：已实装 3 个工具，需补齐更新、删除与收藏操作。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 模糊搜索与标签过滤灵感 | 灵感社区一级页瀑布流 | `inspiration_search` | L1 | `Implemented` | 否 |
| 获取指定灵感 5D 结构化拆解详情 | 灵感详情模态框 | `inspiration_get` | L1 | `Implemented` | 否 |
| 从社媒 URL 抓取并入库新灵感 | 采集导入弹窗 | `inspiration_create` | L1 | `Implemented` | 否 |
| 更新灵感笔记、标签与结构化字段 | 灵感编辑面板 | `inspiration_update` | L1 | `Implemented` | 否 |
| 删除指定灵感条目及其本地缓存 | 灵感卡片删除操作 | `inspiration_delete` | L1 | `Implemented` | 是 (`confirm: true`) |
| 收藏/取消收藏灵感条目 | 卡片爱心图标点赞 | `inspiration_favorite` | L2 | `Implemented` | 否 |
| 查询对标账号列表 | 对标账号工作台左栏 | `inspiration_rival_accounts` | L1 | `Implemented` | 否 |
| 查询对标账号帖子（可按潜力筛选） | 对标账号工作台右栏 | `inspiration_rival_posts` | L1 | `Implemented` | 否 |
| 获取单条对标帖子与所属账号 | 帖子卡片详情 | `inspiration_rival_post` | L1 | `Implemented` | 否 |
| 组装帖子到当前会话的附件载荷 | 帖子卡片「添加到会话」 | `inspiration_rival_posts_add_to_session` | L2 | `Implemented` | 否 |
| 将对标帖子转入灵感库 | 帖子卡片「转成灵感」 | `inspiration_rival_to_inspiration` | L2 | `Implemented` | 否 |
| 触发对标账号刷新（受云端配额约束） | 工作台「刷新 / 全部刷新」 | `inspiration_rival_refresh` | L2 | `Implemented` | 否 |
| 瀑布流列宽与滚动锚定 | 界面自适应容器 | — | UI-Only | `UI-Only` | 豁免 (前端排版状态) |

---

### 3.5 `omnimux-publish`（矩阵发布中心）
- **功能域**：草稿管理、多账号矩阵分发、子任务追踪、失败重试、指标看板。
- **存储**：`$DSH_HOME/omnimux/publish/store.json`。
- **状态**：双面就绪 (已实装 9 大工具，100% 对齐 UI)。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 查询发布记录与草稿列表 | 发布中心表格与三大 Tab | `publish_list_records` | L1 | `Implemented` | 否 |
| 新建图文/视频发布草稿 | 新建草稿表单 | `publish_create_draft` | L1 | `Implemented` | 否 |
| 修改草稿标题、文案、媒体与话题 | 编辑草稿弹窗 | `publish_update_draft` | L1 | `Implemented` | 否 |
| 删除指定草稿 | 草稿行删除操作 | `publish_delete_draft` | L1 | `Implemented` | 是 (`confirm: true`) |
| 查询可用于发布的授权账号 | 账号选择器多选下拉 | `publish_list_accounts` | L1 | `Implemented` | 否 |
| 为草稿分配分发账号 | 矩阵账号分配勾选 | `publish_assign_accounts` | L2 | `Implemented` | 否 |
| 正式提交草稿执行多账号分发 | 立即发布 / 排期发布按钮 | `publish_submit` | L1 | `Implemented` | 否 |
| 获取单条发布记录与全账号子任务 | 发布任务详情抽屉 | `publish_get_record` | L1 | `Implemented` | 否 |
| 重试指定失败的账号分发子任务 | 单子任务重试按钮 | `publish_retry_task` | L2 | `Implemented` | 否 |
| 表格列宽拖拽与排序偏好 | 发布记录表头 | — | UI-Only | `UI-Only` | 豁免 (前端交互) |

---

### 3.6 `omnimux-workflow`（工作流无限画布）
- **功能域**：React Flow DAG 画布编排、物料节点 CRUD、连线规则校验、异步执行与 TableNode 数据表。
- **存储**：`$DSH_HOME/omnimux/workflow/` + Canvas JSON。
- **状态**：双面就绪 (已实装 12 大工具，标杆级画布 Agent 控制)。
- **视频模式**：画布与 Agent 共用[画布生成契约](canvas-generation.md)。界面按目录中的 `modeKind` 显示名称，`workflow_run` 和节点参数使用原 operation ID。已接入分组能力的节点按有效组合查组、方式、参数和槽位。生产范围以实际验收为准。
- **生成输入**：节点提交与 `workflow_run` 共用[当前操作和线路的输入投影](canvas-generation.md#选择和素材)。提示词 `@` 的候选菜单属于画布交互。Agent 通过 `workflow_node_update` 修改提示词，通过 `workflow_connect` 和 `workflow_disconnect` 调整连接。
- 画布剪辑使用下节的 `clip_*` 工具。Workflow 的 Host 服务按工作区、节点和工程核对绑定，用同一画布版本提交草稿指针、成片引用或下游节点和连线。[画布剪辑契约](clip-live-control.md#mp4-与画布提交)

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 列出全部工作区与执行历史 | 一级 Stage 工作区选择器 | `workflow_list` | L1 | `Implemented` | 否 |
| 执行工作区或指定节点。已受理任务按原标识恢复；用 `execution_id` 查询或等待已有执行 | 顶部「运行」及节点生成按钮 | `workflow_run` | L1 | `Implemented` | 否 |
| 获取画布快照。用 `node_id` 查询指定节点及其分组生成选项 | 画布加载与节点配置 | `workflow_snapshot` | L1 | `Implemented` | 否 |
| 创建新工作区与画布 | 新建工作区按钮 | `workflow_create` | L1 | `Implemented` | 否 |
| 向画布添加物料/AI生成节点 | 左侧物料库拖拽入画布 | `workflow_node_add` | L1 | `Implemented` | 否 |
| 更新指定节点的参数与配置。线路分组的选择、默认值及参数校验遵循[画布生成契约](canvas-generation.md#选择和素材)。图片节点的生成方式由参考图绑定派生，不在 patch 中单独选择。可用 `patch.swap_reference_images` 交换有序参考图卡槽的起始图 | 节点右侧属性面板及参考图卡槽的起始图设置 | `workflow_node_update` | L1 | `Implemented` | 否 |
| 移除画布上的指定节点及其相连边 | 节点选中按 Delete 键 | `workflow_node_remove` | L1 | `Implemented` | 是 (`confirm: true`) |
| 在两节点端口之间建立连接边并重算入槽，分组能力节点保留用户已选方式 | 鼠标拖拽连线 | `workflow_connect` | L1 | `Implemented` | 否 |
| 添加同用途的参考素材或向具名角色分配素材。系统对话框与拖入可使用桌面本地文件 | 素材区「添加素材」、角色卡槽及预览「替换」 | — | UI-Only | `UI-Only` | 豁免（桌面文件选择与画布撤销） |
| 从画布选取提示词参考。已绑定上游文本以卡片展示 | 提示词 `@` 菜单。`inputBindingVersion: 1` 节点选中候选后打开素材选择器。已绑定卡片提供预览和操作 | — | UI-Only | `UI-Only` | 豁免（界面交互。连线操作见 `workflow_connect` 和 `workflow_disconnect`） |
| 断开指定两节点之间的连线边，按连线次序补自动卡槽并保留其余具名绑定 | 边右键删除 | `workflow_disconnect` | L1 | `Implemented` | 是 (`confirm: true`) |
| 暂停、恢复或取消正在运行的流程 | 控制台暂停/中止按钮 | `workflow_execution_control` | L2 | `Implemented` | 否 |
| 写入 TableNode 数据表格单元格 | 表格节点全屏编辑器 | `canvas_write_table_node` | L2 | `Implemented` | 否 |
| 读取 TableNode 数据表格内容 | 表格节点渲染面板 | `canvas_get_table_node` | L2 | `Implemented` | 否 |
| 画布鼠标平移 (Pan) 与缩放 (Zoom) | 视口控制器 | — | UI-Only | `UI-Only` | 豁免 (前端物理坐标) |
| 多选节点框选框 (Selection Box) | 鼠标拉框选择 | — | UI-Only | `UI-Only` | 豁免 (瞬态交互) |

---

### 3.7 `omnimux-clip`（OpenReel 视频剪辑）

- OpenReel v1 的多轨剪辑、播放与 WebCodecs 导出共用原生编辑器。入口为画布节点 Portal 和独立「视频剪辑」Tab。Host 在 `$DSH_HOME/omnimux/clip/projects/` 保存原生工程，兼容识别旧 `TimelineSchema` 与原生 UUID 工程。[阶段 2 实现](clip-live-control.md#阶段-2-实现) · [上游引入契约](openreel-vendor-contract.md)
- 已注册 9 个工具。实时工具针对本会话的可见租约，查询可读取保存版本。工具时间用秒。完整参数以[实际注册](../../plugins/omnimux-clip/src/tools.js)为准。

| 当前 Agent 行为 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 列出保存工程与无法读取的条目 | `GET /omnimux-clip/api/projects` | `clip_list` | L1 | `Implemented` | 否 |
| 优先读可见原生投影，亦可按工程 ID 查档 | 编辑器原生快照 / `GET /omnimux-clip/api/projects/:id` | `clip_get` | L1 | `Implemented` | 否 |
| 诊断保存版本的黑场、重叠、素材缺失和越界 | Host 工程 Store | `clip_diagnostics` | L2 | `Implemented` | 否 |
| 创建保存的独立原生空工程 | 新建工程 / Host 工程 Store | `clip_create` | L1 | `Implemented` | 否 |
| 原子执行一批原生剪辑，整批入一次 Undo，可预演 | OpenReel 原生时间轴 / 实时命令 | `clip_edit` | L1 | `Implemented` | 删除非空轨或清空时间轴需 `confirmDestructive: true` |
| 打开明确指定的工程并等待可见租约 | 画布 Portal 或独立 Tab | `clip_open` | L1 | `Implemented` | 用户要求打开时调用 |
| 控制播放头、播放和选段 | 编辑器播放控制 / 实时命令 | `clip_view` | L1 | `Implemented` | 否 |
| 从预览读取并保存最多六帧真实合成 PNG | 编辑器预览 / 实时命令 | `clip_snapshot` | L2 | `Implemented` | 否 |
| 导出版本化 MP4，分别回报成片落盘与画布提交 | WebCodecs / Host 流式上传 / Workflow 版本提交 | `clip_export` | L1 | `Implemented` | 用户明确要求导出并传 `confirm: true` |
| 播放指针拖拽 (Scrubbing) | 播放控制器 | — | UI-Only | `UI-Only` | 豁免（手工拖动） |

查询和操作都保持当前画布工作面，显式导航用 `clip_open`。未物化节点报告 `project-not-materialized`。按 `AMBIGUOUS_TARGET` 的候选定位，可用 `windowInstanceId` 消歧。同窗保活画布的候选标记 `visible: false`。无认证窗口报告 `EDITOR_OFFLINE`，入口不可见或预览尚未就绪按实际状态返回 `EDITOR_NOT_VISIBLE` 或 `PREVIEW_NOT_READY`。实时 `clip_get` 提供 `revision` 和 `revisionEpoch`，供同目标的 `clip_edit` 或指定版本的 `clip_export` 作为 `baseRevision` 和 `baseRevisionEpoch`。世代变更后，旧规划返回 `REVISION_CONFLICT`，可用原 `requestId` 查已执行请求。画布手工导出和 `clip_export` 共用 Host 的导出世代和任务号，文件落盘与画布回写各有独立状态。[错误与工具参数](clip-live-control.md#租约命令与失败)

九个工具的 schema 使用 DSH Host 支持的子集。`clip_get` 的 `revision` 和 `revisionEpoch` 是必填整数，实时读取另返回可选字符串 `windowInstanceId`。各工具在执行时校验领域范围和窗口身份。[工具入参与编辑行为](clip-live-control.md#工具入参与编辑行为)

---

### 3.8 `omnimux-market`（插件·技能·专家·连接器广场）
- **功能域**：技能市场、DSH 插件库、Plaza 专家召唤、MCP 连接器管理。
- **状态**：双面就绪 (已实装 15 个多域工具，内置专家优先守卫)。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 搜索 SkillHub 技能库 | 市场一级页技能 Tab | `skillhub_search` | L1 | `Implemented` | 否 |
| 安装指定 Skill 到本地环境 | 卡片一键安装按钮 | `skillhub_install` | L1 | `Implemented` | 否 |
| 列出已安装在本地的技能清单 | 已安装 Tab | `skillhub_list` | L1 | `Implemented` | 否 |
| 卸载已安装的本地技能 | 技能卡片卸载按钮 | `skillhub_uninstall` | L1 | `Implemented` | 是 (`confirm: true`) |
| 搜索 Plaza 本地专家与专家团队 | 专家馆搜索栏 | `plaza_search` | L1 | `Implemented` | 否 |
| 召唤并持久化专家到当前会话 | 专家卡片召唤按钮 | `plaza_summon` | L1 | `Implemented` | 否 |
| 静默安装 Plaza 专家/技能包 | 市场内部安装 | `plaza_install` | L2 | `Implemented` | 否 |
| 搜索 DSH 插件市场 | 插件市场 Tab | `plugin_search` | L1 | `Implemented` | 否 |
| 安装指定 DSH 官方/社区插件 | 插件卡片安装按钮 | `plugin_install` | L1 | `Implemented` | 否 |
| 卸载已安装的 DSH 插件 | 插件卡片卸载按钮 | `plugin_uninstall` | L1 | `Implemented` | 是 (`confirm: true`) |
| 列出当前 Profile 已装插件列表 | 插件管理面板 | `plugin_list` | L1 | `Implemented` | 否 |
| 搜索 MCP 连接器市场 | 连接器 Tab | `connector_search` | L1 | `Implemented` | 否 |
| 安装已打包 MCP 连接器 | 连接器卡片安装按钮 | `connector_install` | L1 | `Implemented` | 否 |
| 卸载已安装的 MCP 连接器 | 连接器卡片卸载按钮 | `connector_uninstall` | L1 | `Implemented` | 是 (`confirm: true`) |
| 列出当前已配置的 MCP 连接器 | 连接器管理面板 | `connector_list` | L1 | `Implemented` | 否 |
| 市场分类 Tab 切换 | 顶部 Tablist | — | UI-Only | `UI-Only` | 豁免 (前端导航状态) |

---

### 3.9 `omnimux-accounts`（社交账号管理）
- **功能域**：多平台社交账号网格/表格、授权绑定、解绑、Agent 调用权限开关。
- **状态**：UI 完备，底层通过中枢 `omnimux_accounts_*` 执行，建议将垂直账号工具标准化。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 查询账号列表与授权状态 | 账号一级页卡片与表格 | `accounts_list` | L1 | `Implemented` | 否 |
| 修改账号分组或 Agent 权限开关 | 账号卡片 Switch 与分组设置 | `accounts_update_group` | L2 | `Implemented` | 否 |
| 账号卡片排序与筛选偏好 | 筛选栏选择器 | — | UI-Only | `UI-Only` | 豁免 (前端本地排序) |

---

### 3.10 `omnimux-analytics`（数据分析中心）
- **功能域**：账号多维数据看板、粉丝增长趋势、内容衰减曲线、周报月报生成。
- **状态**：数据管道监听完备，底层通过中枢 `omnimux_analytics_*` 8 大工具提供支持。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 查询指定账号或全局核心指标 | 概览卡片与趋势图表 | `analytics_query_metrics` | L2 | `Implemented` | 否 |
| 生成结构化数据分析周报/月报 | 一键生成总结报告按钮 | `analytics_get_summary` | L2 | `Implemented` | 否 |
| 图表 Hover Tooltip 渲染 | ECharts 鼠标悬停交互 | — | UI-Only | `UI-Only` | 豁免 (DOM 临时渲染) |

---

### 3.11 `omnimux-video`（视频计算引擎）
- **功能域**：Headless 纯后端视频解析、深度图预估、AI 逆向提示词拆解。
- **状态**：双面就绪 (已实装 4 个计算工具)。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 执行 FFmpeg 基础转码与视频切片 | 内部处理引擎 | `video_process` | L1 | `Implemented` | 否 |
| 提取视频关键帧并生成深度图序列 | 深度预估管线 | `video_depth` | L2 | `Implemented` | 否 |
| 分析视频场景、镜头运镜与色彩 | AI 视频分析服务 | `video_analyze` | L2 | `Implemented` | 否 |
| 逆向拆解视频生成结构化提示词 | 提示词工程管线 | `video_reverse_prompt` | L2 | `Implemented` | 否 |

---

### 3.12 `omnimux-video-preview`（视频流媒体预览）
- **功能域**：基于 HTTP 206 Range 的轻量本地视频流播放器，支持全功能视频分镜与结构拆解及侧边栏高保真预览。
- **状态**：已实装 2 个工具。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 查询本地视频流元数据与播放 URL | 播放器组件加载 | `video_preview_info` | L3 | `Implemented` | 否 |
| 分析视频分镜与结构拆解并自动打开侧边栏预览 | 视频分析侧边栏预览 | `video_breakdown_analyze` | L2 | `Implemented` | 否 |
| 播放器全屏与音量拖拽控制 | 播放器控件条 | — | UI-Only | `UI-Only` | 豁免 (前端媒体交互) |

---

### 3.13 `omnimux-avatar`（数字人管理）

- **功能域**：结构化角色设定（18 分类 × 170 选项 × 3 档位）、角色设定图生成与多视角设定板派生、形象任务管理；生成结果自动归档到资产库「角色」分类，多视角图归档到该形象自己的「多视角」文件夹。
- **状态**：已实装 9 个工具（双面齐备）。

| 业务功能描述 | 对应 UI 交互 / HTTP 路由 | Agent 工具名称 (`Tool Name`) | 分级 | 状态 | 破坏性 confirm |
|---|---|---|---|---|---|
| 新建一个数字人（默认名「未命名」，双击可改名） | 左栏「+」/ `POST /api/omnimux/avatar/avatars` | `avatar_create` | L1 | `Implemented` | 否 |
| 列出全部数字人及其最新任务状态 | 左栏「数字人」切换器 / `GET /api/omnimux/avatar/avatars` | `avatar_list` | L2 | `Implemented` | 否 |
| 读取单个数字人的完整设定与任务历史 | 形象详情 / `GET /api/omnimux/avatar/avatars` | `avatar_get` | L2 | `Implemented` | 否 |
| 更新数字人的名称或设定参数 | 双击名称改名 / 设定面板保存 / `POST /api/omnimux/avatar/avatars/update` | `avatar_update` | L1 | `Implemented` | 否 |
| 删除数字人（含其托管文件） | 数字人删除按钮 / `POST /api/omnimux/avatar/avatars/delete` | `avatar_delete` | L1 | `Implemented` | 是 (`confirm: true`) |
| 按形象设定提交一次角色设定图生成 | 底部「生成」/ `POST /api/omnimux/avatar/sheet` | `avatar_generate` | L1 | `Implemented` | 否 |
| 由形象主图派生多视角设定板 | 主图弹窗「生成多视角」/ `POST /api/omnimux/avatar/multiview` | `avatar_multiview` | L1 | `Implemented` | 否 |
| 查询形象的任务列表或单条任务状态 | 历史记录画廊 / `GET /api/omnimux/avatar/tasks` | `avatar_tasks` | L2 | `Implemented` | 否 |
| 把形象主图与多视角同步到资产库「角色」分类 | 生成成功后的自动归档 / `POST /api/omnimux/avatar/sheet` | `avatar_library_sync` | L1 | `Implemented` | 否 |
| 选项卡片悬停标签、图片放大预览、视图平移 | 卡片与弹窗 | — | UI-Only | `UI-Only` | 豁免 (前端视口交互) |

---

## 4. 长效治理 SOP：新功能注册与全链路开发规范

当开发团队需要为任何插件开发新功能时，必须遵循以下 **SOP 5 步闭环**，实现「方案自制定、代码双面写、工具自动查」：

```text
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ 1. 需求与契约   │ ──> │ 2. 领域服务层实现 │ ──> │ 3. 双面接口挂载   │ ──> │ 4. 清单文件登记   │ ──> │ 5. CI 门禁验证   │
│ PRD 填双面契约  │     │ Domain Dispatcher│     │ UI HTTP + Tool   │     │ inventory.md 注册│     │ pnpm verify:tools│
└─────────────────┘     └──────────────────┘     └──────────────────┘     └──────────────────┘     └─────────────────┘
```

1. **Step 1：PRD 阶段必须定义 Tool 契约**：
   在需求评审阶段，开发者必须在 PRD 中明确该功能的 Tool 命名、参数 Schema、返回值及错误枚举。
2. **Step 2：优先实现纯粹的领域服务层 (Domain Service)**：
   在 `src/` 中创建或扩展单例 Store / Dispatcher，将业务规则、状态流转、数据落盘完全封装，不依赖 Web 框架。
3. **Step 3：双面接口同时挂载**：
   - HTTP 侧：在 `http-routes.js` 中添加路由，调用 Domain Service；
   - Tool 侧：在 `tools.js` 或 `index.js` 中使用 `ctx.tools.register` 挂载工具，直接调用同一 Domain Service 方法。
4. **Step 4：在契约清单中登记 (inventory.md)**：
   在本文档中录入新工具条目，标记为 `Implemented`。
5. **Step 5：运行自动化门禁测试**：
   本地运行 `pnpm verify:tools`，确保 4 维检查全部通过（0 错误 0 告警）方可提交 PR。

---
*本文档为 OmniMux 插件双面交付权威契约（L1），由 CI 门禁脚本持续强制校验。*
