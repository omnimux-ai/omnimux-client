# 图像生成右侧预览图去黑边、去外围光晕与真圆角修复

## 背景与问题

关联工单：#434

右侧「图像生成」媒体查看器（`omnimux-viewer` / `omnimux` 客户端共享样式）当前存在三项视觉与几何缺陷：

1. **大面积黑边留白**：已完成图片与视频被硬塞进 `.omx-media-slot[data-ratio]` 固定比例占位框内。未显式传 `aspectRatio` 的图片（如对话消息提取或嗅探进入画布的图片）在 `media-viewer-store.js` 中默认兜底为 `'1:1'`，导致容器被锁死为 `520×520` 正方形；叠加 `.omx-media-result img` 的 `width: 100%; height: 100%; object-fit: contain` 后，非 1:1 图片上下或左右产生明显黑边，且 `3:4`、`2:3`、`3:2`、`21:9`、`auto` 比例缺失占位宽高定义。
2. **外圈浅灰模糊光晕特效**：`.omx-mv-display` 与 `.omx-media-slot` 各自叠加了一层大扩散投影（`box-shadow: 0 16px 56px var(--dsw-alias-bg-layer-1)` 与 `0 20px 60px var(--dsw-alias-bg-layer-1)`）。深色主题下 `--dsw-alias-bg-base` 为 `rgb(21, 21, 23)`，而 `--dsw-alias-bg-layer-1` 为更浅的 `rgb(35, 35, 36)`，在深色画布背景上向外渲染成一圈浅灰发雾发光晕，并反衬黑边更明显。
3. **圆角在真实画面上失效**：尽管 `.omx-mv-display img` 与 `.omx-media-slot` 声明过 `border-radius`，但 `<img>` 自身被 `width: 100%; height: 100%` 撑满 `1:1` 方框，CSS `border-radius` 仅裁切外框四角，无法裁切中间按 `object-fit: contain` 等比缩小后的真实照片四角，导致画面仍是生硬直角，同时使标注打点坐标系以含黑边方框为基准发生偏移。

## 假设

1. 将完成态图片/视频与生成中/失败占位框结构解耦（完成态使用 `.omx-media-slot--media` / `.omx-media-result--media`，取消固定 `data-ratio` 尺寸锁定并采用 `width: auto; height: auto` 紧贴媒体原生比例收缩），可以彻底消除黑边，让 `border-radius: var(--dsw-radius-md, 12px)` 直接裁切真实画面四角，并确保标注打点百分比坐标严格对齐画面边缘。
2. 在 `MediaViewerTab.jsx` 中通过 `ResizeObserver` 同时监听 `.omx-mv-single-stage` 与同级底部悬浮输入框 `.omx-mv-composer-outer`，动态写入 `--omnimux-mv-stage-max-w`、`--omnimux-mv-stage-max-h` 与四边避让内边距 `--omnimux-mv-stage-pad-*`（样式层同步保留无 JS 时的 `calc(100vh - 260px)` 兜底），可在窗口缩放、非全屏分栏以及多行提示词撑高输入框时均保证完成态预览图和占位态卡槽零遮挡且不压住左侧缩略图栏。
3. 移除 `.omx-mv-display` 与 `.omx-media-slot` 上引用 `--dsw-alias-bg-layer-1` 的 `box-shadow`（统一置为 `box-shadow: none`）后，深色与浅色主题下预览图四周不再出现浅灰发光晕或阴影杂边，且不影响生成中 `GeneratingStateCard` 与失败卡槽的原有表现。

## 证伪方式

1. **真实 Chromium 几何与样式 E2E 验证**：在加载宿主真实 `--dsw-*` 主题表与构建后 `MEDIA_VIEWER_CSS` 的无头 Chromium 中，渲染 `MediaViewerTab` 并分别注入未带 `aspectRatio` 的竖图（`512×890`）、方图（`800×800`）、横图（`1280×720`）以及 `generating` / `failed` 任务，在亮/暗双主题、宽/窄视口与多行提示词撑高输入框场景下测量：
   - 若完成态 `<img>` 渲染宽高比与 `naturalWidth / naturalHeight` 偏差超过 `0.02`，或 `.omx-media-slot--media` / `.omx-mv-display` 与 `<img>` 的几何尺寸偏差超过 `1px`，则去黑边与紧贴画布假设不成立；
   - 若 `.omx-mv-display` 或 `.omx-media-slot` 计算样式 `boxShadow !== 'none'`，则去光晕假设不成立；
   - 若 `<img>` 与 `.omx-media-slot--media` 计算样式 `borderRadius !== '12px'`，或 `imgRect` 与底部悬浮输入框（含多行撑高）/左侧缩略图栏发生重叠溢出，则圆角或动态避让假设不成立。
2. **双向证伪**：临时回退 `MediaViewerTab.jsx` 与 `styles.js` 的核心修复，运行新增回归测试与真实浏览器 E2E 必须真实断言失败；恢复修复后全量单测、E2E 与样式/阶段/Token 门禁必须全绿。

## 验收标准

- **AC-1（零黑边紧贴画面）**：竖图（如 `512×890`）、方图（`1:1`）、横图（`16:9`）及视频在完成态均按自身原生宽高比渲染，容器紧贴画面边缘，无黑边留白。
- **AC-2（无外围光晕特效）**：`.omx-mv-display` 与 `.omx-media-slot` 均保持 `box-shadow: none`，深色与浅色主题下均无浅灰发光晕。
- **AC-3（真实 12px 圆角裁切）**：已完成图片与视频四角直接呈现 `var(--dsw-radius-md, 12px)` 圆角裁切。
- **AC-4（既有能力无回归）**：生成中流光卡与失败卡槽尺寸正常（并补齐 `3:4`、`2:3`、`3:2`、`21:9`、`auto` 占位比例）、顶部工具栏/缩放/拖拽/打点评论正常工作、现有单测与门禁测试全部保持通过。
- **AC-5（亮暗双主题与窄屏适配）**：暗色主题、亮色主题、有/无左侧缩略图栏及窄屏（`< 520px`）下预览图不遮挡底部悬浮输入框、不压住左侧缩略图栏。
