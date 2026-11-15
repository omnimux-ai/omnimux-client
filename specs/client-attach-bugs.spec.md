# Spec: 客户端附件两处 bug（composer 发送后不清空 + 多模态素材误判 AUDIO）

- 任务：`client-attach-bugs`
- 日期：2026-11-15
- 风险：R1（客户端附件行为）

## 目标
1. 发送成功后清空 composer 附件 chip；消息里仍保留该附件。被 `check()` 拦截/宿主未接单的发送不清。
2. 多模态「图像 + 音频」素材在消息里显示图像缩略，不再显示 `AUDIO` pill；视频显视频、纯音频/文件/表格 pill 回归正常；同一素材不重复双显示。

## 根因
- **Bug1**：`plugins/omnimux/src/client/composer-add/attachment-admission.js` 的 `arm()` 依赖 `getSessions()?.binding(sessionId)`；调用方 `index.js` 的 sessions 句柄 `guideSessions` 只在一个 `ctx.inject(['commandUi','sessions'])` 里赋值，`commandUi` 未挂载时 `guideSessions` 为 null → `binding` 拿不到、`arm()` 直接 return，发送后清理链不触发，`AttachmentTray`（从 `attachments/store.ts` 渲染）继续显示 chip。另：requestId 仅按 text 匹配，空文本/文本被规范化时不稳。
- **Bug2**：`plugins/omnimux-assets/src/client/add-to-chat.js` 云端分支 audio 优先（`if mediaType==='audio'` 先判），有图像封面也被判 `asset`/`ext=AUDIO`；显示端 `plugins/omnimux/src/client/attachments/userMessageAttachmentsEnhancer.ts` 的 `createAttachmentCardElement` 对 `kind==='asset'` 一律文件/AUDIO pill，即使 `previewUrl` 是图片。叠加 native 附件行未完全隐藏 → 「图像 + AUDIO」并存。

## 修法
- Bug1：
  - `index.js`：新增独立 `hostSessions` 句柄（`ctx.inject(['sessions'])` 赋值），附件 admission / 提交桥 session 判定改用 `hostSessions || guideSessions`，不再受 `commandUi` 门控。
  - `attachment-admission.js`：binding 变化时重新订阅；关联用「附件 id 优先，其次 text，唯一新提交兜底」；仅在宿主 admission（`queue[].rpcId` 或 `user/message` 且 `source.kind==='user'`）确认后 `removeAttachment`；binding 缺失时保留附件、不清。
- Bug2：
  - `add-to-chat.js`：判定改为「真实图像封面/媒体 → image；否则视频 → video；纯音频（无真实视觉）才 audio」，多模态按视觉优先（用真实 cover/media，不用生成的 `which=cover` 兜底，避免纯音频被误判为图像）。
  - `userMessageAttachmentsEnhancer.ts`：`asset/audio` 但有图片 `previewUrl`（data:image 或图片扩展名）→ 按图像缩略渲染；纯音频/文件仍 pill。
  - 去重：native 附件行在 OmniMux 素材轨存在时隐藏，同一素材不双显示。

## 验收（AC）
- AC1：加附件→发送成功后 composer chip 清空，消息仍显示附件；被拦截/未接单不清。
- AC2：图像（含「图像+音频」多模态）显示图像缩略；视频显视频（带播放角标）；无 AUDIO 误判。
- AC3：同一素材不「图像 + AUDIO pill」重复显示。
- AC4：纯音频、文档/表格仍正常 pill；未发送前 chip 正常显示、可单个删除。
- AC5：Dev 实机真实「图像+音频」素材前后对照截图 + 单测。

## 边界
- 只改 `plugins/`；worktree；PR 到 omnimux-client，不自行合并；i18n 走脚本；公开仓红线；不发真实模型请求（Dev 实测用本地素材）。

## 旧标准变更
（本次为新增测试与新增用例，未放宽/删除既有断言 —— 无。）
