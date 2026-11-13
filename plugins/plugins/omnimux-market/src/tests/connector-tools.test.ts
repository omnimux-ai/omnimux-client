import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createConnectorTools, type ConnectorToolDeps } from '../connector-tools.js'
import { findItem, installItem, removeMcpRow, withConnectorPatchLock } from '../expert/install.js'

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..')

function item(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    tab: 'connectors',
    kind: 'connector',
    title: '连接器',
    summary: 'mcp',
    category: 'cn-office',
    tags: [],
    serverName: 'demo',
    source: { type: 'mcp', transport: 'stdio', command: 'npx', args: [] },
    installed: false,
    ...partial,
  }
}

function catalog(items: Record<string, unknown>[]) {
  return { schema: 1, generated_at: 't', tabs: ['connectors'], categories: [], featured: [], items }
}

function roots() {
  const home = mkdtempSync(join(tmpdir(), 'omx-cn-'))
  const profileDir = join(home, 'profiles', 'omnimux')
  mkdirSync(profileDir, { recursive: true })
  return { home, profileDir, packageRoot: PACKAGE_ROOT }
}

function makeTools(opts: {
  items?: Record<string, unknown>[]
  market?: Array<{ id: string; name: string; installable: boolean; sourceKind: string }>
  env?: ReturnType<typeof roots>
  spyInstall?: typeof installItem
} = {}) {
  const env = opts.env ?? roots()
  const doc = catalog(opts.items ?? [
    item({ id: 'cn-tencent-docs', title: '腾讯文档', serverName: 'tencent-docs' }),
    item({ id: 'exp-prd', tab: 'experts', kind: 'expert', title: '产品通', skill: 'esc-demo-note', serverName: undefined, source: { type: 'bundled', path: 'catalog/skills/esc-demo-note/SKILL.md' } }),
  ])
  const installs: string[] = []
  const deps: ConnectorToolDeps = {
    roots: () => env,
    loadCatalog: () => doc,
    listMarketplace: () => ({ items: opts.market ?? [] }),
    installItem: opts.spyInstall ?? ((args) => {
      installs.push(args.id)
      return installItem(args)
    }),
    removeMcpRow,
    findItem,
    lock: withConnectorPatchLock,
  }
  const tools = Object.fromEntries(createConnectorTools(deps).map((t) => [t.name, t]))
  return { env, tools, doc, installs }
}

test('connector_search returns catalog connectors and display-only marketplace rows', async () => {
  const { tools } = makeTools({
    market: [{ id: 'wb-cli', name: 'CLI', installable: false, sourceKind: 'marketplace' }],
  })
  const result = await tools.connector_search.execute({ query: '' }) as { items: Array<Record<string, unknown>> }
  const ids = result.items.map((it) => it.id)
  assert.equal(ids.includes('cn-tencent-docs'), true)
  assert.equal(ids.includes('wb-cli'), true)
  const market = result.items.find((it) => it.id === 'wb-cli')
  assert.equal(market?.installable, false)
  assert.equal(market?.sourceKind, 'marketplace')
  assert.equal((result as { ok?: boolean }).ok, undefined)
})

test('connector_search clamps to 8', async () => {
  const items = Array.from({ length: 12 }, (_, i) => item({ id: `cn-x-${i}`, title: `连接器${i}`, serverName: `x${i}` }))
  const { tools } = makeTools({ items })
  const result = await tools.connector_search.execute({ limit: 99 }) as { items: unknown[] }
  assert.equal(result.items.length, 8)
})

test('connector_install writes MCP row for catalog connector', async () => {
  const env = roots()
  writeFileSync(join(env.profileDir, 'cordis.patch.yml'), '[]\n')
  const { tools, installs } = makeTools({ env })
  const result = await tools.connector_install.execute({ id: 'cn-tencent-docs' }) as Record<string, unknown>
  assert.equal(result.id, 'cn-tencent-docs')
  assert.equal(result.installed, true)
  assert.equal(result.restartRequired, true)
  assert.deepEqual(installs, ['cn-tencent-docs'])
  const patch = readFileSync(join(env.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /omnimux-market managed/)
  assert.match(patch, /id: esc-mcp-cn-tencent-docs/)
})

test('connector_install rejects marketplace display-only ids', async () => {
  const { tools, installs } = makeTools({
    market: [{ id: 'wb-cli', name: 'CLI', installable: false, sourceKind: 'marketplace' }],
  })
  await assert.rejects(() => tools.connector_install.execute({ id: 'wb-cli' }), /display-only/)
  assert.equal(installs.length, 0)
})

test('connector_install rejects expert ids', async () => {
  const { tools, installs } = makeTools()
  await assert.rejects(() => tools.connector_install.execute({ id: 'exp-prd' }), /not a connector/)
  assert.equal(installs.length, 0)
})

test('connector_uninstall is idempotent and only touches managed rows', async () => {
  const env = roots()
  const initial = '- insert:\n    - id: my-local-plugin\n      name: my-local-plugin\n'
  writeFileSync(join(env.profileDir, 'cordis.patch.yml'), initial)
  const { tools } = makeTools({ env })
  await tools.connector_install.execute({ id: 'cn-tencent-docs' })
  const once = await tools.connector_uninstall.execute({ id: 'cn-tencent-docs' }) as Record<string, unknown>
  assert.equal(once.restartRequired, true)
  assert.equal(readFileSync(join(env.profileDir, 'cordis.patch.yml'), 'utf8'), initial)
  const twice = await tools.connector_uninstall.execute({ id: 'cn-tencent-docs' }) as Record<string, unknown>
  assert.equal(twice.id, 'cn-tencent-docs')
  assert.equal(readFileSync(join(env.profileDir, 'cordis.patch.yml'), 'utf8'), initial)
})

test('withConnectorPatchLock serializes two installs without interleaving', async () => {
  const env = roots()
  writeFileSync(join(env.profileDir, 'cordis.patch.yml'), '[]\n')
  const { tools } = makeTools({
    env,
    items: [
      item({ id: 'cn-tencent-docs', title: '腾讯文档', serverName: 'tencent-docs' }),
      item({ id: 'cn-notion', title: 'Notion', serverName: 'notion' }),
    ],
  })
  await Promise.all([
    tools.connector_install.execute({ id: 'cn-tencent-docs' }),
    tools.connector_install.execute({ id: 'cn-notion' }),
  ])
  const patch = readFileSync(join(env.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: esc-mcp-cn-tencent-docs/)
  assert.match(patch, /id: esc-mcp-cn-notion/)
  assert.equal((patch.match(/^# --- omnimux-market managed ---$/gm) || []).length, 1)
})

test('connector_list reports installed catalog connectors', async () => {
  const env = roots()
  writeFileSync(join(env.profileDir, 'cordis.patch.yml'), '[]\n')
  const items = [
    item({ id: 'cn-tencent-docs', title: '腾讯文档', serverName: 'tencent-docs', installed: true }),
    item({ id: 'cn-notion', title: 'Notion', serverName: 'notion', installed: false }),
  ]
  const { tools } = makeTools({ env, items })
  const result = await tools.connector_list.execute({}) as { items: Array<{ id: string }> }
  assert.deepEqual(result.items.map((it) => it.id), ['cn-tencent-docs'])
})
