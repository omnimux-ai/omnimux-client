# omnimux-clip

「视频剪辑」使用 OpenReel v1.0.0 三栏工作区和 WebCodecs。独立入口是 `omnimux-clip:studio`。从视频合成节点打开时，剪辑 Portal 留在当前画布，并按工作区、节点、工程三项绑定。Host 保存原生工程，兼容读取已保存的旧时间轴和原生 UUID 工程。[上游引入契约](../../docs/contracts/openreel-vendor-contract.md)

Agent 可用 `clip_list` 查档，`clip_create` 创建独立空工程，`clip_get` 读取当前可见工程或按 ID 读取保存版本，`clip_diagnostics` 检查 Host 保存版本。对可见编辑器用 `clip_edit` 执行整批剪辑并生成一步撤销，用 `clip_view` 控制播放或选段，用 `clip_snapshot` 读取真实合成帧。指定入口用 `clip_open`。剪辑工具不会自动切页，实时操作在无窗口或目标不可见时报告领域错误。

用户明确要求成片时，用 `clip_export` 并传 `confirm: true`。Agent 导出将 MP4 保存为独立任务版本。画布结果按原节点绑定回写，成片落盘与画布提交分别以 `fileSaved` 和 `canvasCommitted` 为准。[剪辑契约](../../docs/contracts/clip-live-control.md) · [工具清单](../../docs/contracts/plugin-agent-tools-inventory.md#37-omnimux-clipopenreel-视频剪辑) · [Clip Craft](skills/clip-craft/SKILL.md)

## 身份

| 项 | 值 |
|---|---|
| id | `omnimux-clip` |
| tier | `tier-1-app` |
| storage | `$DSH_HOME/omnimux/clip/{projects,exports,snapshots,tmp}/` |
| HTTP | `/omnimux-clip/api` |

## 本地验证

从仓库根目录运行以下命令。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --dir plugins run build:all
corepack pnpm --filter omnimux-clip test
node --test plugins/plugins/omnimux-clip/tests/e2e/*.e2e.test.js
node --test plugins/plugins/omnimux-clip/tests/e2e/editor-dialogs.e2e.test.mjs
node scripts/workspace-check.mjs --check
```

工作树浏览器验收使用候选构建，覆盖亮暗主题、展开菜单、窄屏、语言切换、旧工程、首个视频上轨和画布导出。涉及画布、工作台和工具注册时，按[剪辑契约](../../docs/contracts/clip-live-control.md#阶段-2-实现)运行对应测试。真实编辑、截帧和 MP4 播放在隔离运行环境验证。合入后由桌面端同步 Dev 并复核运行版本。[插件开发与交付](../../README.md#本地开发与交付)
