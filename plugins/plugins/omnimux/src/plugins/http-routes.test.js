import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createPluginDispatcher } from './http-routes.js'
import { resolveBundledInstall } from './manage.js'
import { createTabsStore } from '../apps/tabs.js'

function profileHome(bundles) {
  const home = mkdtempSync(join(tmpdir(), 'omnimux-plugins-http-'))
  mkdirSync(join(home, 'profiles', 'omnimux'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'omnimux', 'package.json'), JSON.stringify({
    dsh: { profile: { bundles } },
  }))
  return home
}

function okSpawn() {
  const calls = []
  const spawn = (...args) => {
    calls.push(args)
    return { status: 0, stdout: '', stderr: '' }
  }
  return { calls, spawn }
}

describe('plugin dispatcher installs', () => {
  it('adds a bundle and returns the refreshed profile list', () => {
    const home = profileHome(['@deepseek-ai/dsh-base'])
    const { spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'dsh-cron-parse@1.0.0' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.ok(Array.isArray(result.body.plugins))
  })

  it('installs a bundled row from bundledDir by path, not the registry', () => {
    const home = profileHome(['@deepseek-ai/dsh-base'])
    const bundledDir = join(home, 'bundled')
    mkdirSync(join(bundledDir, 'omnimux-accounts'), { recursive: true })
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      bundledDir,
      appsView: () => [
        { id: 'accounts', title: '账号', spec: { name: 'omnimux-accounts', source: 'bundled' } },
      ],
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'omnimux-accounts' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.deepEqual(calls[0][1].slice(-2), ['add', join(bundledDir, 'omnimux-accounts')])
  })

  it('falls back to the profile copy when bundledDir has no package', () => {
    const home = profileHome(['@deepseek-ai/dsh-base'])
    const copy = join(home, 'profiles', 'omnimux', 'node_modules', 'omnimux-accounts')
    mkdirSync(copy, { recursive: true })
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      bundledDir: '',
      appsView: () => [
        { id: 'accounts', title: '账号', spec: { name: 'omnimux-accounts', source: 'bundled' } },
      ],
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'omnimux-accounts' },
    })
    assert.equal(result.status, 200)
    // macOS resolves /var through /private/var; compare real paths.
    assert.equal(calls[0][1].slice(-1)[0], realpathSync(copy))
  })

  it('rejects a bundled row that is not on disk with a clear error', () => {
    const home = profileHome(['@deepseek-ai/dsh-base'])
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      appsView: () => [
        { id: 'accounts', title: '账号', spec: { name: 'omnimux-accounts', source: 'bundled' } },
      ],
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'omnimux-accounts' },
    })
    assert.equal(result.status, 400)
    assert.match(result.body.error, /not on disk/)
    assert.equal(calls.length, 0)
  })

  it('keeps the registry path for npm rows and unknown names', () => {
    const home = profileHome(['@deepseek-ai/dsh-base'])
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      appsView: () => [
        { id: 'npm-app', title: 'npm', spec: { name: 'dsh-some-npm-app', source: 'npm', version: '1.0.0' } },
      ],
    })
    const result = dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'dsh-some-npm-app@1.0.0' },
    })
    assert.equal(result.status, 200)
    assert.deepEqual(calls[0][1].slice(-2), ['add', 'dsh-some-npm-app@1.0.0'])
  })
})

describe('resolveBundledInstall', () => {
  it('prefers bundledDir, then the profile copy, else undefined', () => {
    const preset = '/preset'
    const profile = '/home/profiles/omnimux'
    assert.equal(
      resolveBundledInstall({ name: 'x', bundledDir: preset, profileDir: profile, exists: (p) => p === '/preset/x' }),
      '/preset/x',
    )
    assert.equal(
      resolveBundledInstall({
        name: 'x',
        bundledDir: preset,
        profileDir: profile,
        exists: (p) => p === join(profile, 'node_modules', 'x'),
        realpath: (p) => `/real${p}`,
      }),
      `/real${join(profile, 'node_modules', 'x')}`,
    )
    assert.equal(
      resolveBundledInstall({ name: 'x', bundledDir: preset, profileDir: profile, exists: () => false }),
      undefined,
    )
  })
})

describe('plugin dispatcher uninstalls', () => {
  it('removes a bundle and returns the refreshed profile list', () => {
    const home = profileHome(['@deepseek-ai/dsh-base', 'dsh-better-sidebar'])
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
    })
    const result = dispatcher.dispatch({ method: 'DELETE', url: '/omnimux/plugins/dsh-better-sidebar' })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0][1].slice(-2), ['remove', 'dsh-better-sidebar'])
  })

  it('removes the app tab that maps to the uninstalled bundle', () => {
    const home = profileHome(['omnimux-accounts'])
    const { spawn } = okSpawn()
    const tabsStore = createTabsStore({ home, now: () => 0 })
    tabsStore.upsert('accounts')
    tabsStore.upsert('some-other-app')
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      appsView: () => [
        { id: 'accounts', title: '账号', spec: { name: 'omnimux-accounts' } },
        { id: 'other-app', title: '其他', spec: { name: 'dsh-other-app' } },
      ],
      tabsRemove: (id) => { tabsStore.remove(id) },
    })
    const result = dispatcher.dispatch({ method: 'DELETE', url: '/omnimux/plugins/omnimux-accounts' })
    assert.equal(result.status, 200)
    assert.deepEqual(tabsStore.list().tabs.map((row) => row.id), ['some-other-app'])
  })

  it('keeps the uninstall response when tab cleanup throws', () => {
    const home = profileHome(['omnimux-accounts'])
    const { spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      appsView: () => [{ id: 'accounts', title: '账号', spec: { name: 'omnimux-accounts' } }],
      tabsRemove() {
        throw new Error('tab store exploded')
      },
    })
    const result = dispatcher.dispatch({ method: 'DELETE', url: '/omnimux/plugins/omnimux-accounts' })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
  })

  it('refuses to remove a protected bundle without spawning', () => {
    const home = profileHome(['@deepseek-ai/dsh-base', 'omnimux'])
    const { calls, spawn } = okSpawn()
    const removed = []
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
      appsView: () => [{ id: 'hub', title: 'hub', spec: { name: 'omnimux' } }],
      tabsRemove: (id) => { removed.push(id) },
    })
    for (const name of ['omnimux', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
      const result = dispatcher.dispatch({ method: 'DELETE', url: `/omnimux/plugins/${encodeURIComponent(name)}` })
      assert.equal(result.status, 400, name)
      assert.match(result.body.error, /cannot be removed/)
    }
    assert.equal(calls.length, 0)
    assert.deepEqual(removed, [])
  })

  it('refuses a cross-origin uninstall', () => {
    const home = profileHome(['dsh-better-sidebar'])
    const { calls, spawn } = okSpawn()
    const dispatcher = createPluginDispatcher({
      env: { DSH_HOME: home, OMNIMUX_DSH_CLI: '/cli', OMNIMUX_PLUGIN_PROFILE: 'omnimux' },
      spawn,
    })
    const result = dispatcher.dispatch({
      method: 'DELETE',
      url: '/omnimux/plugins/dsh-better-sidebar',
      origin: 'https://evil.example',
    })
    assert.equal(result.status, 403)
    assert.equal(calls.length, 0)
  })
})
