import { ClipDomainError } from '../errors.js'

/**
 * Agent tools speak seconds. The on-disk TimelineSchema is integer milliseconds.
 * Accept a finite number (or numeric string); reject NaN / Infinity.
 *
 * @param {unknown} sec
 * @param {string} [field]
 * @returns {number}
 */
export function secToMs(sec, field = 'seconds') {
  if (sec == null || sec === '') {
    throw ClipDomainError.invalidJson(`${field} is required`)
  }
  const value = typeof sec === 'number' ? sec : Number(sec)
  if (!Number.isFinite(value)) {
    throw ClipDomainError.invalidJson(`${field} must be a finite number of seconds`)
  }
  return Math.round(value * 1000)
}

/**
 * Optional seconds → ms. `undefined` / `null` / `''` stay undefined.
 * @param {unknown} sec
 * @param {string} [field]
 * @returns {number | undefined}
 */
export function optionalSecToMs(sec, field = 'seconds') {
  if (sec == null || sec === '') return undefined
  return secToMs(sec, field)
}

/**
 * Prefer an explicit ms field; otherwise convert seconds.
 * @param {{ ms?: unknown, sec?: unknown }} pair
 * @param {string} label
 * @returns {number | undefined}
 */
export function pickTimeMs(pair, label) {
  if (pair.ms != null && pair.ms !== '') {
    const value = typeof pair.ms === 'number' ? pair.ms : Number(pair.ms)
    if (!Number.isFinite(value)) {
      throw ClipDomainError.invalidJson(`${label}Ms must be a finite number`)
    }
    return Math.round(value)
  }
  if (pair.sec != null && pair.sec !== '') return secToMs(pair.sec, `${label}Sec`)
  return undefined
}

/** @param {number} ms */
export function msToSec(ms) {
  return Math.round(Number(ms) || 0) / 1000
}
