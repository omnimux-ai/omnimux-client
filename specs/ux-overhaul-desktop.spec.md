# 桌面壳用户体验八原则重构规格（#420）

## 假设

如果将桌面壳（`dsh-desktop-next` 与 `dsh-plugin-desktop`）中面向用户的交互、确认弹窗、进度反馈与信息架构按「复杂留给系统，体验留给用户」八条原则收口（去除托盘与界面的 `·` 中点及裸英文状态枚举、将破坏性/关键原生弹窗按钮从模糊的「继续」改为明确动宾文案、补齐局域网警告弹窗的键盘焦点隔离与 Esc/遮罩关闭、在安全且无待保存数据时免除冗余重启确认并释放导出完成回执的命令锁、渐进披露局域网控件），用户将获得更低歧义与更低操作阻力的桌面体验，且不破坏原有桌面进程生命周期与上游契约测试。

## 证伪方式

1. 静态检查：`rg` 在 `app/dsh-desktop-next/src` 与 `app/dsh-plugin-desktop/src` 的用户可见 UI 字符串中不再出现违禁中点 `·`（托盘、`Computer Use` 组件统计、安装向导版本条）、`confirmed(...)` 显式传入动宾按钮文案、更新下载失败不再静默吞错、设置页四 Tab 为四字词组且去 `与` 拼接、浏览器访问关闭时不占位展示局域网开关与状态框。
2. 类型检查与自动化单测：在 `.worktrees/ux-overhaul-desktop/app` 运行 `corepack yarn build`、`corepack yarn typecheck`、`corepack yarn check` 与 `corepack yarn test` 全部通过；回退核心修复（例如撤销 `access-tab.tsx` 的 `browserAccess &&` 渐进披露条件）时，`tests/settings-adapter.spec.ts` 新增断言明确失败（`AssertionError: expected ... not to contain '局域网访问（需要 HTTPS）'`），恢复后全绿。
3. 浏览器交互演示验收：在工作树 `ui-demo/ux-overhaul-desktop-demo.html` 对亮/暗双主题、390 px 窄屏、模态框焦点陷阱（`Tab`/`Shift+Tab`/`Escape`/遮罩关闭与焦点恢复）完成实机渲染检查并留存截图证据。

## 改动范围与保留边界

1. **托盘提示与状态文案**：去掉 `·` 并映射 `state.phase`（`starting`/`ready`/`recovery`/`error`）为本地化文案（如 `OmniMux - desktop（恢复模式）`）。
2. **原生确认按钮与导出闭环**：`confirmed(message, detail, confirmLabel)` 显式传入动宾文案（如 `安装并重启`、`开启局域网访问`、`打开向导并重启`、`进入恢复模式`/`立即重启`、`移除环境`、`应用并重启`、`切换并重启`、`备份并修复`、`停用并修复`、`还原并重启`、`进入安全模式`、`退出并重启`、`卸载插件`、`重置数据并重启`、`开始备份`）；导出 CA 证书与诊断包默认命名为 `omnimux-ca.crt` / `omnimux-diagnostics-*.json`，并在释放 `runtime.busy` 锁后即异步弹出「在文件夹中显示 / 完成」提示且命令本身不等弹窗关闭即返回，不阻塞渲染端后续命令队列与本地 `busy` 状态。
3. **静默失败与可恢复反馈**：`update-lifecycle.ts` 在更新下载非中断失败时通知用户；`app-downloads.ts` 映射 HTTP 401/403/404/5xx 为可读原因；`use-desktop-settings-section.ts` 透传具体错误文本；`dsh-desktop-next` 的 `profile-create` 与 `profileName` 按当前语言呈现 64 字符规则提示并保留服务端错误详情（`dsh-plugin-desktop` 的 `ProfileCreateApp` 默认保留既有 255 字节输入边界），同时避免重复 `Escape` 调用；`settings.tsx`（Next 在用设置）与 `diagnostics-tab.tsx` 同步本地化日志级别选项；`desktop-dialog` 本地化缺失状态兜底文案；`workspace-admission.ts` 在不支持的工作区存储阻断纯错误框改用「知道了 / Got It」（可移动磁盘二次确认分支仍保留「选择其他文件夹」）。
4. **渐进披露与模态焦点隔离**：设置页 Tab 精简为 `通用` / `环境数据` / `远程访问` / `诊断恢复`（每项不超过 4 字且无 `与` 拼接），移除 `access` 页签中无关的 `pluginSettingsMovedNotice` 横幅；关闭浏览器访问时折叠局域网开关与状态，异步切换到 `ready` 后保持控件焦点；`Next` 与 `Legacy` 局域网警告框均补齐 `Tab`/`Shift+Tab` 焦点陷阱、捕获阶段 `Escape` 与遮罩关闭及焦点恢复（含重渲染不丢焦点与禁用触发器延迟回退聚焦 `webGroupRef`）；恢复助手在非安全模式退出时跳过多余确认，当前恢复会话内点击「重新导出」触发全新导出并刷新后续「打开所在文件夹」目标路径，未知版本检查点省略未知行，`busy` 时设置 `inert` 与 `aria-busy`。
5. **明确保留的既有契约边界**：`launch-presets` 继续保留显式「保存」以防误触 `unrestricted` 沙箱权限；`dsh-desktop-next` 的 `Computer Use（Next）` 与上游 `macOS Computer Use` 共存故保留区分后缀；`dsh-plugin-desktop` 上游同步测试契约（`HoverCard`、安装向导 5 步、可移动磁盘确认分支「选择其他文件夹」、恢复页 6 Tab / 5 张引导卡）及 `automatic-port` / `workspace-admission` 既定返回契约保持兼容不破坏。
