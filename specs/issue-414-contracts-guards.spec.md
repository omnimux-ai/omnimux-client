# Issue #414：tiktok-selection 工具旁路、Prompt/Manifest 契约漂移与静态守卫加固

## 假设

1. **提示词与清单真源漂移**：`omnimux-products/src/index.js` 的 `PRODUCTS_PROMPT` 仍错误声明不存在 `products_delete` 工具，同时 `omnimux-products/dsh.manifest.json` 漏列 `products_delete`，目录也缺少 `README.md`，会误导 Agent 与开发者认为产品库无法通过工具删除记录。
2. **跨插件工具旁路与名称上限冲突**：`omnimux-tiktok-selection/src/index.js` 将 `ctx.tools?.get` 包装为 `getTool` 传入 `assets-pipeline.js`，导致 `syncToOmnimuxProducts` 直接执行 `productsCreate.execute(...)` 绕过 `ctx.tools.execute` 策略/审批/审计管线并逃逸 `verify-plugin-boundaries.mjs` 检查；同时其传入 `item.title.slice(0, 60)` 超过 `omnimux-products/src/library.js` 的 `NAME_MAX = 40` 且未过滤 `/` 字符，超 40 字符或含斜杠标题同步必抛 `name-invalid`。
3. **Manifest 与遥测前缀表脱节**：`omnimux-accounts`、`omnimux-analytics`、`omnimux-inspiration`、`omnimux-video` 的 `dsh.manifest.json` 漏列已注册工具（`analytics` 的 `tier` 也错标为 `tier-0-hub`），6 个独立业务插件清单仍声明过时的 `shell.overlay` 槽位而非 `betterSidebar.registerTab`；`omnimux-analytics/src/config.js` 的 `DEFAULT_PLUGIN_MAP` 缺少各垂直插件前缀，导致遥测归因落入 `'other'`。
4. **静态守卫盲区**：`verify-plugin-boundaries.mjs` 未拦截将 `ctx.tools.get/executable` 包装为闭包别名外传或间接调用的旁路，`verify-plugin-agent-tools.mjs` 未校验源码注册工具集与 `dsh.manifest.json#capabilities.tools` 的一致性。

## 证伪方式

1. 将 `omnimux-tiktok-selection/src/assets-pipeline.js` 中的名称清洗截断临时改回 `.slice(0, 60)` 或将调用改回 `definition.execute(...)` 后，运行 `node --test plugins/plugins/omnimux-tiktok-selection/src/assets-scheduler-http-tools.test.js`，新增的真实跨插件同步与批次管线回归用例必须断言失败；恢复修复后全绿。
2. 临时恢复 `PRODUCTS_PROMPT` 中的 `"There is no products_delete tool"` 后，`plugins/plugins/omnimux-products/src/tools.test.js` 必须断言失败；从 `omnimux-products/dsh.manifest.json` 删除 `products_delete` 后，`node plugins/scripts/verify-plugin-agent-tools.mjs` 必须非零退出；恢复后均通过。
3. 使用旧版 `const getTool = (name) => ctx.tools?.get?.(name)` 包装片段输入 `checkSourceFileBoundaries` 或在 `verify-ci-gates.test.mjs` 中测试，`verify-plugin-boundaries.mjs` 必须报告工具调度边界违规。
4. 运行 `DEFAULT_PLUGIN_MAP` 映射测试时，所有新增前缀（`clip_`、`products_`、`inspiration_`、`publish_`、`accounts_`、`analytics_`、`tiktok_selection_`、`pibrowse_`、`browser_`、`display_file` 等）必须精确归属对应插件，而未登记前缀仍保持归入 `'other'`。
