import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBareVideoQueue, DEFAULT_MAX_CONCURRENT_BARE_VIDEOS } from './bare-video-queue.js'

describe('bare-video-queue: 无封面视频首帧加载并发门控', () => {
  it('默认并发上限为 3，超出名额的任务按 FIFO 排队并在前序释放后依次放行', () => {
    const queue = createBareVideoQueue()
    assert.equal(queue.stats().maxConcurrent, DEFAULT_MAX_CONCURRENT_BARE_VIDEOS)
    assert.equal(DEFAULT_MAX_CONCURRENT_BARE_VIDEOS, 3)

    const granted = []
    const releases = []
    for (let i = 0; i < 6; i += 1) {
      releases.push(queue.acquire(() => granted.push(i)))
    }

    assert.deepEqual(granted, [0, 1, 2])
    assert.deepEqual(queue.stats(), { active: 3, queued: 3, maxConcurrent: 3 })

    // 释放 1 号槽位后立刻放行队首 3 号；重复调用 release 必须幂等。
    releases[1]()
    releases[1]()
    assert.deepEqual(granted, [0, 1, 2, 3])
    assert.deepEqual(queue.stats(), { active: 3, queued: 2, maxConcurrent: 3 })

    // 卸载取消排队中的 4 号，释放 0 号应直接跳过 4 号放行 5 号。
    releases[4]()
    assert.deepEqual(queue.stats(), { active: 3, queued: 1, maxConcurrent: 3 })
    releases[0]()
    assert.deepEqual(granted, [0, 1, 2, 3, 5])
    assert.deepEqual(queue.stats(), { active: 3, queued: 0, maxConcurrent: 3 })

    releases[2]()
    releases[3]()
    releases[5]()
    assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 3 })
  })
})
