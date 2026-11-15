# Spec: 首页 composer 选素材追加而非覆盖（Issue #25）

- 任务：`issue-25-composer-append`
- 日期：2026-11-15
- 风险：R1（客户端附件状态行为）
- 关联：GitHub Issue #25（P1 bug）

## 目标
首页新对话 composer 通过「指令」菜单的「从资产库选择 / 从商品库选择 / 上传媒体或文件」等入口连续选素材时，附件必须追加、保序、不覆盖；素材工作台原有追加行为不回退；重复选择同一素材只去重，不得静默清掉其他素材。

## 根因
首页探索区卡片走 `plugins/plugins/omnimux-inspiration/src/explore/templates/ExploreTemplatesSection.jsx` 的 `attachCardToConversation()`。该函数每次选卡先调用 `store.clear(activeSessionId)` 再 `store.addAttachment()`，所以第二次选择会把第一次已选附件清空，只剩最后一张。素材工作台走 `AssetHubPanel` 的直接 `addAttachment`，因此正常追加。

## 修法
- `attachCardToConversation()` 改为直接追加，移除选卡前的 `store.clear()`；去重与容量上限继续由 `AttachmentStore.addAttachment()` 负责。
- 增加 `buildCardAttachmentPayload()` / `removeCardFromConversation()`：重复点击或收起时只撤下当前卡片对应附件，保留其他已选素材。
- `useComposerDocking()` 的 `onUndock` 回传当前 `dockedItem`，`SessionGuide` 只移除该卡片附件，不再 `store.clear()` 清空全部。
- 上传多文件仍走宿主原生 `onAddFiles` 批量追加，`native-files-bridge` 增加多文件批次回归测试。

## 验收（AC）
- AC1：首页资产库连续两次选择，两个素材同时在位且保持选择顺序。
- AC2：首页商品库连续多个选择，全部保留。
- AC3：资产库 + 商品库混合选择，全部保留且顺序正确。
- AC4：多文件上传一次批次全部追加。
- AC5：素材工作台原有追加行为不回退。
- AC6：重复选择同一素材只保留一份，且不静默丢弃其他已选素材。

## 测试
- `plugins/plugins/omnimux-inspiration/src/explore/home-composer-append.e2e.test.js`：真实挂载 `SessionGuide` + 真实 `AttachmentStore`，覆盖资产库/商品库/混合/重复选择。
- `plugins/plugins/omnimux-inspiration/src/explore/templates/explore-templates-full-pipeline.test.js`：覆盖 `attachCardToConversation` 追加、保序、去重、只撤销当前卡片。
- `plugins/plugins/omnimux/src/client/attachments/native-files-bridge.test.js`：覆盖多文件批次按源顺序转发并确认全部落地。
- `plugins/plugins/omnimux-assets/src/asset-hub/*.test.js`：素材工作台原有追加行为回归。

## 边界
只改 `plugins/`；worktree 开发；PR 到 omnimux-client，不自行合并；不碰 Dev/Prod；公开仓红线。

## 旧标准变更
（本次只新增测试用例，未删除或改写既有断言 —— 无。）
