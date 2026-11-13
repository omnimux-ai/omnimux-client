import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickAvatar } from './avatar-api.js'

describe('pickAvatar', () => {
  it('keeps only the public avatar fields and drops unknown keys', () => {
    const picked = pickAvatar({
      avatar: {
        uri: 'data:image/svg+xml,x',
        name: 'ada',
        opts: { hue: 210, extra: true },
        using_default: false,
        secret: 'nope',
      },
      error: 'ignored-unless-top-level-error',
      access_token: 'pat-live',
    })
    assert.deepEqual(picked, {
      uri: 'data:image/svg+xml,x',
      name: 'ada',
      opts: { hue: 210 },
      using_default: false,
      error: 'ignored-unless-top-level-error',
    })
  })

  it('returns an empty object for a missing avatar', () => {
    assert.deepEqual(pickAvatar(null), {})
    assert.deepEqual(pickAvatar({}), {})
  })
})
