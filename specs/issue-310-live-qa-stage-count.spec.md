# #310 live-qa 阶段断言跟随舞台契约

## 背景

`#299` 把 `pibrowse` 加入 `plugins/scripts/live-stage-contracts.mjs` 的 `STAGE_CONTENT` 后，`live-qa.test.mjs` 仍写死 `targets.length === 8` 与 `six-methods-and-disposer` 的计数 7，导致 `test:gates` 在 `origin/main` 上稳定失败。本任务只修测试断言，不改产品代码或舞台契约。

## 旧标准变更

- `plugins/scripts/live-qa.test.mjs` :: `stage selection and actual runtime discovery reject empty or unknown targets`
  - 原断言：`targets.length === 8`，且 `adapter === 'six-methods-and-disposer'` 的数量为 7。
  - 必须改的理由：`STAGE_CONTENT` 已随 `#299` 增长为 9 个阶段（新增 `pibrowse`），硬编码数量与真实契约脱节；只把 8 改成 9 仍会在下次新增阶段时再次失效。
  - 新期望证据：数量改为从 `Object.keys(STAGE_CONTENT).length` 派生；`selectStages('all')` 与 `Object.keys(STAGE_CONTENT)` 做 `deepEqual`；`targets` 的 stage 集合排序后与契约键一致；再用 `Object.entries(STAGE_CONTENT)` 派生 `{ stage, content, adapter }` 期望表，与 `targets` 的同构投影做 `deepEqual`，覆盖全部阶段、content 选择器和 adapter 映射。保留 workflow selector、market selector/tabId/rank、`defaultFocus`/`activationModel` 全量断言，并显式断言 stage 不重复。

## 影响文件

- `plugins/scripts/live-qa.test.mjs`
- `specs/issue-310-live-qa-stage-count.spec.md`

## 验证

- `node --test plugins/scripts/live-qa.test.mjs`
- `pnpm --dir plugins run test:gates`
- `git diff --check`
- `gitleaks detect --no-git`
