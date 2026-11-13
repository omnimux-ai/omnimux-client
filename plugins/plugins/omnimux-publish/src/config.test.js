import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BUILTIN_PLATFORMS, BUILTIN_STATUS_MAP, Config, deepMergePlatforms, parsePublishConfig } from './config.js'

describe('parsePublishConfig defaults', () => {
  it('returns builtin matrix and status map for empty config', () => {
    const parsed = parsePublishConfig({})
    assert.equal(parsed.maxMediaMb, 512)
    assert.equal(parsed.submitTimeoutSeconds, 120)
    assert.equal(parsed.dataDir, undefined)
    assert.deepEqual(parsed.platforms.xiaohongshu, BUILTIN_PLATFORMS.xiaohongshu)
    assert.equal(parsed.statusMap.published, 'published')
    assert.equal(parsed.statusMap.scheduled, 'submitted')
  })

  it('accepts undefined config', () => {
    assert.equal(parsePublishConfig(undefined).maxMediaMb, 512)
  })
})

describe('parsePublishConfig overrides', () => {
  it('deep-merges platform overrides onto builtin rows', () => {
    const parsed = parsePublishConfig({
      platforms: {
        xiaohongshu: { supports_cover: true, max_images: 20 },
        newplatform: { media_types: ['video'], supports_cover: false, supports_schedule: true },
      },
    })
    assert.equal(parsed.platforms.xiaohongshu.supports_cover, true)
    assert.equal(parsed.platforms.xiaohongshu.max_images, 20)
    // 未覆盖字段保持 builtin
    assert.equal(parsed.platforms.xiaohongshu.supports_schedule, false)
    assert.deepEqual(parsed.platforms.newplatform.media_types, ['video'])
    // 其他平台不受影响
    assert.equal(parsed.platforms.douyin.supports_cover, true)
  })

  it('overrides statusMap wholesale', () => {
    const parsed = parsePublishConfig({ statusMap: { weird_state: 'reviewing' } })
    assert.equal(parsed.statusMap.weird_state, 'reviewing')
    assert.equal(parsed.statusMap.published, undefined)
  })

  it('honours dataDir / accountsOverlayPath / limits', () => {
    const parsed = parsePublishConfig({
      dataDir: '/tmp/x',
      accountsOverlayPath: '/tmp/y.json',
      maxMediaMb: 8,
      submitTimeoutSeconds: 30,
    })
    assert.equal(parsed.dataDir, '/tmp/x')
    assert.equal(parsed.accountsOverlayPath, '/tmp/y.json')
    assert.equal(parsed.maxMediaMb, 8)
    assert.equal(parsed.submitTimeoutSeconds, 30)
  })
})

describe('bad config fails explicitly', () => {
  /** @param {unknown} value */
  const issues = (value) => {
    const result = Config['~standard'].validate(value)
    assert.ok('issues' in result && Array.isArray(result.issues) && result.issues.length > 0)
    return result.issues[0].message
  }

  it('rejects wrong scalar types', () => {
    assert.match(issues({ maxMediaMb: 'big' }), /maxMediaMb/)
    assert.match(issues({ submitTimeoutSeconds: -1 }), /submitTimeoutSeconds/)
    assert.match(issues({ dataDir: 42 }), /dataDir/)
  })

  it('rejects bad platform rows', () => {
    assert.match(issues({ platforms: { xiaohongshu: { media_types: 'video' } } }), /media_types/)
    assert.match(issues({ platforms: { douyin: { supports_cover: 'yes' } } }), /supports_cover/)
    assert.match(issues({ platforms: { douyin: { max_images: 1.5 } } }), /max_images/)
  })

  it('rejects unknown platform fields (typo protection)', () => {
    assert.match(issues({ platforms: { douyin: { support_cover: true } } }), /support_cover/)
  })

  it('rejects bad statusMap values', () => {
    assert.match(issues({ statusMap: { published: 'done' } }), /statusMap/)
    assert.match(issues({ statusMap: { published: 1 } }), /statusMap/)
  })

  it('non-object config fails', () => {
    assert.match(issues('nope'), /plugin config/)
  })
})

describe('deepMergePlatforms direct', () => {
  it('does not mutate the builtin matrix', () => {
    const before = JSON.stringify(BUILTIN_PLATFORMS)
    deepMergePlatforms(/** @type {any} */ (BUILTIN_PLATFORMS), { xiaohongshu: { max_images: 99 } })
    assert.equal(JSON.stringify(BUILTIN_PLATFORMS), before)
  })
})

describe('BUILTIN_STATUS_MAP sanity (docs/hub-tool-contracts.md §4)', () => {
  it('maps every value into a task status', () => {
    for (const value of Object.values(BUILTIN_STATUS_MAP)) {
      assert.ok(['submitted', 'reviewing', 'published', 'failed'].includes(value), value)
    }
  })
})
