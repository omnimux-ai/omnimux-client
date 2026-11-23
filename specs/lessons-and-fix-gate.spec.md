# 事故账本入库与 `fix:` 回归测试门禁（P0）

## 背景与研究依据

- **对标案例**：Magpie（`yetone/magpie`）将公开脱敏的 `LESSONS.md` 纳入仓库跟踪，由 `AGENTS.md` 与 `CLAUDE.md` 强制每次会话改前读取，并在 `docs/code-standards.md` 中将「回退修复后新测试真实断言失败（双向证伪）」列为验收第一条；命中 3 天以上的教训晋升规范或守卫测试后从活跃区折叠。
- **本仓现状（实测基线）**：
  - `LESSONS.md` 在 PR #42（`0e733d31`）中被写入 `.gitignore`，导致所有 `.worktrees/*` 工作树均无此文件，且全仓 `AGENTS.md` / `CLAUDE.md` 0 处引用。
  - 既有门禁 `plugins/scripts/guard-anti-cheat.mjs` 与 `plugins/scripts/verify-test-standard-declarations.mjs` 防住了「删除/削弱旧测试」，但未拦截「`fix:` 修改产品源码却不带回归测试」。
  - `reviewed-through: 08498ae07`（2026-11-18）后至 `3abd8ca3` 共 82 个提交，其中 31 个为 `fix:` 提交；历史上 #18、#90 均出现过回退修复后新增测试仍全绿的「假回归测试」。

## 目标与范围

1. **事故账本可发现、有代谢、不泄露**：
   - 将脱敏精简后的活跃 `LESSONS.md` 从 `.gitignore` 移除并纳入版本控制，只保留公开工程事实（活跃规则、正反例 PR/SHA、已毕业指针），硬限 `≤ 200 行 / ≤ 16 KB`。
   - 新增根 `CLAUDE.md` 指针（指向 `AGENTS.md` 与 `LESSONS.md`），并在根 `AGENTS.md` 补充 `LESSONS.md` 必读入口与「一坑一测试」规则。
   - 在 `plugins/scripts/verify-agents-md.test.mjs` 追加根 `AGENTS.md` / `CLAUDE.md` / `LESSONS.md` 的存在性、链接有效性与体积预算门禁（只增不减）。
2. **`fix:` 回归测试存在性门禁与评审闭环**：
   - 新增 `plugins/scripts/verify-fix-regression-test.mjs` 与对应单元测试 `plugins/scripts/verify-fix-regression-test.test.mjs`：
     - 仅在 `fix` 变更（PR 标题/标签或提交主题命中 `fix:` / `bug` / `regression`）且改动产品源码或运行脚本时触发；纯文档/CI/测试清理改动自动放行。
     - 要求变更范围包含至少一个**有实质新增代码行**的测试文件，或在已提交的 `specs/*.md` 新增 `## 无回归测试声明`（≥ 20 非空白字符）或在提交正文带 `No-Regression-Test:` trailer（≥ 20 非空白字符），确保 `pull_request` 与 `merge_group` 判定口径 100% 一致。
   - 将脚本接入 `.github/workflows/quality-gate.yml`、`plugins/package.json`（`test:gates`）与 `plugins/scripts/governance-manifest.json`。
   - 更新 `.github/pull_request_template.md`，在验收区补充 `fix:` 必填项（回归测试路径、回退修复变红的双向证伪结果、同类兄弟路径排查）。

## 假设

1. 将脱敏活跃 `LESSONS.md` 纳入 Git 跟踪并挂入根 `AGENTS.md` / `CLAUDE.md` 后，所有隔离工作树（`.worktrees/*`）都能在改代码与评审前直接读取，同时满足 `sync-main.sh` 的干净树要求。
2. `verify-fix-regression-test.mjs` 以 git 提交范围 + 可选 PR 标题/标签作为输入，既能拦住漏写回归测试的 `fix:` 改动，也不会对 `feat:` / `docs:` / `chore:` / `fix(docs):` 产生误报；通过已提交 spec 声明或 commit trailer 豁免可兼顾 `pull_request` 与 `merge_group`。

## 证伪方式

- **账本与入口门禁证伪**：临时让 `LESSONS.md` 超出 200 行或引入断链，或破坏根 `CLAUDE.md` 指向 → `verify-agents-md.test.mjs` 新增用例必须真实失败；恢复后全绿。
- **`fix:` 回归门禁证伪**：在 `withFixtureRepo` 临时 git 仓中构造 10+ 真实场景（`fix:` 改源码无测试→失败；只加空行/纯注释的假测试→失败；仅删测试→失败；`fix:` 带真实新增测试→通过；`fix:` 仅改文档/CI→通过；`feat:` 改源码无测试→通过；`specs/*.md` 新增有效 `## 无回归测试声明`→豁免通过；base 旧声明复用/未跟踪声明/字数不足→失败；commit trailer `No-Regression-Test:`→豁免通过）；且回退门禁关键判定逻辑后对应单测必须变红，恢复后全绿。

## 验收标准

- [x] AC-1：`.gitignore` 不再忽略 `LESSONS.md`，`LESSONS.md` 仅含公开工程事实且 ≤ 200 行 / ≤ 16 KB，链接全部可达，无私有/内部路径或敏感信息。
- [x] AC-2：根 `CLAUDE.md` 与根 `AGENTS.md` 均正确指向 `LESSONS.md`；`node --test plugins/scripts/verify-agents-md.test.mjs` 全绿，且对超预算/断链/缺入口均能真失败。
- [x] AC-3：`plugins/scripts/verify-fix-regression-test.mjs` 单元测试全绿，CLI 在本仓及夹具仓行为符合预期，双向证伪通过。
- [x] AC-4：`quality-gate.yml`、`plugins/package.json`、`plugins/scripts/governance-manifest.json` 全部对齐，`verify-governance-registry.test.mjs`、`doc-lint.mjs --base origin/main --head HEAD`、`verify-test-standard-declarations.mjs`、`guard-anti-cheat.test.mjs`、`git diff --check` 全绿。
- [x] AC-5：`.github/pull_request_template.md` 包含 `fix:` 回归测试、双向证伪与兄弟路径排查提示，保留 `omnimux-docs-impact` 边界标记不变。
