# Spec: Muse 品牌上架（#52）

- 任务：`issue-52-muse-brand`
- 日期：2026-11-17
- 基线：`2febd79e436eca7cc74d74892f9346b9b1b84565`（origin/main）
- 风险：R2（品牌元数据、品牌图标、模型目录快照与相关既有断言；只动 `plugins/plugins/omnimux` 与 `plugins/plugins/omnimux-workflow`）

## 目标

- 网关在售的两个 Muse 模型（`muse-video` / `muse-image`）以独立品牌 `Muse` 出现在模型选择器与品牌图标中，模型 id 不变。
- 品牌元数据提供显示名 `Muse Video` / `Muse Image`；图标使用中性紫 `#8B5CF6` 的 `M` 占位标，不声称官方 logo。
- bundled pricing 快照按网关实时口径刷新成员关系为 16 行，移除已下架 `gemini-3.1-flash-lite-image`，新增 6 行（含两个 Muse 模型），净增 5。
- 交集 10 行沿用 base 行数据（billing / contract / enableGroups），由 `catalog-snapshot.mjs --preserve-existing <ref>` 完成；默认裸跑仍是纯 live，行为不变。
- 快照由仓库脚本生成，不手写 JSON；disappearance guard 按 live 会员关系计算，未被绕过。

## 状态机

```
网关 pricing 快照（脚本生成）
  → buildModelCatalog：familyFor() 标记 family
      ├─ text / image / video / audio 四桶按合同 + 在售集合求交
      └─ Muse 两行进入 image / video 桶
  → 客户端品牌解析（manifest + model-brands + ModelBrandIcon）
      ├─ family 'muse' → 品牌 Muse
      └─ 图标 = 中性紫 M 占位
  → 模型选择器分组：Muse 组（Muse Video / Muse Image）
```

## 范围

- `plugins/plugins/omnimux/src/catalog/gateway-contract.js`：`familyFor()` 加 `muse` 分支。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts`：`BRANDS` 加 Muse。
- `plugins/plugins/omnimux-workflow/src/canvas/ui/ModelBrandIcon.tsx`：Muse 占位 SVG 与匹配规则。
- `plugins/plugins/omnimux/assets/brands/manifest.json` 与 `plugins/plugins/omnimux/src/brand/model-brands.js`：品牌元数据与 SVG。
- `plugins/plugins/omnimux/src/catalog/cloud/bundled/pricing.json`：脚本生成。
- `plugins/plugins/omnimux/src/catalog/contract/auto-serving-manifest.json`：按仓规登记旧模型移除决策（`snapshotDropAcknowledged`，含 id / reason / reviewedAt），供 `verify:model-contracts` 复查；不是绕过 runtime disappearance guard。
- `plugins/plugins/omnimux/scripts/catalog-snapshot.mjs`：新增默认关闭的 `--preserve-existing <ref>` 与 ratio 完整性校验。
- `plugins/scripts/catalog-snapshot-preserve.test.mjs`（新）+ `plugins/scripts/governance-manifest.json` + `.github/workflows/quality-gate.yml` 登记。
- 对应测试与 `specs/issue-52-muse-brand.spec.md`。
- 不改 `channel-groups.js` 覆盖表、线路默认值、价格展示；线路与定价的全量刷新在 #58。

## 验收标准

- [ ] AC-1 `familyFor('muse-video')` / `familyFor('muse-image')` 返回 `muse`；`minimax` 前缀行为不变。
- [ ] AC-2 模型选择器把两行归入 `Muse` 品牌组，显示名 `Muse Video` / `Muse Image`，模型 id 仍为 `muse-video` / `muse-image`。
- [ ] AC-3 `resolveModelBrand` 与 `ModelBrandIcon` 的 `BRAND_SVGS.muse` 均命中 `muse`，SVG 使用 `#8B5CF6` 的 `M` 占位。
- [ ] AC-4 `getAllBrands()` 返回 Muse 品牌（company `Muse`、series `Muse Video / Muse Image`、models 两项、带 SVG）。
- [ ] AC-5 bundled 快照 16 行，含两个 Muse 模型，不含 `gemini-3.1-flash-lite-image`，`source=pricing`、`generatedAt` 可解析。
- [ ] AC-5b 交集 10 行与 base 快照逐行相等；新增 6 行等于 live 行；`groups.ratio` 为 live ∪ 被 carry-over 行引用的 base 档位（26 条）。
- [ ] AC-6 目录四桶与快照一致：image 5 行、video 5 行、text 3 行、audio 2 行；`models.length = 53`。
- [ ] AC-6b 快照中每个模型的每个 `enableGroups` 都能在 `groups.ratio` 找到（`auto` 是网关路由元组，走自动顺序，不计入 ratio）；生成侧对最终快照无条件校验一次（裸跑 / carry-over / `--stdout` 都校验，且在写入前），`--check` 同样校验。
- [ ] AC-7 `catalog-snapshot.mjs --check` 通过，脚本生成、无手改；`verify:model-contracts` 通过（旧模型移除已在 `snapshotDropAcknowledged` 显式登记）。
- [ ] AC-8 双向证伪：回退品牌映射 → 相关用例变红；回退快照到 base → 快照集合用例变红；换回纯 live（回退 carry-over）→ 线路/定价既有用例变红；恢复后全绿。
- [ ] AC-9 相关 `test` / `typecheck` / `build` / `build:all` / `check:boundaries` / `verify:stages` / `verify:model-contracts` / `workspace-check` / `bundle-lock` 全绿。

