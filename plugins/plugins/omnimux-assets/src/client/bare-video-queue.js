/**
 * 离屏/批量无封面视频（bareClip）的首帧加载并发门控队列。
 *
 * `material/hook` 分类中 80%+ 为无封面 MP4（单条 5-15 MB），`<video>` 没有原生
 * `loading="lazy"`；如果不限制并发，单行或网格一次挂载 20+ 路 `element.load()`
 * 会直接占满同一条 `assets.omnimux.ai` HTTP/2 连接与浏览器视频解码器，饿死首屏图片。
 *
 * 本队列限制同一时刻最多 `maxConcurrent` 路无封面视频执行元数据/首帧加载，并在加载
 * 完成、报错、超时或组件卸载时立即释放名额给队列中的下一张卡片。
 */

export const DEFAULT_MAX_CONCURRENT_BARE_VIDEOS = 3

/**
 * @param {number} [maxConcurrent]
 */
export function createBareVideoQueue(maxConcurrent = DEFAULT_MAX_CONCURRENT_BARE_VIDEOS) {
  const limit = Math.max(1, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT_BARE_VIDEOS)
  let active = 0
  /** @type {{ onGrant: () => void, cancelled: boolean, granted: boolean }[]} */
  const waiters = []

  function drain() {
    while (active < limit && waiters.length > 0) {
      const next = waiters.shift()
      if (!next || next.cancelled) continue
      active += 1
      next.granted = true
      next.onGrant()
    }
  }

  /**
   * 申请一个并发加载槽位；返回一个幂等的释放函数（卸载或加载结束时调用）。
   * @param {() => void} onGrant
   * @returns {() => void}
   */
  function acquire(onGrant) {
    let released = false
    const entry = { onGrant, cancelled: false, granted: false }

    if (active < limit) {
      active += 1
      entry.granted = true
      onGrant()
    } else {
      waiters.push(entry)
    }

    return function release() {
      if (released) return
      released = true
      entry.cancelled = true
      if (entry.granted) {
        active = Math.max(0, active - 1)
        drain()
      } else {
        const idx = waiters.indexOf(entry)
        if (idx !== -1) waiters.splice(idx, 1)
      }
    }
  }

  function stats() {
    return {
      active,
      queued: waiters.length,
      maxConcurrent: limit,
    }
  }

  function reset() {
    active = 0
    waiters.length = 0
  }

  return { acquire, stats, reset }
}

/** 全局无封面视频首帧加载并发队列（上限 3 路）。 */
export const bareVideoQueue = createBareVideoQueue(DEFAULT_MAX_CONCURRENT_BARE_VIDEOS)
