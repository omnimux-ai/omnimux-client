# Spec: Composer 斜杠技能与自定义技能按钮双通道共存

- 任务：`issue-46-composer-skill-dual`
- 日期：2026-11-16
- 基线：`529ffff294265a695b708ebee2261c6c009b07dc`（main）
- 风险：R2（Composer 输入状态、技能激活态与发送链路）

## 目标

- 原生斜杠通道保留官方 `onPick` 返回的 `/skill-name ` 文本，由 `ui-conversation` 装饰为蓝色 token；不调用 `requestSkillAttach` / `tryAttach`。
- 自定义技能按钮/面板只显示胶囊，不写假斜杠 token；选择时移除已有 slash token。
- `ActiveSkillIdentity` 增加 `origin: 'slash' | 'custom' | 'shortcut'`，由 `window.__omnimuxActiveSkill` 与 `omnimux:skill:changed` 统一同步。
- 胶囊 ✕、删除/退格 token 都会同步清理 token、胶囊与全局 active 状态；不误删正文、附件、链接卡槽。
- 自定义/快捷方式来源走既有 `tryAttach`；`origin: 'slash'` 跳过 `tryAttach`，由 Host `dsh-tool-skill` 按 token 加载。

## 范围

- `plugins/plugins/omnimux/src/client/composer-commands-i18n.js`
- `plugins/plugins/omnimux/src/client/composer-add/skill-event.ts`
- `plugins/plugins/omnimux/src/client/composer-add/skill-token.ts`（新增）
- `plugins/plugins/omnimux/src/client/composer-add/AttachmentSubmitBridge.jsx`
- `plugins/plugins/omnimux/src/client/composer-quick-shortcuts/ComposerQuickShortcuts.jsx`
- `plugins/plugins/omnimux/src/client/reference/dispatcher.ts`
- `plugins/plugins/omnimux-market/src/client/skill-picker-logic.js`
- `plugins/plugins/omnimux-market/src/client/skill-picker.js`
- `plugins/plugins/omnimux-market/src/client/session-create.js`
- 相关单测 / DOM / 集成测试与演示

## 状态与交互

- `origin: 'slash'`：原生斜杠菜单选择产生，输入框必须有对应 `/slug` token；同一时刻只有一个 active skill，已有旧 token 时替换不并存。
- `origin: 'custom'`：技能面板选择产生，输入框不写假 token；已有 slash token 先移除后设置自定义技能。
- `origin: 'shortcut'`：底部四条快捷方式产生，沿用既有快捷方式提示语/链接卡槽，向全局通道发布 origin shortcut。
- `publishActiveSkill(null)` 清除；`AttachmentSubmitBridge` 监听 draft，`origin: 'slash'` 的 slug 不在 draft 中时清除 active。
- `skill-picker.clearActiveSkill` / `applyItem` 使用 `inputActions.setDraft`（或 revision 守卫的 insertText）清理 token，不直接改 DOM。
- 原生通道不触发 `omnimux:skill:attach-request`；自定义/快捷方式保留 `tryAttach`。

## 验收标准

- [ ] AC1 输入 `/` 选择技能后输入框出现蓝色 `/skill-name` token，胶囊同步，正文其他内容不清空。
- [ ] AC2 原生 token 发送时保留 `/slug`，由 Host 产生 `skill-invocation`。
- [ ] AC3 技能按钮面板选择只显示胶囊，不插入假 `/skill`，仍走 `tryAttach`。
- [ ] AC4 原生→自定义移除旧 token；自定义→原生插入 token；同一技能不重复。
- [ ] AC5 胶囊 ✕ 清除 token+胶囊+全局状态；删除 token 后胶囊消失；不误删正文/附件/链接卡槽。
- [ ] AC6 任意时刻一个 active skill；快速切换无重复 token/重复 tryAttach。
- [ ] AC7 附件、链接卡槽、四条快捷方式、发送/草稿守卫、技能菜单搜索/双语/排序不回归。
- [ ] AC8 对应插件测试、typecheck、build、lint:i18n、verify-plugin-boundaries、verify:stages 全过；双向证伪 base 红、head 绿。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/composer-commands-i18n.test.js` :: `wrapSkillInputTriggerSource wraps candidates and transparently resolves onPick to raw English slug`
  - 原断言：`pickOutcome.text === ''`，且事件中存在 `omnimux:skill:attach-request`（旧设计把原生斜杠选择清空并改走自定义胶囊）。
  - 必须改的理由：本单修复根因就是该行为；新语义必须保留官方 `/raw-slug ` 文本、写入 `origin: 'slash'`，且不触发 `attach-request`。
  - 新期望证据：`pickOutcome.text === '/ip-character-consistency-studio '`；`__omnimuxActiveSkill.origin === 'slash'`；事件中无 `omnimux:skill:attach-request`。
- `plugins/plugins/omnimux/tests/e2e/composer-skill-i18n.spec.js` :: `e2e: composer slash-skill bilingual adaptive search, selection, and plain-text fill`
  - 原断言：`outcome.text === ''`（斜杠选择清空输入框）。
  - 必须改的理由：同一旧行为断言，必须与实现同步为保留官方 token；同时该文件重命名为 `composer-skill-i18n.e2e.test.js` 以纳入 `test:e2e` 的 `*.e2e.test.js` 收集范围。
  - 新期望证据：`outcome.text === '/ip-character-consistency-studio '`；`__omnimuxActiveSkill.origin === 'slash'`。
- `plugins/plugins/omnimux/tests/e2e/composer-skill-i18n.e2e.test.js` :: `e2e: composer slash-skill bilingual adaptive search, selection, and plain-text fill`
  - 原断言：`outcome.text === ''`（斜杠选择清空输入框）。
  - 必须改的理由：同一旧行为断言，必须与实现同步为保留官方 token；重命名后的路径纳入 e2e 脚本收集。
  - 新期望证据：`outcome.text === '/ip-character-consistency-studio '`；`__omnimuxActiveSkill.origin === 'slash'`。

## 测试计划

- `composer-commands-i18n.test.js`：原生 onPick 保留 raw slug、origin slash、无 attach-request。
- `skill-event.test.ts`：origin 透传/custom/shortcut/null。
- `composer-skill-dual.test.js`：token 词边界/删除；原生→原生旧 token 移除。
- `attachment-bridge-skill-sync.test.js`：draft 删除 token 清 active；removeSkillToken 保留正文；custom 不误清。
- `skill-picker-dual-channel.test.js`：自定义选择移除旧 token、不写假 token、胶囊 ✕ 清理。
- 双向证伪：在 base `529ffff` 上新增用例必须红，head 必须全绿。
