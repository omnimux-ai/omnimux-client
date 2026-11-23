# 规格：修复 skillhub_search 多关键词合并排序与 plaza/skillhub 提示词冲突（Issue #201）

## 1. 背景与目标

`omnimux-market` 在「先从技能库找技能，再完成调研并输出报告」类复合请求下暴露两处缺陷：

1. `skillhub_search` 同时传入 `query` 与同义词 `queries` 时，`mergeBySlug` 无条件按全站 `downloads` 重排，覆盖调用方 `sortBy`（默认 `score` 相关性），高下载弱相关结果挤掉高相关低下载技能；
2. `tool:plaza-experts` 的 `PRIORITY RULE (experts beat skills)`（MUST 先 `plaza_search`、禁止同轮两个搜索）与 `tool:skillhub`（MUST 调 `skillhub_search`）形成互斥 MUST，且「卡片出现后至多一句短回复」未区分纯浏览与复合任务。

## 2. 变更

1. `src/api.ts`
   - `mergeBySlug(groups, sortBy = 'score')`：按关键词页命中数 + Reciprocal Rank Fusion（k=60）保留相关性；`downloads`/`stars` 仅在相关性并列时破平；
   - `sortBy` 显式 `downloads` / `stars` / `installs` 时按对应指标排序；`updated_at` 因列表载荷无时间戳而保留服务端页内顺序；
   - `searchSkills` 将 `sortBy` 传入 `mergeBySlug`。
2. `src/plaza-tools.ts`、`src/host.ts`
   - 增加 `SKILL REQUEST FIRST`：用户显式提及「技能库 / SkillHub / 找技能」时直接走 `skillhub_search`，不再要求先 `plaza_search`，不与专家优先规则冲突；
   - 「卡片出现后至多一句」仅限本轮只要求查找/浏览技能；复合任务展示卡片后继续推进，`tool:skillhub` 提示抽为 `SKILLHUB_PROMPT_LINES` 以便单测断言。

## 3. 验收

- `mergeBySlug` / `searchSkills` 单测：`sortBy: 'score'` 下高相关低下载排在低相关高下载噪声之前；`sortBy: 'downloads'` 保持按下载量排序；`stars` / `installs` 同理。
- 提示词单测：`PLAZA_PROMPT_LINES` 与 `SKILLHUB_PROMPT_LINES` 含 `SKILL REQUEST FIRST`，不再包含「禁止同轮调用两个搜索」的互斥句；短回复限制限定在纯浏览场景，复合任务明确继续执行。
- 双向证伪：回退 `mergeBySlug` 相关性排序 → `mergeBySlug keeps relevance ahead of download noise for sortBy score`、`searchSkills multi-keyword merge applies relevance by default and downloads when asked` 必红；回退提示词 → 3 个提示词用例必红；还原后全绿。

## 旧标准变更

- `plugins/plugins/omnimux-market/src/tests/plaza-tools.test.ts` :: `PLAZA_PROMPT_LINES require composer chips and persist attachment`
  - 原断言：断言提示词包含 `same user message`（禁止同轮调用 plaza_search 与 skillhub_search）。
  - 变更理由：Issue #201 要求消除「显式找技能」与专家优先规则的 MUST 冲突，原互斥句被 `SKILL REQUEST FIRST` 取代。
  - 新期望证据：断言包含 `SKILL REQUEST FIRST`，且不再包含 `Do not call plaza_search and skillhub_search in the same user message`。

- `plugins/plugins/omnimux-market/src/tests/host.test.ts` :: `plaza-experts prompt forbids dual search and silent summon`
  - 原断言：断言提示词包含 `same user message`。
  - 变更理由：同上，规则改为显式找技能直达 `skillhub_search`。
  - 新期望证据：用例更名 `plaza-experts prompt resolves explicit skill requests without dual-search MUST conflict`，断言 `SKILL REQUEST FIRST` 且无互斥句。

- `plugins/plugins/omnimux-market/src/tests/api.test.ts` :: `mergeBySlug dedupes and prefers higher downloads`
  - 原断言：仅断言合并后的顺序，未覆盖 `sortBy`。
  - 变更理由：`mergeBySlug` 签名新增 `sortBy` 参数；原用例改为显式保留去重与代表卡选择语义，并新增 score/downloads/stars/installs 与 searchSkills 合并用例。
  - 新期望证据：`mergeBySlug dedupes and keeps the highest-download representative` 通过，并新增 3 个排序/合并用例。
