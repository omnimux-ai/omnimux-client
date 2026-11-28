import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { en, NS, zh } from './client/locales.js'
import { STYLES, STYLES_ID } from './client/styles.js'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

const builtTestBundle = await build({
  absWorkingDir: PKG_ROOT,
  stdin: {
    contents: [
      "export * from './src/client/sidebar-entry.js'",
      "export * as coordinator from '../omnimux/src/client/sidebar-coordinator.js'",
    ].join('\n'),
    resolveDir: PKG_ROOT,
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__ttselTestApi',
  platform: 'browser',
  plugins: [
    {
      name: 'empty-css-modules',
      setup(pluginBuild) {
        pluginBuild.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {}', loader: 'js' }))
      },
    },
  ],
  logLevel: 'warning',
})

const TEST_BUNDLE_CODE = builtTestBundle.outputFiles.at(0)?.text ?? ''

function loadSidebarTestDom() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div data-slot="root">
        <div class="frame" data-omnimux-frame>
          <div data-pane="sidebar">
            <div class="logoRow">
              <button type="button" class="brand" aria-label="OmniMux">OmniMux</button>
            </div>
            <button class="newSession" type="button">新建会话</button>
          </div>
        </div>
      </div>
    </body></html>`,
    { runScripts: 'dangerously', url: 'http://127.0.0.1/' }
  )
  const script = dom.window.document.createElement('script')
  script.textContent = TEST_BUNDLE_CODE
  dom.window.document.body.append(script)
  const api = dom.window.__ttselTestApi
  assert.ok(api && typeof api.mountSidebarEntry === 'function', 'test bundle must expose sidebar-entry exports')
  return { dom, api }
}

test('locales have complete zh/en keys without middle dots', () => {
  assert.equal(NS, 'omnimux-tiktok-selection')
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys)
  const zhMap = new Map(Object.entries(zh))
  const enMap = new Map(Object.entries(en))
  for (const [key, val] of zhMap.entries()) {
    assert.equal(val.includes('·'), false, `zh.${key} must not contain middle dot`)
    const enVal = enMap.get(key)
    assert.equal(typeof enVal, 'string')
    assert.equal(enVal.includes('·'), false, `en.${key} must not contain middle dot`)
  }
  assert.equal(zh.nav, '跟爆选品')
  assert.equal(en.nav, 'TikTok Selection')
  const topTabs = [
    zh.tabDiscovery,
    zh.tabThreeGate,
    zh.tabLibrary,
    zh.tabAssets,
    zh.tabAutomation,
    zh.tabRiskSettings,
  ]
  assert.deepEqual(topTabs, ['选品发现', '三闸筛选', '选品库', '商品素材', '自动选品', '风控配置'])
  for (const label of topTabs) {
    assert.ok(label.length >= 2 && label.length <= 5, `top tab "${label}" must stay 2-5 CJK chars`)
    assert.equal(/[与和及、/]/.test(label), false, `top tab "${label}" must not concatenate themes`)
    assert.equal(label.includes('中心'), false, `top tab "${label}" must not include container filler 中心`)
  }
  assert.equal(Object.hasOwn(zh, 'loadVideos'), false)
  assert.equal(Object.hasOwn(zh, 'loadReviews'), false)
  assert.equal(Object.hasOwn(zh, 'detailAndVideos'), false)
})

test('styles.js defines canonical stage scroll and sticky rules without backdrop-filter', () => {
  assert.equal(STYLES_ID, 'omnimux-tiktok-selection-styles')
  assert.ok(STYLES.includes('.omx-stage-sticky'))
  assert.ok(STYLES.includes('.omx-stage-scroll'))
  assert.equal(/backdrop-filter/i.test(STYLES), false)
})

test('mountSidebarEntry converges row and registers tiktok-selection into More menu with locale updates', () => {
  const { dom, api } = loadSidebarTestDom()
  try {
    api.coordinator.installSidebarGlobal()

    const openedTabs = []
    dom.window.__omnimuxWorkbench = {
      open(opts) {
        openedTabs.push(opts)
        return true
      },
      createSidebarStore() {
        return {
          getSnapshot: () => false,
          subscribe: () => () => {},
          open() {},
          close() {},
          set() {},
          readBox: () => ({ top: 0, left: 0, width: 0, height: 0 }),
        }
      },
    }

    let currentLang = 'zh'
    const zhMap = new Map(Object.entries(zh))
    const enMap = new Map(Object.entries(en))
    const t = (key) => {
      const activeMap = currentLang === 'en' ? enMap : zhMap
      return activeMap.get(key) ?? key
    }
    const listeners = new Set()
    const locale = {
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }

    const dispose = api.mountSidebarEntry(null, t, locale)
    try {
      dom.window.__omnimuxSidebar.place()

      const pane = dom.window.document.querySelector('[data-pane="sidebar"]')
      assert.equal(
        pane.querySelector('[data-omnimux-tiktok-selection-entry]'),
        null,
        'omnimux-tiktok-selection must not mount as an independent row in the sidebar'
      )
      assert.equal(api.coordinator.getConvergedRowsForTests().has('omnimux-tiktok-selection-entry'), true)

      const zhEntry = api.coordinator.resolveExploreMenuItems().find((item) => item.id === api.EXPLORE_ITEM_ID)
      assert.ok(zhEntry, '跟爆选品 entry must appear in resolved More menu items')
      assert.equal(zhEntry.label, '跟爆选品')
      assert.equal(zhEntry.tabId, api.SELECTION_TAB_ID)
      assert.equal(zhEntry.iconSvg, api.SELECTION_ICON_SVG)
      assert.match(zhEntry.iconSvg, /^<svg\b/)

      api.coordinator.activateExploreItem(zhEntry)
      assert.deepEqual(JSON.parse(JSON.stringify(openedTabs)), [{ tabId: api.SELECTION_TAB_ID, title: '跟爆选品' }])

      currentLang = 'en'
      for (const fn of listeners) fn()

      const matchesAfterSwitch = api.coordinator.resolveExploreMenuItems().filter((item) => item.id === api.EXPLORE_ITEM_ID)
      assert.equal(matchesAfterSwitch.length, 1, 'locale refresh must update in place without duplicating items')
      assert.equal(matchesAfterSwitch.at(0)?.label, 'TikTok Selection')
    } finally {
      dispose()
      delete dom.window.__omnimuxWorkbench
    }

    assert.equal(
      api.coordinator.resolveExploreMenuItems().some((item) => item.id === api.EXPLORE_ITEM_ID),
      false,
      'dispose must remove tiktok-selection from More menu'
    )
    assert.equal(api.coordinator.getConvergedRowsForTests().has('omnimux-tiktok-selection-entry'), false)
  } finally {
    api.coordinator.resetSidebarCoordinatorForTests()
    dom.window.close()
  }
})

test('registerMoreMenuEntry retries until window.__omnimuxSidebar becomes ready and disposes cleanly', async () => {
  const { dom, api } = loadSidebarTestDom()
  const registered = []
  let unregisteredCount = 0
  let dispose = () => {}

  try {
    dispose = api.registerMoreMenuEntry((key) => (key === 'nav' ? '跟爆选品' : key))
    assert.equal(registered.length, 0)

    await new Promise((resolve) => setTimeout(resolve, 65))
    dom.window.__omnimuxSidebar = {
      registerExploreItem(item) {
        registered.push(item)
        return () => {
          unregisteredCount += 1
        }
      },
    }

    await new Promise((resolve) => setTimeout(resolve, 110))
    assert.equal(registered.length, 1)
    assert.equal(registered.at(0)?.id, 'tiktok-selection')
    assert.equal(registered.at(0)?.label, '跟爆选品')
    assert.equal(registered.at(0)?.tabId, 'omnimux-tiktok-selection:workbench')
  } finally {
    dispose()
    dom.window.close()
  }

  assert.equal(unregisteredCount, 1)
})

test('built lib/client.js wraps omnimux-tiktok-selection factory and registers More menu entry', () => {
  const bundle = readFileSync(join(PKG_ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes('id: "omnimux-tiktok-selection"'))
  assert.ok(
    bundle.includes('商品评价') || bundle.includes('\\u5546\\u54C1\\u8BC4\\u4EF7'),
    'built lib/client.js must render detail reviews section'
  )
  const discoverySource = readFileSync(join(PKG_ROOT, 'src', 'client', 'DiscoveryPanel.jsx'), 'utf8')
  assert.equal(discoverySource.includes('·'), false, 'DiscoveryPanel copy must not contain middle dot separators')
  assert.equal(discoverySource.includes("t('loadVideos')"), false, 'DiscoveryPanel must not render manual loadVideos button')
  assert.equal(discoverySource.includes("t('loadReviews')"), false, 'DiscoveryPanel must not render manual loadReviews button')
  assert.equal(discoverySource.includes('全部类目'), false, 'Category dropdown first option must be 全部, not 全部类目')
  assert.equal(discoverySource.includes('数据源快照'), false, 'DiscoveryPanel must not duplicate snapshot source dropdown')
  assert.equal(discoverySource.includes('榜单粒度'), false, 'DiscoveryPanel must not render ineffective rank granularity control')
  assert.ok(discoverySource.includes('includeDetail: false'), 'Drawer tab fetches must decouple detail lookup')

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1/',
  })

  try {
    let loadedModule = null
    dom.window.__ModuleLoader__ = {
      load(spec) {
        assert.equal(spec.id, 'omnimux-tiktok-selection')
        loadedModule = spec.factory((dep) => {
          if (dep === 'react') {
            return {
              createElement: () => null,
              forwardRef: (render) => render,
              createContext: (val) => ({ Provider: () => null, _currentValue: val }),
              useContext: () => ({}),
              useCallback: (fn) => fn,
              useEffect() {},
              useLayoutEffect() {},
              useImperativeHandle() {},
              useRef: (v) => ({ current: v }),
              useId: () => 'id-1',
              useMemo: (fn) => fn(),
              useState: (v) => [v, () => {}],
              Fragment: Symbol('Fragment'),
            }
          }
          if (dep === 'react/jsx-runtime') {
            return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
          }
          return {}
        })
      },
    }

    const script = dom.window.document.createElement('script')
    script.textContent = bundle
    dom.window.document.body.append(script)

    assert.ok(loadedModule, 'lib/client.js must invoke __ModuleLoader__.load')
    const moduleEntries = new Map(Object.entries(loadedModule))
    assert.equal(loadedModule.name, 'omnimux-tiktok-selection')
    assert.deepEqual([...loadedModule.inject], ['slots', 'locale'])
    assert.equal(loadedModule.SELECTION_TAB_ID, 'omnimux-tiktok-selection:workbench')
    assert.equal(loadedModule.EXPLORE_ITEM_ID, 'tiktok-selection')
    assert.equal(moduleEntries.has('apply'), true)
    assert.equal(typeof moduleEntries.get('apply'), 'function')
    assert.equal(typeof loadedModule.registerMoreMenuEntry, 'function')

    const registered = []
    let unregisteredCount = 0
    dom.window.__omnimuxSidebar = {
      registerExploreItem(item) {
        registered.push(item)
        return () => {
          unregisteredCount += 1
        }
      },
    }

    const dispose = loadedModule.registerMoreMenuEntry((k) => (k === 'nav' ? '跟爆选品' : k))
    assert.equal(registered.length, 1)
    assert.equal(registered.at(0)?.id, 'tiktok-selection')
    assert.equal(registered.at(0)?.label, '跟爆选品')
    assert.equal(registered.at(0)?.tabId, 'omnimux-tiktok-selection:workbench')
    assert.match(registered.at(0)?.iconSvg, /^<svg\b/)
    dispose()
    assert.equal(unregisteredCount, 1)
  } finally {
    dom.window.close()
  }
})

test('portal drawer and modal text blocks declare --dsw-alias-label-primary to preserve dark-mode contrast', () => {
  for (const selector of [
    '.omnimux-ttsel-drawer-hero',
    '.omnimux-ttsel-kv',
    '.omnimux-ttsel-kv-v',
    '.omnimux-ttsel-video-item',
    '.omnimux-ttsel-evidence-pre',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = STYLES.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    assert.ok(match, `Missing CSS rule for ${selector}`)
    assert.match(
      match[1],
      /color:\s*var\(--dsw-alias-label-primary\)/,
      `${selector} must declare explicit primary label color for portal containers`,
    )
  }
})
