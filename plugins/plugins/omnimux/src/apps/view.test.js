import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { buildAppsView, buildInstalledAppsView, readInstalledVersion } from './view.js'

const catalog = {
  schema: /** @type {1} */ (1),
  generated_at: '2026-08-17T00:00:00Z',
  min_hub: '0.1.0',
  apps: [
    {
      id: 'accounts',
      title: '账号',
      summary: '查看并连接已绑定的社媒账号',
      kind: /** @type {'official'} */ ('official'),
      listed: true,
      capabilities: ['identity'],
      client: true,
      spec: { source: /** @type {'npm'} */ ('npm'), name: 'omnimux-accounts', version: '0.1.0' },
    },
    {
      id: 'hidden',
      title: '隐藏',
      summary: '未上架',
      kind: /** @type {'official'} */ ('official'),
      listed: false,
      capabilities: [],
      client: true,
      spec: { source: /** @type {'npm'} */ ('npm'), name: 'dsh-hidden', version: '0.1.0' },
    },
    {
      id: 'host-only',
      title: '工具',
      summary: '没有 WebUI',
      kind: /** @type {'official'} */ ('official'),
      listed: true,
      capabilities: [],
      client: false,
      spec: { source: /** @type {'npm'} */ ('npm'), name: 'dsh-host-only', version: '0.1.0' },
    },
  ],
}

describe('buildAppsView', () => {
  it('omits unlisted and host-only rows', () => {
    const view = buildAppsView({ catalog, bundles: ['dsh-cron-parse'] })
    assert.deepEqual(view.apps.map((app) => app.id), ['accounts'])
    assert.equal(view.apps[0].state, 'available')
    assert.equal(view.apps[0].install_spec, 'omnimux-accounts@0.1.0')
  })

  it('marks a pinned npm row installed or update from the on-disk version', () => {
    const installed = buildAppsView({
      catalog,
      bundles: ['omnimux-accounts'],
      versions: { 'omnimux-accounts': '0.1.0' },
    })
    assert.equal(installed.apps[0].state, 'installed')
    const update = buildAppsView({
      catalog,
      bundles: ['omnimux-accounts'],
      versions: { 'omnimux-accounts': '0.0.9' },
    })
    assert.equal(update.apps[0].state, 'update')
  })
})

describe('buildInstalledAppsView', () => {
  it('does not invent cards from unmarked profile bundles', () => {
    const view = buildInstalledAppsView({
      catalog,
      home: '/tmp',
      profile: 'omnimux',
      readBundles: () => [{ name: 'dsh-cron-parse' }, { name: 'omnimux' }],
      readVersion: () => '1.0.0',
    })
    assert.deepEqual(view.apps.map((app) => app.id), ['accounts'])
    assert.equal(view.apps[0].state, 'available')
  })

  it('reads the installed version from the profile node_modules tree', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-apps-view-'))
    const pkg = join(home, 'profiles', 'omnimux', 'node_modules', 'omnimux-accounts')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'omnimux-accounts', version: '0.1.0' }))
    assert.equal(readInstalledVersion(home, 'omnimux', 'omnimux-accounts'), '0.1.0')
    const view = buildInstalledAppsView({
      catalog,
      home,
      profile: 'omnimux',
      readBundles: () => [{ name: 'omnimux-accounts' }],
    })
    assert.equal(view.apps[0].state, 'installed')
  })
})
