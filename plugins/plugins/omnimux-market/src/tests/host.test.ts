import assert from 'node:assert/strict'
import test from 'node:test'
import {
  renderConnectorInstall,
  renderConnectorList,
  renderConnectorSearch,
  renderConnectorUninstall,
  renderInstall,
  renderList,
  renderPluginInstall,
  renderPluginList,
  renderPluginSearch,
  renderPluginUninstall,
  renderSearch,
} from '../host.js'
import { CONNECTOR_PROMPT_LINES } from '../connector-tools.js'
import { PLAZA_PROMPT_LINES } from '../plaza-tools.js'
import { PLUGIN_PROMPT_LINES } from '../plugin-tools.js'
import type { InstalledSkill, SearchResult, SkillCard } from '../types.js'

function card(partial: Partial<SkillCard>): SkillCard {
  return {
    id: '@u/demo',
    slug: 'demo',
    name: 'Demo',
    description: '',
    category: '',
    categoryLabel: '',
    version: '1.0.0',
    downloads: 0,
    stars: 0,
    installs: 0,
    pageUrl: 'https://skillhub.cn/skills/demo',
    channel: 'skillhub',
    installBackend: 'skillhub',
    ...partial,
  }
}

test('renderSearch asks for a short empty reply', () => {
  const text = renderSearch({
    query: 'pdf',
    sortBy: 'score',
    items: [],
    total: 0,
    offset: 0,
    hasMore: false,
  })
  assert.match(text, /没有找到/)
  assert.match(text, /不要写长文/)
})

test('renderSearch lists cards and forbids restating them', () => {
  const result: SearchResult = {
    query: '周报',
    sortBy: 'downloads',
    items: [card({ name: '周报助手', slug: 'weekly', installed: true })],
    total: 1,
    offset: 0,
    hasMore: true,
  }
  const text = renderSearch(result)
  assert.match(text, /周报助手（已安装）/)
  assert.match(text, /channel=skillhub/)
  assert.match(text, /禁止复述给用户/)
  assert.match(text, /offset=1/)
  assert.doesNotMatch(text, /curl/)
})

test('renderSearch marks custom channel and remote errors internally', () => {
  const result: SearchResult = {
    query: 'face-warp',
    sortBy: 'score',
    items: [card({ name: '人像拼图', slug: 'face-warp', channel: 'custom', catalogId: 'sk-omx-face-warp', installBackend: 'catalog' })],
    total: 1,
    offset: 0,
    hasMore: false,
    channelErrors: { skillhub: 'timeout' },
  }
  const text = renderSearch(result)
  assert.match(text, /channel=custom/)
  assert.match(text, /远程 SkillHub 暂不可用/)
  assert.doesNotMatch(text, /curl/)
})

test('renderInstall does not print install commands', () => {
  const text = renderInstall({
    slug: 'demo',
    name: 'Demo',
    version: '1.0.0',
    path: '/tmp/skills/demo',
    files: 2,
  })
  assert.match(text, /Demo 已安装/)
  assert.match(text, /不要打印安装命令/)
  assert.doesNotMatch(text, /skillhub install|curl/)
})

test('plaza-experts prompt forbids dual search and silent summon', () => {
  const text = PLAZA_PROMPT_LINES.join(' ')
  assert.match(text, /plaza_search FIRST/)
  assert.match(text, /same user message/)
  assert.match(text, /ask_user_question/)
  assert.match(text, /plaza_summon\(\{ id \}\)/)
  assert.match(text, /persists the expert/)
})

test('renderList handles empty and versioned skills', () => {
  assert.match(renderList({ items: [], skillsDir: '/tmp/skills' }), /还没有安装技能/)
  const items: InstalledSkill[] = [
    { slug: 'demo', name: 'Demo', description: '', version: '1.2.0', path: '/tmp/skills/demo' },
  ]
  assert.match(renderList({ items, skillsDir: '/tmp/skills' }), /Demo \(demo\) v1\.2\.0/)
})

test('plugin and connector prompts name tools, blacklist, and user restart', () => {
  const plugins = PLUGIN_PROMPT_LINES.join(' ')
  assert.match(plugins, /plugin_search/)
  assert.match(plugins, /connector_search/)
  assert.match(plugins, /cannot be removed/)
  assert.match(plugins, /restart Host themselves/)
  const connectors = CONNECTOR_PROMPT_LINES.join(' ')
  assert.match(connectors, /connector_search/)
  assert.match(connectors, /restart Host themselves/)
  assert.match(connectors, /display-only/)
})

test('renderPluginSearch empty is short and forbids CLI', () => {
  const text = renderPluginSearch({ items: [] })
  assert.match(text, /没有找到/)
  assert.match(text, /不要写长文/)
  assert.doesNotMatch(text, /dsh plugin/)
  assert.doesNotMatch(text, /curl/)
})

test('renderPluginSearch lists owner/name and forbids restating', () => {
  const text = renderPluginSearch({
    items: [{ owner: 'liustack', name: 'modlens', installed: true }],
  })
  assert.match(text, /liustack\/modlens（已安装）/)
  assert.match(text, /禁止复述给用户/)
  assert.doesNotMatch(text, /dsh plugin/)
  assert.doesNotMatch(text, /curl/)
})

test('renderPluginInstall and uninstall never print CLI or bash', () => {
  const installed = renderPluginInstall({ fullName: 'liustack/modlens' })
  assert.match(installed, /已安装/)
  assert.match(installed, /自行重启/)
  assert.doesNotMatch(installed, /dsh plugin/)
  assert.doesNotMatch(installed, /curl/)
  const uninstalled = renderPluginUninstall({ name: 'omnimux' })
  assert.match(uninstalled, /已卸载/)
  assert.doesNotMatch(uninstalled, /请用 bash/)
  assert.doesNotMatch(uninstalled, /dsh plugin/)
})

test('renderPluginList forbids teaching core uninstall', () => {
  const empty = renderPluginList({ items: [] })
  assert.match(empty, /不要教用户卸载核心包/)
  const text = renderPluginList({ items: [{ name: 'omnimux', protected: true }] })
  assert.match(text, /omnimux（不可卸）/)
  assert.match(text, /禁止教用户卸核心包/)
  assert.doesNotMatch(text, /dsh plugin/)
})

test('renderConnectorSearch empty is short; marketplace rows are display-only', () => {
  assert.match(renderConnectorSearch({ items: [] }), /没有找到/)
  const text = renderConnectorSearch({
    items: [{ id: 'wb-foo', name: 'Foo', installable: false, sourceKind: 'marketplace' }],
  })
  assert.match(text, /展示不可装/)
  assert.match(text, /禁止复述给用户/)
  assert.doesNotMatch(text, /dsh plugin/)
  assert.doesNotMatch(text, /curl/)
})

test('renderConnectorInstall uninstall and list mention user restart, no CLI', () => {
  assert.match(renderConnectorInstall({ id: 'cn-tencent-docs' }), /自行重启/)
  assert.doesNotMatch(renderConnectorInstall({ id: 'cn-tencent-docs' }), /dsh plugin|curl/)
  assert.match(renderConnectorUninstall({ id: 'cn-tencent-docs' }), /自行重启/)
  const listed = renderConnectorList({ items: [{ id: 'cn-tencent-docs' }], marketplaceDisplayOnly: 3 })
  assert.match(listed, /市场源 3 条均不可装/)
  assert.doesNotMatch(listed, /dsh plugin/)
})
