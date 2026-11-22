# Issue #175 画布成片回写避让

## 假设

首次回写把成片放在合成节点右侧。原落点已有卡片时，成片会盖住卡片，用户需要整理位置。优先保留空闲的原落点，有占位时沿同列向下找首个能容纳成片的位置，可以直接看到原素材与新成片。已有成片依照来源身份更新并保留用户移动后的坐标。[Issue #175](https://github.com/omnimux-ai/omnimux-client/issues/175)

卡身沿用[画布尺寸解析](../plugins/plugins/omnimux-workflow/src/canvas/editor/utils/nodeVisualMath.ts)的测量值和保存尺寸。已有图片或视频尚未保存卡高时，优先用媒体 `size`、`dimensions` 或数值宽高比，按[素材预览](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/index.tsx)加载规则估算高度，并保留加载前占位。未测量的 ComfyUI 卡片沿用[卡片默认规格](../plugins/plugins/omnimux-workflow/src/canvas/editor/utils/comfyPageCard.ts)。

[外置标题](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/NodeHeader.tsx)反向缩放后仍保持屏幕尺寸。用持久化名称、[标题裁剪上限与图标间距](../plugins/plugins/omnimux-workflow/src/canvas/theme/components.css)估算横向范围，并将标题与卡身分别投影到画布坐标。同列保留卡片间距，邻列也检查标题与卡身、标题与标题的交叉。上述两处漏算在独立复审中分别导致已保存竖版与横版重叠，以及 23% 缩放下长标题盖住右卡。[首轮复审](https://github.com/omnimux-ai/omnimux-client/pull/180#pullrequestreview-6011487080)

状态点占用由素材的执行状态、本地状态和[合成节点的徽标映射](../plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionStatus.ts)决定。`ready` 成片无状态点，执行完成的模拟结果按文字徽标估算。素材超出参考图配额的降级警示由客户端实时目录和连线推导，放置估算使用快照中可判定的状态。二轮复审实测，短标题至右卡仍有约 16px 空隙。固定加上 14px 状态点后，标题估算由 84px 增至 98px，超过右卡距标题起点的 94.3px，误触发避让。[状态点渲染](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/StatusBadge.tsx) · [二轮复审](https://github.com/omnimux-ai/omnimux-client/pull/180#discussion_r4657692130)

首次放置以[导出回写的节点计划](../plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.ts)收到的 `sourcePosition` 与 `currentNodes` 为准。来源合成节点按同次回写后的 `completed` 状态计入标题完成点，其余障碍按快照状态估算。三轮复审中，`idle` 快照低估了「一二三四五」的来源标题，回写后完成点与成片图标交叠约 40.80 CSS px²。[三轮复审](https://github.com/omnimux-ai/omnimux-client/pull/180#discussion_r4657874397)

分组内源节点仍由调用方传入组内坐标。未落盘的并发拖动可能与回写重叠，由现有桥接合并处理。

## 证伪方式

在同一画布加载固定输入，触发成片回写，核对保存的坐标、实际卡片边界、连线和预览。检查亮暗主题、窄屏、最小缩放及节点菜单打开态。

- 右侧空闲时，成片的位置仍是合成节点右侧的原落点。成片和原节点之间只有一条连线。
- 同列有一个或多个占位时，成片在同列第一个有足够空间的位置落下。已测量、缺尺寸和竖版加载场景中，成片与占位卡片的边界盒保持分开。
- 拖动成片后再次回写，成片仍使用原 ID、用户移动后的坐标和原连线，新媒体版本已写入。
- 通过 Workflow Host 依次提交两个来源的导出回执。第一个成片在 `(470,-420)`，媒体尺寸为 `180×320`，快照尚无卡高。第二个应放在 `(470,364)`。画布打开并解码后，旧卡高度为 `622`，新旧卡身分开，旧节点和连线仍在。
- 在 760px 亮暗主题下缩到 23%。用同一长标题和右侧卡片对照，测量双向标题与卡身和两个标题之间的交叠面积，应为零。保留菜单打开态的窄屏对照。
- 保持 760px 视口与 23% 缩放，将来源放在 `(40,80)`，右侧音频卡放在 `(880,-80)`，卡高 `300`。来源标题为「短」时，成片保留默认 `(470,80)`，DOM 中标题无状态点，标题和卡身与右卡保有横向空隙。只换成长标题，成片应沿同列避让至 `(470,342)`，标题和卡身与右卡的交叠面积均为零。恢复固定状态点宽度时，短标题的落点断言应失败。
- 在 `(40,80)` 保存 `idle` 来源并通过 `workflowClip.commitExport` 首次导出。一次工作区提交后，来源呈 `completed`，唯一 `out → in` 连线连接成片。「一二三四五」的成片应在 `(470,199)`，四字和「短」仍在 `(470,80)`。在 760px 亮暗主题的 23% 缩放下，来源与成片的标题及卡身交叠均为零。去掉来源完成态的投影时，五字用例应失败。
- [定向测试](../plugins/plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.test.mjs)覆盖顺序无关的多占位、缺尺寸的 ComfyUI 与导演台、折叠组标题、既有素材和合成节点的状态点、模拟文字徽标，以及复用和两种过滤路径。分别撤掉子节点坐标换算和 `hidden` 过滤时，各自用例应失败。
