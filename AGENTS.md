# AGENTS.md — omnimux-client

本仓是 OmniMux 的**客户端单仓**：桌面壳（`app/`）与产品插件（`plugins/`）一起开发、一起发布。

## 公开仓红线

本仓是公开仓，**每个 commit 立即对全世界可见**。

- MUST NOT 提交：生产地址与内部端点、SSH 别名、部署根、凭据与令牌、定价账本、渠道运营脚本、内部证据、私有仓引用或本机绝对路径（含本机 Skill 软链指向的私有目录）。
- 运维与部署物料属于私有仓，不进本仓；需要时在 PR 里写明依赖，不要搬过来。
- 提交前自问：这条信息能不能给全世界看？不能就换地方。

## 结构与指令体系

```text
app/        Electron 桌面壳；Yarn 4；deepseek-harness 为 submodule（pin 见 PROVENANCE.json）
plugins/    产品插件；仓库根单一 pnpm workspace；含共享包（如 plugins/packages/dsh-ui-kit）
```

- 仓库根是插件工作区的唯一 pnpm workspace 根（单一 `pnpm-lock.yaml`）；`app/` 保持独立的 Yarn 4 工作区。桌面依赖通过 `link:` 指向本仓 `plugins/plugins/*`，插件构建产物是打包输入，因此 CI 与打包前置必须先安装/构建插件。不要再添加嵌套的 `plugins/pnpm-workspace.yaml` 或 `plugins/pnpm-lock.yaml`。
- **指令单一权威源**：本文件为全仓总则权威源；子树规则分别由 [app/AGENTS.md](app/AGENTS.md) 与 [plugins/AGENTS.md](plugins/AGENTS.md) 维护，子树不重复声明根规则。各层级 `CLAUDE.md`（如 [app/CLAUDE.md](app/CLAUDE.md)、[plugins/CLAUDE.md](plugins/CLAUDE.md)）仅作为指向或对齐对应 `AGENTS.md` 的入口；更新规则时改 `AGENTS.md` 并同步验证链接。
- **Skill 边界**：根 `.agents/skills/` 仅用于本仓开发/发版协同，不随客户端或插件安装包分发；随产品分发的技能位于 `plugins/plugins/*/skills/` 与 `plugins/plugins/omnimux-market/catalog/skills/`，两者严格隔离。

## 硬约束

1. **工作树隔离**：产品改动一律在 `<repo>/.worktrees/<task>` 工作树做，主检出 `main` 保持干净；MUST NOT push 上游、MUST NOT force-push `main`。合入走 PR。
2. **前端演示先行**：前端（`app/dsh-desktop-next`、`app/dsh-plugin-desktop`、`plugins/` 里的 UI）任何改动——新增、修复、优化、样式、文案、交互——**必须先交付可直接打开的高保真 HTML 演示**，清楚呈现修改前/修改后与关键交互；用户明确确认方案前，禁止修改、提交或合并产品前端代码。
3. **视觉与设计系统单一真源**：`plugins/` UI 统一消费 `plugins/packages/dsh-ui-kit`（[README](plugins/packages/dsh-ui-kit/README.md)）与官方 `--dsw-alias-*` / `--dsw-specific-*` 语义 Token；缺复用角色先扩展共享包，再由业务插件引用。禁止在业务模块复制调色板、写死 Hex/rgba 字面量或绕过组件库另起炉灶。产品文案禁写未交付能力与保证爆款之类夸张承诺。
4. **UI 交互与反馈契约**：瞬态操作结果（保存、复制、导出、失败提示）走浮层 Toast 或非占位反馈层，不插入正常文档流造成布局跳动；慢内容保留几何占位并给出可恢复错误态（已知失败不留无限 loading）；非模态筛选下拉不加多余确认弹窗。真实界面检查必须覆盖**亮/暗双主题**、**打开态浮层/菜单**与**窄屏布局**。
5. **能力与工具面同源**：新增或调整核心业务能力时，产品 UI（HTTP/IPC）与 Agent 工具面（`ctx.tools` / 对外暴露工具）必须共享同一领域 Store/Service 与版本、校验及冲突语义（破坏性操作带显式确认守卫），并在同一 PR 同步更新 [插件工具契约清单](plugins/docs/contracts/plugin-agent-tools-inventory.md) 与对应使用说明。
6. **i18n 与子模块**：i18n 走脚本，不手改多语言 JSON；密钥不入库、不入日志、不入群。子模块 `app/deepseek-harness` 的 pin 改动必须同时更新 `PROVENANCE.json`，并在 PR 里说明升级原因。
7. **文档随改动复核**：凡改变结构、工具契约、构建脚本或发布边界的 PR，必须同步核查并更新受影响的 `README.md`、`app/docs/`、`plugins/docs/contracts/` 或 `specs/`；文档严格区分「当前已实现」与「规划中」。

