# 渠道分组选择：标签换行与名称精简

## 背景

画布节点右侧的模型选择器第三列为渠道分组。当前 `ChannelRow` 把渠道名、价格、计费方式和素材能力标签放在同一个 `flex-wrap` 行里：名称较长时，标签会贴着名称尾部换行，最后一项容易落到下一行且视觉归属不清。模型分组名称来自上游网关快照的 `groups.usable`，其中 H3 等分组会附带长括号说明，三列菜单读起来很长。

## 目标

1. 渠道名称单独占第一行；价格、计费方式、素材能力标签统一从第二行开始排版并换行，不再跟随名称尾部。
2. 渠道名称在展示层显示精简名（去掉尾部长括号说明），完整上游名称保留在 `title` / `aria-label` 中，并保留短限定词如“仅限CC”。
3. 不改变网关分组 ID、路由、价格或成员数据；不新增本地线路表。

## 非目标

- 不改网关 `usable_group` 的源数据或服务端分组命名。
- 不改渠道成员、倍率、计费或筛选逻辑。
- 不改变选择后的 `allowedGroups` / `channelGroupId` 写入语义。

## 研究依据

- `plugins/plugins/omnimux/src/catalog/cloud/snapshot.js`：网关快照把 `usable_group` 归一化为 `groups.usable`。
- `plugins/plugins/omnimux/src/catalog/cloud/view.js`：`snapshotGroupLabels(snapshot)` 读取 `groups.usable`。
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.js`：`snapshotChannelGroups` 优先使用本地 `MODEL_CHANNEL_GROUPS` 展示覆盖；没有覆盖时原样使用网关 `groups.usable[wireGroup]`。H3 当前没有本地覆盖，所以长名称是上游标签。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx`：渠道行 UI 目前将名称和所有 chip 放在同一行。
- 演示：`ui-demo/channel-picker-compact-demo.html`，修改前后并列，覆盖亮/暗主题与窄屏。

## 假设

渠道分组名称是身份展示而非路由键；只做 UI 展示层的尾部括号压缩不会影响选择、执行或价格。短括号限定词具有业务意义（例如“仅限CC”），应保留。

## 证伪方式

如果某个分组长括号前的短名重复或不足以区分线路，而完整名称必须用于选择判断，则不能只压缩展示；若上游 ID/路由或测试表明展示名被用于匹配，则保留完整 label 并只改布局。

## 验收标准

- 渠道卡片名称在第一行，价格/计费/素材 chip 从独立第二行开始，`flex-wrap: wrap`，窄屏下不会把 chip 挤回名称尾部。
- `标准版（主流高品质专线）` 显示为 `标准版`，`H3 文生创意（...）` 显示为 `H3 文生创意`，`H3 数字人口播（...）` 显示为 `H3 数字人口播`；`Claude Max（仅限CC）` 保持短限定词。
- 完整名称通过 `title` 和 `aria-label` 可访问；不改变 `group.id`、`wireGroup`、价格和选择载荷。
- 修改前后演示可直接打开，覆盖亮/暗主题、打开态菜单与窄屏。

## 旧标准变更

无。只新增展示辅助函数和用例，不改已有断言。

## 实施边界

只改 `ModelCascadeMenu.tsx`、`channelGroups.ts`、`components.css`、对应测试和演示；上游快照、Hub 投影、路由协议不动。

## 影响文件

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/theme/components.css`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs`
- `ui-demo/channel-picker-compact-demo.html`

## 验证

- `pnpm --filter omnimux-workflow test`
- `pnpm --filter omnimux-workflow typecheck`
- `pnpm --dir plugins run build:all`
- 浏览器验证：打开演示与画布模型选择器，检查亮/暗主题、打开态菜单和窄屏下名称/标签两行结构；本轮无真实模型调用。
