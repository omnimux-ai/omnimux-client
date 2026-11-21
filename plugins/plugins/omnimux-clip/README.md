# omnimux-clip

「视频剪辑」使用 OpenReel 编辑器和 WebCodecs。独立入口是 `omnimux-clip:studio`，从画布视频合成节点打开时，剪辑 Portal 留在当前工作区。画布打开和返回事件交换 JSON，并用工作区、节点、工程三个 ID 校验归属。

Agent 可用 `clip_list`、`clip_get`、`clip_diagnostics` 查询 Host 的旧档，`clip_create`、`clip_edit` 操作旧格式。待迁移的原生工程在列表单独标出。实时打开、播放、截帧与导出工具返回结构化不可用错误。手工播放和导出在右侧编辑器执行。详见 [工具清单](../../docs/contracts/plugin-agent-tools-inventory.md)、[剪辑契约](../../docs/contracts/clip-live-control.md)和[剪辑技能](skills/clip-craft/SKILL.md)。

## 身份

| 项 | 值 |
|---|---|
| id | `omnimux-clip` |
| tier | `tier-1-app` |
| storage | `$DSH_HOME/omnimux/clip/{projects,exports,snapshots,tmp}/` |
| HTTP | `/omnimux-clip/api` |

## 本地验证

从仓库根运行：

```sh
corepack pnpm --filter omnimux-clip build
corepack pnpm --filter omnimux-clip test
```

涉及画布、工作台和工具注册时，按[剪辑契约](../../docs/contracts/clip-live-control.md#阶段-1-画布绑定与工具结果)跑相应测试。合入前在隔离工作树复测，合入后按[本地开发与交付](../../README.md#本地开发与交付)同步 Dev 并核对运行产物。
