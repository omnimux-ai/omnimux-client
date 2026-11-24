import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCreatorInfoCache, isCacheableCreatorInfo } from './creator-info-cache.js'

describe('createCreatorInfoCache (60s TTL, in-flight coalescing, error exclusion, force bust)', () => {
  it('caches healthy creator_info within TTL, expires after TTL, and supports force:true bust', async () => {
    let clock = 1_000_000
    let calls = 0
    const cache = createCreatorInfoCache({
      ttlMs: 60_000,
      now: () => clock,
      channel: {
        async creatorInfo(accountId) {
          calls += 1
          return {
            data: {
              creator_nickname: `Nick-${calls}`,
              account_id: accountId,
              privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
              max_video_post_duration_sec: 600,
            },
          }
        },
      },
    })

    const first = await cache.get('acc-1')
    assert.equal(calls, 1)
    assert.equal(first.data.creator_nickname, 'Nick-1')

    // Within 60s TTL -> cache hit
    clock += 30_000
    const second = await cache.get('acc-1')
    assert.equal(calls, 1)
    assert.equal(second.data.creator_nickname, 'Nick-1')

    // force:true busts cache immediately
    const forced = await cache.get('acc-1', { force: true })
    assert.equal(calls, 2)
    assert.equal(forced.data.creator_nickname, 'Nick-2')

    // After TTL expires -> refetches
    clock += 61_000
    const expired = await cache.get('acc-1')
    assert.equal(calls, 3)
    assert.equal(expired.data.creator_nickname, 'Nick-3')
  })

  it('coalesces concurrent in-flight calls for the same account_id', async () => {
    let calls = 0
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const cache = createCreatorInfoCache({
      channel: {
        async creatorInfo() {
          calls += 1
          await gate
          return { data: { creator_nickname: 'Shared', privacy_level_options: ['SELF_ONLY'] } }
        },
      },
    })

    const p1 = cache.get('acc-1')
    const p2 = cache.get('acc-1')
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(calls, 1)
    assert.deepEqual(r1, r2)
  })

  it('never caches errors or can_post:false responses so retries re-check immediately', async () => {
    let calls = 0
    const cache = createCreatorInfoCache({
      channel: {
        async creatorInfo() {
          calls += 1
          if (calls === 1) throw new Error('spam_risk_too_many_posts')
          if (calls === 2) return { data: { creator_nickname: 'Limited', can_post: false } }
          return { data: { creator_nickname: 'Recovered', can_post: true, privacy_level_options: ['PUBLIC_TO_EVERYONE'] } }
        },
      },
    })

    await assert.rejects(() => cache.get('acc-1'), /spam_risk_too_many_posts/)
    assert.equal(calls, 1)

    const blocked = await cache.get('acc-1')
    assert.equal(calls, 2)
    assert.equal(blocked.data.can_post, false)

    const recovered = await cache.get('acc-1')
    assert.equal(calls, 3)
    assert.equal(recovered.data.can_post, true)
    assert.equal(isCacheableCreatorInfo(blocked), false)
    assert.equal(isCacheableCreatorInfo(recovered), true)
  })
})
