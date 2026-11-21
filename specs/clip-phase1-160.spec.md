# 画布剪辑身份和工具错误（#160）

对应 [#160](https://github.com/omnimux-ai/omnimux-client/issues/160) 和 [#159](https://github.com/omnimux-ai/omnimux-client/issues/159)。阶段 1 修复三条外围链路。阶段 2 的协议在 [剪辑实时控制](../plugins/docs/contracts/clip-live-control.md) 定稿，交给 #154 合入后的实现。

## 假设

画布保存的逻辑工程 ID 可以独立于当前浏览器工程。对照 `videoComposition.tsx` 的打开事件、`CanvasBridge.js` 的回执和 `projectStore.js` 的文件读取，分开校验画布归属、已保存格式及页面连接。工作台已有会话级 viewport 和跟随规则，可用同一条通道报告画布正在承载剪辑。画布已有版本冲突处理，供阶段 2 的成片回写复用。

## 证伪方式

- AC-P1-01 用 PR diff 确认 OpenReel 目录零改动。
- AC-P1-02 对同一带草稿与成片的节点连续粘贴两次。每次分配独立 `clip_node_…`，清除 `schema` 与旧输出元数据，从 `idle` 开始。重开原节点时仍使用原工程和成片。
- AC-P1-03 打开画布 A 的剪辑节点并发送合法回执，再切到画布 B。覆盖缺字段、非法 ID、其他工作区、其他节点、其他工程及迟到回执。合法回执更新目标与下游，反例保持原图和编辑器状态。当前手工导出继续使用浏览器事件桥。
- AC-P1-04 在不同工作面调用 `clip_list`、`clip_get` 和 `clip_diagnostics`，观察切页 RPC。画布承载剪辑时，写入也保留画布页。没有画布剪辑绑定时，验证独立编辑类和其他工作面的正常跟随。
- AC-P1-05 用落盘夹具覆盖旧格式可读、已预分配 ID 尚无文件、原生格式待迁移、普通不存在和无界面执行器。原生文件在列表有具体条目，失败显示错误码。打开、预览、截帧、导出失败后检查文件与播放状态。
- AC-P1-06 核对工具清单与阶段 2 协议链接，并按 [PRD v1.0](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 的阶段 2 验收项复核契约。

## 验收与范围

沿现有画布节点、复制和退出入口验证交互。用隔离桌面 Dev 验证画布节点工程标识、成片归属和回执，核对状态与 DOM。只修改插件外围、测试和相关文档，零改动 `plugins/plugins/omnimux-clip/src/client/openreel/`。原生时间轴与草稿隔离、v1 迁移和实时 Agent 剪辑按阶段 2 验收。

## 旧标准变更

- `plugins/plugins/omnimux-clip/src/client/canvas-bridge.test.js` :: `CanvasBridge: mounts and routes OMNIMUX_CLIP_OPEN / CLOSE`
  - 原断言允许只带 `nodeId` 的事件。改为完整绑定、可见工作区和实际 stage 状态，验证正常打开关闭，以及缺字段和跨工作区事件均不改变绑定。
- `plugins/plugins/omnimux-clip/src/client/canvas-bridge.test.js` :: `clip-events payload validators`
  - 原断言检测单 ID 及字段类型。保留类型检查，并对四类事件补齐三元组，逐项验证缺失或非法 ID 被拒绝。
- `plugins/plugins/omnimux-clip/src/client/canvas-bridge.test.js` :: `notifyCanvasSave & notifyCanvasProgress: deliver correct payloads to canvas listener`
  - 原断言允许回调脱离活跃会话发送。用真实 stage store 验证当前绑定转发，检查成片属性，并覆盖同一节点 ID 在不同工作区出现后的丢弃行为。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_open surfaces ui-unavailable when no UI channel exists`
  - 原断言只有通道不可用。以真实工程文件区分未物化、原生格式待迁移、可读旧档且无执行器，并在注册边界核对错误码。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_open validates the project then calls the injected open channel`
  - 原断言给 Host 注入仅测试可用的打开通道。当前无执行器，改为旧工程可查、打开明确失败，校验错误不会改写工程。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_snapshot writes png paths and clip_export queues a job`
  - 原断言要求写占位 PNG 和无人消费的任务。改为两工具明确失败，并断言磁盘没有 PNG 或排队文件。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_view / clip_snapshot throw PREVIEW_NOT_READY when overlay is down`
  - 原断言模拟浏览器全局。Host 无实时通道时按已提交契约返回 `ui-unavailable`，无需模拟右侧页面。打开、播放、截帧、导出共用相同校验。
- `plugins/plugins/omnimux-clip/src/tools.test.js` :: `clip_view seeks in seconds without creating an undo step`
  - 原断言允许播放头写到 Host 文件。改为验证播放命令失败、播放头和历史保持原值，查询旧档仍成功。
- `plugins/plugins/omnimux-workflow/src/client/projects/canvasTab-session.test.mjs` :: `源码契约：注册 Context Contributor 携带目标 canvas workspaceId`
  - 旧匹配只接受 `extra` 的单字段字面量。新断言保留目标工作区并检查可见 Portal 的剪辑绑定，宿主跟随用例另覆盖正反条件。
