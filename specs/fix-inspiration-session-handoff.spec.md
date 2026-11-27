# 修复「整理创作参考 → 带入新会话」报错与空白会话复用超时 (#401)

## 背景与现象

在灵感社区「爆款趋势」打开云端帖子（`is_local === false`）右侧详情栏或宽屏弹窗，勾选参考内容（例如 `帖子正文`）进入「整理创作参考」抽屉并点击「带入新会话」或「保存草稿」时：
1. 云端帖子提升为本地记录后直接报 `原帖已保存，内容与素材已更新，请确认后重新选择参考或重试。`（`post.savedReview`），且可能清空已选参考或因规范化 URL 差异触发重复提升循环；同时抽屉底部「保存草稿」与「带入新会话」两个按钮会同时显示 `loading` 转圈。
2. DSH rc.3+ 复用工作区已有空白会话时，点击 `+ 新对话` 同步触发 `sessions.list.subscribe` 时工作台/附件快照尚未刷新，随后不再触发通知，导致 `clickOfficialNewSession` 1500ms 超时报错 `新会话未能打开，请重试`。
3. 右侧栏处于宿主全屏模式时，`revealConversationColumn` 未调用 `ensureConversationVisible()` 退出全屏。
4. `SessionPrefillConsumer` 仅检查 `state.imageIds` 漏检 DSH rc.3+ `state.attachmentIds`；服务端 `handleMaterializeCreationReferences` 异常分支吞掉错误码，统一返回笼统 502。

## 假设

1. 云端条目经 `POST /omnimux/inspiration/local/import-url` 转存为本地条目时，`id` 与本地化媒体 URL 变化是提升的必然结果。只要用户**实际选中的参考对象**（正文、兼容槽位图片/视频或分析结论）未被实质破坏，流程应基于提升后的 `savedRow` 重新协调草稿与 `basis` 后直接完成 `creation-draft` / `creation-reference` 与会话交接，无需弹出 `savedReview` 阻断；外层状态更新与 React `key` 也应以规范化帖身份保持稳定，防止因 `source_url` 规范化差异丢失提升结果或卸载抽屉。仅当所选参考的内容/素材槽位确有实质变化或失效时，才保留仍有效参考并提示 `savedReview`。
2. `clickOfficialNewSession` 在读取 `sessions.list` 时同时识别 `SessionSummary.retainedBy?.mainView > 0 && blank === true`，并在收到列表通知后于轮询循环内复检 `resolvedOfficialTarget`，即可消除 DSH rc.3+ 空白会话复用时 `list.subscribe` 与 React 延迟刷新之间的竞态超时。
3. 兄弟路径 `InspirationPreviewModal`（弹窗预览）、`InspirationDetailSidebar`（右侧详情栏）、`useInspirationFeed`、`InspirationSection` 与 `revealConversationColumn`（对比 `collection-to-chat.js` / `rival-add-to-chat.js`）应保持同一身份判定、全屏退出与错误诊断语义。

## 证伪方式

- 在 `inspiration-sidebar-views.test.js`、`post-reference-owner.e2e.test.js`、`new-session-click.test.js`、`replicate-to-chat.test.js`、`creation-handlers.test.js`、`session-prefill-consumer.test.js` 中构造真实云端转本地（含正文一致与正文实质变化、URL 规范化差异、弹窗兄弟路径、单按钮 `loadingAction` 隔离）、DSH rc.3+ `retain(id, { source: 'mainView' })` 与延迟工作台快照、右侧栏全屏、`attachmentIds` 保护及 `ComposerAttachmentError` 错误映射等回归用例。
- 完成实现后分别临时回退对应核心修复（云端提升检查、规范化身份匹配、`mainView` / 轮询复检、`ensureConversationVisible` 调用、`attachmentIds` 判断、错误码映射），验证对应新增回归用例均真实断言失败；恢复修复后全量相关测试、包构建与仓库门禁全部通过，并在隔离浏览器运行态复核双主题与抽屉交互。

## 验收标准

- 云端「爆款趋势」帖子选中「帖子正文」或未变化的兼容素材，在侧边栏与弹窗模式下点击「带入新会话」均可一次完成 `import-url → creation-reference → onReplicate` 交接，不报 `savedReview` 且仅点击按钮显示加载态。
- 所选正文确有变化时保留「帖子正文」参考（不清空勾选）并提示 `savedReview`；规范化等价的 `source_url` 不会导致父状态丢弃提升记录或卸载抽屉。
- DSH rc.3+ 复用空白会话在仅触发 `retain` 或工作台延迟更新场景下均在超时期内解析到目标会话 ID。
- `revealConversationForReplicate` 在支持 `ensureConversationVisible` 的工作台上正确调用该方法且保持 `setConversationCollapsed(false)` / `setFocus('split')` 与不关 Tab 红线；`creation-handlers.js` 为 `session-not-found` / `needs-session-query` / `disk-space-insufficient` 返回明确状态码与可读提示。
