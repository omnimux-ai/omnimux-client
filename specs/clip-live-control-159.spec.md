# 剪辑实时控制与画布回写（#159 阶段 2）

目标和验收以 [#159 PRD v1.0](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 为准。工作树基线为 `b1e9bc12b53344f0639c5cd00d65ab50d7b98044`。这份草稿供合入前审查，端到端验收以最终候选构建的运行记录为准。

## 目标与范围

用户在左侧主对话要求编辑当前工程时，右侧实际可见的剪辑器完成操作，时间轴和预览随之更新。用户可以在画布 Portal 和独立剪辑页之间交接草稿，在同一撤销历史内交错使用手工与 Agent 编辑，并在明确提出导出时得到可播放的成片。画布导出的成片引用和下游连线在退出、重开后仍可用。

阶段 2 涵盖原生工程迁移、双入口租约与上下文、原生执行、编辑持久化和导出回写。阶段 1 的交付按 [#160](https://github.com/omnimux-ai/omnimux-client/issues/160) 回归，顶栏 AI 剪辑入口按 [#157](https://github.com/omnimux-ai/omnimux-client/issues/157) 独立验收。保持桌面壳运行接口和现有 Hub 事件通路。

## 假设

- [#154 的 OpenReel v1 升级](https://github.com/omnimux-ai/omnimux-client/issues/154) 提供两个入口共用的原生工程、时间轴、撤销和渲染。阶段 2 采用同一个原生 Store 执行所有编辑。Host 负责工程版本、验证和落盘。旧时间轴、裸装或包装的原生 UUID、画布草稿均可读为统一的 v1 工程。需要写入迁移时保留原始内容和可用的媒体身份。
- [#160 的画布归属与实时控制合同](https://github.com/omnimux-ai/omnimux-client/blob/b1e9bc12b53344f0639c5cd00d65ab50d7b98044/plugins/docs/contracts/clip-live-control.md) 已建立工作区、节点和工程的三元组。继续让 Workflow 持有画布身份和版本，并复用下游规划器。运行命令的会话和窗口由现有 Hub WS 与同源 HTTP 证明建立，浏览器实际可见的工作面和项目决定租约是否可用。
- 保存序列由 `revision` 管理，写入比较前置版本。切换入口先保存本地 IndexedDB 和尝试同步 Host，再释放源租约和加载目标。导出拥有独立的 `exportJobId` 与固定工程版本，按源画布绑定提交。迟到回执和导出文件可分别核对，画布冲突后重读并重新验证绑定。

## 交互与工具契约

- 画布入口保留 `omnimux-workflow:canvas`，按 `(workspaceId, nodeId, projectId)` 打开 Portal。独立入口为 `omnimux-clip:studio`。同一渲染进程最多一个可写入口。切走先刷盘，隐藏 Portal 可保活。退出保存后释放，节点依据成片状态回到 `completed` 或 `idle`。切回读目标最新草稿。退出后的画布上下文清除剪辑投影。
- 两侧 `<ui_context>` 由 contributor 上报 `mode`、`projectId`、`title`、`revision`、`playheadSec`、`durationSec`，最多三条选段摘要，各含 `id`、`name`、`trackId`、`startSec`、`endSec`。画布附加 `workspaceId` 和 `nodeId`。只投影安全短字段，文件路径、媒体字节、脚本和租约证明留在原有边界。
- 一般剪辑工具沿已认证租约执行。无目标时可使用唯一可见的编辑器，有多窗口或显式目标与当前入口冲突时返回 `AMBIGUOUS_TARGET` 和安全候选。明确的落盘工程可通过只读工具查档，已分配 ID 的新节点未初始化时返回 `project-not-materialized`。无可见入口和无连接分别给出结构化错误。显式 `clip_open` 按目标入口导航并等对应可见租约，通用工作面跟随对 Clip 工具保持静默。
- 保持 `clip_list`、`clip_create`、`clip_open`、`clip_get`、`clip_edit`、`clip_view`、`clip_snapshot`、`clip_diagnostics`、`clip_export` 九个工具。`clip_get` 优先返回实时安全快照，支持 `summary`、`tracks`、`clips`、`full`。看黑场时按 80 ms 阈值报告，另报同轨重叠、缺失素材和越界裁剪。实时播放、选择和截帧复用原生状态，PNG 单次最多六帧。工具使用秒和结构化 `ClipDomainError`。
- `clip_edit` 支持轨道增删和状态、素材导入与 `mediaId` 上轨、裁剪、分割、移动、删除、范围收拢和剪静音、音量和变速、字幕与花字、原生转场。静态效果字段限原生不透明度、变换及内置滤镜。`validateOnly` 跑同一校验且保持工程、版本与历史。有效批次按 `description` 增加一条原生撤销记录，失败则整批回滚。快照与播放独立于 Undo。常规编辑遵循本轮意图，删除非空整轨、清空时间轴或操作另一工程需要明确授权。Motion 代码执行继续由右侧编辑器人工审批，Agent 工具拒绝代码和授权字段。
- 手工修改 1.5 秒防抖保存。Agent 编辑立即保存本地并尝试同步 Host，回执报告实际版本和同步状态。`baseRevision` 保护用户同期编辑，`requestId` 保护已执行指令重取回执。Host 断连时保留 IndexedDB 草稿，回连比对本地基线和 Host 版本。分叉时提供保留本地、采用最新、另存副本三项并按合同保留相应备份。媒体只通过已校验的素材引用，迟到导入以原三元组和绑定令牌判定归属。
- 只有本轮明确要求导出才可开始 `clip_export`。浏览器对固定版本运行 WebCodecs，Host 校验上传证明并保存独立版本 MP4。Workflow 复用 `planClipExportDownstream` 按 `expectedVersion` 提交源节点、下游视频和边。晚到旧任务标记 `superseded`，节点保留更新成片。`fileSaved` 和 `canvasCommitted` 分别反映文件与画布结果，画布卸载后仍按原归属提交。

## 证伪方式

在隔离桌面 Dev 用最终 PR 候选构建执行。记录构建指纹、每项的操作和结果。连续编辑、退出重开以及撤销重做沿同一节点顺序操作。对亮暗主题、窄屏和打开态浮层复查可见性和操作命中。

| 验收项 | 操作与判定 |
| --- | --- |
| AC-P2-01 原生工程迁移 | 从旧 `TimelineSchema`、裸装与包装的原生 UUID、画布旧草稿各开一次并重开。核对轨道、片段秒数、字幕、素材 ID、引用和可恢复的原档。迁移重试沿用同一目标，出现丢数据、串 ID 或重复迁移即失败。 |
| AC-P2-02 首轮上下文 | 先在独立页选择片段并定位播放头，立即在左侧发一轮。画布 Portal 重走同一操作，再点击退出。两种首轮均核对模式、工程、标题、版本、播放头和选段，画布额外核对三元组。退出后仅保留画布上下文。任何非白名单字段进入上下文即失败。 |
| AC-P2-03 画布首次物化 | 从带上游视频、音频或字幕的节点打开 Portal，检查 Host 已保存同一 `clip_node_…` 和真实可用的 `mediaId`。退出、重入两次，素材数量和身份稳定。分别发无窗口证明的物化和工程 PUT，两者返回 403 且文件与草稿指针保持原值。 |
| AC-P2-04 单一编辑权 | 画布先改草稿并切去独立页修改另一工程，再切回。核对首次切走已保存原稿、两次提交仅写入各自工程、重入使用最新已存版本。再切到资产页并试实时命令，确认隐藏状态拒绝执行。 |
| AC-P2-05 多窗与歧义 | 同会话打开两个可见编辑器，分别发省略目标和目标与当前入口冲突的写命令。校验 `AMBIGUOUS_TARGET`、候选和双方版本保持原值。指定一个正确窗口后，只允许该窗口领取和编辑。 |
| AC-P2-06 实时编辑 | 从左侧完成加轨、按 `mediaId` 上轨、裁剪、分割、移位、音量/静音、字幕/花字和转场。核对右侧预览与时间轴、Host 版本及再次 `clip_get` 的状态。场景同时覆盖画布入口和独立入口。 |
| AC-P2-07 失败原子性 | 预演有效批次后发送半合法批次，例如先加轨再指定离边界不足 80 ms 的切点。核对返回错误，项目、版本、历史和已存在的 Redo 保持原值。 |
| AC-P2-08 播放与截帧 | 新增可见字幕后 `seek` 到指定秒，再对该时间截 PNG。对照真实播放头、原生工程分辨率和画面里的字幕及素材。编辑历史保持不变，1×1 或仅文件路径的回执应拒绝。 |
| AC-P2-09 单步撤销重做 | 一次 Agent 批次包含多条操作，其后手工编辑一次。按平台快捷键依次撤销手工、撤销整批，再重做两次。逐步比较预览、历史和 `clip_get` 的 Host 版本。 |
| AC-P2-10 冲突和幂等 | 让手工编辑发生在命令下发和领取之间，收到 `REVISION_CONFLICT` 时检查最新编辑完好。扣留已执行命令的回执并按同一 `requestId` 查询，确认只发一次且重取原返回值。同 ID 改参数或改窗口须拒绝。 |
| AC-P2-11 迟到导入 | 暂缓节点 A 的素材读取，切到节点 B 后释放 A。查两端实际素材库和时间轴，B 保持原值。复制已有节点后分别编辑，检查新的工程 ID 和操作归属。 |
| AC-P2-12 离线与分叉 | 断 Host 后继续编辑，检查 IndexedDB 和离线状态。按无分叉与有分叉两类恢复。对分叉分别试保留本地、采用最新、另存副本，核对原档/备份、新版本和两主题下可操作的非模态选项。 |
| AC-P2-13 导出和回写 | 两入口分别明确触发真实 WebCodecs 导出。用 `ffprobe` 核对可解码 MP4 的视频、音频、时长。画布已打开、退出后返回两种场景均检查源节点 `completed`、匹配 `rev` 的下游视频和同一 `out → in` 连线。让两次导出逆序回报，再重开验证旧任务 `superseded`，同一个下游节点保留较新结果。 |
| AC-P2-14 安全与壳 | 验证桌面壳运行代码差异为空。运行 Motion 权限回归并在编辑器核对未审批代码保持暂停、路径越界和工具伪造授权均失败。核对浏览器保持现有服务边界。 |

主路径使用同一份本地带音频的视频。画布以「加字幕并裁掉前 1 秒」串起编辑、截帧、撤销重做、导出和重开。独立页以选段、定位、编辑和导出验证可见租约及首轮上下文。保存竞态用截留真实回执或受控传输夹具重现，以落盘工程与版本为准。更新工具行为时同步复核工具清单和阶段协议。

## 本地测试证据

使用 CI 同版本 Node `24.18.1`。直接从 `HEAD` Git blob 调用仓库的 `inspectTestStandardChange`，9 个分派文件全部可解析，3 个可直接通过、6 个共需 13 条具名声明，不可声明项为 0。按 CI 的声明收集与匹配函数读入该草稿，13 条均与当前差异匹配，缺失及多余条目均为 0。CI 声明脚本的回归套件 `node --test scripts/verify-test-standard-declarations.test.mjs` 通过 25 项。`corepack pnpm --config.verify-deps-before-run=false --filter omnimux-clip test` 通过全部 202 项，Workflow 带 `--import ./test-setup.mjs` 的定向及画布事件测试通过 88 项，Hub 跟随测试通过 21 项，跳过均为 0。该次为工作树单测和静态审计，真实 CI、实机端到端、真实模型调用和人工视觉验收仍待各自证据。

## 旧标准变更

- `plugins/plugins/omnimux-clip/src/client/host-locale.test.js` :: `both Clip surfaces receive and subscribe to host locale without locale-key remounts`
  - 两入口开始接收实时编辑会话，原匹配要求闭合旧的精确参数列表。现检查两处真实传入的 `ctx.locale` 字段，保留订阅、无 locale-key 重挂载、Portal 保活、退出翻译和顶栏按钮顺序的断言。相邻渲染测试实际切换语言，覆盖保存中、成功、失败和重开。
- `plugins/plugins/omnimux-clip/src/export-upload.test.js` :: `原始字节上传仅对 save-export 生效，普通 PUT 仍走 JSON 且不写导出目录`
  - 原 PUT 将 `{}` 视为有效工程并回 `saved: true`。原生工程 PUT 要求工程快照及预期版本。二进制和缺版本 JSON 返回 400，连项目目录也保持空白。带原生快照和版本的同一 PUT 返回 200 并校验实际落盘。保留无导出文件和临时文件的断言。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_edit is one undo step and validateOnly does not persist`
  - 原用例直接检查旧 Host `TimelineSchema.history`。编辑执行迁移至原生编辑器。Host 测试经真实命令领取和回执校验拒绝冒充写入的预演，确认成功预演版本和磁盘字节原样，实际编辑回执必须推进版本并声明单步。原生执行测试通过真实 Store 核对批次只增加一条历史、预演不改状态、手工与 Agent 共栈和整批撤销重做。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `includes the stable code in the registered tool error shown by the Harness`
  - 已注册的 `clip_open` 从阶段 1 的 `ui-unavailable` 演进为无认证窗口时的 `EDITOR_OFFLINE`。注册入口仍核对 `[code]` 前缀，未物化工程的代码断言保留。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `isolates a directory named like a project file in tools and HTTP`
  - 原用例把原生 UUID 归到 `openreel-migration-required`。现用完整旧原生工程验证可读，损坏 JSON 和目录仍独立标记。保留工具/HTTP 列表一致、目录 409、相同错误文案及清除本地错误细节的断言。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `missing projectId and unknown project throw ClipDomainError, never { ok: false }`
  - `clip_get` 支持按可信会话选择唯一可见工程。缺工程 ID 也缺可信会话时返回 `SESSION_REQUIRED`。显式不存在仍抛 `not-found`。活跃目标选择另由命令测试验证。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `reports native projects and invalid files alongside readable legacy projects`
  - 裸装和包装的原生草稿进入可读项目列表，旧 `openreel-migration-required` 变为 HTTP 200 与可读工程投影。旧时间轴仍可读且源字节保留。保留损坏文件单列、限制条数、文件内容脱敏与未物化节点错误。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `reports saved format and live availability without changing any files`
  - 原用例把所有实时及只读工具当成按旧文件状态返回同一组错误。现用真实已保存的两种格式核对只读查询，`clip_open` 保留目标身份检查并在无窗口时报 `EDITOR_OFFLINE`。播放、截帧和导出按窗口/租约区分断连与隐藏。保留坏 ID、缺档、未物化、字节不变、无新导出任务及无截帧文件的检查。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasNodeShell.test.mjs` :: `VideoCompositionNode 契约：接入 Shell/Header/Pill/Launcher/GSC 与状态映射模块`
  - 原用例要求单节点组件包含事件桥、上游收集和宽度定义。应用级桥接管事件及素材，组件经 `CanvasClipLauncher` 发起，350 宽度由共享规划器提供。保留共享 UI、状态映射、尺寸和 executorKey 约束。事件用例实际验证打开、上游版本、保存、进度和退出归属。
- `plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.test.mjs` :: `videoComposition.tsx 把版本串存进节点数据并回填给 plan（两个 effect 不互相剥离 rev）`
  - 保存事件将版本写到源节点的责任移到画布桥。替换旧字符串断言，实际派发两次保存，经同一图变更入口、持久化净化和重载检查源节点、同一个下游节点、唯一连线与最新 `rev`。保留组件把已存 `outputRevision` 交回规划器的检查。
- `plugins/plugins/omnimux/src/workbench/surface-follow.test.js` :: `保留已绑定的画布剪辑工作面，未绑定或跨工作区提示仍走独立跟随`
  - 已正确绑定时继续保持画布。未绑定及跨工作区提示也必须保持画布，租约选择返回结果或错误。宿主挂载测试对三种场景均断言切页 RPC 数量为零。
- `plugins/plugins/omnimux/src/workbench/surface-follow.test.js` :: `剪辑查询与未接通的实时工具在任何工作面都不触发跟随`
  - 原用例为 `clip_edit` 单独期待自动打开独立工作面。阶段 2 实时工具由已认证编辑器执行，只有显式 `clip_open` 发定向打开。宿主挂载测试在媒体页、独立剪辑页和画布分别核对适用的无通用 RPC 行为。
- `plugins/plugins/omnimux/src/workbench/surface-follow.test.js` :: `把各工作面工具解析到对应页签`
  - 旧映射将 `clip_edit` 导向独立页。现从通用映射撤出，按目标租约执行，故预期 `null`。其他工作面工具映射全部保留。
