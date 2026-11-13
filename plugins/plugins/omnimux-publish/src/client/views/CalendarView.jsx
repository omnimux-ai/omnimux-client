import React, { useState } from 'react'
import { displayStatus, statusText } from '../status-display.js'
import { Button } from 'dsh-ui-kit'

/**
 * 日历排程视图 (CalendarView)
 * 7 列月网格，支持 Sun/Mon 起始切换、Today 定位、排期条（左侧 3px 状态色条 + 悬停 Tooltip）。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   records: Array<Record<string, unknown>>,
 *   onOpen: (record: Record<string, unknown>) => void,
 * }} props
 */
export function CalendarView({ t, records, onOpen }) {
  const [weekStart, setWeekStart] = useState('sun') // 'sun' | 'mon'
  const [currentDate] = useState(new Date())

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const headers = weekStart === 'sun'
    ? ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

  // 过滤非草稿记录进日历
  const calendarRecords = (records || []).filter((r) => r.status !== 'draft')

  // 计算本月天数与首日偏置
  const firstDayIndex = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = weekStart === 'sun' ? firstDayIndex : (firstDayIndex === 0 ? 6 : firstDayIndex - 1)

  const days = []
  for (let i = 0; i < offset; i++) {
    days.push({ day: null, isCurrentMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, isCurrentMonth: true })
  }

  return (
    <div className="omnimux-publish-cal-wrap">
      <div className="omnimux-publish-cal-top">
        <div className="omnimux-publish-cal-month-label">
          {year} 年 {month + 1} 月
        </div>
        <div className="omnimux-publish-cal-controls">
          <div className="omnimux-publish-week-btn-group">
            <Button
              variant={weekStart === 'sun' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setWeekStart('sun')}
            >
              周日
            </Button>
            <Button
              variant={weekStart === 'mon' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setWeekStart('mon')}
            >
              周一
            </Button>
          </div>
        </div>
      </div>

      <div className="omnimux-publish-cal-grid">
        {headers.map((h) => (
          <div key={h} className="omnimux-publish-cal-head-cell">
            {h}
          </div>
        ))}
        {days.map((item, idx) => {
          if (!item.isCurrentMonth) {
            return <div key={idx} className="omnimux-publish-cal-cell other-month" />
          }
          const d = item.day
          // 查找该日的记录
          const dayRecords = calendarRecords.filter((r) => {
            const dateStr = r.submitted_at || r.created_at || ''
            if (!dateStr) return false
            const dObj = new Date(dateStr)
            return dObj.getDate() === d && dObj.getMonth() === month && dObj.getFullYear() === year
          })

          return (
            <div key={idx} className="omnimux-publish-cal-cell">
              <span className="omnimux-publish-cal-date-num">{d}</span>
              <div className="omnimux-publish-cal-tasks">
                {dayRecords.slice(0, 2).map((rec) => {
                  const status = displayStatus(rec)
                  const label = statusText(status)
                  const title = String(rec.title || rec.description || rec.id)
                  return (
                    <div
                      key={String(rec.id)}
                      className={`omnimux-publish-cal-pill ${status}`}
                      title={`${label} · ${title}`}
                      onClick={() => onOpen(rec)}
                    >
                      <span className="omnimux-publish-cal-pill-title">{title}</span>
                    </div>
                  )
                })}
                {dayRecords.length > 2 ? (
                  <span className="omnimux-publish-cal-more">+{dayRecords.length - 2} 更多</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
