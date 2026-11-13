/**
 * A counting semaphore used as the ffmpeg concurrency gate.
 *
 * `createSemaphore(max)` → `acquire(fn)`: runs at most `max` callbacks
 * concurrently; the rest queue FIFO. `max < 1` is treated as 1.
 *
 * @param {number} max
 * @returns {(fn: () => Promise<unknown> | unknown) => Promise<unknown>}
 */
export function createSemaphore(max) {
  const limit = Math.max(1, Number(max) || 1)
  let active = 0
  /** @type {Array<() => void>} */
  const waiters = []
  const pump = () => {
    while (active < limit && waiters.length > 0) {
      const resolve = waiters.shift()
      active += 1
      resolve()
    }
  }
  return function acquire(fn) {
    if (active >= limit) {
      return new Promise((resolve) => { waiters.push(resolve); pump() })
        .then(() => runWithSlot(fn))
    }
    active += 1
    return runWithSlot(fn)
  }
  function runWithSlot(fn) {
    return Promise.resolve()
      .then(() => fn())
      .finally(() => {
        active -= 1
        pump()
      })
  }
}