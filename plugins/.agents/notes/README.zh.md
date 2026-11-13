# Agent Note 设计决策规范

[English](README.md) | 中文

Agent Note 记录影响本代码库的设计决策或提案 —— 即**“为什么这样做”**与**“放弃了什么（被击败的备选方案）”**。

## 目录布局与命名

每个 Agent Note 具有两个轴向，编码在路径中：`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **Lifecycle (生命周期)**：
  - **`proposed/`**：实现前审阅中的提案；
  - **`implemented/`**：已落地生效的活态权威决策（Living Authority），随代码重构保持事实同步；
  - **`rejected/`**：被正式否决的提案，用于防踩坑和防重复提议；
  - **`archived/`**：已闭环且后续决策杠杆较低的历史快照（带 SHA-256 密码学密封）。
- **Class (封闭分类)**：
  - `feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`。

## 文件格式与前置约束

前三行严格保持：
```markdown
# Agent Note: <title>

Status: <proposed | implemented | rejected — 原因>
```

- `implemented/` 下严格禁止出现 `## Proposal`、`## Plan`、`## Acceptance criteria` 等提案期段落；
- 必须包含 `## Alternatives considered` 段落。
- 必须维护 `.md`、`.zh.md` 与 `.i18n.yaml` 双语三元组。
