---
name: anti-loop
agents: [social-content-team-lead, content-copywriter, image-agent, video-agent, editing-agent, speech-agent, music-agent]
---

# Failure Handling Contract

失败处理由错误类型、可恢复性、成本和新增信息决定，不使用固定次数代替判断。

1. 相同输入与参数失败后，先读取错误和当前状态；没有新证据时不得机械重复。
2. 只有存在合理的瞬时故障迹象时才原样重试；参数、模型或路径变化必须能对应已知原因。
3. 安全拦截、权限不足、缺少授权、无可用通道或输入无效时立即停止该分支，不尝试绕过。
4. 收尾返回已尝试动作、真实错误、已排除原因、可行替代和需要用户决定的事项；没有用户决定也能安全推进的部分继续完成。
