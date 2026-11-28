import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  EXPLORE_MORE_PIN_CSS,
  NAV_RAIL_PINNED_MORE_STORAGE_KEY,
  OFFICIAL_PANEL_ICON_SVG,
  PIN_FILL_ICON_SVG,
  PIN_OUTLINE_ICON_SVG,
  getPinnedMoreSnapshot,
  isMoreItemPinned,
  panelPinId,
  parsePanelPinId,
  readPinnedMoreIds,
  rememberOfficialPanelMeta,
  resetNavRailPinsForTests,
  resolveOfficialPanelMeta,
  setPinnedMoreItem,
  subscribePinnedMoreItems,
  togglePinnedMoreItem,
  writePinnedMoreIds,
} from './nav-rail-pins.js'

const savedGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
}

let dom

afterEach(() => {
  resetNavRailPinsForTests()
  dom?.window.close()
  dom = undefined
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  }
})

function setupStorageDom(initialValue) {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  if (initialValue !== undefined) {
    dom.window.localStorage.setItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY, initialValue)
  }
  return dom.window
}

describe('nav-rail-pins 持久化与元信息真源', () => {
  it('默认读取为空数组，损坏或不合法 JSON 载荷安全降级返回空数组', () => {
    setupStorageDom()
    assert.deepEqual(readPinnedMoreIds(), [])

    setupStorageDom('{broken json')
    assert.deepEqual(readPinnedMoreIds(), [])

    setupStorageDom('{"not":"array"}')
    assert.deepEqual(readPinnedMoreIds(), [])
  })

  it('按操作先后保序写入、去重与切换固定态，并在全清后移除存储键', () => {
    const win = setupStorageDom()
    assert.deepEqual(writePinnedMoreIds(['clip', ' ', 'image-generation', 'clip']), ['clip', 'image-generation'])
    assert.equal(win.localStorage.getItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY), '["clip","image-generation"]')
    assert.equal(isMoreItemPinned('clip'), true)
    assert.equal(isMoreItemPinned('apps'), false)

    assert.deepEqual(togglePinnedMoreItem('apps'), ['clip', 'image-generation', 'apps'])
    assert.deepEqual(togglePinnedMoreItem('clip'), ['image-generation', 'apps'])
    assert.deepEqual(setPinnedMoreItem('apps', true), ['image-generation', 'apps'])
    assert.deepEqual(setPinnedMoreItem('image-generation', false), ['apps'])
    assert.deepEqual(setPinnedMoreItem('apps', false), [])
    assert.equal(win.localStorage.getItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY), null)
  })

  it('绝不在读取时裁剪尚未注册的异步插件 ID', () => {
    setupStorageDom('["image-generation","future-async-plugin"]')
    assert.deepEqual(readPinnedMoreIds(), ['image-generation', 'future-async-plugin'])
  })

  it('官方面板使用 panel: 命名空间隔离，支持菜单缓存与隐藏 panelList DOM 解析', () => {
    const win = setupStorageDom()
    assert.equal(panelPinId('schedules'), 'panel:schedules')
    assert.equal(parsePanelPinId('panel:schedules'), 'schedules')
    assert.equal(parsePanelPinId('clip'), null)

    const panelList = win.document.createElement('nav')
    panelList.className = 'SidebarRoot_panelList__qa'
    panelList.innerHTML = '<div data-entry="schedules"><button class="SidebarRoot_panelRow__qa" aria-label="Schedules"></button></div>'
    win.document.body.append(panelList)
    assert.equal(resolveOfficialPanelMeta('schedules', win.document).label, 'Schedules')

    rememberOfficialPanelMeta({ id: 'schedules', label: '自动化任务' })
    const meta = resolveOfficialPanelMeta('schedules', win.document)
    assert.equal(meta.label, '自动化任务')
    assert.equal(meta.remembered, true)
    assert.equal(meta.iconSvg, OFFICIAL_PANEL_ICON_SVG)
  })

  it('订阅器在本地变更与跨页 storage 事件时均同步推送最新列表', () => {
    const win = setupStorageDom()
    const snapshots = []
    const unsubscribe = subscribePinnedMoreItems((ids) => snapshots.push(ids))

    togglePinnedMoreItem('clip')
    assert.deepEqual(snapshots, [['clip']])

    win.localStorage.setItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY, '["clip","apps"]')
    win.dispatchEvent(new win.StorageEvent('storage', { key: NAV_RAIL_PINNED_MORE_STORAGE_KEY }))
    assert.deepEqual(snapshots, [['clip'], ['clip', 'apps']])

    unsubscribe()
    togglePinnedMoreItem('apps')
    assert.equal(snapshots.length, 2)
  })

  it('图钉矢量图标均为纯 14×14 SVG 且不含 Emoji', () => {
    assert.match(PIN_OUTLINE_ICON_SVG, /width="14" height="14"/)
    assert.match(PIN_FILL_ICON_SVG, /width="14" height="14"/)
    assert.notEqual(PIN_OUTLINE_ICON_SVG, PIN_FILL_ICON_SVG)
  })

  it('getPinnedMoreSnapshot 在未变更时保持引用稳定并在变更后返回新冻结快照', () => {
    setupStorageDom()
    const emptyA = getPinnedMoreSnapshot()
    const emptyB = getPinnedMoreSnapshot()
    assert.equal(emptyA, emptyB)
    assert.equal(Object.isFrozen(emptyA), true)
    assert.deepEqual(emptyA, [])

    togglePinnedMoreItem('apps')
    const pinnedA = getPinnedMoreSnapshot()
    const pinnedB = getPinnedMoreSnapshot()
    assert.notEqual(pinnedA, emptyA)
    assert.equal(pinnedA, pinnedB)
    assert.equal(Object.isFrozen(pinnedA), true)
    assert.deepEqual(pinnedA, ['apps'])

    togglePinnedMoreItem('apps')
    const cleared = getPinnedMoreSnapshot()
    assert.deepEqual(cleared, [])
    assert.equal(cleared, emptyA)
  })

  it('EXPLORE_MORE_PIN_CSS 默认隐藏未固定图钉且不依赖无鼠标 CI 常失配的 hover: hover 媒体查询', () => {
    assert.doesNotMatch(EXPLORE_MORE_PIN_CSS, /@media\s*\(\s*hover\s*:\s*hover\s*\)/)
    assert.match(EXPLORE_MORE_PIN_CSS, /\.omnimux-explore-more-pin-anchor\s*\{[^}]*opacity:\s*0;/)
  })
})
