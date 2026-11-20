# 子系统文档与评审

改动前从对应主文档找到行为约定，再沿源码入口核对当前实现。主文档描述已经交付的行为。计划和取舍留在工单或规格。

| 子系统 | 主文档 | 源码入口 | 验证命令 |
| --- | --- | --- | --- |
| 桌面原生文件选择 | [架构说明](../app/docs/architecture.md#插件的原生文件选择) · [英文版](../app/docs/architecture.en.md) | [桌面实现](../app/dsh-plugin-desktop/src/native-file-picker.ts) · [Legacy 主进程](../app/dsh-plugin-desktop/src/electron-shell-generation.ts) · [Legacy preload](../app/dsh-plugin-desktop/src/preload.ts) · [Next 主进程](../app/dsh-desktop-next/src/main.ts) · [Next preload](../app/dsh-desktop-next/src/preload-app.ts) · [共享选择器](../plugins/packages/dsh-ui-kit/src/native-file-picker.js) | 从仓库根运行 `node --test plugins/packages/dsh-ui-kit/src/native-file-picker.test.js`。桌面变更按 [app 规则](../app/AGENTS.md)补受影响的壳测试和运行态验证。 |
| 插件 Agent 工具契约 | [工具契约清单](../plugins/docs/contracts/plugin-agent-tools-inventory.md) | [Hub 注册入口](../plugins/plugins/omnimux/src/host/apply.js) · [工具检查](../plugins/scripts/verify-plugin-agent-tools.mjs) | 从仓库根运行 `corepack pnpm --dir plugins verify:tools` 和 `corepack pnpm --dir plugins test:agent-tools`。 |

## 开 PR 前核对

实施 Agent 对照最终 diff 检查接口、默认值、状态转换、运行路径、兼容性和失败行为。改变了主文档描述的行为，就在同一 PR 更新该页。只调整内部实现时，写明核对过的页面和行为保持一致的依据。PR 记录每个受影响子系统的主文档、判断、行为与依据、验证证据。重新推送后更新这份记录。

保存一份 JSON 数组作为任务私有证据。每个对象有 `subsystem`、`document`、`decision`、`behavior`、`evidence` 五个字段。子系统 ID 为 `desktop-file-picker` 或 `plugin-agent-tools`。主文档使用上表中文页面的仓库相对路径，决定为 `updated` 或 `unchanged`，其余两项为单行说明。只把可公开的内容放入作者记录。从仓库根运行 `node plugins/scripts/docs-impact.mjs <记录路径>` 生成可粘贴到 PR 的段落，保留段落两侧的标记。

`auto:run` 提供 `OMNIMUX_DOCS_IMPACT_PATH` 给实施命令，也可通过 `--docs-impact` 接收既有记录。脚本开出试点 PR 后把任务快照、作者记录和测试证据交还协调 Agent。

## 评审及合并

1. 协调 Agent 刷新目标基线，在干净的任务工作树用 `node plugins/scripts/review-packet.mjs` 生成评审包。传 `--spec` 指向已提交规格，或传 `--issue-snapshot` 指向已核实的 Issue 快照。为每份测试证据传 `--evidence`，试点改动另传 `--docs-impact`。证据里记录完整 head。脚本在提交前跑的测试，由协调 Agent 在干净的候选提交上复验适用项后提交证据。
2. 派独立子代理在新上下文读取评审包和 base/head 源码。子代理核对行为、主文档与测试，直接返回包含提交身份和证据的 JSON。协调 Agent 保存其结果到私有证据目录。评审发现和补验结果回到原 PR，更新提交后重新派发。
3. 协调 Agent 在本工作树运行 `node plugins/scripts/docs-review-merge.mjs --pr <编号> --packet <评审包> --result <子代理结果>`。命令核对 PR 的文档记录、base/head、评审、必过检查和队列状态，通过 GitHub 的 expectedHeadOid 参数绑定已评提交后入队。合入后按 [仓库交付规则](../AGENTS.md#合并与复核)核对最终版本，适用的 Dev 运行证据由桌面 Bot 提供。

首批 10 个命中试点的合并 PR 记录合入前发现数、合入后关联文档补修数、首条发现到修正提交的时间，以及从派评审到可入队新增的等待时间。把可公开的统计与相关 PR 链接放在交付证据，复评试点范围时一起核对。
