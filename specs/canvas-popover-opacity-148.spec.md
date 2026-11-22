# Issue #148 画布浮层防透底

## 假设

配置面板和菜单挂载到 `document.body` 后不能访问画布根节点的局部令牌。由宿主提供不透明表面可以同时修复亮暗两种主题下的背景透底。原有触发方式、定位与宽度约束适用于新表面。[Issue #148](https://github.com/omnimux-ai/omnimux-client/issues/148) · [同类修复 PR #149](https://github.com/omnimux-ai/omnimux-client/pull/149)

## 证伪方式

在同一 Chromium 测试页面加载锁定版本的宿主样式。打开参数面板和菜单，分别记录亮暗主题下 `backgroundColor` 的 alpha、`backdropFilter` 和面板边界。新版本任一可见表面的 alpha 低于 1、应用了模糊滤镜或参数面板离开窄视口时，验收失败。向画布样式注入旧令牌和模糊声明，门禁应定位到相应文件和规则。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasPageHeader.test.mjs` :: `popover styles specify non-transparent frosted background, backdrop-filter, border and animation`
  - 旧断言固定毛玻璃背景变量和模糊声明。新断言固定不透明宿主背景链，禁止模糊和旧背景令牌，继续核对边框、阴影和动画。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/CanvasPageHeader.test.mjs` :: `theme tokens define elevated popover background and alias fallbacks for light and dark themes`
  - 旧用例固定页头浮层在画布主题的两组半透明色值。页头浮层改由宿主背景令牌级联，专用半透明变量随引用一起移除。页头样式测试断言完整的宿主回退链，画布门禁扫描其有效规则。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/VideoParamPopover.test.mjs` :: `components.css popover 根直接消费 DSH 原生浮层 token`
  - 旧断言要求局部 `bg-elevated` 和 `blur(20px)`。新断言要求宿主 `bg-layer-1` 回退链，禁止局部令牌和模糊，保持原来的边框检查。Chromium 核对实际 Portal 的 alpha。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/VideoParamPopover.test.mjs` :: `components.css 新样式块含 overflow-y:auto 与关键设计规格（32px 高度 / 胶囊圆角 999px）`
  - 从布局用例移除 `blur(20px)` 断言，保留几何、滚动、焦点和入口动画断言。独立根样式用例验证移除滤镜。
- `plugins/plugins/omnimux-workflow/src/canvas/theme/voicePickerTheme.test.mjs` :: `REQ-WF-VOICE-MODAL-NO-ESCAPE: 限定区内无裸色/无 --wb-* 残留/不全局重涂 modal 与 select`
  - 旧断言将共享弹窗和下拉的底色排除在音色工作范围外。本次修复统一了共享底色。继续约束音色子规则不得引入裸色、画布局部令牌或新变量，并检查局部规则不会恢复模糊或旧令牌。
- `plugins/plugins/omnimux-workflow/src/canvas/theme/voicePickerTheme.test.mjs` :: `REQ-WF-VOICE-MODAL-PORTAL-SCOPED: portal 下拉仅在音色弹窗活动时重涂，且同色链`
  - 旧断言要求音色打开时单独重写下拉底色。新断言核对共享底色链且局部规则不覆盖它，继续核对音色的选项与遮罩语义令牌。
- `plugins/plugins/omnimux-workflow/src/canvas/theme/voicePickerTheme.test.mjs` :: `REQ-WF-VOICE-MODAL-SURFACE: 弹窗表面/外框/正文走附录 T.3 唯一语义链，无裸色`
  - 旧断言固定音色弹窗的局部 `bg-elevated` 回退链。新断言核对复用了共享的不透明宿主底色，继续核对专属边框和前景令牌。
