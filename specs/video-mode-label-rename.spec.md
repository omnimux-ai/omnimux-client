# 视频生成模式显示名精简

## 背景

画布生成模式菜单与底栏的显示名来自本地已审校目录 `plugins/plugins/omnimux/src/catalog/contract/operation-registry.json`，画布侧经运行期镜像 `operationLabels.ts` 的 `resolveOperationLabel` 读取。当前五个 operation 的名称带有冗余后缀（驱动、参考、重绘、数字人、过渡），用户要求精简为「首帧 / 尾帧 / 视频编辑 / 对口型」。

## 目标

只改显示文案，覆盖全部用户可见入口与数据源：

| operation id | 修改前 | 修改后 | labelEn 修改后 |
| --- | --- | --- | --- |
| `first_frame` | 首帧驱动 | 首帧 | First frame |
| `first_last_frame` | 首尾帧过渡 | 首尾帧 | First-last frame |
| `end_frame` | 尾帧参考 | 尾帧 | Last frame |
| `video_edit` | 视频编辑/重绘 | 视频编辑 | Video edit |
| `digital_human` | 数字人/对口型 | 对口型 | Lip sync |

同步修改：权威目录、画布镜像、本地型号 YAML 的 `digital_human` label、工作流形态池 `format.json`、受影响的单测/集成/E2E 断言、当前用户文档。

## 非目标

- 不改任何 operation id、`modeKind`、能力槽位、参数、网关契约。
- 不改菜单结构、布局、交互或主题。
- 不新增枚举式硬编码字典；展示仍只经 `resolveOperationLabel`。

## 验收

1. `operation-registry.json` 与 `operationLabels.ts` 对五个 id 的中英文一致，parity 测试通过。
2. 目录层 `list.label.test.js`、网关契约 `gateway-contract.test.js` 的断言使用新名称。
3. 画布模式菜单与底栏摘要仍统一经 `resolveOperationLabel`；`operationLabels.test.mjs` 期望值更新为「首帧」等新名称。
4. 本地型号 YAML 中 `digital_human` 的 label 改为「对口型」；其余三个 id 的 YAML label 本已是「首帧 / 尾帧 / 视频编辑」。
5. 工作流形态池 `plugins/scripts/workflows/pools/format.json` 的对应 `name` 同步。
6. 不提交真实视频生成；单元与静态验证通过。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/shared/validation/operationLabels.test.mjs` :: `#4103 label 等于 id（gateway-only 旧行为）时改用已审校目录`
  - 原断言期望 `first_last_frame` 回落为「首尾帧过渡」，现改为「首尾帧」；原因是本次统一精简显示名。
- `plugins/plugins/omnimux-workflow/src/shared/validation/operationLabels.test.mjs` :: `#4103 六个视频 operation 中英齐备，document/webpage 不再回落 id`
  - 原期望列表含「首帧驱动」「首尾帧过渡」及 `First-frame driven` / `First-last frame transition`，现同步为「首帧」「首尾帧」及 `First frame` / `First-last frame`。
- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js` :: `gateway video mode names reach both catalog projections independently of image count`
  - 原断言 `firstFrame.label` / `labelEn` 期望「首帧驱动」/ `First-frame driven`，现改为「首帧」/ `First frame`。

其余同步（非断言削弱）：`list.label.test.js` 的 `APPROVED_VIDEO_LABELS`、`summaryFormatter.test.mjs` / `videoParamNormalization.test.mjs` / `inputCapabilityVideo.integration.test.mjs` 的夹具文案、`canvas-group-capabilities.e2e.test.mjs` 的菜单选择文案、`http.test.js` / `generation-products.test.js` 的目录夹具，均改为新名称。历史 spec `specs/gateway-video-mode-names.spec.md` 的验收文字不改写；本任务新名称以本 spec 为准。

## 影响文件

- `plugins/plugins/omnimux/src/catalog/contract/operation-registry.json`
- `plugins/plugins/omnimux-workflow/src/shared/validation/operationLabels.ts`
- `plugins/plugins/omnimux/src/catalog/specs/video-models.yaml`
- `plugins/scripts/workflows/pools/format.json`
- `plugins/plugins/omnimux-workflow/README.md`
- 对应测试与断言文件
