import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { en, NS, zh } from './client/locales.js'
import { STYLES, STYLES_ID } from './client/styles.js'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

test('locales have complete zh/en keys without middle dots or prohibited marketing copy', () => {
  assert.equal(NS, 'omnimux-pibrowse')
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys)
  for (const key of zhKeys) {
    assert.equal(zh[key].includes('·'), false, `zh.${key} must not contain middle dot`)
    assert.equal(/一键/.test(zh[key]), false, `zh.${key} must not contain prohibited copy`)
    assert.equal(en[key].includes('·'), false, `en.${key} must not contain middle dot`)
  }
  assert.equal(zh.allOption, '全部')
})

test('styles.js defines canonical stage scroll/sticky rules and local --dsw-bg alias without backdrop-filter', () => {
  assert.equal(STYLES_ID, 'omnimux-pibrowse-styles')
  assert.ok(STYLES.includes('.omx-stage-sticky'))
  assert.ok(STYLES.includes('.omx-stage-scroll'))
  assert.ok(STYLES.includes('--dsw-bg: var(--dsw-alias-bg-base);'))
  assert.equal(/backdrop-filter/i.test(STYLES), false)
  assert.equal(/--dsw-alias-bg-overlay/.test(STYLES), false)
  assert.equal(/--dsw-alias-bg-elevated/.test(STYLES), false)
})

test('built lib/client.js wraps omnimux-pibrowse module factory and registers sidebar + workbench tab', () => {
  const bundle = readFileSync(join(PKG_ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes('id: "omnimux-pibrowse"'))

  let loadedModule = null
  const mockWindow = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'omnimux-pibrowse')
        loadedModule = factory((dep) => {
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
          if (dep === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
          return {}
        })
      },
    },
  }

  const fn = new Function('window', bundle)
  fn(mockWindow)

  assert.equal(loadedModule.name, 'omnimux-pibrowse')
  assert.deepEqual(loadedModule.inject, ['slots', 'locale'])
  assert.equal(loadedModule.PIBROWSE_TAB_ID, 'omnimux-pibrowse:workbench')
  assert.equal(loadedModule.EXPLORE_ITEM_ID, 'pibrowse')
  assert.equal(typeof loadedModule.apply, 'function')
  assert.equal(typeof loadedModule.registerMoreMenuEntry, 'function')

  const registered = []
  let unregisteredCount = 0
  mockWindow.__omnimuxSidebar = {
    registerExploreItem(item) {
      registered.push(item)
      return () => {
        unregisteredCount += 1
      }
    },
  }
  const dispose = loadedModule.registerMoreMenuEntry((k) => (k === 'nav' ? '指纹浏览器' : k))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'pibrowse')
  assert.equal(registered[0].label, '指纹浏览器')
  assert.equal(registered[0].tabId, 'omnimux-pibrowse:workbench')
  assert.match(registered[0].iconSvg, /^<svg\b/)
  dispose()
  assert.equal(unregisteredCount, 1)
})
