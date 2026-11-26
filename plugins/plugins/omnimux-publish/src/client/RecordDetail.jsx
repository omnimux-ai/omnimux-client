import { useCallback, useEffect, useState } from 'react'
import { Button, IconChevronLeftOutline14, IconRefreshOutline16 } from 'dsh-ui-kit'
import { errorText, listHubAccounts, recordDetail, refreshRecord, retryTask } from './api.js'
import { isPublishingAccount, isRetryablePublishingTask } from '../account-policy.js'
import { accountDisplayName, extractAccounts } from './account-sidebar-view.js'
import { showsDirectProcessingNotice, showsInboxDraftNotice, showsPrivateNotice } from './detail-notice.js'

/**
 * A6/M8 记录详情：per-account 子任务状态展开 + 手动刷新（POST /records/refresh）
 * + 单账号重试（POST /tasks/retry，复用已上传媒体）。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   recordId: string,
 *   onBack: () => void,
 *   onChanged: () => void,
 * }} props
 */
export function RecordDetail({ t, recordId, onBack, onChanged }) {
  const [record, setRecord] = useState(null)
  const [accountNames, setAccountNames] = useState(() => new Map())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    setBusy('load')
    return recordDetail(recordId).then((result) => {
      if (result.ok && result.body && result.body.record) {
        setRecord(result.body.record)
        setError('')
      } else {
        setError(errorText(result.body, result.status))
      }
      setBusy('')
      return true
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy('')
      return false
    })
  }, [recordId])

  useEffect(() => { void load() }, [load])

  const hasOfficialSubtask = Array.isArray(record?.subtasks) && record.subtasks.some(isPublishingAccount)
  useEffect(() => {
    if (!hasOfficialSubtask) return undefined
    let active = true
    listHubAccounts().then((result) => {
      if (!active) return
      if (!result.ok) {
        setAccountNames(new Map())
        return
      }
      const map = new Map()
      for (const row of extractAccounts(result.body)) {
        const display = accountDisplayName(row)
        if (display !== '') map.set(String(row.id), display)
      }
      setAccountNames(map)
    }).catch(() => {
      if (active) setAccountNames(new Map())
    })
    return () => { active = false }
  }, [hasOfficialSubtask])

  /** 手动刷新：现拉 hub 平台状态再返回本地账本（与 publish_get_record refresh:true 同源）。 */
  const refresh = useCallback(() => {
    setBusy('refresh')
    return refreshRecord(recordId).then((result) => {
      if (result.ok && result.body && result.body.record) {
        setRecord(result.body.record)
        const syncErrors = Array.isArray(result.body.sync_errors) ? result.body.sync_errors : []
        setError(syncErrors.length > 0 ? t('detail.syncError', { reason: syncErrors[0].error }) : '')
      } else {
        setError(errorText(result.body, result.status))
      }
      setBusy('')
      onChanged()
      return true
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy('')
      return false
    })
  }, [recordId, t, onChanged])

  /** 单账号重试：失败子任务回 submitted（新 post_id）；失败时完整透传服务端错误并回刷子任务错误态。 */
  const retry = useCallback((taskId) => {
    setBusy(taskId)
    return retryTask(taskId).then((result) => {
      if (result.ok && result.body && result.body.record) {
        setRecord(result.body.record)
        setError('')
      } else {
        setError(errorText(result.body, result.status))
        void recordDetail(recordId).then((latest) => {
          if (latest.ok && latest.body && latest.body.record) setRecord(latest.body.record)
        }).catch(() => {})
      }
      setBusy('')
      onChanged()
      return true
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy('')
      return false
    })
  }, [onChanged, recordId])

  if (!record) {
    return (
      <div>
        <div className="omnimux-publish-detail-head">
          <Button variant="ghost" size="sm" leadingIcon={<IconChevronLeftOutline14 size={14} />} onClick={onBack}>
            {t('detail.back')}
          </Button>
        </div>
        <div className="omnimux-publish-muted">{error || t('loading')}</div>
      </div>
    )
  }

  const tasks = Array.isArray(record.subtasks) ? record.subtasks : []
  return (
    <div>
      <div className="omnimux-publish-detail-head">
        <Button variant="ghost" size="sm" leadingIcon={<IconChevronLeftOutline14 size={14} />} onClick={onBack}>
          {t('detail.back')}
        </Button>
        <strong className="omnimux-publish-detail-title">
          {String(record.title || record.description || '(untitled)')}
        </strong>
        <Button
          variant="outline"
          size="sm"
          leadingIcon={<IconRefreshOutline16 />}
          loading={busy === 'refresh'}
          disabled={!tasks.some((task) => isPublishingAccount(task) && task.post_id && ['submitted', 'reviewing', 'submitting', 'sent_to_inbox'].includes(task.status))}
          onClick={() => { void refresh() }}
        >
          {t('detail.refresh')}
        </Button>
      </div>

      {error ? <div role="alert" className="omnimux-publish-alert warn">{error}</div> : null}
      {record.error ? (
        <div role="alert" className="omnimux-publish-alert banner">{String(record.error)}</div>
      ) : null}
      {showsInboxDraftNotice(tasks) ? (
        <div role="status" className="omnimux-publish-alert inbox" data-testid="inbox-draft-notice">
          <div className="omnimux-publish-inbox-title">{t('detail.inboxNotice.title')}</div>
          <div className="omnimux-publish-inbox-body">{t('detail.inboxNotice.body')}</div>
          <ol className="omnimux-publish-inbox-steps">
            <li>{t('detail.inboxNotice.step1')}</li>
            <li>{t('detail.inboxNotice.step2')}</li>
            <li>{t('detail.inboxNotice.step3')}</li>
          </ol>
        </div>
      ) : null}
      {showsDirectProcessingNotice(tasks, record) ? (
        <div role="status" className="omnimux-publish-alert info" data-testid="direct-processing-notice">
          {t('detail.directProcessingNotice')}
        </div>
      ) : null}
      {showsPrivateNotice(tasks, record) ? (
        <div className="omnimux-publish-alert banner">{t('detail.privateNotice')}</div>
      ) : null}

      <div className="omnimux-publish-section">{t('detail.subtasks')}</div>
      <div className="omnimux-publish-tasks">
        {tasks.map((task) => (
          <SubtaskRow
            key={String(task.id)}
            t={t}
            task={task}
            accountName={isPublishingAccount(task) ? (accountNames.get(String(task.account_id)) || '') : ''}
            busy={busy}
            onRetry={retry}
          />
        ))}
        {tasks.length === 0 ? <div className="omnimux-publish-hint">—</div> : null}
      </div>
    </div>
  )
}

