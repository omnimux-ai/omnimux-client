import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCardMenuEntries, buildCardMenuItems, copyCardLink } from './card-actions.js'

const zh = new Map(Object.entries({
  'card.menu.favorite': '收藏星标',
  'card.menu.unfavorite': '取消星标',
  'card.menu.share': '分享公共链接',
  'card.menu.openDetail': '打开详情',
  'card.menu.openSidebar': '在右侧栏打开',
  'card.menu.addToConversation': '添加到对话',
  'card.menu.aiDeconstruct': 'AI 解构灵感',
  'card.cta.try': '立即复刻',
  'card.menu.openOriginal': '打开原始链接',
  'card.menu.copyLink': '复制链接地址',
  'card.menu.addToCollection': '添加到合集',
  'collection.newFromCard': '新建合集…',
  'card.menu.delete': '删除',
  'collection.merge': '合并为合集',
  'collection.remove': '移出合集',
}))
const t = (key) => zh.get(key) || key

function labels(local, inCollection) {
  return buildCardMenuItems({
    t,
    local,
    inCollection,
    onAddToConversation() {},
    onMerge() {},
    onRemove() {},
    onDelete() {},
  }).map((item) => item.label)
}

it('local cards can add to conversation, merge and delete', () => {
  assert.deepEqual(labels(true, false), ['添加到对话', '合并为合集', '删除'])
})

it('a collection member removes instead of merging', () => {
  assert.deepEqual(labels(true, true), ['添加到对话', '移出合集', '删除'])
})

it('cloud cards only get the conversation entry', () => {
  assert.deepEqual(labels(false, false), ['添加到对话'])
})

it('drops items without a handler', () => {
  const items = buildCardMenuItems({ t, local: true, inCollection: false, onAddToConversation() {} })
  assert.deepEqual(items.map((item) => item.id), ['chat'])
})

describe('buildCardMenuEntries & copyCardLink', () => {
  it('builds grouped host Menu entries for a local root card including collection submenu', () => {
    const called = []
    const menu = buildCardMenuEntries({
      t,
      local: true,
      inCollection: false,
      sourceUrl: 'https://x.com/demo/status/1',
      isFavorite: false,
      importing: false,
      itemId: 'i1',
      collections: [
        { id: 'c1', title: '爆款视频', item_ids: ['i1'] },
        { id: 'c2', title: '长文章', item_ids: [] },
      ],
      onToggleFavorite: () => called.push('favorite'),
      onShare: () => called.push('share'),
      onOpenDetail: () => called.push('open-detail'),
      onOpenSidebar: () => called.push('open-sidebar'),
      onAddToConversation: () => called.push('chat'),
      onAiDeconstruct: () => called.push('ai'),
      onReplicate: () => called.push('replicate'),
      onOpenOriginal: () => called.push('original'),
      onCopyLink: () => called.push('copy'),
      onAddToCollection: (col) => called.push(`col:${col.id}`),
      onCreateCollection: () => called.push('col:new'),
      onDelete: () => called.push('delete'),
    })

    const ids = menu.entries.map((e) => (e.type === 'separator' ? '---' : e.id))
    assert.deepEqual(ids, [
      'favorite',
      'share',
      '---',
      'open-detail',
      'open-sidebar',
      'add-to-conversation',
      'ai-deconstruct',
      'replicate',
      '---',
      'open-original',
      'copy-link',
      'add-to-collection',
      '---',
      'delete',
    ])
    const del = menu.entries.find((e) => e.id === 'delete')
    assert.equal(del?.danger, true)

    const colMenu = menu.entries.find((e) => e.id === 'add-to-collection')
    assert.ok(Array.isArray(colMenu?.submenu))
    assert.equal(colMenu.submenu.find((s) => s.id === 'collection:c1')?.disabled, true)
    assert.equal(colMenu.submenu.find((s) => s.id === 'collection:c2')?.disabled, false)

    assert.equal(menu.run('collection:c1'), false)
    assert.equal(menu.run('collection:c2'), true)
    assert.equal(menu.run('collection:new'), true)
    assert.equal(menu.run('favorite'), true)
    assert.deepEqual(called, ['col:c2', 'col:new', 'favorite'])
  })

  it('omits local-only entries on cloud rows and swaps submenu for remove-from-collection inside collections', () => {
    const cloud = buildCardMenuEntries({
      t,
      local: false,
      inCollection: false,
      sourceUrl: '',
      onShare() {},
      onOpenDetail() {},
      onAddToConversation() {},
      onToggleFavorite() {},
      onDelete() {},
    })
    assert.equal(cloud.entries.some((e) => e.id === 'favorite' || e.id === 'delete' || e.id === 'copy-link'), false)

    const inCol = buildCardMenuEntries({
      t,
      local: true,
      inCollection: true,
      importing: true,
      sourceUrl: 'https://example.com/a',
      onShare() {},
      onAiDeconstruct() {},
      onReplicate() {},
      onRemoveFromCollection() {},
    })
    assert.equal(inCol.entries.some((e) => e.id === 'remove-from-collection'), true)
    assert.equal(inCol.entries.some((e) => e.id === 'add-to-collection'), false)
    assert.equal(inCol.entries.find((e) => e.id === 'ai-deconstruct')?.disabled, true)
    assert.equal(inCol.entries.find((e) => e.id === 'replicate')?.disabled, true)
  })

  it('copyCardLink handles empty urls cleanly without crashing outside browser', async () => {
    assert.equal(await copyCardLink(''), false)
    assert.equal(await copyCardLink('   '), false)
  })
})
