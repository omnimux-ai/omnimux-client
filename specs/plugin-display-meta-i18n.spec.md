# 插件名称与描述规范化及多语言适配

## 背景

当前 `plugins/plugins/*` 下 13 个 OmniMux 插件未提供符合 DeepSeek Harness 官方插件展示元信息规范（`locale/en.json`、`locale/zh.json` 及 `package.json` 导出）的多语言名称与描述，导致插件管理页与内置插件设置页直接回退显示原始包名（如 `omnimux-assets`）和冗长、中英混杂甚至缺失（`omnimux-forms`）的 `package.json.description`。

## 假设

1. DeepSeek Harness 的插件管理页（`ui-plugin-manager`）与设置页（`ui-settings-plugins`）通过 `app-boot` 的 `readPluginMeta` 读取插件包导出的 `./locale/*.json`（以 `en.json` 为发现入口，同目录自动扫描 `zh.json` 等语言文件）中的 `meta.title` 和 `meta.description`，并按当前界面语言（`zh` / `en`）自动切换展示。
2. 所有 13 个插件补齐 `locale/en.json`、`locale/zh.json`，在 `package.json` 声明 `exports["./locale/*.json"]` 与 `files` 包含 `"locale"`，同步精简 `package.json.description`、`dsh.manifest.json`、`plugins.registry.json` 与 `app/scripts/build-plugin-index.mjs` 后，中英文插件列表与市场索引均能呈现与官方插件一致的简洁风格，无截断、无技术实现词、无中点分隔符。

## 证伪方式

1. 静态门禁验证：`verify-package-files.mjs` 扩展校验 13 个插件的 `locale/{en,zh}.json`、`exports["./locale/*.json"]`、`files` 覆盖与 `package.json.description` 一致性；删除或破坏任一插件的 `locale/zh.json`、`meta.title` 或 `exports` 时，校验必须真实失败。
2. DSH 运行时元数据解析验证：针对 13 个插件执行真实 Node ESM 导出解析与 DSH `readPluginMeta` 等价校验，断言全部返回非空 `title.{en,zh}` 与 `description.{en,zh}` 且无 `error` 诊断。
3. 市场索引与注册表验证：`node plugins/scripts/registry-tool.mjs verify` 与 `node app/scripts/build-plugin-index.mjs --offline` 通过 DSH `parseMarketIndex` 校验。
4. 合并后在 Dev 运行态核对中英文切换下插件页展示与文案无截断。
