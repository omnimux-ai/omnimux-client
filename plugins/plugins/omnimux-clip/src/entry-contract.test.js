import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Boot-crash regression guards (#70/#73 family): every cordis entry module of
 * omnimux-clip must statically declare the services its apply() reads.
 * "cannot get property X without inject" = a missing declaration here.
 */
const here = dirname(fileURLToPath(import.meta.url))

function readSource(rel) {
  return readFileSync(join(here, rel), 'utf8')
}

describe('cordis entry inject contracts', () => {
  it('host entry declares tools and systemPrompt', async () => {
    const mod = await import('./index.js')
    assert.deepEqual(mod.inject, ['tools', 'systemPrompt'])
  })

  it('client entry declares slots and locale (no undeclared ctx.locale read)', () => {
    const src = readSource('client/index.js')
    assert.match(src, /export const inject = \['slots', 'locale'\]/)
    // forbid any ctx.<service> read that is not declared above or a nested
    // ctx.inject(...) callback (legal late binding)
    const declared = new Set(['slots', 'locale', 'effect', 'provide', 'name'])
    for (const match of src.matchAll(/ctx\.([a-zA-Z_$][\w$]*)/g)) {
      assert.ok(
        declared.has(match[1]) || match[1] === 'inject',
        `client/index.js reads undeclared service: ctx.${match[1]}`,
      )
    }
  })

  it('host entry has no direct ctx service reads beyond declared/nested injects', () => {
    const src = readSource('index.js')
    const declared = new Set(['tools', 'systemPrompt', 'provide', 'effect', 'name'])
    for (const match of src.matchAll(/ctx\.([a-zA-Z_$][\w$]*)/g)) {
      assert.ok(
        declared.has(match[1]) || match[1] === 'inject',
        `index.js reads undeclared service: ctx.${match[1]}`,
      )
    }
  })

  it('compiled lib/client.js matches source inject declarations (bundle drift guard)', () => {
    const bundle = readFileSync(join(here, '../lib/client.js'), 'utf8')
    // Every service the source declares must appear in the compiled bundle's
    // own `var inject = [...]` — catches shipping a stale build.
    const srcInject = /export const inject = \[([^\]]+)\]/.exec(readSource('client/index.js'))
    assert.ok(srcInject, 'client/index.js must declare an inject array')
    for (const raw of srcInject[1].split(',')) {
      const svc = raw.trim().replace(/^['"]|['"]$/g, '')
      if (!svc) continue
      assert.ok(
        new RegExp(`inject\\s*=\\s*\\[[^\\]]*['"]${svc}['"]`).test(bundle),
        `lib/client.js is stale: missing declared inject "${svc}". Rebuild via node scripts/build-client.mjs`,
      )
    }
    // If the compiled apply reads ctx.locale, the declaration is mandatory.
    if (/ctx\.locale\b/.test(bundle)) {
      assert.match(bundle, /inject\s*=\s*\["slots",\s*"locale"\]/)
    }
  })
})
