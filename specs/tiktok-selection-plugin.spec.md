# TikTok 跟爆选品插件（`omnimux-tiktok-selection`）产品与技术规格

- **状态**：实施中
- **所属包**：`plugins/plugins/omnimux-tiktok-selection`
- **工作台入口**：左侧栏「更多」菜单注册项「跟爆选品」（`id: tiktok-selection`，Tab ID：`omnimux-tiktok-selection:workbench`），通过 `window.__omnimuxSidebar.registerExploreItem` 注册并保留收敛后的 `createWorkbenchSidebarEntry` 作为独立 DSH 兜底入口
- **存储域**：`$DSH_HOME/omnimux/tiktok-selection/`

## 一、目标与核心范围

构建面向跨境电商与 TikTok Shop 选品场景的独立 OmniMux 一级插件，覆盖以下完整业务闭环，并保持 Web UI 与 Agent 工具双面同源：

1. **多源选品发现**：
   - 类目热销榜查询与关键词多维检索（消费 Hub `ctx.get('socialData')` / `ctx.get('tiktok')` 公共接缝，按站点与类目拉取实时商品与带货参考视频）。
   - 外部选品表导入（CSV / JSON 快照导入，支持带 7 天/28 天销量、佣金率、达人数、商品卡占比、视频占比字段的完整三闸分析）。
   - 商品详情抽屉（完整属性、VOC 评价摘要与 Top-10 带货参考视频加载）、列显隐设置与入库去重标记。
2. **三闸批量筛选引擎（G1 → G2 → G3）**：
   - **试拉预估（Dry-Run）**：先预览首页命中规模，展示接口上限/页数截断提示、各阶段调用预估与并发度（1–8）控制，确认后再创建任务。
   - **G1 本地量化初筛**：支持总销量上限、7 天销量区间、带货达人数区间、佣金率下限、评分下限、上架天数窗口、28 天加速基数及加速倍数（`7天日均 ÷ 28天日均`）；逐条记录机器原因码与计算明细。
   - **G2 渠道占比核验**：校验近 30 天商品卡 GMV 占比下限与视频占比上限；当实时数据源缺少渠道拆分指标时，显式按任务策略处理（标注缺失跳过或严格拦截），绝不伪造数值。
   - **G3 合规风控与自动入库**：先执行本地品牌词表、敏感词表与排除品类硬拦截，再通过 Hub `ctx.get('headlessSkill')` 调用标准技能 `tiktok-selection-risk-audit` 输出严格 JSON Schema 结论；模型不可用或解析失败时记为未完成，不静默放行；通过商品自动去重入库。
   - **任务全生命周期控制**：支持任务列表查询、5 节点交互式漏斗详情、执行日志、逐条证据抽屉、单行改判（忽略/删除）、停止、重试未完成与复制条件再跑，并通过 `hubEvents` 广播进度。
3. **选品库与素材工坊**：
   - 选品库支持多维筛选、列设置、批量改选品状态（`pending_review` / `approved` / `rejected` / `recheck`）与评估备注、批量渠道与详情补齐、批量移除，以及一键同步至 OmniMux 商品库（`products_create`）。
   - 爆款视频脚本重写走 Hub `ctx.get('headlessSkill')`（标准技能 `tiktok-selection-video-script`）；生图（3:4，单品上限 10 张，单批上限 60 张）与生视频（9:16，5 秒，单品上限 5 个，单批上限 20 个）复用 Hub `imageGenerate` / `videoGenerate` 与 `modelCatalog` 动态默认配置。
   - 独立素材中心视图集中管理已生成或生成中的商品素材。
4. **自动选品调度与风控配置**：
   - 定时自动选品任务配置（数据源、周期、执行时间、时区、拉取页数、单次入库上限、自动生图开关、启停与手动立即执行）与 12 列执行记录审计表。
   - 品牌词与敏感词分表维护（CRUD、批量导入、启用/停用、来源标记），入库前自动扫描商品标题与店铺名。
   - 系统配置（并发数 1–8、每日素材生成上限、G3 排除品类清单、缺失指标默认策略与 Hub 接缝状态展示）。

