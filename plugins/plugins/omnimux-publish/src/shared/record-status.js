/** Browser-safe publishing status rules shared by the Host and Client. */
import { isObject } from './values.js'
/** @typedef {'draft' | 'publishing' | 'partial_failed' | 'failed' | 'sent_to_inbox' | 'published'} AggregateStatus */
/** @typedef {AggregateStatus | 'reviewing'} DisplayStatus */
/** @typedef {'submitting' | 'submitted' | 'reviewing' | 'sent_to_inbox' | 'published' | 'failed'} TaskStatus */
/** @typedef {{ total: number, published: number, sentToInbox: number, failed: number, inFlight: number, reviewing: number, submitted: number }} SubtaskSummary */

// submitted/reviewing are the Host's persisted, non-terminal in-flight task states.
// sent_to_inbox is settled in TikTok's creator inbox and must not stall in publishing.
const IN_FLIGHT = new Set(['submitting', 'submitted', 'reviewing', 'uploading', 'processing'])

/** @param {unknown} subtasks @returns {Record<string, unknown>[]} */
function tasksOf(subtasks) {
  const values = Array.isArray(subtasks) ? subtasks : isObject(subtasks) ? Object.values(subtasks) : []
  return values.filter(isObject)
}

/** @param {Record<string, unknown>} task */
function statusOf(task) {
  return typeof task.status === 'string' ? task.status : typeof task.state === 'string' ? task.state : ''
}

/** @param {unknown} subtasks @returns {SubtaskSummary} */
export function calculateSubtaskSummary(subtasks) {
  const summary = { total: 0, published: 0, sentToInbox: 0, failed: 0, inFlight: 0, reviewing: 0, submitted: 0 }
  for (const task of tasksOf(subtasks)) {
    const status = statusOf(task)
    summary.total += 1
    if (status === 'published') summary.published += 1
    if (status === 'sent_to_inbox') summary.sentToInbox += 1
    if (status === 'failed') summary.failed += 1
    if (IN_FLIGHT.has(status)) summary.inFlight += 1
    if (status === 'reviewing') summary.reviewing += 1
    if (status === 'submitted' || status === 'submitting') summary.submitted += 1
  }
  return summary
}

/**
 * Only known in-flight states outrank failures; unknown states cannot imply success.
 * @param {unknown} record
 * @returns {AggregateStatus}
 */
export function aggregateStatus(record) {
  const summary = calculateSubtaskSummary(isObject(record) ? record.subtasks : undefined)
  if (summary.total === 0) return 'draft'
  if (summary.inFlight > 0) return 'publishing'
  if (summary.failed > 0) return (summary.published > 0 || summary.sentToInbox > 0) ? 'partial_failed' : 'failed'
  if (summary.published === summary.total) return 'published'
  if (summary.sentToInbox > 0 && summary.sentToInbox + summary.published === summary.total) return 'sent_to_inbox'
  return 'draft'
}

/** @param {unknown} record @returns {DisplayStatus} */
export function displayStatus(record) {
  const aggregate = aggregateStatus(record)
  const reviewing = isObject(record) && tasksOf(record.subtasks).some((task) => task.status === 'reviewing' || task.state === 'reviewing')
  return aggregate === 'publishing' && reviewing ? 'reviewing' : aggregate
}
