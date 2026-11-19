# 本地工作树门禁的测试夹具

通用门禁在任务工作树中应核验与主检出相同的行为。三项失败分别由测试进程的工作目录、Git 对裸仓的显式访问要求、迁仓后过时的索引路径断言触发。

工作树分类使用自建仓库里的同一个受版本控制文件，分别验证主检出和工作树。推送测试在读取它自己的临时裸仓时显式指定裸仓位置，兼容 Git 的 [`safe.bareRepository=explicit`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safebareRepository)。索引检查核对脚本目录中的随仓实现，保留显式指定、随仓实现、PATH 兜底的顺序。

验证覆盖三个回归用例和完整的本地门禁。Git 保持原有裸仓安全设置。

## 旧标准变更

- `plugins/scripts/guard-worktree.test.mjs` :: `detects worktree vs ephemeral vs tracked`

原断言通过进程相对路径假定目标处于主检出。从任务工作树运行时，该路径实际指向工作树。现在使用测试自建的主检出和工作树的绝对路径，核验同一受版本控制文件分别返回 false 和 true。临时路径判定与其余断言保持原条件。
