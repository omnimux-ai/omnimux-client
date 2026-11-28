# 插件与共享组件 UX 重构规格（PR 2A：dsh-ui-kit + omnimux + omnimux-market，Ref #432）

## 假设

如果在保留 `#429` 统一动效体系（`--omnimux-motion-*`、`IconSwap`、`usePresence`）和既有安全/契约边界的前提下，按「复杂留给系统，体验留给用户」八条原则完成 PR 2A 三层重构：
1. **共享层（`plugins/packages/dsh-ui-kit`）**：补齐语言检测与组件本地化默认文案、窄屏横向滚动工具栏、`SearchField` Esc 清空不误关外层抽屉及跨平台 `Mod+K`、破坏性 `ConfirmModal` 默认聚焦取消并在 `confirmLoading` 期间锁住关闭、`Tabs`/`DropdownSelect`/`DataTable` 键盘导航、禁用态 `IconButton` 悬浮提示、抽屉捕获期 Esc 与侧边栏 `:focus-visible`/原生 `title`、`SocialSearchToolView` 隐藏原始 JSON 并内联报错重试、支持关闭伪 `0→96%` 假进度百分比；
2. **中枢层（`plugins/plugins/omnimux`）**：清除 `welcome-greeting.js` 私有开发昵称兜底与 `innerHTML` 拼接、发送防丢续发、完整双语与键盘可控的 `ModelPicker`、去冗余宣传并补复制/锁遮罩的 `LoginGate`、退出与断连危险二次确认、`CreativePresetsModal`/`ProductPicker`/`AssetAddModal` 状态重置与 4 字分类、折叠设置技术细节与未启用 S3 表单、清除 `ClipContextChip` 与 `composer-add` 中点 `·` 与成功 Toast 噪音、窗口聚焦自动重查额度与裸域名自动补全 `https://`；
3. **市场层（`plugins/plugins/omnimux-market`）**：对无后端持久化路由的假控件（`InstallModal` 本地上传假吞字节、`skills-ui` 假停用开关、`plugins-column` 仅 `localStorage` 开关、`autoUpdate` 易失开关）如实下线或改为真实状态展示，隔离发现/我的筛选与搜索状态，为卸载补齐危险 `ConfirmModal`，修复 `SKILL.md` 伪造文件树、修复半译中文说明、统一定界四字类目并清除所有 `·` 与冗余 Toast；

则插件主入口的误触风险、静默假动作与跨插件交互割裂感会显著下降，且全部包构建、工作区契约与回归测试均保持全绿。

## 证伪方式

1. **静态与契约门禁**：在 `.worktrees/ux-overhaul-plugins` 运行 `corepack pnpm --dir plugins run build:all`、`node scripts/bundle-lock.mjs`、`node scripts/workspace-check.mjs --check`、`verify:dsw-tokens`、`test:ui`、`verify:stages`、`verify:stage-scroll`、`verify:stage-inset`、`verify:slots`、`verify:silent-catch`、`verify:product-baseline`、`verify:plugin-load`、`verify:model-contracts`、`doc-lint.mjs`、`verify-plugin-agent-tools.mjs`、`verify-test-standard-declarations.mjs`、`verify-fix-regression-test.mjs` 与 `auto-qa-gate.mjs` 全部通过；用户可见文案不再出现 `·` 与私有开发昵称兜底。
2. **包级单测与双向证伪**：`dsh-ui-kit`、`omnimux` 与 `omnimux-market` 全量单测及新增 UX 回归测试全绿；临时撤销关键修复（例如在 `SearchField` 的 `Escape` 清空分支去掉 `e.stopPropagation()`，或在 `welcome-greeting.js` 恢复私有兜底昵称）后，对应回归断言明确失败，恢复后全绿。
3. **真实浏览器交互验收**：通过 `ego-browser` 打开 `ui-demo/ux-overhaul-plugins-demo.html` 及 Worktree Web/UI 视图，在亮/暗双主题与 390 px 窄屏下实测无横向溢出、焦距陷阱与键盘切换正确、浮层开关与破坏性确认关闭锁按预期生效并留存截图。

## 范围与保留边界

- 本阶段（PR 2A）聚焦 `dsh-ui-kit`、`omnimux` 与 `omnimux-market`；创意制作四插件（`omnimux-workflow`、`omnimux-clip`、`omnimux-viewer`、`omnimux-video`）与九大垂直领域插件分别在后续 PR 2B、PR 2C 推进，共同闭合 `#432`。
- `dsh-ui-kit` 对已有公有 Props 保持向后兼容，不破坏 `#429` 动效原语（`IconSwap`、`usePresence`、`AnimatedNumber`、`--omnimux-motion-*`）。
- 既有 `.test.js` 文件严禁写入 TypeScript 语法以免触发 CI `verify-test-standard-declarations.mjs`（`acorn` 纯 JS 解析）报错；任何对既有测试断言的合理调整均在本节下方 `## 旧标准变更` 逐条声明。

