# 资产库文本文档编辑器弹窗规格

## 背景与问题定义

在资产中心（`omnimux-assets`）的「本地」视图中，用户经常把知识包、提示词集合、技能目录（含 `SKILL.md`、`README.md`、`INDEX.md` 等）和纯文本脚本（`.txt`、`.json`、`.srt` 等）存入资产库。当前点击文件夹内文档或单文件文档资产时：

1. `AssetBrowse.jsx` 与 `AssetGrid.jsx` 均通过 `resolveAssetMediaPreview` 将文件交由 `AssetPreviewModal.jsx` 打开；
2. `AssetPreviewModal.jsx` 仅支持图片、视频、音频和云端纯展示文案，本地 `.md`/`.txt` 等文档直接落入「当前文件格式不支持内嵌预览」空态；
3. 后端 `library.js` 的 `resolvePreview` 仅开放图片和视频只读流，缺少受管文本文件的异步读取、写盘、乐观锁冲突校验和版本快照持久化能力。

同时，创作画布（`omnimux-workflow`）已经具备成熟的 CodeMirror 6 + Live Markdown 所见即所得文本编辑器（`TextStage`），但存在历史未定义 `--dsw-*` 令牌、裸色硬编码、`window.confirm` 原生弹窗及 Store 与 CM6 双轨撤销栈问题。本次在资产库交付与画布同款视觉与交互体验的居中大弹窗编辑器，并完全遵循本仓设计系统、安全沙箱和异步 I/O 契约。

## 研究与决策依据

### 案例与来源

1. **本仓同款交互基线**：
   - `plugins/plugins/omnimux-workflow/src/canvas/components/text-stage/TextStage.tsx`、`TextStageTopbar.tsx`、`CodeMirrorEditor.tsx`、`liveMarkdownPlugin.ts`、`VersionDrawer.tsx`、`VersionDiffModal.tsx`：确立了 CodeMirror 6 + 光标感知 Live Markdown 渲染、顶部 6 按钮工具栏（撤销/重做 | 版本历史/保存/查找/关闭）、右上角极简内联查找浮层、右侧版本历史抽屉和 `@codemirror/merge` 双栏 Diff 对比的交互范式。
   - `plugins/plugins/omnimux-assets/src/client/AssetPreviewModal.jsx` 与 `AssetBrowse.jsx`：确立了资产库居中模态预览弹窗（带遮罩、文件名与后缀角标、底部路径与「加入对话」投递）及 `resolveAssetMediaPreview` 统一预览路由入口。
2. **安全与存储真源**：
   - `plugins/plugins/omnimux-assets/src/paths.js` 与 `library.js`：声明插件仅允许写入 `$DSH_HOME/omnimux/assets/`，新入库文件统一复制到受管目录 `data/files/<assetId>/`，严禁修改用户原始桌面文件。
   - `plugins/plugins/omnimux-assets/src/http-routes.js`：`sendJson` 含 `access_token` / `sk-*` 响应脱敏拦截，因此受管文档正文与快照正文读取必须走 `text/plain; charset=utf-8`（加 `X-Content-Type-Options: nosniff`、`Cache-Control: no-store`），仅在 JSON 接口返回元数据，防止合法技术文档误触发 500。
   - `LESSONS.md`（`#182`）：Host 主线程严禁同步文件 I/O，新增读写与快照持久化全部使用 `node:fs/promises`。
3. **宿主主题与门禁真源**：
   - `plugins/scripts/dsw-token-allowlist.json`、`plugins/scripts/verify-dsw-tokens.mjs`、`plugins/scripts/scan-ui-gates.mjs`、`plugins/scripts/guard-no-transparent-popover.mjs`：新增客户端代码必须 100% 消费白名单 `--dsw-*` 令牌、使用 `dsh-ui-kit` 控件、字号落入合规字阶白名单、浮层容器保持实体不透明底色。

### 数据与真实性（改前基线 vs 改后目标）

- **改前基线（源码复现与截图实证）**：点击文件夹内 `SKILL.md`、`README.md`、`INDEX.md` 等文本文件，触发 `AssetPreviewModal` 后展示「当前文件格式不支持内嵌预览」，0 编辑/查找/版本对比能力。
- **改后目标**：
  - 点击本地文件夹内或单文件本地资产中命中纯文本白名单（`.md`、`.markdown`、`.mdx`、`.txt`、`.text`、`.json`、`.jsonl`、`.yaml`、`.yml`、`.csv`、`.tsv`、`.srt`、`.vtt`、`.lrc`、`.xml`、`.toml`、`.ini`、`.conf`、`.log`）的文件，一步打开 `min(1120px, 92vw) × min(86vh, 880px)` 居中大弹窗编辑器；
  - `.md`/`.markdown`/`.mdx` 开启光标感知 Live Markdown 渲染，其他后缀保持纯文本无行号自动换行编辑；
  - 完整对齐画布 6 按钮工具栏、内联查找、右侧历史版本快照抽屉（单文件最多 50 条）与 `@codemirror/merge` 双栏 Diff 对比，底栏保留路径、字数/行数与「加入对话」；
  - 图片、视频、音频、`.pdf`/`.docx` 二进制文档与云端只读资产仍走原 `AssetPreviewModal`，零回归。

### 取舍与范围边界

