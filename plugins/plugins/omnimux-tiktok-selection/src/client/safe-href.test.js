import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { safeExternalHref } from './safe-href.js'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('omnimux-tiktok-selection safeExternalHref', () => {
  it('permits explicit http and https URLs', () => {
    assert.equal(safeExternalHref('https://www.tiktok.com/@creator/video/123'), 'https://www.tiktok.com/@creator/video/123')
    assert.equal(safeExternalHref('http://example.com/item?id=1'), 'http://example.com/item?id=1')
  })

  it('rejects javascript:, data:, vbscript:, file:, protocol-relative, and malformed URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      '  JaVaScRiPt:alert(1)  ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/phish',
      '',
      null,
      undefined,
      123,
    ]) {
      assert.equal(safeExternalHref(bad), null, `expected ${String(bad)} to be rejected`)
    }
  })

  it('is wired into DiscoveryPanel reference video links', () => {
    const src = readFileSync(join(HERE, 'DiscoveryPanel.jsx'), 'utf8')
    assert.match(src, /href=\{safeExternalHref\(v\.url\)\}/)
    assert.doesNotMatch(src, /href=\{v\.url\}/)
  })
})
