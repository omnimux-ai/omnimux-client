# Spec: 云端公共素材「图像+音频」多模态判型（follow-up）

- 任务：`cloud-cover-multimodal`
- 日期：2026-11-15
- 风险：R1（客户端附件展示行为）
- 关联：#18 的 AC5 真机回归漏点；#18 本身不改。

## 目标
云端公共素材经 `normalizeCloudAsset()` 归一化后，真实的「图像 + 音频」多模态素材（如公共 Elf Archer：`category:'character'`、`media_type:'audio'`、`cover_url:…png`、`media_url:…wav`）在消息附件中显示为**图像缩略**，不再显示 `ASSET`/`AUDIO` pill；纯 audio 类目仍保持 AUDIO pill；视频仍为 VIDEO；文件仍为文件 pill。

## 根因
`CloudAssetCard` 传给 `addAssetToConversation()` 的是 `normalizeCloudAsset(row)` 的 camelCase 结果（`thumbUrl`/`coverUrl`/`mediaType`/`hasCover`），而 `buildAssetPayload()` 的云端分支只读 raw snake_case（`cover_url`/`media_url`/`meta.source_*`）。真实 Elf Archer 行因此被算成 `kind:'asset'`、`extension:'AUDIO'`，显示端只能渲染 AUDIO pill。PR #18 的判别单测使用 raw snake_case 行，未覆盖 normalize 后的真实入参，所以单测绿而真机漏。

## 修法
`buildAssetPayload()` 兼容 `normalizeCloudAsset()` 的 camelCase 字段：
- 封面：`thumbUrl` / `coverUrl` 作为真实封面候选，raw `cover_url` / `meta.source_cover_url` 继续兼容，最后才回落到 `which=cover` 路由；
- 分类：在视频优先、纯音频保护之后，新增「`mediaType==='audio'` 且 `category` 为非 audio 类目（如 `character`）且存在真实封面 → `kind:'image'`」；纯 `category:'audio'` 的素材不进入该分支，仍为 `asset/AUDIO`；
- 纯 audio 的 `previewUrl` 保持无扩展名的 cover 路由，避免显示端按图片 URL 误判；
- metadata 的 `cover_url` / `media_url` 兼容 camelCase 真实值。

## 验收（AC）
- AC1：`buildAssetPayload(normalizeCloudAsset(Elf Archer 真实行))` 返回 `kind:'image'`、`extension:'IMAGE'`、`previewUrl` 为真实缩略图（`.webp`）。
- AC2：`normalizeCloudAsset` 后的纯 `category:'audio'` 素材仍返回 `asset/AUDIO`。
- AC3：`normalizeCloudAsset` 后的视频素材仍返回 `video/VIDEO`。
- AC4：`pnpm --filter omnimux-assets test` 全绿；diff-aware L0 门禁 PASS。

## 假设
根因假设：真实云端素材进入会话时走的是 `normalizeCloudAsset()` 的归一化对象，而不是目录 raw 行；因此只要 `buildAssetPayload()` 接受 camelCase 的 `thumbUrl`/`coverUrl`/`mediaType`/`hasCover`，并按「非 audio 类目 + audio 媒体 + 有封面」区分角色多模态与纯音频，就能在不动显示端的前提下恢复图像缩略。

## 证伪方式
在 base（不含本修复的 `add-to-chat.js`）上运行新增用例「云端真实 Elf Archer 行经 normalizeCloudAsset 后判为 image/IMAGE」，应失败为 `actual:'asset' !== expected:'image'`；应用本修复后同一用例通过，且纯 audio / video 回归用例仍通过。若 base 上该用例也通过，说明测试没有覆盖真实入参，修复假设不成立。

## 边界
只改 `plugins/`；worktree 开发；PR 到 omnimux-client，不自行合并；无视觉样式变化（无需重出 HTML demo）；i18n 走脚本；公开仓红线（无内部地址/凭据/本机路径）。

## 旧标准变更
（本次仅新增用例与修复代码，未放宽或删除既有断言 —— 无。）
