import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import * as esbuild from 'esbuild'
import { marketRuntime } from './runtime-state.js'
import { getPlazaKeepAlive, setPlazaKeepAlive } from './keepalive.js'
import { fmt, iconSrc, initials, pluginUrl } from './format.js'
import { DETAIL_TABS, TRACE } from './constants.js'
import { apiCacheKey } from './api.js'
import { findComposer } from './composer.js'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_MODULES = [
  'runtime-state.js',
  'boot.js',
  'css.js',
  'portal.js',
  'format.js',
  'i18n.js',
  'constants.js',
  'api.js',
  'keepalive.js',
  'session-create.js',
  'skills-ui.js',
  'tool-views.js',
  'list-view.js',
  'settings.js',
  'marketplace.js',
  'plugins-column.js',
  'skill-plaza.js',
  'skill-picker.js',
  'composer.js',
  'experts.js',
  'connectors.js',
  'plaza-shell.js',
  'apply.js',
]

describe('omnimux-market client standard ES modules (Issue #333)', () => {
  it('concat-client.mjs bundles src/client/apply.js via esbuild entryPoints without fragment string concatenation', () => {
    const bundlerSrc = readFileSync(join(here, '../../scripts/concat-client.mjs'), 'utf8')
    assert.match(bundlerSrc, /entryPoints:\s*\[/)
    assert.match(bundlerSrc, /apply\.js/)
    assert.doesNotMatch(bundlerSrc, /\bFRAGMENTS\b/)
    assert.doesNotMatch(bundlerSrc, /\bstdin\s*:/)
  })

  it('every client module parses as standard ESM and contains explicit exports', () => {
    for (const file of CLIENT_MODULES) {
      const source = readFileSync(join(here, file), 'utf8')
      const transformed = esbuild.transformSync(source, {
        loader: 'js',
        format: 'esm',
        sourcefile: file,
      })
      assert.ok(transformed.code.length > 0, `${file} transformed cleanly`)
      assert.match(source, /^\s*export\s+/m, `${file} must declare explicit ES exports`)
    }
  })

  it('client ES module graph has zero import cycles', () => {
    const importRe = /^\s*import\s+[\s\S]*?\s+from\s+["'](\.\/[^"']+)["']/gm
    const adj = new Map()
    for (const file of CLIENT_MODULES) {
      const source = readFileSync(join(here, file), 'utf8')
      const deps = []
      for (const match of source.matchAll(importRe)) {
        const spec = match[1].replace(/^\.\//, '')
        if (CLIENT_MODULES.includes(spec)) deps.push(spec)
      }
      adj.set(file, deps)
    }
    const visited = new Set()
    const stack = new Set()
    const cycles = []
    function dfs(node, trail) {
      visited.add(node)
      stack.add(node)
      for (const next of adj.get(node) || []) {
        if (stack.has(next)) cycles.push([...trail.slice(trail.indexOf(next)), next])
        else if (!visited.has(next)) dfs(next, [...trail, next])
      }
      stack.delete(node)
    }
    for (const file of CLIENT_MODULES) {
      if (!visited.has(file)) dfs(file, [file])
    }
    assert.deepEqual(cycles, [], `unexpected ESM import cycle: ${cycles.map((c) => c.join(' -> ')).join('; ')}`)
  })

  it('skill-plaza.js removes legacy magic contract comments and uses ES imports for plaza/*', () => {
    const plazaSrc = readFileSync(join(here, 'skill-plaza.js'), 'utf8')
    for (const magic of ['// 结构契约：', '// 样式契约：', '// 领域契约：', '// 货架真源：', '// 规则真源：']) {
      assert.ok(!plazaSrc.includes(magic), `skill-plaza.js must not retain magic comment ${magic}`)
    }
    assert.doesNotMatch(plazaSrc, /\brequire\(["']\.\/plaza\//)
    assert.match(plazaSrc, /import \* as plazaUtils from "\.\/plaza\/plazaUtils\.js"/)
  })

  it('pure client ES modules import directly in native Node ESM and share runtime state', () => {
    const prev = getPlazaKeepAlive()
    try {
      setPlazaKeepAlive(false)
      assert.equal(getPlazaKeepAlive(), false)
      assert.equal(marketRuntime.plazaKeepAlive, false)
      setPlazaKeepAlive(true)
      assert.equal(getPlazaKeepAlive(), true)
    } finally {
      setPlazaKeepAlive(prev)
    }
    assert.equal(fmt(15000, () => 'en'), '15.0k')
    assert.equal(fmt(15000), '1.5 万')
    assert.equal(initials('SkillHub'), 'SK')
    assert.equal(typeof pluginUrl, 'function')
    assert.equal(iconSrc('data:image/png;base64,AA'), 'data:image/png;base64,AA')
    assert.ok(DETAIL_TABS.length >= 3)
    assert.equal(TRACE.length, 5)
    assert.equal(apiCacheKey('search', { q: 'x', refresh: true }), 'search:{"q":"x"}')
    assert.equal(findComposer(), null)
  })
})
