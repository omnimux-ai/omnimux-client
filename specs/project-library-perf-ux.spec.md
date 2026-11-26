# 规格：创作画布 / 项目页加载性能与 UI 交互体验优化

## 背景与目标

`omnimux-workflow` 的「创作画布 / 项目」一级工作台页（`ProjectLibraryPage.jsx`）在项目数量增长至数十个及以上时，存在以下可复现的性能瓶颈与界面交互短板：

1. **封面缩略图全局单链串行阻塞**：`coverThumbnail.js` 使用全局单条 `tail` Promise 链串行处理所有封面请求，连持久化 Cache API 命中也要排队并反复执行 `createImageBitmap` 校验；单张慢图或视频超时（10–20s）会阻塞后续全部卡片停留在 `•••` 加载态；超过 32 张并发挂起即抛出 `thumbnail-queue-full` 退回原图解码。
2. **后端列表接口低并发阻塞与重复文件校验**：`ProjectStore.scanForRead` 本地并发仅 3、外部目录逐个串行；`ProjectCoverService` 并发仅 2 且每次 `GET /api/projects` 均等待全部项目的全部画布封面与 `mediaRevision` 计算完成才返回；`serveFile.ts` 对本地媒体写死 `Cache-Control: no-cache` 且无 `ETag` / `304`。
3. **重度合成与页面交互缺口**：`ProjectFolderCard` 全量渲染无视口跳过，每张卡叠加双份 `<img>` 与 `blur(24px) saturate(1.15)` 离屏模糊，音频占位渲染 160 个独立 `<path>`；顶栏含冗余副标题、独占一行的「新建项目」按钮与分割线（约 180px）且未接入一级页整页滚动 + Tab 吸顶契约；冷启动无骨架屏会先闪出「暂无项目」；搜索无结果误用空库文案；缺少来源筛选与排序；二级项目详情页 `/api/projects/:id/files` 在 Host 主线程使用同步 `readdirSync` / `statSync`，并存在硬编码假日期与不可点击死按钮。

目标是在不破坏既有项目档案、封面契约与全部已登记 E2E/单测前提下，实现首屏秒开、零队头阻塞、轻量化文件夹视觉打磨、紧凑吸顶顶栏、筛选排序闭环以及二级详情页异步化硬化。

## 研究与决策依据

- **对标与仓内真源**：遵循 [dsh-ui-kit](plugins/packages/dsh-ui-kit/README.md)、宿主运行时 `--dsw-alias-*` / `--dsw-specific-*` 语义 Token 白名单（`verify-dsw-tokens.mjs`）以及全仓一级页整页滚动 + Tab 吸顶契约（`verify-stage-scroll-contract.mjs`）。
- **核心取舍**：
  1. 保留文件夹识别造型与 `POCKET_PATH` 蒙版轮廓，用纯令牌多层渐变替代第二张 `<img>` + `blur(24px)` 离屏模糊，兼顾品牌辨识度、亮暗双主题纯净度与滚动帧率。
  2. `GET /omnimux-workflow/api/projects` 默认行为保持全量返回封面以 100% 兼容外部调用方；新增 `?covers=none` 与批量 `POST /omnimux-workflow/api/projects/covers` 支撑客户端两阶段渐进渲染。
  3. 列表 `DropdownSelect` 首项严格使用「全部」而非「全部+维度」，所有文案杜绝中点分隔符，不因排序/筛选/切页新增冗余 Toast 播报。

## 假设

1. **首屏延迟假设**：将项目列表拆分为「快速元数据首屏（`?covers=none` + 并发度 8）+ 视口优先批量封面回填（`POST /api/projects/covers`）」，并配合模块级 SWR 缓存与 12 卡几何骨架屏，可在 60 个项目样本下将首屏可交互渲染时间降低 60% 以上，并彻底消除回切页签白屏与冷启动「暂无项目」空态闪现。
2. **封面并发与队头阻塞假设**：将持久化 Cache API 查找移出解码并发队列，图片（并发 4）与视频（并发 2）分池并支持 `AbortSignal` 取消，再叠加会话级内存 LRU `ObjectURL` 池，可使 1 张慢图/视频不再阻塞已缓存或同屏其他图片卡片，且 60+ 卡片并发滚动不再触发 `thumbnail-queue-full`。
3. **视觉与交互清晰度假设**：移除 `•••` 字符加载圆点改用几何骨架占位、去除双图重模糊并给图片封面补中性内描边与柔化压暗层、标题锁定单行对齐并展示创作页数与等宽日期、将「新建项目」收敛进单行 `PageHeader` 并接入整页滚动与吸顶筛选排序栏，可在亮/暗双主题及宽/窄视口下显著提高首屏卡片露出量与信息扫视效率，且不破坏任何已有菜单、键盘导航与工作区激活契约。
4. **详情页异步化假设**：将 `GET /api/projects/:id/files` 改为全异步 I/O 并在客户端延迟至切到「项目资产」页签时按需请求，可消除进入项目详情时的 Host 主线程阻塞，同时修复假日期、死图标与面包屑不可键盘聚焦缺陷。