1. **包边界**：在 `omnimux-assets` 直接声明根 `pnpm-lock.yaml` 已锁定的 7 个 MIT `@codemirror/*` / `@lezer/highlight` 依赖，不向 `dsh-ui-kit` 主入口引入 CodeMirror（避免 14 个消费插件体积膨胀），不跨插件私有导入 `omnimux-workflow/src`。
2. **保存与关闭策略**：因为修改直接落盘到受管副本，未保存时关闭弹窗（`X` / `Esc` / 点击遮罩）弹出三向确认弹窗（保存并关闭 / 不保存 / 取消），而非画布的静默自动保存；并发修改通过 SHA-256 `ETag` 乐观锁返回 `409 file-conflict` 并提供「重新加载最新内容 / 覆盖保存」。
3. **撤销栈单一真源**：顶栏撤销/重做按钮与 `Cmd+Z` / `Cmd+Shift+Z` 统一驱动 CodeMirror 6 原生 `history()`，避免外部整文替换丢失光标与词级分组。

## 假设

1. 将可编辑文本白名单收敛到无 Node 依赖的共享模块 `src/text-files.js`，并在 `resolveAssetMediaPreview` 中附带 `assetId` / `fileId` / `subPath` / `editableText` / `markdown` 结构化定位字段，可使 `AssetBrowse` 与 `AssetGrid`（网格与列表视图）全部无感路由到 `AssetTextEditorModal`，同时 100% 保持现有 `detectMediaKind` 和 `AssetPreviewModal` 既有契约不变。
2. 后端以异步 `node:fs/promises` 实现 `readTextFile` / `writeTextFile` 与 `text-versions.js` 快照存储，并以 `text/plain; charset=utf-8` 独立端点传输文档和快照正文、以 JSON 仅传元数据，能够在不触碰用户原始桌面文件、不阻塞主线程、不被 `sendJson` 敏感词守卫误杀技术文档的前提下，可靠支撑在线编辑、乐观锁冲突检测和 50 条历史版本管理与资产删除同步回收。
3. 使用 100% 白名单 `--dsw-alias-*` 令牌、`dsh-ui-kit` 原子控件、实体不透明浮层底色和原生 CodeMirror 6 + Live Markdown 插件构建弹窗、查找浮层、历史抽屉与 MergeView Diff 弹窗，可在亮/暗双主题及宽/窄视口下达到与画布编辑器一致的阅读与编辑质感，并通过全套静态与运行态门禁。

## 证伪方式

若以下任一可观测结果成立，即证明上述假设不成立，必须修正实现：

1. 点击资产库内 `.md` / `.txt` / `.json` 文件时仍落入「不支持内嵌预览」空态，或点击图片/视频/音频/云端资产/PDF 被误路由到文本编辑器；
2. 打开包含 `access_token` 或 `sk-example` 示范文案的 Markdown 文档、创建/列出/对比历史快照时接口返回 500 或 400；
3. 路径穿越（`..`）、符号链接逃逸、超 2 MiB 文件、含 NUL 字节二进制文件或未物化在受管目录外的路径被允许写入，或保存受管副本时修改了用户桌面原始文件，或删除资产后 `data/text-versions/<assetId>/` 未被回收；
4. 并发修改文件后未返回 `409 file-conflict`，或在加载/切换文件过程中迟到的旧请求覆盖当前打开的文档；
5. 在亮/暗双主题、宽视口（`1280×800`）与窄视口（`640×720`）的真实浏览器渲染中，弹窗、内联查找面板、版本抽屉或 Diff 弹窗出现透明透底、内容溢出裁切、无法关闭或按钮重叠；
6. 以下任一验证命令失败：
   - `corepack pnpm --filter omnimux-assets build && corepack pnpm --filter omnimux-assets test`
   - `corepack pnpm --dir plugins run verify:dsw-tokens`
   - `corepack pnpm --dir plugins run test:ui`
   - `corepack pnpm --dir plugins run guard:popover`
   - `corepack pnpm --dir plugins run check:boundaries`
   - `corepack pnpm --dir plugins run verify:silent-catch`
   - `corepack pnpm --dir plugins run verify:stages && corepack pnpm --dir plugins run verify:stage-scroll`
   - `corepack pnpm --dir plugins run verify:tools && corepack pnpm --dir plugins run verify:plugin-load`
   - `node scripts/workspace-check.mjs --check`

## 验收标准

- [ ] 文件夹钻取视图与单文件本地资产网格/列表点击 `.md`/`.txt`/`.json`/`.yaml`/`.srt`/`.csv` 等受支持文档时打开居中大弹窗文本编辑器；非文本与云端只读资产维持原 `AssetPreviewModal`。
- [ ] Markdown 文件具备与画布一致的光标感知 Live Markdown 排版（标题、加粗、斜体、行内代码、引用块、分割线）；纯文本文件保持同款无行号自动换行编辑。
- [ ] 顶栏完整具备撤销、重做、历史版本快照抽屉、保存、文档内查找和关闭 6 个操作与对应快捷键（`Cmd/Ctrl+Z`、`Cmd/Ctrl+Shift+Z`、`Cmd/Ctrl+S`、`Cmd/Ctrl+F`、`Esc` 分层关闭）。
- [ ] 支持新建快照、查看列表、打开双栏 Diff 对比（`@codemirror/merge`）、回滚至历史快照（生成 `revert` 记录）及删除快照，数据持久存于 `$DSH_HOME/omnimux/assets/data/text-versions/<assetId>/` 并随资产删除一并清理。
- [ ] 保存仅写入 `$DSH_HOME/omnimux/assets/data/files/<assetId>/` 受管副本，绝不修改桌面原始文件；支持未保存关闭三向确认、外部并发修改 `409` 冲突提示与恢复、超大/二进制/损坏文件友好错误态。
- [ ] 高保真 HTML 演示、单测、E2E 行为测试、静态门禁与真实浏览器（亮/暗双主题 + 宽/窄视口）验收全部通过并留存证据。
