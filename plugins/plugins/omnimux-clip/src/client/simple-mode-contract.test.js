/**
 * OmniMux Clip Simple Mode 2×2 contract & adapter unit tests.
 * Covers uiModeStore defaults, localStorage persistence, Pro->Simple convergence,
 * CSS selector scoping/token discipline, and 5-point OpenReel vendor seam integrity.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLIP_UI_MODE_STORAGE_KEY,
  SIMPLE_RAIL_SECTIONS,
  SIMPLE_SECTION_IDS,
  getClipUiModeSnapshot,
  reconcileSimpleModeState,
  registerSimpleModeStores,
  reloadClipUiModeFromStorage,
  resetClipUiModeForTest,
  setClipDrawerOpen,
  setClipUiMode,
  toggleClipDrawer,
} from './simple-mode/uiModeStore.js'
import { zh } from './i18n/zh-CN.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIMPLE_CSS_PATH = join(HERE, 'simple-mode/simple-mode.css')
const STUDIO_TAB_PATH = join(HERE, 'OpenReelStudioTab.jsx')
const CLIP_STAGE_PATH = join(HERE, 'ClipStage.jsx')
const EDITOR_DIR = join(HERE, 'openreel/web/components/editor')

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function withMockStorage(initial = {}, fn) {
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const map = new Map(Object.entries(initial))
  const mockStorage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: mockStorage,
  })
  try {
    return fn(map)
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor)
    } else {
      delete globalThis.localStorage
    }
    resetClipUiModeForTest({ mode: 'simple', drawerOpen: true })
  }
}

test('uiModeStore defaults to simple and rejects invalid storage values', () => {
  withMockStorage({}, () => {
    const snap = reloadClipUiModeFromStorage()
    assert.equal(snap.mode, 'simple')
    assert.equal(snap.drawerOpen, true)
  })

  withMockStorage({ [CLIP_UI_MODE_STORAGE_KEY]: 'invalid-mode' }, () => {
    const snap = reloadClipUiModeFromStorage()
    assert.equal(snap.mode, 'simple')
  })

  withMockStorage({ [CLIP_UI_MODE_STORAGE_KEY]: 'pro' }, () => {
    const snap = reloadClipUiModeFromStorage()
    assert.equal(snap.mode, 'pro')
  })
})

test('setClipUiMode persists across reloads and toggles left drawer state', () => {
  withMockStorage({}, (map) => {
    resetClipUiModeForTest({ mode: 'simple', drawerOpen: true })
    assert.equal(getClipUiModeSnapshot().mode, 'simple')

    setClipDrawerOpen(false)
    assert.equal(getClipUiModeSnapshot().drawerOpen, false)
    toggleClipDrawer()
    assert.equal(getClipUiModeSnapshot().drawerOpen, true)

    setClipUiMode('pro')
    assert.equal(getClipUiModeSnapshot().mode, 'pro')
    assert.equal(map.get(CLIP_UI_MODE_STORAGE_KEY), 'pro')

    setClipDrawerOpen(false)
    // Switching back to simple re-opens the drawer cleanly
    setClipUiMode('simple')
    assert.equal(getClipUiModeSnapshot().mode, 'simple')
    assert.equal(getClipUiModeSnapshot().drawerOpen, true)
    assert.equal(map.get(CLIP_UI_MODE_STORAGE_KEY), 'simple')
  })
})

test('reconcileSimpleModeState converges Pro-only sections, tools, and overlays back to Simple defaults', () => {
  const workspaceState = {
    section: 'effects',
    timelineTool: 'blade',
    setSection(next) { this.section = next },
    setTimelineTool(next) { this.timelineTool = next },
  }
  const uiState = {
    panels: { audioMixer: { visible: true } },
    keyframeEditorOpen: true,
    scopesVisible: true,
    cropMode: true,
    setPanelVisible(id, visible) { this.panels[id] = { visible } },
    setKeyframeEditorOpen(open) { this.keyframeEditorOpen = open },
    setScopesVisible(visible) { this.scopesVisible = visible },
    setCropMode(enabled) { this.cropMode = enabled },
  }
  const sourceState = {
    tab: 'source',
    setTab(tab) { this.tab = tab },
  }
  const colorState = {
    falseColor: true,
    setFalseColor(on) { this.falseColor = on },
  }

  const stores = {
    workspaceStore: { getState: () => workspaceState },
    uiStore: { getState: () => uiState },
    sourceMonitorStore: { getState: () => sourceState },
    colorMonitorStore: { getState: () => colorState },
  }

  withMockStorage({}, () => {
    const unregister = registerSimpleModeStores(stores)
    setClipUiMode('pro', { persist: false })
    setClipUiMode('simple', { persist: false })
    unregister()
  })

  assert.equal(workspaceState.section, 'media')
  assert.equal(workspaceState.timelineTool, 'select')
  assert.equal(uiState.panels.audioMixer.visible, false)
  assert.equal(uiState.keyframeEditorOpen, false)
  assert.equal(uiState.scopesVisible, false)
  assert.equal(uiState.cropMode, false)
  assert.equal(sourceState.tab, 'program')
  assert.equal(colorState.falseColor, false)

  // Preserves valid Simple Mode sections (e.g. text / recipes / versions)
  for (const validSection of SIMPLE_SECTION_IDS) {
    workspaceState.section = validSection
    reconcileSimpleModeState(stores)
    assert.equal(workspaceState.section, validSection)
  }
})

test('simple-mode.css scopes all rules under studio root with zero bare color literals', () => {
  const rawCss = readFileSync(SIMPLE_CSS_PATH, 'utf8')
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')

  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+/g.test(css), false, 'simple-mode.css must use semantic tokens only')
  assert.doesNotMatch(css, /(^|[\s,(>+~])(?::root\b|html\b|body\b)/)

  assert.match(css, /\.openreel-studio-root\[data-clip-ui-mode="simple"\]\s+\[data-clip-pro-only="true"\]/)
  assert.match(css, /\.openreel-studio-root\[data-clip-ui-mode="simple"\]\[data-clip-editing="true"\]\s*>\s*\.openreel-studio-hostbar/)
  assert.match(css, /\.openreel-studio-root\[data-clip-ui-mode="simple"\]\s+\.workspace-rail\s*\{[\s\S]*flex-direction:\s*row;/)
  assert.match(css, /\.omnimux-clip-stage\[data-clip-mode="canvas"\]\[data-clip-ui-mode="simple"\]\s+\.workspace-topbar/)
})

test('Standalone and Canvas entries share orthogonal data-clip-ui-mode and simple-mode.css', () => {
  for (const filePath of [STUDIO_TAB_PATH, CLIP_STAGE_PATH]) {
    const src = readFileSync(filePath, 'utf8')
    assert.match(src, /useClipUiMode/, `${filePath} must subscribe to useClipUiMode`)
    assert.match(src, /simple-mode\/simple-mode\.css/, `${filePath} must import simple-mode.css`)
    assert.match(src, /data-clip-ui-mode=\{uiMode\}/, `${filePath} must expose data-clip-ui-mode`)
  }
})

test('5-point OpenReel vendor seam markers remain complete and aligned with Chinese labels', () => {
  assert.deepEqual(SIMPLE_RAIL_SECTIONS, {
    media: 'Media',
    text: 'Text',
    recipes: 'Templates',
    versions: 'Versions',
  })
  assert.equal(zh.Media, '素材')
  assert.equal(zh.Text, '文字')
  assert.equal(zh.Templates, '模板')
  assert.equal(zh.Versions, '版本')
  assert.equal(zh.Simple, '简易')
  assert.equal(zh.Pro, '专业')

  const checks = [
    ['EditorInterface.tsx', [/useClipUiMode/, /registerSimpleModeStores/, /reconcileSimpleModeState/, /data-clip-pro-only="true"/]],
    ['Toolbar.tsx', [/<ClipDrawerToggle\s*\/>/, /<ClipModeToggle\s*\/>/, /openreel-toolbar-brand-block/, /data-clip-pro-only="true"/]],
    ['EditorActionRail.tsx', [/SIMPLE_RAIL_SECTIONS/, /data-clip-section=\{value\}/, /clip-rail-label/]],
    ['Preview.tsx', [/workspace-preview-header" data-clip-pro-only="true"/, /workspace-preview-meta" data-clip-pro-only="true"/]],
    ['PreviewTransportControls.tsx', [/data-clip-pro-only="true"/]],
    ['preview/ProgramMonitorOverlays.tsx', [/data-clip-pro-only="true"/]],
    ['Timeline.tsx', [/proOnly/, /data-clip-pro-only="true"/]],
    ['timeline/TrackHeader.tsx', [/data-clip-pro-only="true"/]],
    ['AssetsPanel.tsx', [/missingAssetsCount === 0 \? "true" : undefined/, /data-clip-pro-only="true"/]],
    ['InspectorPanel.tsx', [/SimpleInspectorCloseButton/, /SimpleInspectorFooter/]],
    ['inspector/shell/InspectorClipHeader.tsx', [/trailing\?:\s*ReactNode/, /\{trailing\}/]],
    ['tour/useTour.ts', [/shouldAutoStartTour/, /getClipUiModeSnapshot/]],
  ]

  for (const [rel, patterns] of checks) {
    const src = stripComments(readFileSync(join(EDITOR_DIR, rel), 'utf8'))
    for (const pattern of patterns) {
      assert.match(src, pattern, `${rel} missing expected seam pattern ${pattern}`)
    }
  }
})
