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

  it('onGrant 回调抛错时立即回收槽位并继续放行后续排队任务，不泄漏并发名额', () => {
    const queue = createBareVideoQueue(2)
    const warnings = []
    const origWarn = console.warn
    console.warn = (...args) => { warnings.push(args.join(' ')) }
    try {
      const granted = []
      // 1. 直接放行路径抛错：槽位应立刻回收，release 幂等不二次扣减。
      const badImmediate = queue.acquire(() => { throw new Error('boom-immediate') })
      assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 2 })
      badImmediate()
      assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 2 })

      // 2. 占满 2 路后，队首 waiter 抛错，释放 1 路应跳过抛错项继续放行下一位。
      const r0 = queue.acquire(() => granted.push('ok-0'))
      const r1 = queue.acquire(() => granted.push('ok-1'))
      queue.acquire(() => { throw new Error('boom-queued') })
      const r3 = queue.acquire(() => granted.push('ok-3'))
      assert.deepEqual(queue.stats(), { active: 2, queued: 2, maxConcurrent: 2 })

      r0()
      assert.deepEqual(granted, ['ok-0', 'ok-1', 'ok-3'])
      assert.deepEqual(queue.stats(), { active: 2, queued: 0, maxConcurrent: 2 })

      r1()
      r3()
      assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 2 })
      assert.equal(warnings.length, 2)

      // 3. 排队项的 onGrant 同步调用自身 release 后再抛错，不得二次扣减 active 影响其他在途任务。
      const keepA = queue.acquire(() => {})
      const keepB = queue.acquire(() => {})
      let selfRelease = () => {}
      selfRelease = queue.acquire(() => {
        selfRelease()
        throw new Error('throw-after-self-release')
      })
      const keepC = queue.acquire(() => granted.push('ok-after-reentrant'))
      keepA()
      assert.equal(granted.at(-1), 'ok-after-reentrant')
      assert.deepEqual(queue.stats(), { active: 2, queued: 0, maxConcurrent: 2 })
      keepB()
      keepC()
      assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 2 })
    } finally {
      console.warn = origWarn
    }
  })
})