## 旧标准变更

- `plugins/packages/dsh-ui-kit/src/drawer/Drawer.test.js` :: `uses IconButton with IconCloseOutline16 conforming to UI01 gate`
  - 原断言要求 `Drawer.tsx` 硬编码 `aria-label="关闭抽屉"`。
  - 变更理由：按语言环境自动本地化（中文「关闭抽屉」 / 英文「Close drawer」）并允许 `closeLabel` 覆盖；保留 `<IconButton>` + `IconCloseOutline16` 门禁约束，新增可证伪的源码契约与本地化测试。
- `plugins/packages/dsh-ui-kit/src/table/DataTable.test.js` :: `implements single and multiple selection with WAI-ARIA and no native input tags`
  - 原断言要求 `DataTable.tsx` 硬编码 `aria-label="全选所有行"` 与 ``aria-label={`选择第 ${rowIndex + 1} 行`}``。
  - 变更理由：改为基于 `resolveKitLocale()` 与可选 props 的中英双语可访问标签，不再对英文界面输出硬编码中文读屏标签。
- `plugins/packages/dsh-ui-kit/src/table/DataTable.test.js` :: `integrates EmptyState for empty rows and skeleton loaders when loading`
  - 原断言要求 `DataTable.tsx` 硬编码 `emptyContent ?? <EmptyState title="暂无数据" />`。
  - 变更理由：改为基于 `resolveKitLocale()` 与 `emptyTitle` props 的双语空态标题，保持 `EmptyState` 组件集成与骨架屏不退化。
- `plugins/plugins/omnimux/src/client/LoginGate.test.js` :: `ships the locked 商业出海与出片 zh strings`
  - 原断言锁定旧的宣传口号文案（如「全面接入商业 Agent 矩阵」「释放十倍出片生产力」）。
  - 变更理由：按「克制表达、界面自明」改写为真实能力说明（「登录 OmniMux Studio」「连接云端模型、账户额度与跨设备配置同步」等），并保持 `zh`/`en` 键位全等。
- `plugins/plugins/omnimux/src/client/LoginGate.test.js` :: `closes on Escape and on backdrop click`
  - 原正则断言遮罩点击直接无条件 `cancel()`。
  - 变更理由：`starting`/`waiting` 授权等待期锁定 `Escape` 与背景遮罩防误关，显式点击关闭按钮仍随时可取消，按 `allowBackdropDismiss` 精确校验。
- `plugins/plugins/omnimux/src/client/welcome-greeting.test.js` :: `resolveGreetingUserName returns profile name or falls back to 老钟`
  - 原断言未登录或无用户名时兜底返回私有开发昵称。
  - 变更理由：改为通用中性称呼 `'创作者'`（英文 `'Creator'`），保留已登录用户真实昵称优先逻辑。（注：上一条引号内为 `main` 基线既有测试原名，CI 旧测试标准声明门禁强制要求精确匹配该原名。）
- `plugins/plugins/omnimux/src/client/welcome-greeting.test.js` :: `createWelcomeHeaderElement creates well-formed header element`
  - 原断言匹配 `'属于你的AI社媒运营团队'`。
  - 变更理由：改为产品实际定位文案 `'AI 社媒内容创作助手'` 并采用 DOM `textContent` 安全渲染以消除 XSS 拼接风险。
- `plugins/plugins/omnimux/src/client/composer-add/attachment-bridge-native.test.js` :: `confirmed void legacy setter consumes only on exact subsequent snapshot`
  - 原断言在草稿确认匹配后停留在 `translated:attachments.submit.prepare.ready` 提示态并等待用户第二次点击发送。
  - 变更理由：系统确认内容落地且未超时时自动代为续发，避免用户重复点击发送。
- `plugins/plugins/omnimux/src/client/composer-add/attachment-bridge-native.test.js` :: `marketing appends only directives, then waits for advanced matching metadata before consumption`
  - 原用例在 `publish()` 确认匹配后再次手动调用 `await env.send()` 并断言 `sends === 1`。
  - 变更理由：确认匹配后桥接器已自动触发发送，去掉多余的第二次手动 `env.send()` 即可验证 `sends === 1`。
