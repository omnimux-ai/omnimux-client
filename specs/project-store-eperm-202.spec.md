# 外部项目注册表权限错误与文件损坏的区分及告警限流（Issue #202）

## 假设

- macOS TCC 或 POSIX 权限不足时，`readFileSync` 抛出 `EPERM` / `EACCES`；文件内容损坏时 `JSON.parse` 抛出 `SyntaxError`，两者可从错误类型稳定区分。
- 外部项目注册表（`<libraryRoot>/.external-projects.json`）中的目录在每次列表刷新都会重新扫描；同一目录在相同不可读状态下的重复告警没有诊断价值，只应保留首条。
- `store.list()`（同步路径）与 `store.listForRead()`（HTTP 列表实际使用的异步路径）读取同一批目录，告警记忆必须在同一个 Store 实例内共享，否则同一目录仍会从另一条路径重复刷屏。
- 目录恢复可读或被移出注册表后，下一次扫描应能正常恢复展示；此时清除该目录的告警记忆，未来再次不可读时允许重新告警一次。

## 证伪方式

- 将外部项目 `project.json` 置为 `chmod 000` 后连续调用 `list()` 与 `listForRead()`：若告警超过 1 条，或文案把权限不足写成损坏/JSON 无效，则修复不成立。
- 恢复权限后列表必须重新出现该项目且不再新增告警；再次置为不可读必须新增 1 条告警，证明记忆已被清除而不是永久静默。
- 写入非法 JSON 与 schema 不合法记录：两者必须分别输出「malformed JSON」与「schema validation failed」文案，且同类别重复读取只告警 1 条。
- 将目录从 `.external-projects.json` 移除再重新加入同一不可读目录：重新加入后的首次扫描必须再次告警，证明「从注册表移除后重置」生效。
- 将 `.external-projects.json` 本身置为不可读：必须输出注册表级权限告警 1 条，不得误报为项目文件损坏。

## 验收

- `corepack pnpm --dir plugins --filter omnimux-workflow test` 全绿（含本规格对应的新增回归用例）。
- 回退 `ProjectStore.ts` 核心分类/限流改动后，新增用例必须真实失败；恢复后全绿（双向证伪，结果写入 PR 验收区）。
- 测试与 QA 脚手架显式传入临时 `libraryRoot`，不向用户共享项目库写入 `.external-projects.json`。
