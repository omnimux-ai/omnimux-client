import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('analytics workbench seat (sidebar must not claim overlay)', () => {
  it('sidebar entry uses the workbench store, not the product stage', () => {
    const source = readFileSync(join(here, 'sidebar-entry.js'), 'utf8')
    assert.match(source, /createWorkbenchSidebarEntry/)
    assert.match(source, /omnimux-analytics:library/)
    assert.doesNotMatch(source, /claimProductStage/)
  })

  it('client apply mounts the sidebar with a null product stage and registers tab', () => {
    const source = readFileSync(join(here, 'index.js'), 'utf8')
    assert.match(source, /mountSidebarEntry\(null, t, ctx\.locale\)/)
    assert.match(source, /id: ANALYTICS_TAB_ID/)
    assert.match(source, /registerAnalyticsTab/)
    assert.doesNotMatch(source, /slots\.inject\('shell\.overlay'/)
  })

  it('stage component has no in-tab FocusBar and does not claim overlay', () => {
    const stage = readFileSync(join(here, 'AnalyticsStage.jsx'), 'utf8')
    assert.doesNotMatch(stage, /WorkbenchFocusBar/)
    assert.doesNotMatch(stage, /omnimux-workbench-focus/)
    assert.doesNotMatch(stage, /claimProductStage/)
  })

  it('stage visibility refresh is independent of dashboard filter changes', () => {
    const stage = readFileSync(join(here, 'AnalyticsStage.jsx'), 'utf8')
    // A filter change is owned by the store. Only visibility reopens the dashboard.
    assert.doesNotMatch(stage, /\[visible,\s*analyticsStore\.query\]/)
    assert.match(stage, /if \(visible\) void refresh\(\)/)
    assert.match(stage, /\[visible, refresh\]/)
    assert.match(stage, /onChange=\{\(patch\) => analyticsStore\.setQuery\(patch\)\}/)
    assert.match(stage, /analyticsStore\.payload/)
    assert.doesNotMatch(stage, /analyticsStore\.data\b/)
  })
})
