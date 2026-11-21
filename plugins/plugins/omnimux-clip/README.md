# omnimux-clip

「视频剪辑」使用 OpenReel v1.0.0 三栏工作区和 WebCodecs。独立入口是 `omnimux-clip:studio`，从画布视频合成节点打开时，剪辑 Portal 留在当前工作区。画布打开和返回事件交换 JSON，并用工作区、节点、工程三个 ID 校验归属，并通过宿主保存 MP4 原始字节。[上游引入契约](../../docs/contracts/openreel-vendor-contract.md)

Agent 可用 `clip_list`、`clip_get`、`clip_diagnostics` 查询 Host 的旧档，`clip_create`、`clip_edit` 操作旧格式。列表单独标出待迁移和不可读的工程。实时打开、播放、截帧与导出工具返回结构化不可用错误。手工播放和导出在右侧编辑器执行。在画布中退出编辑后，已开始的导出仍可把成片回写到原节点。详见 [工具清单](../../docs/contracts/plugin-agent-tools-inventory.md)、[剪辑契约](../../docs/contracts/clip-live-control.md)和[剪辑技能](skills/clip-craft/SKILL.md)。

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

工作树浏览器验收使用候选构建，覆盖亮暗主题、展开菜单、窄屏、语言切换、旧工程、首个视频上轨和画布导出。文件写入测试单独验证 MP4 回填与宿主上传。涉及画布、工作台和工具注册时，按[剪辑契约](../../docs/contracts/clip-live-control.md#阶段-1-画布绑定与工具结果)运行对应测试。合入后由桌面端按正式入口同步 Dev 并复核运行版本。[插件开发与交付](../../README.md#本地开发与交付)
