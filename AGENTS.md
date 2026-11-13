# AGENTS.md — omnimux-client

本仓是 OmniMux 的**客户端单仓**：桌面壳（`app/`）与产品插件（`plugins/`）一起开发、一起发布。

## 公开仓红线

本仓是公开仓，**每个 commit 立即对全世界可见**。

- MUST NOT 提交：生产地址与内部端点、SSH 别名、部署根、凭据与令牌、定价账本、渠道运营脚本、内部证据、私有仓引用。
- 运维与部署物料属于私有仓，不进本仓；需要时在 PR 里写明依赖，不要搬过来。
- 提交前自问：这条信息能不能给全世界看？不能就换地方。

## 结构

```text
app/        Electron 桌面壳；Yarn 4；deepseek-harness 为 submodule（pin 见 PROVENANCE.json）
plugins/    产品插件；pnpm；含 3 个共享包
```

阶段一两套包管理器并存，各自独立安装与构建。统一为单一 pnpm workspace 是后续任务，**不要在没有迁移任务的情况下擅自改根目录的包管理结构**。

## 硬约束

1. 产品改动一律在 `<repo>/.worktrees/<task>` 工作树做，主检出 `main` 保持干净；MUST NOT push 上游、MUST NOT force-push `main`。合入走 PR。
2. 前端（`app/dsh-desktop-next`、`app/dsh-plugin-desktop`、`plugins/` 里的 UI）任何改动——新增、修复、优化、样式、文案、交互——**必须先交付可直接打开的高保真 HTML 演示**，清楚呈现修改前/修改后与关键交互；用户明确确认方案前，禁止修改、提交或合并产品前端代码。
3. 视觉遵循 `app/DESIGN.md`（若目录内存在）与 `app/docs/brand/` 的品牌真源；禁写未交付能力、保证爆款之类文案。
4. i18n 走脚本，不手改多语言 JSON。
5. 密钥不入库、不入日志、不入群。
6. 子模块 `app/deepseek-harness` 的 pin 改动必须同时更新 `PROVENANCE.json`，并在 PR 里说明为什么升。

## 验证（按触及范围跑最窄）

| 触及 | 命令 |
|---|---|
| `plugins/` | `cd plugins && corepack pnpm install --frozen-lockfile && corepack pnpm -r build` |
| `app/` 类型 | `cd app && corepack yarn typecheck` |
| `app/` 打包 | `cd app && corepack yarn workspace dsh-desktop-next dist:mac` |
| 文档 / 指令 | 只核 diff、链接与命令一致性 |

报告只写真正跑过的命令与真实输出；CI 负责穷举矩阵。

## 交付

改动必须带证据：跑过的命令、真实输出、commit 或 PR 链接。不擅自发布、不做生产操作。不确定就停下来问负责人（X）。