/**
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   task: Record<string, unknown>,
 *   accountName?: string,
 *   busy: string,
 *   onRetry: (taskId: string) => void,
 * }} props
 */
function SubtaskRow({ t, task, accountName = '', busy, onRetry }) {
  const status = String(task.status || '')
  const platformKey = `platform.${String(task.platform || '')}`
  const platformLabel = t(platformKey) !== platformKey ? t(platformKey) : String(task.platform || '')
  const accountLabel = accountName || String(task.account_id)
  return (
    <div className="omnimux-publish-task">
      <div className="omnimux-publish-task-row">
        <span>{platformLabel}</span>
        <span>{accountLabel}</span>
        <span className="omnimux-publish-task-status" data-status={status}>{t(`task.${status}`)}</span>
      </div>
      {task.post_id ? (
        <div className="omnimux-publish-task-meta">{t('task.post', { id: String(task.post_id) })}</div>
      ) : null}
      {task.raw_status ? (
        <div className="omnimux-publish-task-meta">{t('task.rawStatus', { status: String(task.raw_status) })}</div>
      ) : null}
      {Number(task.attempts) > 1 ? (
        <div className="omnimux-publish-task-meta">{t('task.attempts', { count: Number(task.attempts) })}</div>
      ) : null}
      {task.error ? (
        <div className="omnimux-publish-task-err">{String(task.error)}</div>
      ) : null}
      {!isPublishingAccount(task) ? <div className="omnimux-publish-task-err">{t('task.sourceMismatch')}</div> : null}
      {isRetryablePublishingTask(task) ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="danger"
            loading={busy === String(task.id)}
            onClick={() => { onRetry(String(task.id)) }}
          >
            {t('task.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
