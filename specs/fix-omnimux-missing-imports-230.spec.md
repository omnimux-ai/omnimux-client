# Issue #230：补齐 omnimux 客户端入口缺失导入

## 背景

隔离 `dsh-desktop-next` 实机启动时，Electron 渲染层在 `connectionCtx.inject(['sessions'], ...)` 的 effect 中抛出 `ReferenceError: createGenerationFeedback is not defined`。`plugins/plugins/omnimux/src/client/index.js` 第 314 行调用了 `createGenerationFeedback` 与 `getGlobalMediaViewerStore`，但文件顶部没有对应的静态导入，导致画布生成反馈绑定在真实宿主启动时直接失效。

## 假设

`createGenerationFeedback` 与 `getGlobalMediaViewerStore` 分别由 `./media-viewer/generation-feedback.js` 与 `./media-viewer/media-viewer-store.js` 导出；补齐这两条静态导入后，`sessions` 注入路径即可正常初始化 feedback 并在宿主释放 effect 时调用 `dispose()`。同根因的未绑定标识符仅此两处，客户端入口及其兄弟模块不需要额外改动。

## 证伪方式

- 回退任一缺失导入后，`plugins/plugins/omnimux/src/client/index.test.js` 的 sessions 注入用例必须真实抛出 `ReferenceError`（对应标识符未定义）并转红；还原后全绿。
- 用 Babel AST 静态扫描 `plugins/plugins/omnimux/src/client/index.js`（及 `src/client` 下全部非测试 JS）若仍出现未绑定标识符，则上述假设不成立，需继续排查。
- 执行 `corepack pnpm --dir plugins --filter omnimux test` 与 `corepack pnpm --dir plugins run build:all`，构建或单测任何一项失败都说明修复不完整。