## 验证（按改动边界选最小集）

仅当 `package.json` / 锁文件变化或本地依赖缺失/损坏时才重装依赖；否则复用现有安装。

| 改动边界 | 最小必跑本地验证 |
|---|---|
| 纯文档 / 指令 / 注释 | 仅跑 `git diff --check` 与改动链接/命令一致性核对；**禁止重装依赖或跑构建/打包** |
| `plugins/` 业务与 UI | 根目录 `corepack pnpm --dir plugins run build:all` + 受影响插件单测 / `plugins` 门禁（UI 改动加跑对应阶段/视口浏览器验证） |
| 工作区元数据 | `node scripts/workspace-check.mjs --check`（校验 `dsh-version.json` / `bundle.lock.json`） |
| `app/` 类型与壳代码 | `cd app && corepack yarn typecheck` + 受影响桌面单测 |
| `app/` 打包（仅打包/发版边界） | `cd app && corepack yarn workspace dsh-desktop-next dist:mac`（前置需按 [app/AGENTS.md](app/AGENTS.md) staging） |

报告只写真正跑过的命令与真实输出；CI 负责全量矩阵。

<a name="release-preflight"></a>

### 发布链路预演

打包或分发变更须在合并前预演。每条独立工作流都从无项目依赖、无发布凭据的干净环境开始，按该工作流的工作目录和顺序从锁文件安装依赖。打包改动须在受影响的目标平台运行构建步骤。分发预演须运行实际的索引生成步骤，把产物写入本地目录。[打包工作流](.github/workflows/release.yml) · [分发工作流](.github/workflows/r2-publish.yml)

逐项核对索引里的包名和版本，检查漏列、多列及版本差异。允许上架的范围取自该版本已有市场描述且处于 `preview` 档的插件，版本取自各插件的包清单。[插件档位](app/config/plugin-tiers.json) · [市场描述与索引入口](app/scripts/build-plugin-index.mjs)

<a name="desktop-ac"></a>

### 合并前实测必验桌面交互

工单标记为必验的桌面交互，合并前须在隔离桌面 Dev 上逐项通过。记录实测构建指纹及其来源提交。使用最终 PR head 构建，或列出实测树与待合并树的构建输入及其指纹，证明两者等价。

每个必验项按工单编号关联操作、实际结果与可复核的运行记录。连续编辑须在同一节点上按用户操作顺序完成，保留上一步的状态。自动检查可核对构建指纹、验收编号和逐项证据，评审根据运行记录判定交互是否符合预期。已明确授权先合的 P0 紧急修复，在工单列明待验项，合入后按相同标准补齐证据。

## 交付、证据分级与发布授权

- **证据分级报告**：汇报必须明确区分并单独写明以下状态——① CI/静态门禁、② 本机构建与单测、③ Worktree 真实浏览器/Dev 运行态验证、④ 真实模型/网关调用、⑤ 人工视觉验收；离线/mock 测试或 HTTP 200 不得冒充真实模型或端到端验收，未跑项显式标明未执行。
- **候选构建与发布授权分离**：CI 绿灯不等于自动合并或正式发布授权。本地与 Dev 联调同步按 [app/AGENTS.md](app/AGENTS.md) 与 [plugins/AGENTS.md](plugins/AGENTS.md) 规程执行；正式对外发布（公开 tag、GitHub Release、R2 分发同步、`--prod`）必须取得明确发布授权，并只基于合入 `main` 的已审查提交构建。不确定就停下来问负责人（X）。