## 测试计划

- 快照脚本：`plugins/scripts/catalog-snapshot-preserve.test.mjs` 校验 `--preserve-existing` 默认关闭、缺 ref 报错、`--check` 下拒绝、carry-over 只换交集行数据（新增行用 live、移除行不复活）、base 档位 ratio/usable 回填、`auto` 不计入缺失 ratio；裸跑缺 ratio 在写入/打印前拒绝且不落盘；live-only 行同名 group 不被 base 值污染；`--check --baseline <base>` 能读到旧快照并报出 `gemini-3.1-flash-lite-image` 消失；`--baseline` 非 `--check` 误用 exit 2。
- 单元：`gateway-contract.test.js` 校验 Muse family/label/selectable、16 行快照集合与旧模型排除；`list.test.js` 校验四桶与 53 行；`media/catalog.test.js` 与 `omitted-model-defaults.test.js` 校验 image/video/text 桶；`model-brands.test.js` 校验品牌解析与 `getAllBrands()`。
- 运行时：`ModelBrandIcon.runtime.test.mjs` 用 esbuild 打包 `ModelBrandIcon.tsx` 后实际调用 `resolveModelBrand`，断言 `muse` 与 `#8B5CF6` / `M`；`modelPickerCandidates.test.mjs` 用真实分组函数断言 Muse 分组。
- 双向证伪：逐个回退 `familyFor` 的 muse 分支、`BRANDS` 条目、`ModelBrandIcon` 的 `RULES` 规则与 SVG，对应用例必须变红；`bundled/pricing.json` 换回 base 版，快照集合用例必须变红；恢复后全绿。

## carry-over 机制（#52 边界）

- 裸跑 `catalog-snapshot.mjs` 仍是纯 live 快照，行为与之前一致。
- `--preserve-existing <ref>`：以 live 响应的模型集合为准，只把「live 与 `<ref>` 都在售」的模型行替换为 `<ref>` 的行数据；live 独有行用 live，base 独有行不复活。
- 只有被 carry-over 的行引用的 `groups.ratio` / `groups.usable` 才从 `<ref>` 回填（live ∪ 被引用 base 档位），同名档位以 base 值优先，保证这些行的线路价格与改动前一致；live-only 新行不触发回填，始终使用 live 值。
- 会员判定、空快照判定与 disappearance guard 仍只看 live 响应，carry-over 发生在 guard 之后。
- 本单只做成员关系，线路与定价的全量 live 刷新在 #58。

## 旧标准变更

- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js` :: `Gateway Contract v2 fills text and image buckets without local YAML`
  - 原断言：text 桶 `['gemini-3.8-flash', 'gemini-4-argon']`，image 桶 `['gemini-3.1-flash-lite-image', 'gpt-image-2.5']`，并断言旧 image 模型 `image_to_image` 的 `max = 14`。
  - 必须改的理由：#52 定稿按网关实时快照刷新 bundled 目录，`gemini-3.1-flash-lite-image` 已下架，Muse 两行在售；旧硬编码集合不再成立。
  - 新期望证据：text 桶含 `seed-evolving`（3 行），image 桶为 `gpt-image-2.5` + 两个 Muse + 两个 nano-banana + `seedream-5-5`（5 行）；`max = 14` 改由在售的 `nano-banana-2-lite` 承载。
- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js` :: `Gateway text rows and SubmitGuard admit gateway-only models`
  - 原断言：网关 text 行为 `['gemini-3.8-flash', 'gemini-4-argon']`，SubmitGuard 用 `gemini-3.1-flash-lite-image` 验证 image 放行。
  - 必须改的理由：同上，快照刷新后 text 行新增 `seed-evolving`，旧 image 模型已不在售，不能再用它证明 image 放行。
  - 新期望证据：text 行为 3 行；SubmitGuard 改用 `nano-banana-2-lite` 的 `text_to_image` 仍返回放行。
- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js` :: `a v1 cached snapshot supplements missing contracts from bundled v2`
  - 原断言：v1 缓存补全后 text/image 桶等于旧 2 + 2 集合。
  - 必须改的理由：补全来源是 bundled v2 快照，快照刷新后集合随之变化；断言口径不变，仅集合更新。
  - 新期望证据：text 3 行、image 5 行，`missingContract` / `adapterUnsupported` 断言保持不变。
- `plugins/plugins/omnimux/src/catalog/list.test.js` :: `returns Catalog v1.1: models[] authority + listed-only four lists + defaults`
  - 原断言：`catalog.models.length = 48`；image 桶 `['gemini-3.1-flash-lite-image', 'gpt-image-2.5']`；video/text 桶为刷新前集合。
  - 必须改的理由：#52 快照刷新后多出 6 行、少 1 行，净增 5，四桶与扁平列表口径必须同步；不能为保持旧数字而放宽快照消失检查。
  - 新期望证据：`models.length = 53`；image 5 行、video 5 行、text 3 行、audio 2 行，且 Muse 两行在列。
- `plugins/plugins/omnimux/src/catalog/list.test.js` :: `keeps gateway-public unsupported rows and merges custom BYOK profiles`
  - 原断言：BYOK video 列表 `['minimax-h3-video', 'custom:my-video-model', 'seedance-2-0', 'seedance-2-5', 'wan-3.0']`。
  - 必须改的理由：在售集合新增 `muse-video`，自定义 BYOK 行仍保留。
  - 新期望证据：列表含 `muse-video`，`custom:my-video-model` 与 `wan-3.0` 的 `ready` 断言不变。
- `plugins/plugins/omnimux/src/catalog/list.test.js` :: `text bucket lists PR-A verified models; gate cannot invent unlisted ids`
  - 原断言：`catalog.text.length = 2`。
  - 必须改的理由：在售 text 集合新增 `seed-evolving`，长度变为 3；「gate 不能虚构未列出 id」的断言不变。
  - 新期望证据：`catalog.text.length = 3`，仍不含 `whisper-1`。
- `plugins/plugins/omnimux/src/catalog/list.test.js` :: `wins over the offline defaults when its row is ready`
  - 原断言：用 `gemini-3.1-flash-lite-image` 作为网关推荐 image 默认并断言胜出。
  - 必须改的理由：该模型已下架，不能再作为「row ready」的推荐样本。
  - 新期望证据：改用 `muse-image` 作为推荐默认，仍断言 `defaults.image` 胜出且 `defaultsMeta.image.source = 'gateway-recommended'`。
- `plugins/plugins/omnimux/src/media/catalog.test.js` :: `mediaModelIds matches the table rows`
  - 原断言：image 列表 = 本地 image specs + `gemini-3.1-flash-lite-image`。
  - 必须改的理由：媒体目录 facade 与 bundled 快照同源，旧模型下架、Muse 与 nano-banana / seedream 新行在售。
  - 新期望证据：image 列表 = 本地 specs + `muse-image`、`nano-banana-2-1`、`nano-banana-2-lite`、`seedream-5-5`。
- `plugins/plugins/omnimux/src/settings/omitted-model-defaults.test.js` :: `3312: saved defaults pointing at delisted models resolve only to the fixed real published catalog`
  - 原断言：text 2 行、image `['gemini-3.1-flash-lite-image', 'gpt-image-2.5']`、video 4 行。
  - 必须改的理由：该用例断言「保存默认回落到固定真实在售目录」，快照刷新后固定目录本身变化；回落逻辑与 `defaults` 断言不变。
  - 新期望证据：text 3 行、image 5 行、video 5 行（含两个 Muse 行），`catalog.defaults` 断言保持不变。
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.hub.test.mjs` :: `real Hub catalog exposes the listed text models and selects Gemini 3.8 for video`
  - 原断言：真实 Hub 投射的 text 桶为 `['gemini-3.8-flash', 'gemini-4-argon']`。
  - 必须改的理由：在售 text 集合新增 `seed-evolving`，用例读取的是真实 bundled 快照而非固定白名单。
  - 新期望证据：text 桶为 3 行且含 `seed-evolving`，`defaults.text = 'gemini-3.8-flash'` 不变。
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.hub.test.mjs` :: `real Hub catalog: the listed whisper-1 ASR contract is selectable in the audio-transcription tool (#1789)`
  - 原断言：同一 text 桶 2 行；chat 白名单 `CHAT = ['gemini-3.8-flash', 'gemini-4-argon']`。
  - 必须改的理由：同上，text 桶新增在售行，chat 白名单需覆盖同一在售集合；ASR 模型不得进入生成式 chat 桶的核心断言不变。
  - 新期望证据：text 3 行、`CHAT` 含 `seed-evolving`，`whisper-1` 仍只走 `speechToText` seam。
- `plugins/plugins/omnimux/src/brand/model-brands.test.js` :: `getBrandInfo: returns valid metadata and SVG for all brands`
  - 原断言：`getAllBrands().length >= 15`，只做通用字段遍历。
  - 必须改的理由：新增 Muse 品牌后品牌数增加，且需要把 Muse 的 company / series / 色值 / models / SVG 作为具名契约固定下来。
  - 新期望证据：`length >= 16`，并断言 Muse 品牌五项字段与 `#8B5CF6` SVG；通用遍历保留。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `passes token store and credentials seam to media generators`
  - 原断言：apply 后 `provided.modelCatalog.list().text.length === 2`。
  - 必须改的理由：在售 text 集合新增 `seed-evolving`，快照刷新后文本桶为 3 行；默认模型断言不变。
  - 新期望证据：`catalog.text.length === 3`，`defaults.text` 仍为 `gemini-3.8-flash`。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `fine-grained disables media, text models, and official tools via gate`
  - 原断言：gate 关闭 `gemini-3.8-flash` 后 textComplete 的 model enum 为 `['gemini-4-argon']`。
  - 必须改的理由：在售 text 集合新增 `seed-evolving`，关闭一个模型后应剩下两个在售文本模型。
  - 新期望证据：enum 为 `['gemini-4-argon', 'seed-evolving']`。
- `plugins/plugins/omnimux/src/text/execute.test.js` :: `registers and forwards onto textComplete`
  - 原断言：textComplete 工具默认 model enum 为 `['gemini-3.8-flash', 'gemini-4-argon']`。
  - 必须改的理由：同上，默认 enum 跟随在售 text 集合。
  - 新期望证据：enum 含 `seed-evolving`（3 项），工具注册与转发断言不变。
- `plugins/plugins/omnimux/src/text/execute.test.js` :: `hides a disabled whitelist model from the tool enum`
  - 原断言：关闭 `gemini-3.8-flash` 后 enum 为 `['gemini-4-argon']`。
  - 必须改的理由：同上，关闭后剩两个在售文本模型。
  - 新期望证据：enum 为 `['gemini-4-argon', 'seed-evolving']`。
- `plugins/plugins/omnimux/src/text/mount.test.js` :: `registers omnimux_text_complete tool and provides textComplete seam by default`
  - 原断言：默认 textComplete model enum 为两项。
  - 必须改的理由：同上，默认 enum 跟随在售 text 集合。
  - 新期望证据：enum 含 `seed-evolving`（3 项），seam 注册断言不变。
- `plugins/plugins/omnimux/src/text/mount.test.js` :: `filters enum in tool parameters when gate disables specific models`
  - 原断言：关闭 `gemini-3.8-flash` 后 enum 为 `['gemini-4-argon']`。
  - 必须改的理由：同上，关闭后剩两个在售文本模型。
  - 新期望证据：enum 为 `['gemini-4-argon', 'seed-evolving']`。
