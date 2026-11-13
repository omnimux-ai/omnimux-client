import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { STYLES } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))
const chips = readFileSync(join(here, 'chips.jsx'), 'utf8')

describe('Avatar freeze (referrerPolicy + fallback, no client cache)', () => {
  it('sets referrerPolicy="no-referrer" on the raster <img>', () => {
    assert.match(chips, /<img[\s\S]*referrerPolicy="no-referrer"/)
    assert.match(chips, /className="omnimux-accounts-avatar"/)
    assert.match(chips, /loading="lazy"/)
  })

  it('still flips to the letter fallback onError', () => {
    assert.match(chips, /onError=\{\(\) => \{ setFailed\(true\) \}\}/)
    assert.match(chips, /className="omnimux-accounts-avatar-fallback"/)
    assert.match(chips, /const \[failed, setFailed\] = useState\(false\)/)
  })

  it('does not persist avatars in IndexedDB or localStorage', () => {
    assert.doesNotMatch(chips, /indexedDB/)
    assert.doesNotMatch(chips, /localStorage/)
    assert.doesNotMatch(chips, /sessionStorage/)
  })
})

describe('Avatar geometry contract', () => {
  it('keeps the raster and fallback at 40×40', () => {
    assert.match(STYLES, /\.omnimux-accounts-avatar\s*\{[^}]*width:\s*40px;/)
    assert.match(STYLES, /\.omnimux-accounts-avatar\s*\{[^}]*height:\s*40px;/)
    assert.match(STYLES, /\.omnimux-accounts-avatar-fallback\s*\{[^}]*width:\s*40px;/)
    assert.match(STYLES, /\.omnimux-accounts-avatar-fallback\s*\{[^}]*height:\s*40px;/)
  })
})
