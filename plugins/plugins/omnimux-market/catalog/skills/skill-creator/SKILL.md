---
name: skill-creator
disable-model-invocation: true
user-invocable: true
version: 1.0.0
author: OmniMux Team
description: "零门槛设计并构建可复用的 OmniMux 双语标准 Skill：梳理触发场景、输入输出与确定性校验步骤，生成符合 OmniMux 规范的 SKILL.md、meta.yaml 与本地技能包并完成安装验证。触发：创建技能、新建 Skill、封装工作流、create skill、skill creator。"
description_zh: "按步骤设计并生成可复用的 OmniMux 双语标准 Skill，自动对齐目录规范、0-Token 触发策略与本地测试验收。"
description_en: "Design, scaffold, and validate reusable bilingual OmniMux Skills with clear triggers, SOP workflows, 0-Token invocation metadata, and local verification."
---

# 创建自定义 Skill（OmniMux Skill Creator）

本技能帮助创作者、电商运营与开发者，把高频重复的脚本创作、选品分析、素材质检或剪辑工作流沉淀为标准化、可复用的 OmniMux Skill 包。

## 何时使用

- 当某类内容创作或营销增长任务需要固定输入契约、合规红线与多步检查清单时；
- 当希望用一条 `/skill-name` 斜杠指令复用成熟提示词、参考模板与辅助脚本时；
- 当需要把已有碎片化笔记升级为双语（中/英）标准 Skill 并在本机安装验证时。

## 核心设计原则

1. **聚焦单一高频目标**：一个 Skill 专注解决一类明确任务（4–7 字动宾短名称最佳），避免把互不相关的流程硬塞进一份文档。
2. **输入输出与红线显式化**：清晰写明「需要向用户确认的缺失输入」「每步必须查证的真实数据源」以及「严禁编造的参数/声明」。
3. **默认 0-Token 按需激活**：随包分发的垂类 Skill 应在 YAML frontmatter 声明 `disable-model-invocation: true` 与 `user-invocable: true`，仅由用户通过 `/` 或技能市场按需唤起，不常驻消耗每轮系统上下文预算。
4. **双语齐备与可验证**：提供准确简练的中/英 `titleZh` / `titleEn` 与 `summaryZh` / `summaryEn`，复杂计算尽量交给零外部依赖的小脚本完成，并在交付前做正反样例验证。

## 标准创建流程

### 第 1 步：对齐目标、触发词与边界
首先向用户询问并确认 4 项要素（信息不足时不臆造）：
1. **核心任务**：这个 Skill 要帮用户完成什么产出？
2. **适用场景**：属于视频创作、爆款复刻、商品视觉、市场洞察、营销增长还是效率工具？
3. **必备输入与工具**：需要哪些文件/商品信息/素材，预期调用会话内哪些已注册能力（仅写当前会话实际可见的工具，不编造不存在的工具名）？
4. **合规红线与验收标准**：哪些数据严禁捏造，交付物需满足什么格式或数值条件？

### 第 2 步：规划目录与命名规范
- **Slug 规范**：小写字母与连字符组成（如 `tiktok-hook-rewrite`），32 字符以内，清晰表达动作与对象。
- **标准文件结构**：
  - `SKILL.md`：必填，包含标准 YAML frontmatter 与可执行的 SOP 正文；
  - `meta.yaml`：展示用中英文名称、摘要与归属字段（`origin: first-party`、`license: MIT`、`author-en` / `author-cn`）；
  - `scripts/`（可选）：纯标准库确定性校验脚本；
  - `references/`（可选）：按需读取的规则模板或行业术语表，避免把大段静态表格塞进主 `SKILL.md`。

### 第 3 步：撰写高质量 `SKILL.md` Frontmatter 与正文
按以下模板构建，注意保持正反样例清晰、语言直白：

```markdown
---
name: <kebab-case-slug>
disable-model-invocation: true
user-invocable: true
version: 1.0.0
description: "<一句话中文能力说明 + 触发关键词。触发：关键词1、关键词2、english keyword。>"
---

# <中文标题>（<English Title>）

## 适用场景
- 明确触发条件与前置输入。

## 执行步骤
1. 检查必需输入，缺失即先追问确认。
2. 按序调用会话可用工具或参考规范执行核心工作流。
3. 执行交付前自检清单（数字溯源 / 格式合规 / 语言一致）。

## 输出格式
给出清晰、可直接复用的 Markdown 或 JSON 结构模版。
```

### 第 4 步：安装落盘与闭环试跑
1. 将编写完成的技能目录写入本机 `$DSH_HOME/skills/<slug>/`（或当前项目工作区受管目录，不污染无关系统路径，不写入任何 API 密钥或本机绝对路径）；
2. 在新对话中输入 `/<slug>` 执行至少 1 次真实用例与 1 次缺失输入/边界用例试跑，根据执行偏差迭代精简指令，再向用户交付结果与使用示例。
