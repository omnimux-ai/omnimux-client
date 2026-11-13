import assert from 'node:assert/strict'
import test from 'node:test'
import { withDefaults } from '../config-store.js'
import { isProtectedBundle } from '../plugin-market.js'
import { createPluginTools, type PluginToolDeps } from '../plugin-tools.js'
import type { MarketPlugin, PluginInstallResult, PluginPage } from '../plugin-market.js'
import type { PluginConfig } from '../types.js'

function plugin(partial: Partial<MarketPlugin> & Pick<MarketPlugin, 'owner' | 'name'>): MarketPlugin {
  return {
    fullName: `${partial.owner}/${partial.name}`,
    description: '',
    stars: 0,
    categoryKey: 'web-tools',
    installability: 'verified',
    repositoryUrl: `https://github.com/${partial.owner}/${partial.name}`,
    avatarUrl: '',
    installed: false,
    ...partial,
  }
}

function page(items: MarketPlugin[]): PluginPage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: items.length || 6,
    apiBase: 'https://api.skillhub.cn',
    webBase: 'https://skillhub.cn',
  }
}

function makeDeps(overrides: Partial<PluginToolDeps> = {}) {
  const cfg = withDefaults({})
  const calls: { lock: number; remove: string[]; install: Array<{ owner: string; name: string }> } = {
    lock: 0,
    remove: [],
    install: [],
  }
  let chain = Promise.resolve()
  const deps: PluginToolDeps = {
    cfg: () => cfg,
    lock: async <T>(fn: () => Promise<T>) => {
      calls.lock += 1
      const run = chain.then(fn, fn)
      chain = run.then(() => undefined, () => undefined)
      return run
    },
    listPlugins: async () => page([]),
    installMarketPlugin: async (ref) => {
      calls.install.push({ owner: String(ref.owner), name: String(ref.name) })
      return {
        fullName: `${ref.owner}/${ref.name}`,
        source: `github:${ref.owner}/${ref.name}#abcdef0`,
        restartedHint: true,
        log: 'ok',
      } satisfies PluginInstallResult
    },
    removeDshPlugin: async (name) => {
      calls.remove.push(name)
      return 'removed'
    },
    readInstalled: () => ({ 'dsh-better-sidebar': '^1.0.0', omnimux: 'file:./omnimux' }),
    isProtected: (name) => isProtectedBundle(name, cfg.protectedBundlesExtra),
    ...overrides,
  }
  const tools = Object.fromEntries(createPluginTools(deps).map((t) => [t.name, t]))
  return { cfg, deps, tools, calls }
}

test('plugin_search clamps limit to 8', async () => {
  let seenPageSize = 0
  const { tools } = makeDeps({
    listPlugins: async (_cfg: PluginConfig, query = {}) => {
      seenPageSize = Number(query.pageSize)
      return page(Array.from({ length: 20 }, (_, i) => plugin({ owner: 'o', name: `p${i}` })))
    },
  })
  const result = await tools.plugin_search.execute({ query: 'sidebar', limit: 99 }) as { items: unknown[] }
  assert.equal(seenPageSize, 8)
  assert.equal(result.items.length, 8)
  assert.equal((result as { ok?: boolean }).ok, undefined)
})

test('plugin_install goes through lock and never restarts', async () => {
  const { tools, calls } = makeDeps({
    listPlugins: async () => page([plugin({ owner: 'liustack', name: 'modlens', installability: 'verified' })]),
  })
  const result = await tools.plugin_install.execute({ owner: 'liustack', name: 'modlens' }) as Record<string, unknown>
  assert.equal(calls.lock, 1)
  assert.deepEqual(calls.install, [{ owner: 'liustack', name: 'modlens' }])
  assert.equal(result.restartRequired, true)
  assert.equal(result.installed, true)
  assert.equal((result as { ok?: boolean }).ok, undefined)
})

test('plugin_install rejects unverified plugins', async () => {
  const { tools, calls } = makeDeps({
    listPlugins: async () => page([plugin({ owner: 'o', name: 'n', installability: 'unsupported' })]),
  })
  await assert.rejects(() => tools.plugin_install.execute({ owner: 'o', name: 'n' }), /not a verified plugin/)
  assert.equal(calls.install.length, 0)
})

test('plugin_uninstall blocks core bundles without calling remove', async () => {
  const { tools, calls } = makeDeps()
  await assert.rejects(() => tools.plugin_uninstall.execute({ name: 'omnimux' }), /cannot be removed/)
  await assert.rejects(() => tools.plugin_uninstall.execute({ name: '@deepseek-ai/dsh-base' }), /cannot be removed/)
  await assert.rejects(() => tools.plugin_uninstall.execute({ name: 'omnimux-market' }), /cannot be removed/)
  assert.equal(calls.remove.length, 0)
  assert.equal(calls.lock, 0)
})

test('plugin_uninstall throws when not installed', async () => {
  const { tools, calls } = makeDeps()
  await assert.rejects(() => tools.plugin_uninstall.execute({ name: 'dsh-missing' }), /not installed/)
  assert.equal(calls.remove.length, 0)
})

test('plugin_uninstall lock serializes and does not return {ok:false}', async () => {
  const order: string[] = []
  const { tools } = makeDeps({
    readInstalled: () => ({ 'dsh-better-sidebar': '^1.0.0', 'dsh-other': '^1.0.0' }),
    removeDshPlugin: async (name) => {
      if (name === 'dsh-better-sidebar') await new Promise((r) => setTimeout(r, 20))
      order.push(name)
      return 'ok'
    },
  })
  const first = tools.plugin_uninstall.execute({ name: 'dsh-better-sidebar' })
  const second = tools.plugin_uninstall.execute({ name: 'dsh-other' })
  const results = await Promise.all([first, second]) as Array<Record<string, unknown>>
  assert.deepEqual(order, ['dsh-better-sidebar', 'dsh-other'])
  assert.equal(results[0].ok, undefined)
  assert.equal(results[0].restartRequired, true)
})

test('plugin_list marks protected bundles', async () => {
  const { tools } = makeDeps()
  const result = await tools.plugin_list.execute({}) as { items: Array<{ name: string; protected: boolean }> }
  const byName = Object.fromEntries(result.items.map((it) => [it.name, it.protected]))
  assert.equal(byName.omnimux, true)
  assert.equal(byName['dsh-better-sidebar'], false)
})
