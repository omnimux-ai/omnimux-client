import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('inspiration workbench seat (sidebar must not claim overlay)', () => {
  it('sidebar entry uses the workbench store, not the product stage', () => {
    const source = readFileSync(join(here, 'sidebar-entry.js'), 'utf8')
    assert.match(source, /createSidebarStore/)
    assert.match(source, /omnimux-inspiration:library/)
    assert.doesNotMatch(source, /claimProductStage/)
  })

  it('client apply mounts the sidebar with a null product stage and registers tab', () => {
    const source = readFileSync(join(here, 'index.js'), 'utf8')
    assert.match(source, /mountSidebarEntry\(null, t, ctx\.locale\)/)
    assert.match(source, /id: INSPIRATION_TAB_ID/)
    assert.match(source, /registerInspirationTab/)
    assert.doesNotMatch(source, /slots\.inject\('shell\.overlay'/)
  })

  it('stage component has no in-tab FocusBar and does not claim overlay', () => {
    const stage = readFileSync(join(here, 'InspirationStage.jsx'), 'utf8')
    assert.doesNotMatch(stage, /WorkbenchFocusBar/)
    assert.doesNotMatch(stage, /omnimux-workbench-focus/)
    assert.doesNotMatch(stage, /claimProductStage/)
  })
})
