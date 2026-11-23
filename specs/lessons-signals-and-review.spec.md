# 事故账本信号提取、定期复盘工作流与增量复盘（P1）

## 背景与研究依据

- **前序交付**：PR #207（`2e7c2aa4`）已完成 P0：脱敏精简活跃 `LESSONS.md` 入库、根 `CLAUDE.md` / `AGENTS.md` 必读入口、预算与断链单测门禁，以及 CI 侧 `verify-fix-regression-test.mjs`「一坑一测试」门禁。
- **当前缺口（实测基线）**：
  1. `LESSONS.md` 的复盘游标仍停在 `08498ae07`（`2026-11-18`），截至 `2e7c2aa4`（`2026-11-23`）已有 **86 个主干提交**（含 33 个 `fix:` 提交）未做增量复盘。
  2. 过去依赖人工通读每日 PR，缺少确定性的**返修信号提取器**（72h 返修链、回滚提交、无测试 `fix:` 审计、跨日连修热点文件、活跃账本 `seen ≥ 3` 待晋升与 >30 天过期检测），也缺少「仅在有信号时提醒、无信号静默」的自动化触发机制。
  3. 对标做法：将「信号提取（确定性脚本，零 LLM / 零误报）」与「根因判定（由 Agent / 评审人核对真实 diff 后更新 `LESSONS.md`）」解耦——脚本绝不盲推游标，只在命中真实信号时汇总到单一幂等复盘工单与 Job Summary。

## 目标与范围

1. **确定性信号提取脚本与单测**：
   - 新增 `plugins/scripts/analyze-lessons-signals.mjs` 与 `plugins/scripts/analyze-lessons-signals.test.mjs`：
     - 复用 `verify-fix-regression-test.mjs` 的产品源码 / 测试文件 / `fix:` 判定逻辑，避免双份口径漂移。
     - 读取根 `LESSONS.md` 的 `reviewed-through` 游标与活跃规则区（`seen N`、最近日期、行/字节预算），自动识别 `seen ≥ 3` 待晋升项与 `seen ≤ 1` 且超过 30 天未复发的可归档项。
     - 单次 `git log --first-parent` 扫描 `since..head` 及其前 `windowHours`（默认 `72` 小时）回看窗口，提取四类可证伪信号：回滚提交、`≤ 72h`（并标出 `≤ 24h` 高紧度）产品源码重叠返修链、未含测试文件且无 `No-Regression-Test:` trailer 的 `fix:`、以及 `≥ 2` 个不同日历日被修复的热点产品文件。
     - 支持 `--json`、`--markdown`、`--output`、`--fail-on-signals` 与确定性 `--as-of` 基准日。
2. **接入治理与信号触发工作流**：
   - 接入 `plugins/package.json`（`test:gates` 与 `lessons:signals`）、`plugins/scripts/governance-manifest.json`、`.github/workflows/quality-gate.yml`（语法校验与单测）。
   - 新增 `.github/workflows/lessons-review-digest.yml`（`workflow_dispatch` + 每周一/四定时运行）：运行信号提取脚本输出 Job Summary；仅当 `actionable=true` 且允许建单时，幂等创建或原地更新唯一带有 `lessons-review` 标签的开放复盘 Issue；无信号时零噪音退出。
3. **补齐 `08498ae07`（2026-11-18）至 `2242fc73`（2026-11-23）的真实增量复盘**：
   - 基于上述信号提取结果与逐条核对 PR 事实（#72/#74/#107/#112/#116/#117/#125/#129/#132/#133/#136/#139/#142/#144/#161/#162/#165/#170/#171/#176/#177/#182/#196/#209/#216），更新 `LESSONS.md`：
     - 将游标推进至 `2242fc73eec889072473eda2fb174c1c044dee9b (2026-11-23)`；
     - 将已命中 `seen ≥ 3` 且已有根 `AGENTS.md` / 门禁承接的两条活跃规则毕业迁入「已毕业」表（真实非空载荷与双向证伪 → `AGENTS.md#一坑一测试`；UI 真实渲染几何、连续操作与浮层防透底 → `AGENTS.md#合并与复核` + `guard-no-transparent-popover.mjs`）；
     - 更新「打包与恢复归档物理验证」至 `seen 2`（补录 #139→#142 `.asar` 物理语义与 PAX 稀疏文件返修）；
     - 新增两条跨多日高频复现的活跃规则（`seen 2` 重点观察，下一批次再复现即触发 `seen ≥ 3` 待晋升提醒，避免刚完成复盘就在定时任务产生自激告警）：网关/目录/宿主运行时契约单一真源、异步交接/共享状态作用域与 Host 主线程非阻塞边界；
     - 全文严格控制在 `≤ 200 行 / ≤ 16 KB` 内且仅含公开工程事实。

## 假设

1. 将回看窗口向前延伸 `windowHours`（覆盖 `since` 之前的 `72h` 提交）可捕获「修复提交落在游标之后、被返修的原提交落在游标之前」的跨界返修链。
2. 通过单一幂等 `lessons-review` Issue 承接定时信号而非自动提交空 `chore(lessons):` PR，可避免盲推 `reviewed-through` 游标或产生无人审阅的垃圾 PR。

## 证伪方式

- **脚本单测与双向证伪**：在 `withFixtureRepo` 临时 git 仓验证：① 跨游标 72h 返修链精准检出、超过 72h 不误报；② `Revert` 提交与无测试 `fix:`（区分有无 `No-Regression-Test:` trailer）精准检出；③ 跨 2 天热点文件检出而单日多提交不误判为跨日；④ `LESSONS.md` 解析准确识别 `seen ≥ 3` 待晋升项与 `> 30` 天过期项；⑤ 手动破坏回看窗口或 `seen` 阈值后对应单测真实变红，恢复后全绿。
- **真实仓库回归**：对本仓 `08498ae07..2e7c2aa4` 实跑 `analyze-lessons-signals.mjs`，核对输出与人工抽检 PR（#112→#116、#107→#117、#74→#129、#139→#142、#165→#177 等）一致；再以更新后的 `LESSONS.md` 对 `HEAD` 实跑，确认工作流与预算校验全绿。

## 验收标准

- [x] AC-1：`plugins/scripts/analyze-lessons-signals.mjs` 与 `analyze-lessons-signals.test.mjs` 实现上述全部检测、JSON/Markdown 输出与 CLI 选项，单测全绿且完成双向证伪。
- [x] AC-2：`quality-gate.yml`、`lessons-review-digest.yml`、`plugins/package.json`、`plugins/scripts/governance-manifest.json` 全部对齐，`verify-governance-registry.test.mjs`、`verify-agents-md.test.mjs`、`pnpm --dir plugins run test:gates`、`doc-lint.mjs`、`auto-qa-gate.mjs`、`gitleaks` 全部通过。
- [x] AC-3：`LESSONS.md` 游标推进至 `2242fc73eec889072473eda2fb174c1c044dee9b (2026-11-23)`，行数 ≤ 200、字节 ≤ 16 KB，相对链接全部可达，无任何私有/敏感信息，且每条新增/毕业结论均有公开 PR/SHA 佐证。
