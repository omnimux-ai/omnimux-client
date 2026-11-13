# 社媒公开数据获取指南

用于规划和审计公开社媒数据获取。优先官方 API、已授权连接器、用户导出和平台提供的下载。本文不授权抓取，也不提供反爬绕过。

## 来源优先级

1. 用户提供的导出或数据文件；
2. 平台官方 API、分析后台或公开下载；
3. 已获授权且符合平台条款的连接器；
4. 公开网页的有限读取，仅在任务授权、站点条款和运行时能力允许时。

需要登录、付费、好友关系、私密账号、验证码或权限提升的内容，不属于“公开可采集”。

## 字段设计

按任务最小化收集：

| Field group | Examples | Privacy treatment |
|---|---|---|
| Content | URL/ID, title, text, format, publish time | preserve source |
| Public metrics | views, likes, comments, shares | capture timestamp |
| Topic | hashtags, keywords, content category | normalized mapping |
| Creator | public account name/type | avoid unnecessary profile enrichment |
| Comments | text, time, public engagement | pseudonymize user IDs where possible |
| Media | thumbnail or authorized asset | record rights and retention |

不采集手机号、邮箱、地址、私聊、订单或其他非必要个人信息。

## 任务流程

1. 明确用途、平台、来源、时间范围、数量、字段、保留周期和输出。
2. 从运行时目录发现实际官方能力和权限，不根据旧文档假设“全平台支持”。
3. 确认来源可访问且读取未超出任务范围，遵守已知条款与配额；遇到账号、付费或权限限制时只解决实际缺口。
4. 执行最小范围读取，记录来源时间和覆盖缺口。
5. 清洗、去重、必要时匿名化；保留可追溯 source URL/ID。
6. 输出分析前先做采样偏差和缺失数据说明。
7. 仅按用户已授权的保留/清理策略处理任务数据，不自定删除周期。

## 限流与拒绝

- 以官方 API 文档、响应头和平台返回为准，不使用经验“安全频率矩阵”。
- 401/403 表示权限或访问被拒；停止并核对授权。
- 429 按 Retry-After 或官方退避要求处理。
- 验证码、风控、反爬或封禁出现时停止；不得换 IP、换账号、伪装设备或模拟真人行为继续。
- 不下载无授权媒体，不去水印，不绕过地域、登录、付费或版权限制。

## 配置模板

| Field | Value |
|---|---|
| Purpose | |
| Platform / official source | |
| Authorization basis | |
| Time range | |
| Accounts / keywords / content | |
| Maximum records | |
| Required / excluded fields | |
| Sampling and coverage limits | |
| Retention / output location | |
| Runtime capability and quota | |
| Stop conditions | |

## 交付

报告 source、captured_at、coverage、confidence、privacy treatment、rights/ToS status、failures 和 explicit unknowns。不得把缺失数据补成事实。
