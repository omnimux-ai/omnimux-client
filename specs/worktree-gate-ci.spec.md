# 工作树门禁的 CI 覆盖

## 历史证据

提交 `aa3ccf95` 的 GitHub Actions 在 Ubuntu 26.04 的主检出运行，使用 Git 2.56.1 和 Node.js 24.18.1。该任务执行了推送测试，旧测试读取临时裸仓成功。日志未打印裸仓策略，实际允许隐式访问是根据该结果推断的。工作树分类和索引工具定位用例未被该任务选中。[历史 CI 日志](https://github.com/omnimux-ai/omnimux-client/actions/runs/44461783910/job/135350052623)

本次本地通用门禁在实际链接的任务工作树中运行这三项，Git 要求显式指定裸仓。旧分类测试从当前工作树解析本应属于主检出的路径，旧推送测试隐式读取裸仓，索引定位测试仍匹配迁仓前的路径。[本地失败原因与修复](portable-local-gates.spec.md)

## 本次修复

必需的静态门禁在 PR 和合并队列中都创建临时链接工作树，使用待验提交运行工作树分类、推送和索引定位测试。该步骤临时启用显式裸仓策略，推送测试也移入这个步骤运行。本地通用门禁仍包含更广的测试范围。[CI 工作流](../.github/workflows/quality-gate.yml)

首次试跑时，守卫套件中还有七个用例把写死的 macOS 路径当成执行用户的主目录，在 Ubuntu 失败。现在测试以运行环境的实际主目录构造输入，继续验证无界扫描被拦截、有限深度和仓内查询被允许。[首次试跑日志](https://github.com/omnimux-ai/omnimux-client/actions/runs/44465854983/job/135363344436#step:21:1)

## 验收

- CI 日志应确认链接工作树、Git 和 Node.js 版本以及生效的裸仓策略。
- 三组测试都应实际执行且通过。任一失败应阻止必需门禁通过。

## 旧标准变更

- `plugins/scripts/guard-worktree.test.mjs` :: `classifies scan roots without flagging project-internal paths`
- `plugins/scripts/guard-worktree.test.mjs` :: ``denies `cd <home> && find .` where the sweep root is armed by the previous segment``
- `plugins/scripts/guard-worktree.test.mjs` :: `denies the incident command: find over the user home directory`
- `plugins/scripts/guard-worktree.test.mjs` :: `guards the glob and grep tools when their path argument names a traversal root`

原用例用固定的 macOS 用户目录比较分类结果和报告目标。在 Linux 上，该路径并非执行用户的主目录。新用例验证实际主目录仍会触发拒绝，报告的目标仍精确等于该次测试的输入目录。带字面反引号的既有用例名使用双反引号围栏声明，校验器仍按完整路径和完整用例名匹配。
