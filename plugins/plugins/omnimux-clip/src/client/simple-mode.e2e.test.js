import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import postcss from 'postcss'

const clientDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(clientDir, '..', '..')
const bundlePath = join(packageRoot, 'lib', 'client.js')
const simpleCssPath = join(clientDir, 'simple-mode', 'simple-mode.css')
const req = createRequire(import.meta.url)

function extractInjectedCss(bundleText, stylesheetRelPath) {
  const marker = `omnimux-clip-css:${stylesheetRelPath}`
  const idx = bundleText.indexOf(marker)
  assert.notEqual(idx, -1, `Expected stylesheet marker ${marker} in lib/client.js`)
  const tail = bundleText.slice(idx, idx + 300)
  const match = /\.textContent\s*=\s*(["`])/.exec(tail)
  assert.notEqual(match, null, `Expected textContent assignment after ${marker}`)
  const quote = match[1]
  const literalStart = idx + match.index + match[0].length - 1
  let end = literalStart + 1
  while (end < bundleText.length) {
    const ch = bundleText[end]
    if (ch === '\\') {
      end += 2
      continue
    }
    if (ch === quote) {
      end += 1
      break
    }
    end += 1
  }
  const literal = bundleText.slice(literalStart, end)
  if (quote === '"') return JSON.parse(literal)
  return literal.slice(1, -1).replace(/\\([\\`$])/g, '$1')
}

test('E2E: built lib/client.js injects simple-mode.css strictly after dsw-map.css with isolated selectors', () => {
  assert.equal(existsSync(bundlePath), true, 'Built client bundle lib/client.js must exist before E2E check')
  const bundle = readFileSync(bundlePath, 'utf8')
  const openreelIdx = bundle.indexOf('omnimux-clip-css:openreel/web/index.css')
  const dswIdx = bundle.indexOf('omnimux-clip-css:theme/dsw-map.css')
  const simpleIdx = bundle.indexOf('omnimux-clip-css:simple-mode/simple-mode.css')

  assert.notEqual(openreelIdx, -1)
  assert.notEqual(dswIdx, -1)
  assert.notEqual(simpleIdx, -1)
  assert.equal(dswIdx > openreelIdx, true, 'dsw-map.css must inject after openreel/web/index.css')
  assert.equal(simpleIdx > dswIdx, true, 'simple-mode.css must inject after dsw-map.css')

  const injectedCss = extractInjectedCss(bundle, 'simple-mode/simple-mode.css')
  const ast = postcss.parse(injectedCss, { from: simpleCssPath })

  const selectors = []
  let hasNarrowContainerRule = false
  ast.walkAtRules('container', (atRule) => {
    if (atRule.params.includes('clip-stage') && atRule.params.includes('560px')) {
      hasNarrowContainerRule = true
    }
  })
  ast.walkRules((rule) => {
    for (const sel of rule.selectors) {
      selectors.push(sel)
      assert.match(
        sel,
        /^(?:\.openreel-studio-root|\.omnimux-clip-stage)/,
        `Selector must remain strictly scoped under editor root: ${sel}`,
      )
    }
    rule.walkDecls((decl) => {
      assert.equal(
        /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\s*\(/i.test(decl.value),
        false,
        `Unexpected bare color literal in ${decl.prop}: ${decl.value}`,
      )
    })
  })

  assert.equal(hasNarrowContainerRule, true, 'Expected @container clip-stage (width < 560px) narrow responsive rule')
  assert.equal(
    selectors.some((s) => s.includes('[data-clip-ui-mode="simple"]') && s.includes('[data-clip-editing="true"]') && s.includes('.openreel-studio-hostbar')),
    true,
    'Missing editing hostbar suppression rule',
  )
  assert.equal(
    selectors.some((s) => s.includes('.omnimux-clip-stage[data-clip-mode="canvas"][data-clip-ui-mode="simple"]')),
    true,
    'Missing canvas header padding preservation rule',
  )
  assert.equal(
    selectors.some((s) => s.includes('[data-clip-ui-mode="simple"]') && s.includes('.workspace-inspector-value input')),
    true,
    'Missing Simple Inspector value input height containment rule',
  )
})

test('E2E: live uiModeStore + real OpenReel Zustand stores converge Pro -> Simple and balance storage listeners', async () => {
  const entry = `
    export * from ${JSON.stringify(join(clientDir, 'simple-mode', 'uiModeStore.js'))};
    export { useEditorWorkspaceStore } from ${JSON.stringify(join(clientDir, 'openreel', 'web', 'stores', 'editor-workspace-store.ts'))};
    export { useUIStore } from ${JSON.stringify(join(clientDir, 'openreel', 'web', 'stores', 'ui-store.ts'))};
    export { useSourceMonitorStore } from ${JSON.stringify(join(clientDir, 'openreel', 'web', 'stores', 'source-monitor-store.ts'))};
    export { useColorMonitorStore } from ${JSON.stringify(join(clientDir, 'openreel', 'web', 'stores', 'color-monitor-store.ts'))};
    export { shouldAutoStartTour } from ${JSON.stringify(join(clientDir, 'openreel', 'web', 'components', 'editor', 'tour', 'useTour.ts'))};
  `

  const portalStubPlugin = {
    name: 'stub-portal-root',
    setup(build) {
      build.onResolve({ filter: /^@openreel\/ui\/lib\/portal-root$/ }, () => ({
        path: 'portal-root',
        namespace: 'stub-portal-root',
      }))
      build.onResolve({ filter: /\/services\/keyboard-shortcuts$/ }, () => ({
        path: 'keyboard-shortcuts',
        namespace: 'stub-keyboard-shortcuts',
      }))
      build.onLoad({ filter: /.*/, namespace: 'stub-portal-root' }, () => ({
        contents: 'export const useEditorPortalRoot = () => null;',
        loader: 'js',
      }))
      build.onLoad({ filter: /.*/, namespace: 'stub-keyboard-shortcuts' }, () => ({
        contents: 'export const isEditorShortcutEvent = () => false;',
        loader: 'js',
      }))
    },
  }

  const built = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: packageRoot,
      loader: 'js',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react', 'zustand', 'zustand/*'],
    plugins: [portalStubPlugin],
    logLevel: 'silent',
  })

  const storageMap = new Map()
  const storageListeners = new Set()
  let addCount = 0
  let removeCount = 0

  const prevWindow = globalThis.window
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const fakeStorage = {
    getItem(key) { return storageMap.has(key) ? storageMap.get(key) : null },
    setItem(key, val) { storageMap.set(key, String(val)) },
    removeItem(key) { storageMap.delete(key) },
  }
  const fakeWindow = {
    location: { origin: 'http://127.0.0.1' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, fn) {
      if (type === 'storage') {
        addCount += 1
        storageListeners.add(fn)
      }
    },
    removeEventListener(type, fn) {
      if (type === 'storage') {
        removeCount += 1
        storageListeners.delete(fn)
      }
    },
  }

  globalThis.window = fakeWindow
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true })

  try {
    const modExports = {}
    const modObj = { exports: modExports }
    const compiled = new Function('exports', 'require', 'module', built.outputFiles[0].text)
    compiled(modExports, req, modObj)
    const mod = modObj.exports

    assert.equal(mod.getClipUiModeSnapshot().mode, 'simple')
    assert.equal(mod.shouldAutoStartTour(), false, 'Simple Mode must suppress automatic passive web tour')

    const unregister = mod.registerSimpleModeStores({
      workspaceStore: mod.useEditorWorkspaceStore,
      uiStore: mod.useUIStore,
      sourceMonitorStore: mod.useSourceMonitorStore,
      colorMonitorStore: mod.useColorMonitorStore,
    })

    const unsub1 = mod.subscribeClipUiMode(() => {})
    const unsub2 = mod.subscribeClipUiMode(() => {})
    assert.equal(addCount, 1)
    assert.equal(storageListeners.size, 1)

    // Switch to Pro mode and dirty every Pro-only state + keep a clip selection
    mod.setClipUiMode('pro')
    assert.equal(mod.getClipUiModeSnapshot().mode, 'pro')
    assert.equal(fakeStorage.getItem(mod.CLIP_UI_MODE_STORAGE_KEY), 'pro')

    mod.useEditorWorkspaceStore.getState().setSection('effects')
    mod.useEditorWorkspaceStore.getState().setTimelineTool('blade')
    mod.useUIStore.getState().setPanelVisible('audioMixer', true)
    mod.useUIStore.getState().setKeyframeEditorOpen(true)
    mod.useUIStore.getState().setScopesVisible(true)
    mod.useUIStore.getState().setCropMode(true)
    mod.useUIStore.getState().select({ type: 'clip', id: 'clip_preserve_1' })
    mod.useSourceMonitorStore.getState().setTab('source')
    mod.useColorMonitorStore.getState().setFalseColor(true)

    assert.equal(mod.useEditorWorkspaceStore.getState().section, 'effects')
    assert.equal(mod.useEditorWorkspaceStore.getState().timelineTool, 'blade')

    // Switch back Pro -> Simple and verify convergence + selection preservation
    mod.setClipUiMode('simple')
    assert.equal(mod.getClipUiModeSnapshot().mode, 'simple')
    assert.equal(mod.getClipUiModeSnapshot().drawerOpen, true)
    assert.equal(fakeStorage.getItem(mod.CLIP_UI_MODE_STORAGE_KEY), 'simple')

    assert.equal(mod.useEditorWorkspaceStore.getState().section, 'media')
    assert.equal(mod.useEditorWorkspaceStore.getState().timelineTool, 'select')
    assert.equal(mod.useUIStore.getState().panels.audioMixer.visible, false)
    assert.equal(mod.useUIStore.getState().keyframeEditorOpen, false)
    assert.equal(mod.useUIStore.getState().scopesVisible, false)
    assert.equal(mod.useUIStore.getState().cropMode, false)
    assert.equal(mod.useSourceMonitorStore.getState().tab, 'program')
    assert.equal(mod.useColorMonitorStore.getState().falseColor, false)
    assert.deepEqual(mod.useUIStore.getState().selectedItems, [{ type: 'clip', id: 'clip_preserve_1' }])

    // Cross-tab storage event switching to simple converges live stores
    mod.setClipUiMode('pro')
    mod.useEditorWorkspaceStore.getState().setSection('audio')
    for (const listener of [...storageListeners]) {
      listener({ key: mod.CLIP_UI_MODE_STORAGE_KEY, newValue: 'simple' })
    }
    assert.equal(mod.getClipUiModeSnapshot().mode, 'simple')
    assert.equal(mod.useEditorWorkspaceStore.getState().section, 'media')

    unsub1()
    assert.equal(removeCount, 0)
    unsub2()
    assert.equal(removeCount, 1)
    assert.equal(storageListeners.size, 0)
    unregister()
  } finally {
    globalThis.window = prevWindow
    if (prevStorage) {
      Object.defineProperty(globalThis, 'localStorage', prevStorage)
    } else {
      delete globalThis.localStorage
    }
  }
})