- `plugins/plugins/omnimux/src/client/composer-add/attachment-bridge-native.test.js` :: `product library ID keeps its marker and chip is consumed only after publication`
  - 原用例在 `publish()` 确认匹配后再次手动调用 `await env.send()`。
  - 变更理由：同上，草稿版本确认后已自动续发，去掉多余的第二次手动 `env.send()` 即可验证 `sends === 1`。
- `plugins/plugins/omnimux/src/client/explore-more-menu.test.js` :: `Alpha 内测项带行内标识，非 Alpha 项保持纯字符串文案（Issue #3823）`
  - 原断言预期 `'手机管理'`。
  - 变更理由：侧边栏与矩阵模块名称统一为更准确的 `'移动设备'`（4 字名词，去冗余「管理」后缀）。
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `发布渠道过滤：开发版保留全部入口，正式版只过滤 Alpha 测试版`
  - 原断言预期 `'手机管理'`。
  - 变更理由：同上，统一为 `'移动设备'`。
- `plugins/plugins/omnimux/src/client/presets/compiler.test.js` :: `compileCreativePrompt: supports english output`
  - 原断言检查 `[CREATIVE DIRECTIVE · CINEMATIC COMMERCIAL PRODUCTION]` 中的中点 `·`。
  - 变更理由：统一移除 UI 及提示词头的中点分隔符，改为 `[CREATIVE DIRECTIVE - CINEMATIC COMMERCIAL PRODUCTION]`。
- `plugins/plugins/omnimux/src/client/attachments/linkPillMetadata.test.ts` :: `linkPillMetadata: inferLinkMetadata resolves multiple video platforms accurately`
  - 原断言预期 `'YouTube · 视频'`、`'哔哩哔哩 · 视频'`、`'小红书 · 笔记'`。
  - 变更理由：统一移除中点 `·` 分隔符，改为 `'YouTube 视频'`、`'哔哩哔哩 视频'`、`'小红书 笔记'`。
- `plugins/plugins/omnimux/src/client/attachments/linkReference.test.ts` :: `preserves the full URL and purpose in independent video/product reference payloads`
  - 原断言预期 `label: '${purpose} · example.com'`。
  - 变更理由：移除中点 `·`，统一与 `clipboardText` 冒号格式对齐（`${purpose}：example.com`）。
- `plugins/plugins/omnimux/src/client/attachments/useLinkReference.test.js` :: `useLinkReference requires a strict true receipt and a subsequent newer matching snapshot`
  - 原断言预期 `label: '参考视频 · example.com'`。
  - 变更理由：同步移除中点 `·`，改为 `'参考视频：example.com'`。
- `plugins/plugins/omnimux/src/client/social-toolview/index.test.js` :: `renders running, ready cards, empty, error, and passthrough states accurately`
  - 原断言匹配 `dsh-ui-kit` 旧计数胶囊 `/×2/`。
  - 变更理由：同步 Layer 1 `SocialSearchToolView` 本地化数量表达（`/2 results/` / `2 条`），语义清晰无歧义。
- `plugins/plugins/omnimux/src/client/social-toolview/index.test.js` :: `toggles collapse, JSON output, and show-more button in interactive DOM`
  - 原用例在普通成功搜索卡片头部直接点击 `JSON` 按钮。
  - 变更理由：同步 Layer 1 收敛原始 JSON 调试按钮，日常结果态隐藏 `JSON` 按钮以降低视觉噪音，透传/排障模式仍完整保留并可展开 `<pre>`。
- `plugins/plugins/omnimux/src/client/provider-config-state.test.js` :: `F3: scenario change and a 409 check refresh the revision and allow an explicit retry without saving`
  - 原用例点击并断言 `'custom · saved-unknown-model'`。
  - 变更理由：`ScenarioSelection.jsx` 移除中点 `·` 改为 `'custom / saved-unknown-model'`，保持 409 冲突刷新与重试行为不变。
- `plugins/plugins/omnimux/src/client/provider-config-state.test.js` :: `F5: stored unknown defaults and operations remain visible in the actual dropdown controls`
  - 原断言预期 `'retired-* · runtime.needsConfirmation'`。
  - 变更理由：`ModelsSettingsCard.jsx` 移除中点 `·` 改为括注 `'retired-* (runtime.needsConfirmation)'`，仍完整展示已保存的未知默认值与操作。
