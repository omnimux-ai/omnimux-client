import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sectionSource = readFileSync(join(here, 'InspirationSection.jsx'), 'utf8')
const stylesSource = readFileSync(join(here, 'styles.js'), 'utf8')

describe('replicate CTA failure feedback', () => {
  it('mirrors non-replicating ctaStatus into the existing viewport toast', () => {
    assert.match(
      sectionSource,
      /const status = feed\.ctaStatus[\s\S]{0,200}if \(!status \|\| status === 'card\.cta\.replicating'\) return[\s\S]{0,120}showToast\(t\(status\)\)/,
      'replicate failures must go through showToast, not only #omnimux-inspiration-cta-status',
    )
    assert.match(sectionSource, /className=\{`omnimux-inspiration-toast/, 'the toast element must stay the existing product component')
  })

  it('keeps the toast fixed inside the viewport', () => {
    const toastRule = stylesSource.match(/\.omnimux-inspiration-toast \{([\s\S]*?)\}/)
    assert.ok(toastRule, '.omnimux-inspiration-toast styles must exist')
    assert.match(toastRule[1], /position:\s*fixed/)
    assert.match(toastRule[1], /top:\s*24px/)
    assert.match(toastRule[1], /z-index:\s*99999/)
  })

  it('keeps the aria-live status element for assistive tech', () => {
    assert.match(sectionSource, /id="omnimux-inspiration-cta-status"/)
    assert.match(sectionSource, /aria-live="polite"/)
  })
})
