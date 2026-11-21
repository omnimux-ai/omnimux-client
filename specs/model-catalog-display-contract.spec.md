# 模型目录显示契约与硬编码收敛

## 背景

`/omnimux/model-catalog` 是 hub 对网关快照的投影。当前 viewer、快捷选择器和画布各自维护模型显示名、品牌名及回退目录，导致同一模型在不同入口显示不同名称，并出现不可达的旧模型回退。

## 目标

1. catalog 行新增可选 `familyLabel`，统一品牌显示名。
2. `humanizeId()` 将连续数字段格式化为版本号（`seedream-5-5` → `Seedream 5.5`）。
3. 快捷选择器使用 catalog `label`，删除 `DEFAULT_PRESET_MODELS` 旧回退。
4. 画布型号选择器保持 canonical `id`（现有产品契约），品牌分组使用 `familyLabel`；快捷选择器显示 catalog `label`。
5. 所有改动有单测覆盖，bundle lock 同步。

## 非目标

- 不修改 gateway API。
- 不改变模型参数、计费或生成协议。
- 不迁移 viewer 插件仓。

## 验收

- `seedream-5-5` label 为 `Seedream 5.5`，familyLabel 为 `Seedream`。
- `nano-banana-2-1` label 为 `Nano Banana 2.1`。
- `muse-image` familyLabel 为 `Muse`。
- 快捷选择器显示 label；画布型号保持 canonical `id`，`id` 仅用于值和测试标识。
- `/omnimux/model-catalog` 不可用时不显示旧 `DEFAULT_PRESET_MODELS` 模型。
- `bundle.lock.json`、workspace check、相关单测通过。

## 旧标准变更

以下既有测试断言因本次 catalog 显示契约调整需要改写；原断言锁定了 raw id / 旧排序行为。

- `plugins/plugins/omnimux-workflow/tests/model-id-labels.e2e.test.mjs` :: `model rows and config options render canonical ids, not marketing labels`
  - 原断言：`ModelPicker.jsx` 必须硬编码 `const name = rawId;` 和 `const capsuleName = rawId;`。
  - 必须改的理由：快捷选择器改为优先消费 catalog `label`（缺失时回退 `name`/id），画布型号仍保持 canonical id。
  - 新期望证据：断言 `const name = typeof row.label === 'string'`，并保留 `capsuleName = name`；画布 `label: row.id` 断言不变。
- `plugins/plugins/omnimux/src/settings/omitted-model-defaults.test.js` :: `3312: saved defaults pointing at delisted models resolve only to the fixed real published catalog`
  - 原断言：image bucket 按旧显示排序期待 `nano-banana-2-1` 在 `nano-banana-2-lite` 前。
  - 必须改的理由：`nano-banana-2-1` 的 label 修正为 `Nano Banana 2.1`，目录按 label 排序后顺序变为 lite 在 2.1 前。
  - 新期望证据：断言顺序更新为 `nano-banana-2-lite`, `nano-banana-2-1`，模型集合不变。
