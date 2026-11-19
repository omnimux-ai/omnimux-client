# Spec: 移除冗余状态播报 Toast/提示条并固化 UI 反馈规范（#109）

- 任务：`issue-109-ui-notices`
- 日期：2026-11-19
- 基线：`6479a34d0d969aaf6364d34a1a9ed9f78d297199`（origin/main）
- 风险：R2（`omnimux-workflow` / `omnimux-clip` 用户可见反馈层；不改模型线路、定价数据与底层参数归一化）

## 目标

- 移除「状态切换结果已在控件/画面直接呈现」的冗余 Toast、内联提示条与画布通知，落实 Show, Don't Tell。
- 保留失败/阻断错误、需要用户补救的异常、界面无直观变化的回执（复制、无音轨、试听不可用等）。
- 保留 `videoParamNormalization.ts` / `videoParameterSelection.ts` / `channelContractReconciler.ts` 的底层参数归一化、钳制与 `blocked` 提交阻断校验。
- 在根 `AGENTS.md` 第 4 条固化「禁止冗余状态播报」「禁止为测试加 UI 文案」「Toast/提示条唯一适用范围」。

## 范围

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/AssetsDrawer.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/assets/drawer/drawerMenuHandlers.ts`
- `plugins/plugins/omnimux-clip` 检查器四文件：`MotionPresetsPanel.tsx`、`BackgroundRemovalSection.tsx`、`FilterPresetsPanel.tsx`、`ClipTransitionSection.tsx`
- 相关测试、根 `AGENTS.md` 与 `specs/issue-109-ui-notices.spec.md`

## 用户操作旅程

1. 打开视频创作节点，在模型/线路/生成方式间切换：参数自动归一化，控件（分辨率、画幅、时长、生成方式）直接显示新值；界面不出现参数联动 Toast、`wf-channel-healing-notes` 提示条或 `mode_consumption_changed` 通知。
2. 从素材抽屉点击「在画布中定位」：画布镜头移动并高亮节点，无「已在创作画布中定位」Toast。
3. 在素材抽屉点击「预览」或切换网格/树形视图：预览窗口/视图布局直接变化，无「已打开预览」「已切换视图」Toast。
4. 在 `omnimux-clip` 检查器移除预设、关闭背景移除、清除滤镜/动画：控件与预览直接变化，无纯状态复读 Toast。
5. 触发失败/阻断/补救场景（结构拒绝、禁用态发送、BYOK 失效横幅、无音轨、试听失败、剪贴板复制）：反馈仍然存在且语义正确。
6. 全流程覆盖亮/暗双主题与窄屏布局。

## 验收标准

- [ ] AC-1 切换视频/图片模型、线路、生成方式时底层参数归一化继续生效，控件直接显示更新结果；参数联动 Toast 为 0、`wf-channel-healing-notes` 提示条为 0、`mode_consumption_changed` 通知为 0。
- [ ] AC-2 `AssetsDrawer` 定位与 `drawerMenuHandlers` 预览/视图切换的冗余 Toast 已移除。
- [ ] AC-3 `omnimux-clip` 四处纯状态复读 `toast.info` 已移除，其余失败/成功回执不受影响。
- [ ] AC-4 审慎保留项完好：结构拒绝、禁用态发送阻断、BYOK 失效横幅与切换按钮、无音轨/试听不可用（warning）、异步分析 0 命中、剪贴板复制回执、未支持菜单拦截。
- [ ] AC-5 旧单测不再断言被删提示文案，改为断言真实归一化参数值、控件状态或 DOM。
- [ ] AC-6 根 `AGENTS.md` 第 4 条已补充规则；`git diff --check`、`node --test plugins/scripts/verify-agents-md.test.mjs` 通过。
- [ ] AC-7 `pnpm --filter omnimux-workflow test`、`pnpm --filter omnimux-clip test`、构建与门禁通过；worktree 真实浏览器亮/暗主题、窄屏验收通过。

## 假设

- 参数归一化、钳制与 `blocked` 阻断来自纯函数层，删除 UI 展示不改变其返回值、执行准备与提交校验行为。
- 被删提示只承担「复读已呈现状态」，不承载唯一可用的错误信息；失败与补救反馈均有独立的错误码、横幅或按钮状态承接。
- 本单不触碰 `#58` 的模型线路与定价数据/产品代码，也不改官方 DSH 源码。

## 证伪方式

- 若有任一归一化参数值、`blocked` 结果或执行准备输出因删除提示而变化，则假设不成立，停止并修正。
- 临时在切换路径重新注入一条 `toast.info` 或 `wf-channel-healing-notes` DOM，浏览器验收脚本应检出非 0 提示并失败；移除后恢复全绿。
- 对保留项做反向检查：删除 BYOK 横幅、禁用态阻断提示或无音轨回执时，相应用例必须变红。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/configPanelExpand.test.mjs` :: `Feed-Slot 卡槽：SlotWells 驱动 + 卸装填不断边 + 无节点内静态错误条（T03/T05）`
  - 原断言：`assert.match(panelSrc, /mode_consumption_changed/)`，要求 `ConfigPanel` 保留模式消费变更通知。
  - 必须改的理由：#109 明确移除 `mode_consumption_changed` 播报，旧断言与新验收标准相反。
  - 新期望证据：同一用例改为 `assert.doesNotMatch(panelSrc, /mode_consumption_changed/)`，并保留 `submit_blocked_click` 的画板通知断言。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/audioParams/voicePickerDialog.test.mjs` :: `VoicePickerDialog：试听安全（原生 Audio 消费 hub preview DTO，零 fetch / TTS / 本地拼 URL）`
  - 原断言：`assert.match(dialogSrc, /toast\.info\('试听暂不可用，请稍后重试。'\)/)`。
  - 必须改的理由：#109 要求试听失败与无音轨回执语义化为 `toast.warning`，不能继续断言 info 级别。
  - 新期望证据：改为 `assert.match(dialogSrc, /toast\.warning\('试听暂不可用，请稍后重试。'\)/)`，文案本身保持不变。

## 测试计划

- 单元：`pnpm --filter omnimux-workflow test`、`pnpm --filter omnimux-clip test`；重点覆盖 `videoParameterSelection`、`videoParamNormalization`、`channelContractReconciler`、ConfigPanel 源码/DOM 契约与 `voicePickerDialog`。
- 静态：`git diff --check`、`node --test plugins/scripts/verify-agents-md.test.mjs`、`pnpm test:gates`。
- 构建：`corepack pnpm --dir plugins run build:all`。
- 真实浏览器：worktree 隔离环境覆盖亮/暗主题与窄屏；断言切换模型/线路/生成方式后控件值直显且 Toast/提示条数量为 0，并核对保留项仍可见。
