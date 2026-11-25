# fix(omnimux-workflow): 主体库缩略图卡片保持横版占位，竖版图片按比例完整显示

## 问题描述

左侧主体库（`SubjectLibraryView`）的 2 列卡片网格中，封面区域（`.wf-subject-card-cover-compact`）高度固定为 `80px`，呈现横版卡片占位。当前图片样式 `.wf-subject-card-img-compact` 使用 `object-fit: cover`，竖版人物/角色全身像会被按宽度放大并上下裁切，头部与下半身丢失；同时封面容器背景硬编码为 `#09090b`，浅色主题下出现突兀纯黑边。

## 假设

1. 根因完全位于 `plugins/plugins/omnimux-workflow/src/canvas/theme/components.css` 中 `.wf-subject-card-cover-compact`（硬编码 `background: #09090b`）与 `.wf-subject-card-img-compact`（`object-fit: cover`），无需改动 `.wf-subject-grid-compact` 的 2 列网格与 `80px` 高度占位，也无需改动 `SubjectLibraryView.tsx` 的 DOM 结构与交互行为。
2. 参照同文件 `.wf-picker-card__media` 与 `.wf-hover-inspector-img` 的完整呈现模式，将 `.wf-subject-card-img-compact` 改为 `object-fit: contain; object-position: center center; display: block;`，并将 `.wf-subject-card-cover-compact` 背景改为宿主真实语义 Token `var(--dsw-alias-bg-layer-2, var(--wb-surface-raised))`（该 Token 已在宿主 `design-platform.css` 与 `dsw-token-allowlist.json` 中注册），即可在保持 2 列横版卡片网格不变的前提下，于亮/暗双主题中按原始比例完整居中展示竖图、横图与方图且无突兀纯黑边。
3. 本次修复严格限定于 `SubjectLibraryView`：不改动 `ProjectAssetsView`（`.wf-grid-card-thumb-compact` 由 `mediaThumbRendering.e2e.test.mjs` 显式断言 `object-fit: cover`），也不改动 `assetsLibraryMapper.ts` 的非图片 `files[0]` 映射。

## 证伪方式

1. **双向证伪回归测试**：运行 `node --import ./test-setup.mjs --test src/canvas/editor/components/assets/subjectCardCover.e2e.test.mjs`（在 `plugins/plugins/omnimux-workflow` 目录）。在修复前基线运行该测试必须失败（命中的 `.wf-subject-card-img-compact` 仍为 `object-fit: cover` 且 `.wf-subject-card-cover-compact` 仍为 `#09090b`）；应用修复后必须全绿，且在 JSDOM 加载真实 `workbench-theme.css` + `components.css` 并在亮/暗主题（`body[data-ds-dark-theme]`）下校验层叠最终胜出值而非仅做文本存在性检查。
2. **宿主 Token 门禁与构建验证**：运行 `node plugins/scripts/verify-dsw-tokens.mjs`、`corepack pnpm --dir plugins run build:all` 与 `corepack pnpm --dir plugins --filter omnimux-workflow test`。若新增未定义 `--dsw-*` Token、破坏 `mediaThumbRendering.e2e.test.mjs` 或破坏 `assetsLibraryMapper.test.mjs`，即证伪失败。
3. **真实浏览器亮/暗双主题几何与像素核对**：在真实 Chromium 中渲染 `SubjectLibraryView`（含 9:16 竖版全身像、16:9 横版图、1:1 方图及无图占位），在亮色与暗色（`body[data-ds-dark-theme]`）及窄屏（260px 抽屉宽度）下分别校验：
   - `.wf-subject-grid-compact` 维持 2 列且每张卡片 `.wf-subject-card-cover-compact` 计算高度精确为 `80px`；
   - `.wf-subject-card-img-compact` 计算样式为 `object-fit: contain`、`object-position: 50% 50%`、`display: block`；
   - 竖图在 `80px` 高容器内按原比例完整呈现头脚（通过采样图片上下边缘色带确认未被裁切），左右留白底色等于当前主题的 `--dsw-alias-bg-layer-2`（亮色非 `rgb(9, 9, 11)`，暗色为宿主层 2 深灰而非 `#09090b`）。
4. **已有端到端路径复核**：运行 `assetsLibraryMapper.test.mjs`、`subjectBrowse.runtime.test.mjs`、`mediaThumbRendering.e2e.test.mjs` 及主体库浏览器端到端验收；任一项因本次改动回归即证伪失败。
