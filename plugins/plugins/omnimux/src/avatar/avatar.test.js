import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AvatarOptionsError,
  avatarSeed,
  buildAvatarOptions,
  buildAvatarView,
  HUES,
  parseAvatarOptions,
  renderAvatarUri,
} from './avatar.js'

describe('parseAvatarOptions', () => {
  it('accepts hue, tone, background and a trimmed seed', () => {
    assert.deepEqual(parseAvatarOptions({
      seed: '  abc  ',
      hue: 210.4,
      tone: 0.25,
      background: 'circle',
      extra: true,
    }), {
      seed: 'abc',
      hue: 210,
      tone: 0.25,
      background: 'circle',
    })
  })

  it('rejects empty, oversized, and non-string seeds', () => {
    assert.throws(() => parseAvatarOptions({ seed: '' }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ seed: 'x'.repeat(65) }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ seed: 3 }), AvatarOptionsError)
  })

  it('rejects hue and tone outside their ranges', () => {
    assert.throws(() => parseAvatarOptions({ hue: -1 }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ hue: 361 }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ hue: Number.NaN }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ tone: 1 }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ tone: -0.1 }), AvatarOptionsError)
    assert.throws(() => parseAvatarOptions({ background: 'oval' }), AvatarOptionsError)
  })
})

describe('avatarSeed', () => {
  it('prefers a stored seed, then username, then id', () => {
    assert.equal(avatarSeed({ username: 'ada', id: 3 }, { seed: 'rerolled' }), 'rerolled')
    assert.equal(avatarSeed({ username: 'ada', id: 3 }), 'ada')
    assert.equal(avatarSeed({ id: 3 }), '3')
    assert.equal(avatarSeed({}), 'omnimux')
  })
})

describe('renderAvatarUri', () => {
  it('is deterministic for the same seed and options', () => {
    const a = renderAvatarUri('ada', { hue: 210 })
    const b = renderAvatarUri('ada', { hue: 210 })
    const c = renderAvatarUri('ada', { hue: 12 })
    assert.match(a, /^data:image\/svg\+xml,/)
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.equal(renderAvatarUri('ada') === renderAvatarUri('adb'), false)
  })
})

describe('buildAvatarView', () => {
  it('renders a default view from the username and marks it as default', () => {
    const view = buildAvatarView({ username: 'ada', id: 3 })
    assert.equal(view.using_default, true)
    assert.equal(view.name, 'ada')
    assert.equal(view.uri, renderAvatarUri('ada'))
    assert.deepEqual(view.opts, {})
  })

  it('returns a stored snapshot URI without re-rendering', () => {
    const view = buildAvatarView({ username: 'ada' }, {
      snapshot_uri: 'data:image/svg+xml,%3Csvg%3Ekept%3C/svg%3E',
      hue: 12,
    })
    assert.equal(view.using_default, false)
    assert.equal(view.uri, 'data:image/svg+xml,%3Csvg%3Ekept%3C/svg%3E')
    assert.deepEqual(view.opts, { hue: 12 })
  })

  it('exports the hue presets the picker uses', () => {
    assert.deepEqual(HUES, [12, 90, 150, 210, 280, 320])
    assert.deepEqual(buildAvatarOptions({ hue: 12, extra: 1 }), { hue: 12 })
  })
})