## 二、架构边界与硬约束

- **Hub 单一集成层**：本插件不直接访问 `ctx.llm`、不内置第三方 HTTP 客户端、不读写凭据或密钥；所有外部数据、模型推理与媒体生成均通过 `ctx.get('socialData')`、`ctx.get('headlessSkill')`、`ctx.get('imageGenerate')`、`ctx.get('videoGenerate')`、`ctx.get('modelCatalog')`、`ctx.get('hubEvents')` 与 `ctx.tools.get('products_create')` 接缝调用。
- **双面同源与破坏性守卫**：HTTP 路由（`/omnimux/tiktok-selection/*`）与 18 个 `tiktok_selection_*` Agent 工具共享同一 `Dispatcher` 与本地原子 `Store`。删除商品、删除定时任务、删除风险词、删除闸口记录等破坏性操作强制要求 `confirm: true`。
- **视觉与滚动契约**：Client UI 100% 消费 `dsh-ui-kit` 与官方 `--dsw-alias-*` / `--dsw-specific-*` 语义 Token，遵循 `.omx-stage-scroll` / `.omx-stage-sticky` 滚动契约，浮层容器使用实体背景变量禁止透底，文案不使用中点分隔符与冗余说明。

## 三、假设与证伪方式

| 假设 | 证伪方式与通过条件 |
|---|---|
| 双模数据源（Hub `socialData` + CSV/JSON 导入）可在无私有第三方代理时完整跑通选品与三闸流程 | 单元测试与集成测试分别覆盖 Hub `socialData` 响应归一化与 CSV/JSON 导入解析；当实时源缺失渠道占比时显式产出 `G2_CHANNEL_DATA_MISSING` 而不静默伪造。 |
| G3 合规风控采用「本地词表 + 排除品类 + Hub `headlessSkill` JSON Schema」可在模型异常时 fail-closed | 注入异常/非 JSON/离线返回，断言任务项落为 `incomplete` 且不被写入选品库；命中排除品类或 `brandRisk=confirmed` 时即使模型返回 `pass:true` 也强制拦截。 |
| 客户端在亮/暗双主题、窄屏与展开浮层下无透底、无横向裁切与无控件错位 | 在真实浏览器对高保真演示与编译产物 `lib/client.js` 执行亮/暗/窄屏/弹层检查并留存截图证据。 |

## 四、验收清单

- [ ] `plugins/plugins/omnimux-tiktok-selection` 单元测试与双面集成测试全绿。
- [ ] `corepack pnpm --dir plugins run build:all` 构建成功并产出 `lib/client.js`。
- [ ] 全仓门禁通过：`check:boundaries`、`verify:product-baseline`、`verify:silent-catch`、`check:package-files`、`verify:licenses`、`verify:tools`、`test:agent-tools`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`guard:popover`、`registry:verify`。
- [ ] 真实浏览器端到端验证通过（覆盖发现导入、三闸试拉与任务漏斗、选品库状态与素材弹窗、定时任务、风险词与配置，含亮/暗双主题与窄屏）。

## 旧标准变更

- `plugins/scripts/verify-license-consistency.test.mjs` :: `真实仓库：14 个插件全部登记且通过`
  原断言：真实仓库磁盘插件目录数固定为 14，许可类别计数为 `{ original: 9, fork: 3, vendor: 2 }`。
  必须改的理由：本 PR 新增原创插件 `omnimux-tiktok-selection`（`class: original`），全仓插件目录数变为 15，original 计数变为 10；该用例是「与真实仓库一致」的快照断言，必须随插件集合更新。
  新期望证据：`verify:licenses` 与 `test:licenses` 全绿，`verifyLicenseConsistency` 返回 `errors=[]`、`warnings=[]`、`counts={ original: 10, fork: 3, vendor: 2 }`，且注册表键集合与磁盘目录集合完全一致。
