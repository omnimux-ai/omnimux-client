import { isObject } from './shared/values.js'
/**
 * @typedef {object} MediaRecord
 * @property {string} id
 * @property {string} sha256
 * @property {string} filename
 * @property {string} content_type
 * @property {'image' | 'video' | 'other'} kind
 * @property {number} size
 * @property {string} created_at
 * @property {number | null} [duration_sec]
 */
/** @param {unknown} value @returns {value is MediaRecord} */
export function isMediaRecord(value) {
  return isObject(value)
    && ['id', 'sha256', 'filename', 'content_type', 'created_at'].every((key) => typeof value[key] === 'string')
    && (value.kind === 'image' || value.kind === 'video' || value.kind === 'other')
    && typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0
    && (value.duration_sec === undefined || value.duration_sec === null
      || (typeof value.duration_sec === 'number' && Number.isFinite(value.duration_sec) && value.duration_sec >= 0))
}
