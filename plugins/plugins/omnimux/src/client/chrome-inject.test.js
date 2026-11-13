/**
 * 回归：installHubChrome 不得在顶层读 ctx.layout / ctx.sessions / ctx.betterSidebar。
 * 可选依赖只能 ctx.inject([...])；未 inject 的 Cordis Proxy 会直接 throw。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const chromeSource = readFileSync(join(here, 'chrome.js'), 'utf8')
const indexSource = readFileSync(join(here, 'index.js'), 'utf8')

describe('hub chrome optional inject', () => {
  it('keeps top-level inject to slots + locale only', () => {
    assert.match(indexSource, /export const inject = \['slots', 'locale'\]/)
    assert.doesNotMatch(indexSource, /export const inject = \[[^\]]*(layout|sessions|betterSidebar)/)
  })

  it('binds workbench services through ctx.inject, never ctx.layout at apply time', () => {
    assert.match(chromeSource, /installWorkbenchGlobal/)
    assert.match(chromeSource, /ctx\.inject\(\['layout', 'sessions'\]/)
    assert.match(chromeSource, /ctx\.inject\(\['betterSidebar'\]/)
    assert.doesNotMatch(chromeSource, /ctx\.layout/)
    assert.doesNotMatch(chromeSource, /ctx\.sessions/)
    assert.doesNotMatch(chromeSource, /ctx\.betterSidebar/)
  })

  it('installs the left-rail observer so gui width tracks expand/collapse', () => {
    assert.match(chromeSource, /installWorkbenchLeftRailObserver/)
    assert.match(chromeSource, /hydrateConversationCollapsed/)
    assert.match(chromeSource, /ensureConversationCollapseChrome/)
  })

  it('installs the split conversation min clamp with cleanup', () => {
    assert.match(chromeSource, /installSplitConversationMin/)
    assert.match(chromeSource, /unsubSplitMin/)
  })

  it('installs the composer-compact chrome and density observer', () => {
    assert.match(chromeSource, /ensureComposerCompactChrome/)
    assert.match(chromeSource, /installComposerCompactObserver/)
    assert.match(chromeSource, /composer-compact\.js/)
  })

  it('installs the topbar sidebar toggle with cleanup', () => {
    assert.match(chromeSource, /installSidebarToggleTopbar/)
    assert.match(chromeSource, /sidebar-toggle-topbar\.js/)
    assert.match(chromeSource, /unsubSidebarTopbar/)
  })
})