## 证伪方式

1. **后端渐进加载与异步 I/O 证伪**：在 `projectListRead.test.mjs` 与基线脚本中构造 60 个含画布与媒体引用的项目，对比改前全量 `GET /api/projects` 与改后 `?covers=none` + 批量 `/covers` 耗时；通过 `t.mock.method(fs, 'readdirSync')` / `statSync` 断言 `GET /api/projects/:id/files` 同步 I/O 调用次数严格为 `0`（回退修复即失败）。
2. **HTTP ETag / 304 证伪**：在 `fileStream.test.mjs` 中验证同文件携带 `If-None-Match` 返回 `304`、文件改写后返回 `200` 新内容、`Range` 请求仍返回 `206` 且不误返 `304`、`mediaDigest` 不匹配仍返回 `409`。
3. **封面并发池与无队头阻塞证伪**：在 `coverThumbnail.test.mjs` 中构造 1 张挂起的慢响应图片/视频与多张缓存/正常图片并发调用，断言正常图片与 Cache 命中均在慢图未完成前即刻返回；同时并发触发 40 张不同卡片断言不抛 `thumbnail-queue-full`；取消 `AbortSignal` 断言排队任务不再触发解码。
4. **UI 交互、门禁与真实浏览器双向证伪**：
   - 先交付高保真前后对照 HTML 演示并在真实浏览器中核对亮/暗主题、宽/窄视口、骨架屏、白底图柔化与打开态浮层；
   - 在 `ProjectFolderCard.test.mjs`、`projectLibraryPage.apps.test.mjs` 与新增 E2E 测试中验证无 `•••` 文本加载徽标、无 `.omnimux-folder-glass-image` 双图模糊、来源筛选（首项 `全部`）、排序、搜索无匹配空态与「清空筛选」、冷启动骨架屏、按需资产加载与子目录导航；
   - 跑通全量插件门禁（`build:all`、`typecheck`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`verify:dsw-tokens`、`test:ui`、`guard:popover`、`lint:i18n`）并在 worktree 真实浏览器完成亮/暗双主题、宽/窄视口及打开态菜单/下拉实测截图验收。

## 验收项

- **AC-1 后端提速与渐进接口**：`GET /api/projects?covers=none` 返回 `{ projects, coversIncluded: false }`；`POST /api/projects/covers` 批量返回目标项目封面；默认 `GET /api/projects` 保持向后兼容且全量并发扫描保序提速；`GET /api/projects/:id/files` 零同步 I/O；`serveFile` 支持强 `ETag` 与 `304`。
- **AC-2 前端封面无阻塞与会话缓存**：`coverThumbnail.js` 缓存命中不排队、图片/视频分池并发、支持 `AbortSignal` 取消且无 32 上限爆错；会话内重挂载已解码封面 0ms 复用且 LRU 安全释放；`AudioCover` 合并为单 `<path>`。
- **AC-3 文件夹卡片轻量化与视觉打磨**：保留文件夹轮廓与菜单契约，移除双图 `blur` 与 `•••` 徽标，白底图在深色模式下柔化不刺眼，单行标题对齐 + 零补齐等宽日期 + 创作页数（无中点 `·`），悬停轻展与按压反馈（尊重 `prefers-reduced-motion`），展开菜单不被邻卡遮挡。
- **AC-4 顶栏收敛、整页吸顶与筛选排序**：单行 `PageHeader` 内置「新建项目」（保留 `.omnimux-workflow-library-action-row`）、移除冗余副标题与多余分割线；接入 `.omx-stage-scroll` + `.omx-stage-sticky`；提供来源筛选（首项 `全部`）、排序（最近更新 / 名称 A-Z）、冷启动 12 卡骨架屏、搜索无匹配空态与一键清空筛选、可恢复错误重试按钮。
- **AC-5 二级详情页硬化**：进入详情先加载创作页，切「项目资产」才按需拉文件且支持子目录浏览；无硬编码假日期、无死操作图标、面包屑与操作卡键盘可达且全量组件走 `dsh-ui-kit`。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/client/projects/local-tab-placeholder.test.mjs` :: `ProjectLibraryPage mounts a pressed 本地项目 FilterBar tab`
  - 原断言：校验 `ProjectLibraryPage.jsx` 顶栏与标签栏之间渲染独立的 `<Divider />` 分隔线。
  - 变更理由：按 Issue #326 与已确认设计，项目库页收敛为紧凑单行 `PageHeader` + 吸顶 `FilterBar`（自带 `border-bottom` 底线），移除冗余副标题与多余 `<Divider />` 以增加首屏卡片展示面积。
  - 新期望证据：替换为断言 `<FilterBar ... omnimux-workflow-library-filter` 与 `<Tabs variant="underline"` 共存，并由 `tests/project-library-perf-ux.e2e.test.mjs` 及 `plugins/docs/evidence/project-library-perf-ux/01-dark-library-1440.png` 端到端验证。
