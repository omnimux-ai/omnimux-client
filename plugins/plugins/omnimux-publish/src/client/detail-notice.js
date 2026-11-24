import { isPublishingAccount } from '../account-policy.js'
import { normalizeTikTokOptions } from '../shared/tiktok-options.js'

/** TikTok app review is pending, so a submitted direct post stays private in-app. */
const PRIVATE_STATUSES = new Set(['submitted', 'reviewing', 'published'])

/**
 * Whether a subtask was delivered to or submitted under TikTok's creator inbox
 * draft upload path (`video.upload`), rather than Direct Post (`video.publish`).
 * @param {Record<string, unknown>} task
 * @param {{ settings?: Record<string, unknown> } | null} [record]
 */
export function isDraftUploadTask(task, record) {
  if (!task || typeof task !== 'object') return false
  if (task.publish_mode === 'draft') return true
  if (String(task.status || '').toLowerCase() === 'sent_to_inbox') return true
  if (String(task.raw_status || '').trim().toUpperCase() === 'SEND_TO_USER_INBOX') return true
  if (record?.settings && typeof record.settings === 'object' && record.settings.publish_mode === 'draft') {
    return task.publish_mode !== 'direct'
  }
  return false
}

/**
 * Whether the record detail should render the TikTok inbox draft delivery guide.
 * Shown once at least one official TikTok subtask has reached `sent_to_inbox` /
 * `SEND_TO_USER_INBOX` (with a valid upstream post_id).
 * @param {Array<Record<string, unknown>>} tasks
 */
export function showsInboxDraftNotice(tasks) {
  const rows = Array.isArray(tasks) ? tasks : []
  return rows.some((task) => isPublishingAccount(task)
    && typeof task.post_id === 'string' && task.post_id !== ''
    && (String(task.status || '').toLowerCase() === 'sent_to_inbox'
      || String(task.raw_status || '').trim().toUpperCase() === 'SEND_TO_USER_INBOX'))
}

/**
 * Whether this record's live TikTok direct subtasks are subject to the
 * pre-review "Only you" visibility. Draft uploads (both `sent_to_inbox` and
 * in-flight `submitted` draft tasks), local drafts, failed and historical
 * non-official rows never qualify, so the notice cannot mislead them.
 * A record explicitly published with a wider privacy level must not show the
 * notice; legacy direct records without stored options keep the pre-review behavior.
 * @param {Array<Record<string, unknown>>} tasks
 * @param {{ settings?: Record<string, unknown> } | null} [record]
 */
export function showsPrivateNotice(tasks, record) {
  const rows = Array.isArray(tasks) ? tasks : []
  const privacy = normalizeTikTokOptions(record?.settings?.tiktok_options).privacy_level
  if (privacy !== '' && privacy !== 'SELF_ONLY') return false
  return rows.some((task) => isPublishingAccount(task)
    && !isDraftUploadTask(task, record)
    && typeof task.post_id === 'string' && task.post_id !== ''
    && PRIVATE_STATUSES.has(String(task.status || '')))
}

/**
 * TikTok Content Sharing Guidelines §5.d:
 * Show post-submission processing notice for live TikTok Direct Post subtasks
 * (submitted / reviewing / published) so creators know it may take a few minutes
 * for content to appear on their TikTok profile. Never shown for inbox drafts,
 * failed tasks, local drafts, or non-official providers.
 * @param {Array<Record<string, unknown>>} tasks
 * @param {{ settings?: Record<string, unknown> } | null} [record]
 */
export function showsDirectProcessingNotice(tasks, record) {
  const rows = Array.isArray(tasks) ? tasks : []
  return rows.some((task) => isPublishingAccount(task)
    && !isDraftUploadTask(task, record)
    && typeof task.post_id === 'string' && task.post_id !== ''
    && PRIVATE_STATUSES.has(String(task.status || '')))
}
