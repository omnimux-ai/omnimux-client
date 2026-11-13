---
name: social-engagement-ops
description: "Analyze social engagement, classify comments, draft replies, monitor brand signals, and obtain task-relevant public or authorized data. Use for 互动增长、评论运营、品牌监控、信号挖掘、社媒数据分析。Analysis and drafting do not authorize posting comments, sending DMs, following, liking, or other account writes."
---

# 社媒互动增长运营

本技能默认做只读分析、分类、策略和拟稿，可在所请求范围内读取公开或用户授权的数据。真实评论、私信、点赞、关注、转发、删除、封禁或账号设置必须有覆盖账号、平台、对象和动作的明确授权，并且运行时存在可用的官方能力；同一范围已授权后不重复询问。

## 工作流

1. 复用用户已给的平台、账号、内容、目标、素材和授权；只追问会改变结果的缺口。
2. 从当前运行时工具目录发现实际可用能力，不依据 reference 杜撰工具名、安装状态或平台权限。
3. 区分四类结果：观察事实、分析判断、回复草稿、外部执行。
4. 分析/拟稿授权只产出报告与候选文案，不自动发布评论或私信。
5. 外部执行前核对账号、平台、目标对象、动作、数量/范围、最终内容及授权是否仍有效。
6. 使用平台官方 API、已授权连接器或用户提供的导出；不模拟真人行为，不规避检测，不轮换指纹/IP，不绕过验证码、限流或审核。
7. 记录执行结果、平台返回、失败原因和未完成项；平台拒绝时停止，不换策略规避。

## 按需加载 references

| Reference | 何时加载 |
|---|---|
| references/interaction-automation-guide.md | 规划或执行真实互动动作、判断授权范围 |
| references/ai-comment-strategy.md | 分类评论、起草回复、识别销售/投诉信号 |
| references/brand-monitoring-framework.md | 舆情分级、竞品监控、危机草稿和报告 |
| references/social-data-crawling.md | 规划公开数据获取、字段、来源和合规检查 |

不要默认把四份全部加载。

## 输出

每次交付明确列出：

- 数据来源、时间范围、适用平台和缺失证据；
- 事实、推断、风险级别和建议；
- 草稿与已执行动作分栏；
- 当前授权覆盖范围；
- 未执行动作及原因。

危机声明、客服承诺、退款/补偿、私信索取订单信息、对外发布和账号动作均不得由分析结论自动触发。
