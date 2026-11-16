# Spec: 模型输入框提交后即时任务创建与运行反馈（#48 v2）

- 任务：`issue-48-submit-feedback`
- 日期：2026-11-16
- 基线：`e5e2e32ffc09b2ca5f771b4995b7e62908dfe89e`（origin/main）
- 风险：R2（画布节点提交流程、执行状态机与按钮状态；不改其他插件/后端）

## 目标

- 点击图片/视频节点生成按钮后立即进入同步提交 guard，并调用 `startNodeExecution`；不等待 quota、saveNow、附件/提示词预处理。
- 创建请求窗口只显示极短静态 `…`，不旋转；创建成功立即切 `pending/running`，按钮静止禁用（ArrowUp 置灰）；失败恢复 ArrowUp + toast，可重试。
- 连点 5 次只创建 1 个任务；图片节点与视频节点共用 `MaterialNode → ConfigPanel → GenerateButton` 链路统一覆盖。

## 状态机

```
idle
  └─ 点击：submitPendingRef 同步置位、submitPending=true
       ├─ creating：仅覆盖 startNodeExecution 的 create RPC；GenerateButton data-submission-state="creating"，静态 …
       │    ├─ 成功：executionStatus=pending/running 接管；submitPending 清除，按钮静止禁用
       │    └─ 失败：submitPending 清除，toast.error，按钮恢复 ArrowUp，可重试
       └─ 重复点击：submitPendingRef / startingRef 拦截，不重复 create
```

## 范围

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/index.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/GenerateButton.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/hooks/useExecutionController.ts`
- `plugins/plugins/omnimux-workflow/src/shared/api.ts`、`src/workflow/routes/executionRoutes.ts`、`src/workflow/workspace/snapshotSchema.ts`（请求携带 graph snapshot，由 host 直接执行）
- `plugins/plugins/omnimux-workflow/src/canvas/store/executionStore.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/nodeVisualMath.ts`
- 相关测试与 spec

## 交互与执行

- `MaterialNode.handleGenerate` 第一行检查 `submitPendingRef.current`；未提交时同步置位并 `setSubmitPending(true)`，随后立即 `startNodeExecution(id)`；不先 await quota。
- `startNodeExecution` 返回 `Promise<{ ok, error? }>`；`useExecutionController.startExecution` 的 single-node 立即路径不等待 save barrier，把点击时 graph snapshot 放进 create 请求，host 路由按该 snapshot 执行；group/subset 保留既有保存屏障与 `expectedVersion`。
- `GenerateButton` 增加 `isSubmitting`：creating 只渲染静态 `…`；running 只渲染静止 ArrowUp；不出现 `Loader2` 或旋转 animation。
- quota 预检与 create 并行，不阻塞点击；额度拒绝由 hub quota seam 提示，quota transport 失败由点击入口 toast。
- immediate single-node 的 save barrier 在后台并行；若保存失败，通过 `onPreflightError` 回调显示 toast，不静默吞掉。
- 创建失败由点击入口 `toast.error`，节点不残留 loading；`finally` 清理本地 submitting guard。
- `mapNodeToGenerationStatus('pending')` 映射为 `pending`，创建成功后节点卡立即显示排队/运行态。
- 图片/视频均使用同一 `MaterialNode → ConfigPanel → GenerateButton` 组件链，无节点类型分支。

## 验收标准

- [ ] AC-1 点击生成后 `startNodeExecution` 立即被调用，不等待 quota/saveNow/附件/提示词预处理；`startExecution` 的 single 立即路径在 save barrier 未完成时已发出 create。
- [ ] AC-2 创建窗口只显示静态 `…`，按钮不旋转；成功立即切 pending/running 后 ArrowUp 静止禁用。
- [ ] AC-3 创建失败恢复 ArrowUp、显示 toast，节点不残留 loading，可再次点击。
- [ ] AC-4 连点 5 次 create 调用 1 次。
- [ ] AC-5 图片节点与视频节点共用同一组件链路，分别通过。
- [ ] AC-6 现有 workflow 测试、typecheck、build 通过；附件/链接/快捷方式/草稿不回归。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/nodeVisualMath.test.mjs` :: `GSC 映射：pending/skipped 不算生成中，按媒体与本地态落`
  - 原断言：`mapNodeToGenerationStatus('pending', 'empty', false) === null`。
  - 必须改的理由：#48 v2 要求创建成功后立即显示排队/运行态，`pending` 不能再落入空态；否则节点卡在 create 成功后会回到空素材占位。
  - 新期望证据：`mapNodeToGenerationStatus('pending', 'empty', false) === 'pending'`（新用例名「GSC 映射：pending 进入排队态，skipped 按媒体与本地态落」）。
