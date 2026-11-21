# omnimux-clip

剪辑工坊在工作台标签页 `omnimux-clip:studio` 和画布合成节点内复用 OpenReel 编辑器与 WebCodecs 管线。OpenReel v1.0.0 提供三栏工作区。画布通过 `omnimux-clip-*` 事件交换工程状态，通过宿主 HTTP 保存编码后的 MP4 原始字节。[上游引入契约](../../docs/contracts/openreel-vendor-contract.md)

Agent 可列出、创建和打开剪辑项目，还可以查询、编辑、预览、截图、诊断和导出。工具失败抛出 `ClipDomainError`。[工具清单](../../docs/contracts/plugin-agent-tools-inventory.md#37-omnimux-clipopenreel-视频剪辑工坊) · [剪辑技能](skills/clip-craft/SKILL.md)

## 身份

| 项 | 值 |
|---|---|
| id | `omnimux-clip` |
| tier | `tier-1-app` |
| storage | `$DSH_HOME/omnimux/clip/{projects,exports,snapshots,tmp}/` |
| HTTP | `/omnimux-clip/api` |

## 本地验证

从仓库根目录运行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --dir plugins run build:all
corepack pnpm --filter omnimux-clip test
node --test plugins/plugins/omnimux-clip/tests/e2e/*.e2e.test.js
node scripts/workspace-check.mjs --check
```

工作树浏览器验收使用候选构建，覆盖亮暗主题、展开菜单、窄屏、语言切换、旧工程、首个视频上轨和画布导出。文件写入测试单独验证 MP4 回填与宿主上传。合入后由桌面端按正式入口同步 Dev 并复核运行版本。[插件开发与交付](../../README.md#本地开发与交付)
