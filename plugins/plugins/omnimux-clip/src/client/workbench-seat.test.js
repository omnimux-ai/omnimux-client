import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('clip workbench seat (sidebar must not claim overlay)', () => {
  it('sidebar entry uses the workbench store, not the product stage', () => {
    const source = readFileSync(join(here, 'sidebar-entry.js'), 'utf8')
    assert.match(source, /createClipWorkbenchStore/)
    assert.match(source, /stageStore: createClipWorkbenchStore\(t\)/)
    const storeSource = readFileSync(join(here, 'workbench-store.js'), 'utf8')
    assert.match(storeSource, /createSidebarStore/)
    assert.doesNotMatch(storeSource, /closePanel/)
    assert.doesNotMatch(source, /stageStore: stage/)
    assert.doesNotMatch(source, /claimProductStage/)
  })

  it('client apply keeps the studio tab but does not mount the left sidebar row', () => {
    const source = readFileSync(join(here, 'index.js'), 'utf8')
    assert.doesNotMatch(source, /mountSidebarEntry\(/)
    assert.match(source, /id: 'omnimux-clip:studio'/)
    assert.match(source, /__omnimuxWorkbench/)
  })

  it('stage store no longer restores a leftover product-stage claim', () => {
    const source = readFileSync(join(here, 'stage-store.js'), 'utf8')
    assert.doesNotMatch(source, /omnimux_active_product_stage/)
  })

  it('stage component has no in-tab FocusBar and does not claim overlay', () => {
    const stage = readFileSync(join(here, 'OpenReelStudioTab.jsx'), 'utf8')
    assert.doesNotMatch(stage, /WorkbenchFocusBar/)
    assert.doesNotMatch(stage, /omnimux-workbench-focus/)
    assert.doesNotMatch(stage, /claimProductStage/)
  })
})
