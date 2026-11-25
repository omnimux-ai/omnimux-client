/**
 * DP-007 contract regression test: verify that the patched
 * @deepseek-ai/dsh-client-ui-layout@0.2.2-rc.5 runtime bundle exposes
 * ctx.layout.getSnapshot() (including rightbarAuthored to distinguish the 45%
 * openRightbar seed from explicit setRightbar writes) and ctx.layout.setRightbar(px).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import type { ILayout, LayoutSnapshot } from '@deepseek-ai/dsh-client-ui-layout/client'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import { describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)

interface LoadedClientModule {
  apply: (ctx: unknown) => void
  LayoutController: new (...args: unknown[]) => ILayout
}

function loadPatchedUiLayoutClient(viewportWidth = 1728): LoadedClientModule {
  const clientEntry = requireFromHere.resolve('@deepseek-ai/dsh-client-ui-layout/client')
  const source = readFileSync(clientEntry, 'utf8')

  let loadedFactory: ((req: (id: string) => unknown) => LoadedClientModule) | null = null
  const fakeDoc = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      textContent: '',
      name: '',
      content: '',
      isConnected: false,
      remove: () => {},
    }),
    head: { append: () => {}, appendChild: () => {} },
    body: {
      style: { setProperty: () => {}, removeProperty: () => {} },
      setAttribute: () => {},
      removeAttribute: () => {},
    },
    documentElement: {
      dataset: { platform: 'darwin' },
      style: { colorScheme: '', removeProperty: () => {} },
      setAttribute: () => {},
      removeAttribute: () => {},
      hasAttribute: () => false,
    },
  }
  const fakeWindow = {
    innerWidth: viewportWidth,
    __ModuleLoader__: {
      load(spec: { id: string; factory: (req: (id: string) => unknown) => LoadedClientModule }) {
        loadedFactory = spec.factory
      },
    },
  }

  const script = new Script(source, { filename: clientEntry })
  script.runInNewContext({
    window: fakeWindow,
    document: fakeDoc,
    getComputedStyle: () => ({ backgroundColor: 'rgb(20, 20, 22)' }),
    AbortController,
    matchMedia: undefined,
    console,
    Math,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Symbol,
    Error,
    Map,
    Set,
    Promise,
  })

  const factory = loadedFactory as ((req: (id: string) => unknown) => LoadedClientModule) | null
  if (!factory) throw new Error('DP-007 test: failed to capture __ModuleLoader__ factory')
  return factory((id: string) => {
    if (id === '@deepseek-ai/dsh-client-store') return clientStore
    if (id === 'react') {
      return {
        useRef: () => ({ current: null }),
        useState: (init: unknown) => [init, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useCallback: (fn: unknown) => fn,
        useMemo: (fn: () => unknown) => fn(),
      }
    }
    if (id === 'react/jsx-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    }
    throw new Error(`Unexpected module request in ui-layout client: ${id}`)
  })
}

function mountLayoutService(viewportWidth = 1728): { layout: ILayout; disposeAll: () => void } {
  const mod = loadPatchedUiLayoutClient(viewportWidth)
  let providedLayout: ILayout | null = null
  const disposers: Array<() => void> = []

  const fakeCtx = {
    effect(fn: () => void | (() => void)) {
      const cleanup = fn()
      if (typeof cleanup === 'function') disposers.push(cleanup)
    },
    locale: {
      register: () => () => {},
      bind: () => (k: string) => k,
    },
    slots: {
      entries: () => [],
      subscribe: () => () => {},
      provideRoot: () => () => {},
      register: () => () => {},
    },
    reflect: {
      provide(name: string, service: unknown) {
        if (name === 'layout') providedLayout = service as ILayout
        return () => {}
      },
    },
    shortcuts: {
      register: () => () => {},
    },
    theme: {
      getTheme: () => ({
        preference: 'dark',
        active: { colorScheme: 'dark', tokens: {} },
        fontSizes: { text: 14, code: 13, terminal: 13 },
        fontFamilies: { text: '', code: '', terminal: '' },
      }),
    },
    on: () => () => {},
  }

  mod.apply(fakeCtx)
  if (!providedLayout) throw new Error('DP-007 test: ctx.reflect.provide("layout") was not called')
  return {
    layout: providedLayout,
    disposeAll: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

describe('DP-007: dsh-client-ui-layout@0.2.2-rc.5 LayoutController contract', () => {
  it('exposes getSnapshot() and distinguishes openRightbar 45% seed from explicit setRightbar writes', () => {
    const { layout, disposeAll } = mountLayoutService(1728)
    try {
      expect(typeof layout.getSnapshot).toBe('function')
      expect(typeof layout.setRightbar).toBe('function')

      const initial = layout.getSnapshot() as LayoutSnapshot
      expect(initial).not.toBeNull()
      expect(initial.viewportWidth).toBe(1728)
      expect(initial.sidebar).toBe(280)
      expect(initial.rightbar).toBeNull()
      expect(initial.rightbarAuthored).toBe(false)
      expect(initial.rightbarShown).toBe(false)

      // First openRightbar seeds 45% (778px) without marking rightbarAuthored true (prevents H-1 new-user migration bug).
      layout.openRightbar(true, false)
      const afterSeed = layout.getSnapshot() as LayoutSnapshot
      expect(afterSeed.rightbar).toBe(Math.round(1728 * 0.45))
      expect(afterSeed.rightbarAuthored).toBe(false)
      expect(afterSeed.rightbarShown).toBe(true)
      expect(afterSeed.rightbarTrack).toBe(true)
      expect(afterSeed.rightbarFullscreen).toBe(false)

      // Explicit setRightbar persists requested width (within upstream clamp) and marks rightbarAuthored true.
      layout.setRightbar(1014)
      const afterSet = layout.getSnapshot() as LayoutSnapshot
      expect(afterSet.rightbar).toBe(1014)
      expect(afterSet.rightbarAuthored).toBe(true)
      expect(afterSet.rightbarInstant).toBe(false)
    } finally {
      disposeAll()
    }
  })

  it('clamps setRightbar to upstream [300, viewport * 0.7] bounds and returns a detached shallow snapshot copy', () => {
    const { layout, disposeAll } = mountLayoutService(1728)
    try {
      layout.setRightbar(120)
      expect(layout.getSnapshot()?.rightbar).toBe(300)

      layout.setRightbar(99999)
      expect(layout.getSnapshot()?.rightbar).toBe(1728 * 0.7)

      const snap = layout.getSnapshot() as unknown as Record<string, unknown>
      snap.rightbar = 42
      expect(layout.getSnapshot()?.rightbar).toBe(1728 * 0.7)
    } finally {
      disposeAll()
    }
  })
})
