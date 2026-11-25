# merge queue 浏览器探针启动超时抖动

## 背景

合并队列连续两次因浏览器探针启动超时把已通过 PR 级检查的 PR 踢出队列：

- `#265` 首次入队：runner 上 Chrome 启动 `ETIMEDOUT`。
- `#277` 首次入队：`merge_group` 头 `2e4feca5` 的 `Plugin tests (inspiration)` 在 `card-compact-cta.e2e.test.js` 报 `spawnSync /usr/bin/google-chrome ETIMEDOUT`，同 head 的 PR 级检查此前全绿，重入队即通过。

本任务只处理 CI 稳定性，不改变产品行为。

## 根因判断

### 机制

`style-dom-probe.mjs` 用 `spawnSync(…, { timeout: 30_000 })` 启动 Chrome。Node 的 `spawnSync` 在超时后发 `SIGTERM` 并返回 `error.code = 'ETIMEDOUT'`；若子进程恰好在超时边界退出，返回值仍可能同时带 `status = 0 / signal = null`。失败日志正是这个形态：

```text
spawnSync /usr/bin/google-chrome ETIMEDOUT
Chrome probe diagnostic: {"timeoutMs":30000,"status":0,"signal":null,...}
```

因此不能把 `status: 0` 当作成功；现有代码优先 `output.error`，失败语义没有被伪装成通过。真正的问题是**单次 30s 窗口没有重试，也没有对 Chrome 冷启动做就绪等待**，一次慢启动就会直接让整条用例失败。

### 为什么只在 merge_group 出现

对比同一 head 的两类运行：

- PR 级 `Plugin tests (inspiration)`：成功。
- `merge_group` 同一 head：失败；重新入队后同一 head 成功。
- 两者 job 定义、runner 镜像、checkout 深度、install/build/test 步骤完全相同；`merge_group` 仅额外并行一个 `full-scan` job（独立 runner）。
- 失败 job 的 `Plugin unit suites` 耗时 108s，与 PR 级 job 的 ~163s 总时长同量级；没有 checkout/IO 异常。

结论：**不是 merge_group 合成检出或事件语义导致**，而是 runner 调度与冷启动资源竞争造成的概率性抖动。`merge_group` 只是恰好与更多运行重叠时更容易命中；代码侧缺的是有界重试与明确的探针环境失败分类。

### 本地复现

- 单进程真实 Chrome 探针：约 1.4s 完成。
- 8 个并发进程同时跑同一探针：每个进程 4.2–4.4s 完成，单次 probe 约 2.03–2.23s。
- 未复现 30s 卡死；本机 16 核 / 48GB，无法等价复现 GitHub 托管 runner 的 CPU/内存/`/dev/shm` 约束。

因此本任务采用「有界重试 + 减少共享内存启动风险 + 保留显式失败」而不是伪造成功。

## 修复

1. **有界重试**：单次 attempt 15s，最多 3 次（2 次重试），指数退避 1s → 2s，整次 probe 总预算 48s。成功/失败/重试均输出 attempt、耗时、原因。
2. **就绪等待**：每次 attempt 的 `--dump-dom` 本身就是就绪等待——Chrome 只有在页面产生 `RESULT` 标题后才退出；不使用固定 sleep。超时 attempt 使用独立 profile 重试。
3. **启动参数与清理**：增加 `--disable-dev-shm-usage`，避免托管 runner 较小 `/dev/shm` 下 Chrome renderer/zygote 的共享内存冷启动卡顿；超时 attempt 用 `SIGKILL` 结束，避免旧 Chrome 残留继续占用 CPU/内存。
4. **失败语义**：最终失败保留原始 `ETIMEDOUT` 错误对象与 `cause`，附加 `probeClass: 'environment-unavailable'`、`probeAttempts` 与分类诊断；失败消息始终写入显式 `[style-dom-probe] probeClass=...`（单 attempt 与多次 attempt 都写）。`run-workspace-tests` 的 `classifyFailure` 只认 `probeClass=environment-unavailable` 显式标记，`probe-result-invalid`、缺 RESULT、invalid JSON、`SyntaxError` 等一律归 `assertion-or-product-failure`。断言失败仍是普通 `AssertionError`。不跳过、不计入通过。
5. **日志可查**：`actions/upload-artifact` 不受 `defaults.run.working-directory` 影响，原 `Upload plugin test logs` 的 `.tmp/...` 实际指向仓根，而 runner 日志写在 `plugins/.tmp/...`，导致失败 job 的 TAP 日志从未上传。新增 `Stage plugin test logs for artifact upload` 步骤把 `plugins/.tmp/ci-workspace-logs` 与 `plugins/.tmp/ci-workspace-summary.json` 复制到仓根 `.tmp`；`Upload plugin test logs` 的 upload path 保持 `.tmp/...`，并同步测试断言。

## 验证

- `node --test plugins/scripts/style-dom-probe.test.mjs`：16 项通过（14 个声明用例 + 1 组双参数循环 2 项），覆盖探针成功路径、超时保留原始错误、缺 RESULT、无效 JSON、Ego 行为等。
- `node --test plugins/scripts/style-dom-probe-retry.test.mjs`：9 项通过，覆盖重试、1s/2s 退避、3 次上限、总预算截断，以及 `probe-result-invalid`、单次/多次超时的显式分类。
- `pnpm --dir plugins --filter omnimux-inspiration test`：全量通过。
- 真实 Chrome 探针本地复跑通过，8 并发启动耗时 2.03–2.23s/次。
- `pnpm --dir plugins run test:gates`、`build:all`、`verify-plugin-boundaries`、`verify-dsw-tokens`、`bundle-lock --check`、`workspace:check`、`plugins:verify`、`git diff --check`、`gitleaks --no-git` 均通过。
- 无 UI 变更，浏览器视觉验收不适用；未调用真实模型/网关。
