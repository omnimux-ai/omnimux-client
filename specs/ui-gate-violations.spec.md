# UI 门禁违规收敛

- 任务：`fix-ui-gate-violations`
- 日期：2026-11-21
- 范围：`omnimux` / `omnimux-inspiration` / `omnimux-workflow` 客户端视图的 UI01/UI02/UI10 静态门禁存量违规；不改变业务流程、接口或工具契约。
- 验收：`corepack pnpm --dir plugins run test:ui` 0 违规；受影响插件构建与测试通过；亮/暗/窄屏演示 `ui-demo/ui-gate-fixes-demo.html`。

## 修复项

- `RuntimeModeSection.jsx`：Agent 卡片原生 `<button>` 改为 `dsh-ui-kit Button`，保留卡片布局类并补齐 `aria-pressed`。
- `ProductCreateLinkModal.jsx`：手动创建次链改为 `Button`；标题 22px 收敛为 24px/32px。
- `SkillCard.jsx`：隐藏的「使用 Skill」触发按钮保持原生 `button`（session-guide 子树刻意保持零 dsh-ui-kit 依赖，显式 `exempt-ui01`），绝对定位/隐藏态移入样式表。
- `SkillsPanel.jsx`：`marginTop: '16px'` 内联样式改为 `omnimux-skills-grid--spaced` 样式类。
- `PostMediaCarousel.jsx`：图片打开按钮与轮播圆点改为 `Button`，保留既有可访问语义。
- `RivalTimelineRow.jsx`：展开/收起文字链改为 `Button`，文字链视觉保持。
- `omnimux/src/client/styles.js`：Agent 标题与图标字号 17px 收敛为 16px。
- `omnimux-workflow/src/client/styles.js`：画布加载说明 12.5px 收敛为 13px。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/client/canvasLoadingState.test.mjs` :: `CSS：1.35s 线性无限旋转 + 280ms 淡入 + 12.5px/.05em 说明文字`
  原断言要求加载说明为 12.5px；12.5px 不在 UI10 合规字阶白名单，运行态样式改为 13px，测试同步改为 13px。视觉层级不变，仅收敛到相邻标准字号。
- `plugins/plugins/omnimux-workflow/src/client/canvasLoadingState.test.mjs` :: `CSS：1.35s 线性无限旋转 + 280ms 淡入 + 13px/.05em 说明文字`
  新用例名对应上述 13px 断言，仅用于保留改名后的旧标准声明映射。
