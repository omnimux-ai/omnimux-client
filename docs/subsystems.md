# 子系统文档与评审

改动前从对应主文档找到行为约定，再沿源码入口核对当前实现。主文档描述已经交付的行为。计划和取舍留在工单或规格。

| 子系统 | 主文档 | 源码入口 | 验证命令 |
| --- | --- | --- | --- |
| 桌面原生文件选择 | [架构说明](../app/docs/architecture.md#插件的原生文件选择) · [英文版](../app/docs/architecture.en.md) | [桌面实现](../app/dsh-plugin-desktop/src/native-file-picker.ts) · [Legacy 主进程](../app/dsh-plugin-desktop/src/electron-shell-generation.ts) · [Legacy preload](../app/dsh-plugin-desktop/src/preload.ts) · [Next 主进程](../app/dsh-desktop-next/src/main.ts) · [Next preload](../app/dsh-desktop-next/src/preload-app.ts) · [共享选择器](../plugins/packages/dsh-ui-kit/src/native-file-picker.js) | 从仓库根运行 `node --test plugins/packages/dsh-ui-kit/src/native-file-picker.test.js`。桌面变更按 [app 规则](../app/AGENTS.md)补受影响的壳测试和运行态验证。 |
| 插件 Agent 工具契约 | [工具契约清单](../plugins/docs/contracts/plugin-agent-tools-inventory.md) | [Hub 注册入口](../plugins/plugins/omnimux/src/host/apply.js) · [工作流工具注册](../plugins/plugins/omnimux-workflow/src/workflow/agent/agentTools.ts) · [工具检查](../plugins/scripts/verify-plugin-agent-tools.mjs) | 从仓库根运行 `corepack pnpm --dir plugins verify:tools` 和 `corepack pnpm --dir plugins test:agent-tools`。 |
| 画布剪辑 | [画布归属与实时控制](../plugins/docs/contracts/clip-live-control.md) | [画布事件](../plugins/plugins/omnimux-workflow/src/canvas/bridge/clipEvents.ts) · [剪辑事件桥](../plugins/plugins/omnimux-clip/src/client/CanvasBridge.js) · [工程 Store](../plugins/plugins/omnimux-clip/src/store/projectStore.js) | 从仓库根运行 `corepack pnpm --filter omnimux-clip test`，按[规格](../specs/clip-phase1-160.spec.md)复测画布。 |
| 画布生成 | [画布生成契约](../plugins/docs/contracts/canvas-generation.md) | [分组能力](../plugins/plugins/omnimux-workflow/src/shared/validation/lineConstraints.ts) · [运行准入](../plugins/plugins/omnimux-workflow/src/workflow/execution/prepareExecutionAdmission.ts) · [网关目录转换](../plugins/plugins/omnimux/src/catalog/gateway-contract.js) | 从仓库根运行 `corepack pnpm --dir plugins run verify:model-contracts`，按[当前规格](../specs/canvas-group-capabilities.spec.md#验收标准)复测桌面。 |

## 更新或新建主文档

现有主文档已负责这项行为时，直接在同一 PR 更新对应段落。新增需要长期维护的子系统或独立行为，而且现有主文档没有合适归属时，在同一 PR 新建一页并挂到上方索引。其他页面用链接引用这份主文档，已有试点拆分出新页时也从原主文档链接到新页。

新页写清职责与边界、实现以哪里为准、主要入口及状态变化、正常结果和相关的失败或兼容行为。链接实际源码和可运行的验证命令。

## 开 PR 前核对

实施 Agent 对照最终 diff 检查接口、默认值、状态转换、运行路径、兼容性和失败行为。对每条实际变化，记录触发条件和改前改后行为，指明更新或新建的文档段落，再列出覆盖该行为的测试或实测结果。例如 `旧壳打开文件选择时改为提示更新 → 架构说明 / 原生文件选择 → 旧壳兼容测试通过`。

只调整内部实现时，写明核对过的页面和行为保持一致的依据。重新推送后更新记录。

保存一份 JSON 数组作为任务私有证据。每个对象有 `subsystem`、`document`、`decision`、`behavior`、`evidence` 五个字段。子系统 ID 为 `desktop-file-picker` 或 `plugin-agent-tools`。主文档使用上表中文页面的仓库相对路径，决定为 `updated` 或 `unchanged`，其余两项为单行说明。

同一子系统有多条变化时，在 `behavior` 逐项编号并写对应段落，在 `evidence` 沿用同一组编号写验证结果。已有试点拆分新页时，`document` 保留原主文档路径，原页补链接后记为 `updated`，新页的路径和段落写在 `behavior`。试点之外新建子系统的记录直接写在 PR，沿用相同的行为、段落和证据格式。

只把可公开的内容放入作者记录。从仓库根运行 `node plugins/scripts/docs-impact.mjs <记录路径>` 生成可粘贴到 PR 的段落，保留段落两侧的标记。

`auto:run` 提供 `OMNIMUX_DOCS_IMPACT_PATH` 给实施命令，也可通过 `--docs-impact` 接收既有记录。作者记录齐备后，脚本在依赖缺失或锁文件、工作区清单变动时，在隔离工作树按锁文件安装依赖。开出试点 PR 后，脚本把任务快照、作者记录和测试证据交还协调 Agent。

## 评审及合并

1. 协调 Agent 刷新目标基线，在干净的任务工作树用 `node plugins/scripts/review-packet.mjs` 生成评审包。传 `--spec` 指向已提交规格，或传 `--issue-snapshot` 指向已核实的 Issue 快照。为每份测试证据传 `--evidence`，试点改动另传 `--docs-impact`。证据里记录完整 head。脚本在提交前跑的测试，由协调 Agent 在干净的候选提交上复验适用项后提交证据。
2. 独立子代理在新上下文读取评审包和 base/head 源码，先列出变化，再逐条核对文档段落和实际验证结果。遗漏行为、表述不符或证据未覆盖声称的行为时，退回原 PR 修补，更新提交后重新派发。子代理直接返回包含提交身份和证据的 JSON，协调 Agent 保存到私有证据目录。
3. 协调 Agent 在本工作树运行 `node plugins/scripts/docs-review-merge.mjs --pr <编号> --packet <评审包> --result <子代理结果>`。命令核对 PR 的文档记录、base/head、评审、必过检查和队列状态，通过 GitHub 的 expectedHeadOid 参数绑定已评提交后入队。合入后按 [仓库交付规则](../AGENTS.md#合并与复核)核对最终版本，适用的 Dev 运行证据由桌面 Bot 提供。

首批 10 个命中试点的合并 PR 记录合入前发现数、合入后关联文档补修数、首条发现到修正提交的时间，以及从派评审到可入队新增的等待时间。把可公开的统计与相关 PR 链接放在交付证据，复评试点范围时一起核对。