- `plugins/plugins/omnimux/src/client/provider-config-state.test.js` :: `F5: unknown saved image and video models remain visible without replacing stored preferences`
  - 原断言预期 `'retired-image · runtime.needsConfirmation'` 与 `'retired-video · runtime.needsConfirmation'`。
  - 变更理由：同步改为 `'retired-image (runtime.needsConfirmation)'` 与 `'retired-video (runtime.needsConfirmation)'`。
- `plugins/plugins/omnimux-market/src/client/skill-header.test.js` :: `failed installation retains dialog and reports error without installed callback`
  - 原用例向旧本地包上传框传入 `{ name: 'example.zip' }`，触发失败安装回调。
  - 变更理由：`InstallModal` 下线虚假本地 `.zip` 上传框并如实拦截 `.zip`/`.md` 引导改用 `/skill-creator`，该用例改为传入合法标识 `'example-skill'` 验证真实远程安装失败时的弹窗保留与错误展示。
- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `install modal provides drag & drop and requirements notice`
  - 原断言匹配旧拖拽上传区类名 `drop-zone`。
  - 变更理由：下线虚假拖拽上传后，弹窗提供 `omx-install-slug-box` 标识/链接输入与 `parseSkillSlugInput` 校验，同步更新结构断言。
- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `Issue #773: top bar strictly aligns with reference mock and featured card metadata is complete`
  - 原断言要求 `Skill` Tab 带 `tab-info-icon` 装饰图标。
  - 变更理由：按「此刻没用的就不出现」移除 Tab 无交互信息图标与对应无用 CSS 规则。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A2 套件卡：构成计数真源完备且普通卡可渲染`
  - 原断言预期 `'技能 0 · 规则 5 · Agent 7'` 与 `'技能 6 · 规则 0 · Agent 5'`。
  - 变更理由：统一移除中点 `·` 分隔符，改为中文顿号格式（`'技能 0、规则 5、Agent 7'` 与 `'技能 6、规则 0、Agent 5'`）。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A5 解析不到项目目录时不发请求，明确提示改选个人全局`
  - 原用例依赖未打开目录时也默认选中 `project`。
  - 变更理由：`SuiteDetailModal` 在 `projectDir` 为空时默认选中 `global` 以防误触；该测试改为显式点选「当前项目」后再触发确认安装，继续验证未配置项目目录拦截逻辑。
- `plugins/plugins/omnimux-market/src/client/suite-marketplace.test.js` :: `A5 partial 回执标注未完成项，按钮不转「已安装」且不向上层声明成功`
  - 原断言预期 `'未完成 · music-agent：EACCES'`。
  - 变更理由：移除回执文案中的中点 `·`，同步改为 `'未完成：music-agent（EACCES）'`。
- `plugins/plugins/omnimux-market/src/presets/composer-presets.test.js` :: `Submission Context Assembly: compiles presets into system prompt and clears state`
  - 原断言匹配 `'【营销视频创意指令 · 工业级分镜与视听规范】'`。
  - 变更理由：同步 `omnimux` 创意预设编译器移除标题中点 `·` 与冗余后缀后的真实标题 `'【营销视频创意指令】'`。
- `plugins/plugins/omnimux-market/tests/e2e/suite-marketplace.spec.js` :: `E2E 旅程一：套件分类只列真实套件，8 张卡与目录一致`
  - 原断言预期 `` `技能 ${counts.skills} · 规则 ${counts.rules} · Agent ${counts.agents}` ``。
  - 变更理由：同步移除套件构成文本中的中点 `·`，改为中文顿号分隔。
- `plugins/plugins/omnimux-market/tests/e2e/suite-marketplace.spec.js` :: `E2E 旅程三（分支）：projectDir 解析不到时不发请求，留在确认框并提示`
  - 原用例直接点击确认按钮。
  - 变更理由：无 `projectDir` 时确认框默认选中「个人全局」，测试显式点选「当前项目」后再点击确认，继续验证无项目目录时的请求拦截与提示。
- `plugins/plugins/omnimux/tests/e2e/retire-forms-social-harvest.e2e.test.js` :: `E2E: retired plugins have zero active UI/runtime entry while session-prefill stays operational`
  - 原断言预期 `'手机管理'`。
  - 变更理由：同步侧边栏与探索菜单模块命名统一为 4 字名词 `'移动设备'`。
- `plugins/plugins/omnimux/tests/e2e/session-compact-welcome.spec.js` :: `e2e: session compact welcome header mounts on split mode and unmounts on exit`
  - 原断言匹配未登录兜底私有昵称与 `'属于你的AI社媒运营团队'`。
  - 变更理由：移除私有兜底昵称，改为中性 `'你好，创作者'` 与 `'AI 社媒内容创作助手'`。
