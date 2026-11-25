# Spec: 自动物化派生逻辑的混合改动、bash 3.2 与工作区目录修复

## 背景

#269 把自动物化的插件名派生改为按真实目录映射，但独立评审在合并后指出三处缺陷（B1/B2 为 #269 引入，B3 为同根因残留）：

1. **B1 混合改动漏装非默认插件**：`full_sync=1` 只跑无参数完整同步，丢掉了同一范围内的具名插件；而无参数同步只覆盖默认插件清单（不含 `omnimux-browser`、`omnimux-viewer`、`omnimux-tiktok-selection` 与新增插件），会误报 `materialize=ok`。
2. **B2 macOS bash 3.2 空数组崩溃**：workspace-only 改动时 `changed_plugins` 为空，`plugins_csv="$(... "${changed_plugins[*]}")"` 在 `set -u` 下报 `unbound variable`，ship 在物化成功后崩溃、不清理工作树。
3. **B3 工作区目录被当插件**：`plugins/.agents`、`plugins/.dsh`、`plugins/fixtures` 都是真实存在的目录，扁平布局的回退目录判断会把它们当插件名，导致增量失败 → 完整同步 → 重试失败 → `materialize=failed`（Dev 实际已同步）。

另有：`pnpm-lock.yaml` 未进入变更路径（条件死代码）、真实布局的 docs/tests 过滤与 client-only 重启判断仍按扁平路径、完整同步失败文案误写“增量与完整同步都失败”。

## 修复

- `worktree.sh`
  - 完整同步成功后，对同一范围的具名插件再跑一次命名同步；任一失败则 `sync_ok=0`。
  - `plugins/plugins` 存在时，插件名必须带 `plugins/plugins/<name>/package.json`；扁平夹具布局保留目录判断。deny 列表补充 `fixtures` 与 `.*`（隐藏目录）。
  - `plugins_csv` 仅在 `changed_plugins` 非空时展开，兼容 bash 3.2 `set -u`。
  - `git log` 的 pathspec 加入 `pnpm-lock.yaml`，使锁文件改动触发完整同步。
  - docs/tests 过滤与 client-only 重启正则同时匹配 `plugins/plugins/<name>/...` 和 `plugins/<name>/...`。
  - 完整同步失败时的提示改为“完整同步失败”。
- 测试 `worktree-primary-cleanliness.test.mjs`
  - 夹具 sync 桩改为追加写入，支持断言多次调用。
  - 新增：混合 workspace+plugin 先完整同步再命名同步；`.agents` 不触发物化；workspace-only 在 `/bin/bash`（3.2）下不崩溃且完成完整同步。
  - 强化单仓布局用例：receipt 必须精确等于 `SYNC_CALLED: omnimux-workflow`。

## 验收标准

- AC-1：`plugins/package.json` + `plugins/plugins/omnimux-browser/*` 同范围合入时，调用顺序为「无参数完整同步 → `omnimux-browser`」，两者都成功才算 `materialize=ok`。
- AC-2：workspace-only 合入在 macOS `/bin/bash` 3.2 下退出 0，无 `unbound variable`，完成完整同步。
- AC-3：仅改 `plugins/.agents/*`、`plugins/.dsh/*`、`plugins/fixtures/*` 时判 `not-needed`，不调用同步。
- AC-4：既有 `worktree-delivery`、`worktree-cleanup-3820`、`kit-refresh+retry` 行为保持不变。

## 回归测试与双向证伪

- 新测试文件在 `origin/main`（121cb7bc）的旧 `worktree.sh` 上：**8 pass / 3 fail**，失败项正是上述三条新用例；修复后 **11/11 pass**。
- `worktree-delivery.test.mjs` + `worktree-cleanup-3820.test.mjs`：**62/62 pass**。

## 文档影响

仅收尾脚本的物化范围判定与错误文案；不改变插件工具契约、打包流程或发布边界。

## 旧标准变更

- `plugins/scripts/worktree-primary-cleanliness.test.mjs` :: `ship derives plugin names from the monorepo plugins/plugins/<name> layout`
  原断言：receipt 包含 `omnimux-workflow`，且不含独立 `plugins` token（`match` + `doesNotMatch`）。
  变更理由：token 级否定会放过 `plugins/omnimux-workflow` 这类错误参数，无法锁死真实传参形态。
  新期望证据：`receipt.trim() === 'SYNC_CALLED: omnimux-workflow'`；旧实现传 `plugins` 时该用例失败。
