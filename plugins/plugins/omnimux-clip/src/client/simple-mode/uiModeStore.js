import { useSyncExternalStore } from 'react'

export const CLIP_UI_MODE_STORAGE_KEY = 'omnimux.clip.uiMode'

export const SIMPLE_RAIL_SECTIONS = Object.freeze({
  media: 'Media',
  text: 'Text',
  recipes: 'Templates',
  versions: 'Versions',
})

export const SIMPLE_SECTION_IDS = Object.freeze(Object.keys(SIMPLE_RAIL_SECTIONS))

const VALID_MODES = new Set(['simple', 'pro'])

function normalizeMode(value) {
  return VALID_MODES.has(value) ? value : 'simple'
}

function readStoredMode() {
  if (typeof globalThis.localStorage?.getItem !== 'function') return 'simple'
  try {
    return normalizeMode(globalThis.localStorage.getItem(CLIP_UI_MODE_STORAGE_KEY))
  } catch (error) {
    console.warn('[omnimux-clip] failed to read ui mode preference', error)
    return 'simple'
  }
}

function writeStoredMode(mode) {
  if (typeof globalThis.localStorage?.setItem !== 'function') return
  try {
    globalThis.localStorage.setItem(CLIP_UI_MODE_STORAGE_KEY, mode)
  } catch (error) {
    console.warn('[omnimux-clip] failed to persist ui mode preference', error)
  }
}

let snapshot = Object.freeze({
  mode: readStoredMode(),
  drawerOpen: true,
})

let registeredStores = {}
let storeRegistrationToken = null
const listeners = new Set()
let storageHandler = null

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function bindStorageSync() {
  if (storageHandler || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }
  storageHandler = (event) => {
    if (event.key !== CLIP_UI_MODE_STORAGE_KEY) return
    const nextMode = normalizeMode(event.newValue)
    if (nextMode === snapshot.mode) return
    snapshot = Object.freeze({
      mode: nextMode,
      drawerOpen: snapshot.drawerOpen,
    })
    if (nextMode === 'simple') {
      reconcileSimpleModeState(registeredStores)
    }
    emitChange()
  }
  window.addEventListener('storage', storageHandler)
}

function unbindStorageSync() {
  if (!storageHandler || typeof window === 'undefined' || typeof window.removeEventListener !== 'function') {
    storageHandler = null
    return
  }
  window.removeEventListener('storage', storageHandler)
  storageHandler = null
}

export function subscribeClipUiMode(listener) {
  listeners.add(listener)
  if (listeners.size === 1) {
    bindStorageSync()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unbindStorageSync()
    }
  }
}

export function getClipUiModeSnapshot() {
  return snapshot
}

export function useClipUiMode() {
  return useSyncExternalStore(
    subscribeClipUiMode,
    getClipUiModeSnapshot,
    getClipUiModeSnapshot,
  )
}

/**
 * Registers live OpenReel Zustand store references from the mounted editor shell
 * so switching back from Pro to Simple converges hidden tools safely without static
 * cross-boundary TypeScript imports inside pure JS tests.
 */
export function registerSimpleModeStores(stores) {
  const token = Symbol('clip-simple-stores')
  storeRegistrationToken = token
  registeredStores = stores && typeof stores === 'object' ? { ...stores } : {}
  return () => {
    if (storeRegistrationToken === token) {
      storeRegistrationToken = null
      registeredStores = {}
    }
  }
}

/**
 * Converges Pro-only workspace sections, tools, and diagnostic overlays back to
 * safe Simple Mode defaults without unmounting the editor or discarding timeline state.
 */
export function reconcileSimpleModeState(stores = registeredStores) {
  const activeStores = stores && typeof stores === 'object' ? stores : {}
  const { workspaceStore, uiStore, sourceMonitorStore, colorMonitorStore } = activeStores

  if (workspaceStore && typeof workspaceStore.getState === 'function') {
    const ws = workspaceStore.getState()
    if (ws) {
      if (ws.section && !SIMPLE_SECTION_IDS.includes(ws.section)) {
        ws.setSection?.('media')
      }
      if (ws.timelineTool && ws.timelineTool !== 'select') {
        ws.setTimelineTool?.('select')
      }
    }
  }

  if (uiStore && typeof uiStore.getState === 'function') {
    const ui = uiStore.getState()
    if (ui) {
      if (ui.panels?.audioMixer?.visible) {
        ui.setPanelVisible?.('audioMixer', false)
      }
      if (ui.keyframeEditorOpen) {
        ui.setKeyframeEditorOpen?.(false)
      }
      if (ui.scopesVisible) {
        ui.setScopesVisible?.(false)
      }
      if (ui.cropMode) {
        ui.setCropMode?.(false)
      }
    }
  }

  if (sourceMonitorStore && typeof sourceMonitorStore.getState === 'function') {
    const sm = sourceMonitorStore.getState()
    if (sm && sm.tab && sm.tab !== 'program') {
      sm.setTab?.('program')
    }
  }

  if (colorMonitorStore && typeof colorMonitorStore.getState === 'function') {
    const cm = colorMonitorStore.getState()
    if (cm && cm.falseColor) {
      cm.setFalseColor?.(false)
    }
  }
}

export function setClipUiMode(nextMode, options = {}) {
  const normalized = normalizeMode(nextMode)
  const prevMode = snapshot.mode
  const shouldPersist = options.persist !== false
  if (shouldPersist) {
    writeStoredMode(normalized)
  }
  const changed = normalized !== prevMode
  if (changed) {
    snapshot = Object.freeze({
      mode: normalized,
      drawerOpen: normalized === 'simple' ? true : snapshot.drawerOpen,
    })
  }
  if (normalized === 'simple' && (changed || options.reconcile)) {
    reconcileSimpleModeState(options.stores ?? registeredStores)
  }
  if (changed) {
    emitChange()
  }
  return snapshot
}

export function setClipDrawerOpen(open) {
  const nextOpen = Boolean(open)
  if (nextOpen === snapshot.drawerOpen) return snapshot
  snapshot = Object.freeze({
    mode: snapshot.mode,
    drawerOpen: nextOpen,
  })
  emitChange()
  return snapshot
}

export function toggleClipDrawer() {
  return setClipDrawerOpen(!snapshot.drawerOpen)
}

export function reloadClipUiModeFromStorage() {
  const nextMode = readStoredMode()
  if (nextMode === snapshot.mode) return snapshot
  snapshot = Object.freeze({
    mode: nextMode,
    drawerOpen: snapshot.drawerOpen,
  })
  emitChange()
  return snapshot
}

export function resetClipUiModeForTest(overrides = {}) {
  registeredStores = {}
  const mode = Object.hasOwn(overrides, 'mode') ? normalizeMode(overrides.mode) : readStoredMode()
  const drawerOpen = Object.hasOwn(overrides, 'drawerOpen') ? Boolean(overrides.drawerOpen) : true
  snapshot = Object.freeze({ mode, drawerOpen })
  emitChange()
  return snapshot
}
