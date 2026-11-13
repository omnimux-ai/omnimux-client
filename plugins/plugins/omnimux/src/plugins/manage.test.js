import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { assertNpmSpec, assertRemovable, readProfilePlugins, resolvePluginCli } from './manage.js'
import { createPluginDispatcher } from './http-routes.js'

describe('assertNpmSpec', () => {
  it('accepts a registry name and version', () => {
    assert.equal(assertNpmSpec('dsh-cron-parse'), 'dsh-cron-parse')
    assert.equal(assertNpmSpec('dsh-cron-parse@1.2.3'), 'dsh-cron-parse@1.2.3')
    assert.equal(assertNpmSpec('@scope/pkg@1.0.0'), '@scope/pkg@1.0.0')
  })

  it('rejects filesystem and git specs', () => {
    assert.throws(() => assertNpmSpec('file:./plugin'), /only npm package names/)
    assert.throws(() => assertNpmSpec('link:/tmp/x'), /only npm package names/)
    assert.throws(() => assertNpmSpec('git+https://example.com/x.git'), /only npm package names/)
    assert.throws(() => assertNpmSpec('../evil'), /only npm package names/)
  })
})

describe('assertRemovable', () => {
  it('protects the hub and official web bundles', () => {
    assert.throws(() => assertRemovable('omnimux'), /cannot be removed/)
    assert.throws(() => assertRemovable('@deepseek-ai/dsh-base'), /cannot be removed/)
    assert.doesNotThrow(() => assertRemovable('dsh-better-sidebar'))
  })
})

describe('plugin dispatcher', () => {
  it('reports unavailable when the desktop CLI env is absent', () => {
    const dispatcher = createPluginDispatcher({ env: {} })
    const result = dispatcher.dispatch({ method: 'GET', url: '/omnimux/plugins' })
    assert.equal(result.status, 200)
    assert.equal(result.body.available, false)
    assert.deepEqual(result.body.plugins, [])
  })

  it('lists profile bundles when the desktop CLI env is set', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-plugins-'))
    mkdirSync(join(home, 'profiles', 'omnimux'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'omnimux', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'omnimux', 'dsh-better-sidebar'] } },
    }))
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
    })
    const result = dispatcher.dispatch({ method: 'GET', url: '/omnimux/plugins' })
    assert.equal(result.body.available, true)
    assert.equal(result.body.plugins[0].protected, true)
    assert.equal(result.body.plugins[2].protected, false)
  })

  it('refuses a file spec without spawning', () => {
    const spawn = () => {
      throw new Error('should not spawn')
    }
    const dispatcher = createPluginDispatcher({
      env: { OMNIMUX_DSH_CLI: '/cli' },
      spawn,
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'file:./x' },
    })
    assert.equal(result.status, 400)
    assert.match(result.body.error, /only npm package names/)
  })

  it('refuses a cross-origin install', () => {
    const dispatcher = createPluginDispatcher({
      env: { OMNIMUX_DSH_CLI: '/cli' },
      spawn() { throw new Error('should not spawn') },
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      origin: 'https://evil.example',
      body: { spec: 'dsh-cron-parse@1.0.0' },
    })
    assert.equal(result.status, 403)
  })
})

describe('resolvePluginCli', () => {
  it('is absent without OMNIMUX_DSH_CLI', () => {
    assert.equal(resolvePluginCli({}), undefined)
  })
})

void readProfilePlugins
