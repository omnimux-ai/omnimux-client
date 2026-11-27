import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { safeExternalHttpHref, safeMediaLinkHref } from './safe-href.js'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('omnimux-inspiration safe-href guards', () => {
  it('safeExternalHttpHref permits only http(s) URLs', () => {
    assert.equal(safeExternalHttpHref('https://x.com/user/status/1'), 'https://x.com/user/status/1')
    assert.equal(safeExternalHttpHref('http://example.com/post'), 'http://example.com/post')
    for (const bad of [
      'javascript:alert(document.domain)',
      'JAVASCRIPT:void(0)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/x',
      '/omnimux/inspiration/local/media/item/0',
      '',
      null,
    ]) {
      assert.equal(safeExternalHttpHref(bad), null, `expected ${String(bad)} to be rejected`)
    }
  })

  it('safeMediaLinkHref permits http(s) and same-origin local media routes while rejecting active schemes', () => {
    assert.equal(
      safeMediaLinkHref('/omnimux/inspiration/local/media/item-1/0'),
      '/omnimux/inspiration/local/media/item-1/0',
    )
    assert.equal(safeMediaLinkHref('https://cdn.example.com/photo.jpg'), 'https://cdn.example.com/photo.jpg')
    for (const bad of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'vbscript:1',
      'file:///tmp/x.png',
      '//evil.example/x.jpg',
      '/omnimux/inspiration/local/media/x\r\nSet-Cookie:a=b',
    ]) {
      assert.equal(safeMediaLinkHref(bad), null, `expected ${String(bad)} to be rejected`)
    }
  })

  it('is wired into InspirationPostDetail anchor elements', () => {
    const src = readFileSync(join(HERE, 'InspirationPostDetail.jsx'), 'utf8')
    assert.match(src, /safeExternalHttpHref\(item\.source_url\)/)
    assert.match(src, /safeMediaLinkHref\(image\.url\)/)
    assert.doesNotMatch(src, /href=\{item\.source_url\}/)
    assert.doesNotMatch(src, /href=\{image\.url\}/)
  })
})
