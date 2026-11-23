import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountMaxMediaItems,
  accountPublishMode,
  pickAccountCapabilities,
  resolveSelectionPublishMode,
} from './tiktok-capabilities.js'

describe('pickAccountCapabilities', () => {
  it('whitelists boolean flags and optional positive integer media limits', () => {
    assert.deepEqual(
      pickAccountCapabilities({
        upload_draft: true,
        publish_direct: false,
        max_media_items: 10,
        max_images: 10,
        secret: 'nope',
      }),
      { upload_draft: true, publish_direct: false, max_media_items: 10, max_images: 10 },
    )
    assert.deepEqual(
      pickAccountCapabilities({
        upload_draft: true,
        publish_direct: false,
        max_media_items: 0,
        max_images: 3.5,
      }),
      { upload_draft: true, publish_direct: false },
    )
    assert.equal(pickAccountCapabilities(null), undefined)
    assert.equal(pickAccountCapabilities([]), undefined)
    assert.equal(pickAccountCapabilities({ upload_draft: 'yes' }), undefined)
  })
})

describe('accountMaxMediaItems', () => {
  it('reads explicit server-supplied limit and ignores invalid values', () => {
    assert.equal(accountMaxMediaItems({ capabilities: { upload_draft: true, max_media_items: 10 } }), 10)
    assert.equal(accountMaxMediaItems({ capabilities: { upload_draft: true, max_images: 12 } }), 12)
    assert.equal(accountMaxMediaItems({ capabilities: { upload_draft: true, max_media_items: 10, max_images: 35 } }), 10)
    assert.equal(accountMaxMediaItems({ capabilities: { upload_draft: true } }), undefined)
    assert.equal(accountMaxMediaItems({}), undefined)
  })
})

describe('accountPublishMode & resolveSelectionPublishMode', () => {
  it('classifies single accounts deterministically', () => {
    assert.equal(accountPublishMode({ capabilities: { upload_draft: true, publish_direct: false } }), 'draft_only')
    assert.equal(accountPublishMode({ capabilities: { upload_draft: true, publish_direct: true } }), 'direct')
    assert.equal(accountPublishMode({ capabilities: { upload_draft: false, publish_direct: false } }), 'no_publish_scope')
    assert.equal(accountPublishMode({ id: 'legacy' }), 'legacy_unknown')
  })

  it('resolves selection precedence: no_publish_scope > direct > draft_only > legacy_unknown', () => {
    const draft = { capabilities: { upload_draft: true, publish_direct: false } }
    const direct = { capabilities: { upload_draft: true, publish_direct: true } }
    const noScope = { capabilities: { upload_draft: false, publish_direct: false } }
    const legacy = { id: 'legacy' }

    assert.equal(resolveSelectionPublishMode([]), 'legacy_unknown')
    assert.equal(resolveSelectionPublishMode([draft]), 'draft_only')
    assert.equal(resolveSelectionPublishMode([draft, direct]), 'direct')
    assert.equal(resolveSelectionPublishMode([direct, noScope]), 'no_publish_scope')
    assert.equal(resolveSelectionPublishMode([draft, legacy]), 'legacy_unknown')
  })
})
