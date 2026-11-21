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
