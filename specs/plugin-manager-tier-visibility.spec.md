# 侧栏插件页分层可见性与底座保护

## 背景

在 `dsh-desktop-next` 中，侧栏「插件 → 已安装插件」仅展示满足 `pkg.installed || pkg.official || pkg.error !== undefined` 的组合包，其中 `installed` 仅检查 profile `package.json#dependencies`。这导致：

1. 全新正式版安装或执行 `upgrade-dev` 后，随 `app.asar` 内置分发的全部 OmniMux 业务插件（`installed=false, official=false`）在插件管理页全部隐身，PR #243 的多语言名称与兄弟插件详情配置页在正式版不可达。
2. Dev 环境单插件物化后，被覆盖的少数包会零星冒泡（甚至包括 `omnimux` 核心底座并附带可关闭开关），Dev 与正式版表现分裂。

## 目标与假设

1. **底座内置隐藏与强保护**：`omnimux` 与 `dsh-better-sidebar` 属于产品底座，通过 `app/dsh-desktop-next/package.json#dsh.protectedBundles` 在 Host `dsh-plugin-manager` 层对组合包（`protectsManager`、`listBundles`、`setBundleEnabled`、`removeBundle`）与插件行（`listPlugins`、`setPluginEnabled`，覆盖 Agent `plugin_manager` 工具与 RPC）均强制返回 `readOnlyReason: 'management-required'`（禁止关闭与卸载），并在客户端通过 `plugins.bundle.hidden` 从侧栏插件页隐藏；模型设置与参考素材存储仍由顶部「内置插件配置」（`plugins.item`）承载，运行态清单保留在「设置 → 内置插件」。
2. **业务 `omnimux-*` 进「已安装插件」可启停、禁卸载**：通过 `dsh-client-ui-plugin-manager` 新增对称槽位 `plugins.bundle.listed`，由 `dsh-desktop-next` 从单一真源 `app/config/plugin-tiers.json` 注册 `preview`（不含 `omnimux`）与 `beta` 业务包；业务包在全新正式版与 Dev 下统一显示于「已安装插件」，可自由启停与进入详情页，且 `availability === 'installation'` 始终不展示卸载按钮、Host `removeBundle` 拒绝卸载。
3. **Beta 插件不泄露给全新正式版**：4 个 `beta` 插件（`omnimux-accounts`、`omnimux-analytics`、`omnimux-publish`、`omnimux-video`）在各自 `package.json#dsh.bundle` 声明 `listedByDefault: false`，在全新正式版默认关闭态保持隐藏，在 Dev 启用或物化时正常显示。

## 证伪方式

1. **客户端可见性与无卸载按钮证伪**：回退 `client-seams.mjs` 的 `plugins.bundle.listed` 判定后，`plugin-detail-navigation.spec.ts` 新增的全新正式版业务插件展示断言必须失败；恢复后全绿。
2. **Host 底座保护证伪**：回退 `dsh-plugin-manager@0.2.2-rc.5.patch` 的 `protectedBundles` 校验后，`protected-bundles-compat.test.mjs` 对 `omnimux` / `dsh-better-sidebar` 的组合包与行级 `management-required` 拒绝关闭断言必须失败；恢复后全绿。
3. **打包、双语文档与工作区元数据门禁**：`workspace-check.mjs --check`、`check:package-files`、`dsh-desktop-next` `build` / `typecheck` / `test` / `verify:host` / `verify:frontend` 及 `verify-bilingual-docs.mjs` 全部通过。

## 旧标准变更

- `plugins/plugins/omnimux/tests/e2e/model-settings.journey.mjs` :: `*`
  - 原断言：旧旅程点击侧栏「已安装插件」中的 `[data-plugin-package="omnimux"]` 卡片并进入 `[data-plugin-detail="omnimux"]`，断言 `bundle.bundleConfig === 1` 与 `bundle.detailSection === 0`。
  - 变更理由：本次产品分层将核心底座 `omnimux` 与 `dsh-better-sidebar` 通过 `plugins.bundle.hidden` 从「已安装插件」隐藏，并在 Host `dsh.protectedBundles` 设为只读保护，原卡片入口不再存在；且该旧文件采用顶层无主断言（无 `test()`/`it()` 包装），按仓库旧测试标准门禁退役该文件并以新旅程替代。
  - 新期望与证据：新增 `plugins/plugins/omnimux/tests/e2e/plugin-manager-tier-visibility.journey.mjs` 覆盖原「内置插件配置 → 模型设置」全部断言，同时验证核心底座在「已安装插件」中数量为 0、`omnimux-workflow` 可见且详情页无卸载按钮并挂载单份 `plugins.detail.section`；配套 `app/dsh-desktop-next/tests/plugin-detail-navigation.spec.ts` 与 `app/scripts/protected-bundles-compat.test.mjs` 覆盖 Host/Client 契约。
