# main 分支必需门禁清单（required checks）

本文件记录 `main` 分支保护里应有的必需检查、为什么只收这几条，以及变更与验证流程。
改本文件必须同步改仓库分支保护设置（见文末命令），否则文档与现实会分叉。

## 结论

`required_status_checks.strict = true`，必需检查共 4 条（app_id 一律 15368 / GitHub Actions）：

| # | workflow | 检查名（context） | 覆盖范围 | 状态 |
|---|---|---|---|---|
| 1 | CI | `Plugins build and typecheck` | `plugins/` 全量安装 + typecheck + build | 既有 |
| 2 | CI | `Desktop app check` | `app/` 安装 + 版本文件 + `yarn check`（layout/architecture/workspace） | 既有 |
| 3 | CI | `Privacy scan` | gitleaks 扫提交内容，禁凭据/内部端点 | 既有 |
| 4 | Quality Gate & Auto QA | `Static L0 QA & Tests` | 聚合：静态门禁与回归、插件测试分片矩阵、泄漏门禁、（merge queue 上的）全仓扫描 | 本次新增 |

前 3 条是本次收尾前 `main` 的既有必需检查；第 4 条是 `quality-gate.yml` 里唯一的聚合作业。

## 为什么不把子作业逐条列为必需

`quality-gate.yml` 运行 5 个作业，但只有 `static-and-tests`（检查名 `Static L0 QA & Tests`）应进必需清单：

- **`Plugin tests (<shard>)`** 是 impact-matrix 决定的分片矩阵：`hub` / `inspiration` / `workflow-market` / `rest` 这类名字随受影响包集合变化。把分片名写进必需检查，矩阵一改就没有任何作业报出该 context，所有 PR 停在 `Expected` 永远合不了。
- **`Static gates & regression`、`Leak gate (gitleaks + denylist)`** 已被聚合作业用 `test "$GATES" = success`、`test "$LEAK_GATE" = success` 强校验，单独列为必需是纯冗余，只增加改名时的维护面。
- **`Full-repo secret & extension outbound scan`** 只在 `merge_group` 事件运行，在 `pull_request` 上是 `skipped`。GitHub 不把 `skipped` 当成功，列为必需会让每个 PR 永久等待一条不会通过的检查。

同理，`release.yml`、`r2-publish.yml`、`publish.yml` 都是手动或发布专用工作流，不在 PR 上运行，不能进必需清单。

## 聚合作业的语义（为什么它可以单独代表全部质量门禁）

`static-and-tests` 声明 `needs: [gates, plugin-tests, full-scan, leak-gate]` 且 `if: ${{ always() }}`，随后在 `Require upstream jobs` 步骤显式断言：

- `gates`、`plugin-tests`、`leak-gate` 必须 `success`；
- `full-scan` 必须 `success`，或仅当事件不是 `merge_group` 时允许 `skipped`。

因此任一上游作业失败或被取消，聚合作业都会失败，不会出现"上游红、聚合绿"。`always()` 是这条语义的前提：缺了它，上游失败时聚合会被跳过，而必需检查一旦 skipped，分支保护就失去了判定基准。

## 验证与变更流程

1. 改仓库设置（保持 app 绑定，避免把 context 放宽到任意应用）：

   ```bash
   gh api -X PATCH repos/omnimux-ai/omnimux-client/branches/main/protection/required_status_checks \
     --input - <<'JSON'
   {
     "strict": true,
     "checks": [
       {"context": "Plugins build and typecheck", "app_id": 15368},
       {"context": "Desktop app check", "app_id": 15368},
       {"context": "Privacy scan", "app_id": 15368},
       {"context": "Static L0 QA & Tests", "app_id": 15368}
     ]
   }
   JSON
   ```

2. 读回确认：

   ```bash
   gh api repos/omnimux-ai/omnimux-client/branches/main/protection/required_status_checks
   ```

3. 在一个真实 PR 上确认这 4 条出现在必需检查里、且全部转绿后才允许合入；任一上游失败时 `Static L0 QA & Tests` 必须跟着红。

4. 回滚：把上面的 `checks` 还原为前 3 条，其余保护项（`enforce_admins`、`required_linear_history`、`allow_force_pushes` 等）本次不动。

## 相关：publish.yml 验证窗口

`publish.yml` 的 `Verify published package` 曾只轮询 5 分钟，0.1.8 真实发布已成功但 registry 传播超过 5 分钟，把成功发布判成红灯（false red）。修复已合入（PR #8 / `f1101d1`）：

- 轮询窗口 5 → 15 分钟（60 × 15s）；
- 窗口用尽仍不可见时降级为 `warning` 并 `exit 0`，因为前一步 `npm publish` 已成功，可见性只是最终一致；
- `name@version` 与 `gitHead` 的一致性校验保留：拿到 registry 数据后仍不匹配即 hard fail。

修复的实证要等下一次真实发布（12 包发布链）跑过 `Verify published package` 才算闭环，在那之前只能确认为代码层已修复。
