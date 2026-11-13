# Agent Note: OmniMux 插件全流程自动化 CI 门禁体系

Status: implemented

[English](2026-08-27-ci-automation-gate-suite.md) | 中文

## Problem

在多 Agent 与人类工程师高度协同的 OmniMux 插件开发过程中，缺乏统一且由机器强制执行的决策生命周期和架构边界门禁。没有机械门禁的约束，架构漂移、上下文腐化、双语文档失步以及跨插件依赖泄漏等问题会随时间推移严重降低工程质量与可维护性。

## Decision

我们在 `omnimux-dsh` 代码库中全面落地多维自动化 CI 门禁体系：

1. **Agent Note 决策生命周期与格式状态机**：
   - `scripts/verify-agent-note-format.mjs` 强制执行前 4 行 Header 契约，强制包含 `## Problem`、`## Decision`、`## Alternatives considered` 与 `## Consequences`，并在 `implemented/` 状态下严格禁止出现提案期遗留段落（`Proposal`、`Plan`、`Acceptance criteria`）；
   - `scripts/lib/agent-note-tree.mjs` 严格封闭 6 大分类（`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`），统一 `yyyy-mm-dd-topic.md` 命名，并禁止出现中心化 `INDEX.md`。

2. **双语三元组与 Git Blob Hash 侧车一致性校验**：
   - `scripts/verify-bilingual-docs.mjs` 将 `.md` 与 `.zh.md` 通过 `.i18n.yaml` 侧车绑定，记录精确的 Git Blob SHA-1 哈希。修改任何一侧未同步另一侧将直接阻断 CI。

3. **密码学密封的 Append-Only 归档机制**：
   - `scripts/verify-archived-agent-notes.mjs` 将低长线杠杆价值的已实现笔记封存在 `archived/` 中，通过 `archived/manifest.json` SHA-256 签名清单实现只增不改的防篡改保护。

4. **插件依赖单向流动与架构边界守护**：
   - `scripts/verify-plugin-boundaries.mjs` 静态扫描插件源码，拦截跨插件私有实现引用与未声明依赖泄漏。

5. **全流程命令集成**：
   - 在 `package.json` 中配置 `pnpm note:lint`、`pnpm doc:pairing`、`pnpm check:boundaries`、`pnpm archived:verify` 与 `pnpm check:all`。

## Alternatives considered

- **纯人工 PR 审查**：否决。人工审查与 Agent 自检无法在数十次高频 PR 中稳定记住每条时态与双语对齐细则。
- **中心化单一 INDEX.md 索引表**：否决。在多 Agent 并发开发时极易产生密集的 Git 合并冲突。
- **仅依赖 Front-Matter 标签**：否决。基于文件系统路径的双轴编码（`{lifecycle}/{class}/`）提供了零解析成本的目录直观性与原生工具支持。

## Consequences

引入轻微的编写约束，确保任何非微小变更必须在同 PR 维护决策笔记；彻底消除架构上下文腐化，为多 Agent 长期自治开发提供坚固的质量与稳定性保障。
