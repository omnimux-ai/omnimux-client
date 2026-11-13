import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLIP_STATUS_BY_CODE,
  ClipDomainError,
  clipErrorStatus,
  isClipDomainError,
} from './errors.js'

describe('ClipDomainError', () => {
  it('carries a stable code and message', () => {
    const error = new ClipDomainError('timeline_gap', 'gap at 1200ms')
    assert.equal(error.name, 'ClipDomainError')
    assert.equal(error.code, 'timeline_gap')
    assert.equal(error.message, 'gap at 1200ms')
    assert.ok(error instanceof Error)
    assert.equal(isClipDomainError(error), true)
  })

  it('exposes static factories for every frozen code', () => {
    const cases = [
      ['needsClipPlugin', 'needs-clip-plugin'],
      ['exportEncodeFailed', 'export-encode-failed'],
      ['previewNotReady', 'PREVIEW_NOT_READY'],
      ['timelineGap', 'timeline_gap'],
      ['clipOverlap', 'clip_overlap'],
      ['mediaMissing', 'media_missing'],
      ['schemaTooLarge', 'schema-too-large'],
      ['canceled', 'canceled'],
      ['pathDenied', 'path-denied'],
      ['notFound', 'not-found'],
      ['invalidJson', 'invalid-json'],
      ['invalidId', 'invalid-id'],
    ]
    for (const [method, code] of cases) {
      const error = ClipDomainError[method]()
      assert.equal(error.code, code, method)
      assert.equal(error.name, 'ClipDomainError')
      assert.ok(error.message.length > 0)
    }
  })

  it('maps codes to HTTP status', () => {
    assert.equal(clipErrorStatus(ClipDomainError.previewNotReady()), 409)
    assert.equal(clipErrorStatus(ClipDomainError.notFound()), 404)
    assert.equal(clipErrorStatus(ClipDomainError.pathDenied()), 403)
    assert.equal(clipErrorStatus(ClipDomainError.schemaTooLarge()), 413)
    assert.equal(clipErrorStatus(new Error('boom')), 500)
    assert.equal(CLIP_STATUS_BY_CODE['needs-clip-plugin'], 503)
  })
})
