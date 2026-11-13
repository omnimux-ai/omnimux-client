import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  clearMarketplaceConnectorMemos,
  listMarketplaceConnectors,
  MARKETPLACE_ICON_SCHEME,
  marketplaceListMemoSize,
  marketplaceManifestPath,
  resolveMarketplaceIconFile,
  resolveMarketplaceIconUrl,
  sanitizeMarketplaceIconId,
} from '../marketplace-connectors.js'

function writeManifest(root: string, connectors: unknown[]) {
  const dir = join(root, '.codebuddy-connector')
  mkdirSync(dir, { recursive: true })
  writeFileSync(marketplaceManifestPath(root), JSON.stringify({
    name: 'fixture',
    connectors,
  }))
}

function writeIcon(root: string, id: string, ext = '.png') {
  const dir = join(root, 'icons')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}${ext}`), ext === '.svg' ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'png')
}

test('lists all marketplace connectors without visible_in filtering', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-mkt-cn-'))
  writeManifest(root, [
    { id: 'open-all', name: 'Open All', description_zh: '空名单', type: 'mcp' },
    { id: 'internal-only', name: 'Internal Only', description_zh: '内网', type: 'mcp', visible_in: ['internal'] },
    { id: 'cli-tool', name: 'CLI Tool', description_zh: '命令行', type: 'cli', visible_in: ['external'] },
    { id: 'skill-pack', name: 'Skill Pack', description_zh: '技能', type: 'skill-only' },
  ])

  const { items, categories } = listMarketplaceConnectors(root)
  assert.equal(items.length, 4)
  assert.deepEqual(items.map((it) => it.id), ['open-all', 'internal-only', 'cli-tool', 'skill-pack'])
  assert.ok(items.every((it) => it.installable === false))
  assert.ok(items.every((it) => it.sourceKind === 'marketplace'))
  assert.deepEqual(categories.map((c) => c.id), ['mcp', 'cli', 'skill-only'])
})

test('missing manifest returns empty list', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-mkt-miss-'))
  const { items, categories } = listMarketplaceConnectors(root)
  assert.deepEqual(items, [])
  assert.deepEqual(categories, [])
})

test('listMarketplaceConnectors memos by manifest mtime and reuses iconUrl', () => {
  clearMarketplaceConnectorMemos()
  const root = mkdtempSync(join(tmpdir(), 'omx-mkt-memo-'))
  writeManifest(root, [
    { id: 'a', name: 'A', type: 'mcp' },
    { id: 'b', name: 'B', type: 'cli' },
  ])
  writeIcon(root, 'a', '.svg')
  const first = listMarketplaceConnectors(root)
  assert.equal(marketplaceListMemoSize(), 1)
  assert.equal(first.items[0]?.iconUrl, `${MARKETPLACE_ICON_SCHEME}a`)
  const second = listMarketplaceConnectors(root)
  assert.equal(second.items, first.items)
  assert.equal(second.categories, first.categories)
  // icon path is memoized: second resolve must not re-walk existsSync
  assert.equal(resolveMarketplaceIconUrl('a', root), `${MARKETPLACE_ICON_SCHEME}a`)
  writeManifest(root, [{ id: 'c', name: 'C', type: 'mcp' }])
  const third = listMarketplaceConnectors(root)
  assert.equal(third.items.length, 1)
  assert.equal(third.items[0]?.id, 'c')
})

test('prefers Chinese name and description when present', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-mkt-zh-'))
  writeManifest(root, [{
    id: 'notion',
    name: 'Notion',
    name_en: 'Notion',
    description: 'English only',
    description_zh: '连接 Notion',
    type: 'mcp',
  }])
  const { items } = listMarketplaceConnectors(root)
  assert.equal(items[0]?.name, 'Notion')
  assert.equal(items[0]?.description, '连接 Notion')
  assert.equal(items[0]?.category, 'mcp')
})

test('resolves local icons by id and rejects path traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-mkt-icon-'))
  writeManifest(root, [
    { id: 'github', name: 'GitHub', type: 'mcp' },
    { id: 'qq-mail', name: 'QQ邮箱', type: 'mcp' },
    { id: 'no-icon', name: 'No Icon', type: 'cli' },
  ])
  writeIcon(root, 'github', '.svg')
  writeIcon(root, 'qq-mail', '.png')

  const { items } = listMarketplaceConnectors(root)
  assert.equal(items.find((it) => it.id === 'github')?.iconUrl, `${MARKETPLACE_ICON_SCHEME}github`)
  assert.equal(items.find((it) => it.id === 'qq-mail')?.iconUrl, `${MARKETPLACE_ICON_SCHEME}qq-mail`)
  assert.equal(items.find((it) => it.id === 'no-icon')?.iconUrl, '')

  assert.equal(resolveMarketplaceIconUrl('../etc/passwd', root), '')
  assert.equal(sanitizeMarketplaceIconId('a/../../b'), '')

  const file = resolveMarketplaceIconFile(`${MARKETPLACE_ICON_SCHEME}github`, root)
  assert.ok(file)
  assert.equal(file.contentType, 'image/svg+xml')
  assert.ok(file.path.endsWith(`${join('icons', 'github.svg')}`))

  assert.equal(resolveMarketplaceIconFile(`${MARKETPLACE_ICON_SCHEME}../x`, root), null)
  assert.equal(resolveMarketplaceIconFile('https://example.com/x.png', root), null)
})
