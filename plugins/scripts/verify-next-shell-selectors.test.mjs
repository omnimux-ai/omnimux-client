import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { auditDirectory, auditSource } from './verify-next-shell-selectors.mjs'

describe('verify-next-shell-selectors static dual-shell parity gate', () => {
  it('flags bare .dshDesktopRightbarSurface CSS rule missing Next shell twin (reproduces 236px black void bug)', () => {
    const bad = `
export const CSS = \`
.dshDesktopRightbarSurface [class*="_panel"] {
  left: 0 !important;
  width: 100% !important;
}
\`
`
    const violations = auditSource(bad, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'legacy-rightbar-surface-missing-next-twin')
  })

  it('passes when .dshDesktopRightbarSurface is paired with [data-rightbar-col] or [class*="rightbarCol"]', () => {
    const good = `
export const CSS = \`
.dshDesktopRightbarSurface [class*="_panel"],
[class*="frame"]:not([data-rightbar-collapsed="true"]) [data-rightbar-col] [class*="_panel"][data-sidebar-right-panel="push"][data-sidebar-right-open] {
  left: 0 !important;
  width: 100% !important;
}
\`
`
    assert.deepEqual(auditSource(good, 'sample.js'), [])
  })

  it('flags bare body[data-dsh-desktop-platform="darwin"] CSS rule missing html[data-platform="darwin"]', () => {
    const bad = `
export const CSS = \`
body[data-dsh-desktop-platform="darwin"] .dshUk-PageHeader-pageHeader {
  padding-left: 84px !important;
}
\`
`
    const violations = auditSource(bad, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'legacy-darwin-platform-missing-next-twin')
  })

  it('flags bare JS doc.querySelector(".dshDesktopFrame") without [class*="frame"] twin', () => {
    const bad = `
export function findFrame(doc) {
  return doc.querySelector('.dshDesktopFrame')
}
`
    const violations = auditSource(bad, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'js-legacy-frame-query-missing-next-twin')
  })

  it('passes when JS querySelector pairs .dshDesktopFrame with [class*="frame"] or declares legacy-shell-only', () => {
    const paired = `
export function findFrame(doc) {
  return doc.querySelector('.dshDesktopFrame, [class*="frame"]')
}
`
    const exempt = `
export function findLegacyOnly(doc) {
  // legacy-shell-only: test exemption for legacy AdvancedFrame
  return doc.querySelector('.dshDesktopFrame')
}
`
    assert.deepEqual(auditSource(paired, 'sample.js'), [])
    assert.deepEqual(auditSource(exempt, 'sample.js'), [])
  })

  it('does not let backticks inside JS comments break CSS template literal scanning', () => {
    const badWithCommentBackticks = `
// A comment with an odd backtick: \`something
/* Block comment with single backtick \` too */
export const CSS = \`
.dshDesktopRightbarSurface [class*="_panel"] {
  width: 100% !important;
}
\`
`
    const violations = auditSource(badWithCommentBackticks, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'legacy-rightbar-surface-missing-next-twin')
  })

  it('flags multi-line JS querySelector calling bare .dshDesktopFrame without [class*="frame"]', () => {
    const multilineBad = `
export function findFrame(doc) {
  return doc.querySelector(
    '.dshDesktopFrame'
  )
}
`
    const violations = auditSource(multilineBad, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'js-legacy-frame-query-missing-next-twin')
  })

  it('flags bare JS data-dsh-desktop-platform="darwin" lookup without html[data-platform="darwin"] / dataset.platform twin', () => {
    const bad = `
export function isMac(doc) {
  return Boolean(doc.body.matches('[data-dsh-desktop-platform="darwin"]'))
}
`
    const good = `
export function isMac(doc) {
  return doc.documentElement?.dataset?.platform === 'darwin'
    || Boolean(doc.body.matches('[data-dsh-desktop-platform="darwin"]'))
}
`
    const violations = auditSource(bad, 'sample.js')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'js-legacy-darwin-platform-query-missing-next-twin')
    assert.deepEqual(auditSource(good, 'sample.js'), [])
  })

  it('passes on the real plugins/omnimux/src/client tree with zero unpaired legacy selectors', () => {
    const { filesScanned, violations } = auditDirectory()
    assert.ok(filesScanned > 10, `expected >10 client files scanned, got ${filesScanned}`)
    assert.deepEqual(violations, [])
  })
})
