# Issue #175 画布成片回写避让

## 假设

首次回写把成片放在合成节点右侧。原落点已有卡片时，成片会盖住卡片，用户需要整理位置。优先保留空闲的原落点，有占位时沿同列向下找首个能容纳成片的位置，可以直接看到原素材与新成片。已有成片依照来源身份更新并保留用户移动后的坐标。[Issue #175](https://github.com/omnimux-ai/omnimux-client/issues/175)

边界盒沿用[画布尺寸解析](../plugins/plugins/omnimux-workflow/src/canvas/editor/utils/nodeVisualMath.ts)的测量值和默认规格，并为同列的可见标题预留纵向空间。未测量的 ComfyUI 卡片沿用[卡片默认规格](../plugins/plugins/omnimux-workflow/src/canvas/editor/utils/comfyPageCard.ts)。竖版成片按[素材预览](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/index.tsx)加载后的高度预留位置。将位置决策留在[导出回写的节点计划](../plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.ts)，复用已有节点和连线写入流程。

## 证伪方式

在同一画布加载固定输入，触发成片回写，核对保存的坐标、实际卡片边界、连线和预览。检查亮暗主题、窄屏、最小缩放及节点菜单打开态。

- 右侧空闲时，成片的位置仍是合成节点右侧的原落点。成片和原节点之间只有一条连线。
- 同列有一个或多个占位时，成片在同列第一个有足够空间的位置落下。已测量、缺尺寸和竖版加载场景中，成片与占位卡片的边界盒保持分开。
- 拖动成片后再次回写，成片仍使用原 ID、用户移动后的坐标和原连线，新媒体版本已写入。
- [纯函数单测](../plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.test.mjs)覆盖顺序无关的多占位、缺尺寸的 ComfyUI 与导演台、最小倍率下的折叠组标题，以及复用路径的坐标与连线。
