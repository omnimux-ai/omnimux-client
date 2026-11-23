# omnimux-tiktok-selection

OmniMux 系列 TikTok 跟爆选品插件（Tier-1 独立工作台应用）。

## 功能概览

- **多源选品发现**：支持通过 Hub `socialData` 实时检索 TikTok Shop 类目与关键词商品，同时支持 CSV / JSON 外部选品快照导入，查看商品详情、VOC 评价与 Top-10 带货参考视频，并支持去重与风险词拦截入库。
- **三闸批量筛选引擎（G1 → G2 → G3）**：
  - **试拉预估（Dry-Run）**：先评估命中规模、接口上限、页数截断与各阶段调用次数，确认后建单。
  - **G1 本地量化初筛**：总销量上限、7 天销量、28 天加速基数、加速倍数（`7天日均 ÷ 28天日均`）、达人数、佣金率、评分、上架天数窗口。
  - **G2 渠道占比核验**：校验近 30 天商品卡 GMV 占比下限与视频占比上限；当数据源缺少渠道拆分指标时，显式按任务策略处理，不伪造数据。
  - **G3 合规风控与自动入库**：本地品牌词表 + 敏感词表 + 排除品类硬拦截 + Hub `headlessSkill`（`tiktok-selection-risk-audit`）JSON Schema 审查；解析失败记为未完成，不默认放行。
- **选品库与素材工坊**：多维筛选、自定义列显隐、状态流转、批量渠道补齐、Hub `headlessSkill` 爆款视频脚本重写（`tiktok-selection-video-script`）、Hub `imageGenerate` / `videoGenerate` 批量生成带货图（3:4，单品上限 10）与竖屏视频（9:16，单品上限 5），以及一键同步至 `omnimux-products` 商品库。
- **自动选品与风控配置**：定时自动选品调度器、立即执行与执行审计记录、品牌词/敏感词管理与运行参数配置。

## 双面交付

- **UI Surface**：侧边栏独立入口「跟爆选品」→ `dsh-better-sidebar` 工作台页签（`omnimux-tiktok-selection:workbench`），消费 `dsh-ui-kit` 与官方 `--dsw-alias-*` Token。
- **HTTP Surface**：挂载于 `/omnimux/tiktok-selection/*`，所有写请求校验本机来源（`assertLocalWrite`）并过滤敏感令牌。
- **Agent Tool Surface**：注册 18 个 `tiktok_selection_*` 工具，与 HTTP 路由共享同一 `Dispatcher` 与本地原子 `Store`（`$DSH_HOME/omnimux/tiktok-selection/`），破坏性操作强制校验 `confirm: true`。
