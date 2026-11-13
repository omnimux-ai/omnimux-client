/**
 * WAI-ARIA 水平 tab 键盘行为（对齐 dsh-agent-team-gui / .atg-tabs）。
 * ArrowRight 下一项循环、ArrowLeft 上一项循环、Home 第一项、End 最后一项。
 * @param {{ key: string, currentTarget: { querySelectorAll: Function }, target: unknown, preventDefault: Function }} event
 */
export function handleTabKey(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
  if (tabs.length === 0) return
  const current = Math.max(0, tabs.indexOf(event.target))
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
