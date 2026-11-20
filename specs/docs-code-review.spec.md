# 文档与代码同步评审

## 任务范围

试点覆盖桌面原生文件选择和插件 Agent 工具契约。作者在开 PR 前核对文档影响，独立评审 Agent 核对实际改动、主文档和验证证据。协调 Agent 对普通 PR 和脚本 PR 执行同一入队前评审，继续验证实际合入结果。

## 方案依据

Magpie 将主文档和源码入口放进子系统索引，评审时按确定的 base/head 复核修改。[子系统规则](https://github.com/yetone/magpie/blob/848e3b1b26d769c8b1a4b086909824d3c311c5d5/docs/subsystems/README.md) · [复评实例](https://github.com/yetone/magpie/pull/1282#issuecomment-6088223083)

OmniMux 复用已有评审包、流水线交接、必过 CI 和 GitHub 合并队列。协调 Agent 消费独立评审，CI 检查能确定的新增漂移。工程流程和证据入口见 [子系统文档与评审](../docs/subsystems.md)。

## 验收

- 普通 PR 和脚本 PR 都能提交文档影响记录。缺少记录或独立评审、评审阻断或过期、CI 未通过时不请求入队。内部重构有理由和证据时可以通过。只有 Issue 的任务可生成评审包。
- 对候选与基线检查新增断链、失效源码入口和新增工具清单差异。已存在的差异继续报告。PR 与合并组各使用事件对应的基线。
- 用隔离夹具回归阻断场景，在本任务 PR 验证独立评审、CI、绑定提交入队及合入版本复核。产品运行、模型调用及人工视觉验收不适用于此工程变更。

## 旧标准变更

- `plugins/scripts/review-packet.test.mjs` :: `干净工作区生成评审包：三段输入 + 评审要求 + SHA，无额外段落，写在仓库外`

原测试要求评审包引用已移除的插件 QA 契约。现断言引用实际生效的根规则，继续校验评审包的章节、提交身份、证据和私有落点。

- `plugins/scripts/auto-pipeline.test.mjs` :: `merged handoff preserves the worktree and defers the agent gate to isolated-worktree browser evidence`
- `plugins/scripts/auto-pipeline.test.mjs` :: `Dev acceptance remains non-blocking and final human confirmation is independent of complete document evidence`

合入后交接的确认责任由人工改为协调 Agent 核验最终版本。原有工作树保护、隔离浏览器证据和桌面 Bot 证据断言继续执行。纯工程文档交付的用例名称与实际判定一致，覆盖不适用 Dev 检查时完成交付。
