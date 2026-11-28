import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  hooks: [] as Array<{ current: unknown }>,
  hookCursor: 0,
  effects: [] as Array<{ fn: () => unknown; deps?: readonly unknown[] }>,
  confirmLan: true,
  busy: undefined as string | undefined,
  settingsWritable: true,
  browserAccess: true,
  mode: 'compatibility' as const,
  setConfirmLan: vi.fn(),
  setNetworkExposure: vi.fn(),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const idx = state.hookCursor++
      if (!state.hooks[idx]) state.hooks[idx] = { current: initial }
      return state.hooks[idx]
    },
    useEffect: (fn: () => unknown, deps?: readonly unknown[]) => {
      state.effects.push({ fn, deps })
    },
  }
})

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  SegmentedTabs: () => null,
}))

vi.mock('../src/client/desktop-settings/use-desktop-settings-section.ts', () => ({
  useDesktopSettingsSection: (props: { t: (k: string) => string }) => ({
    t: props.t,
    tabsId: 'tabs',
    tab: 'access',
    setTab: () => {},
    operationFailed: false,
    operationError: null,
    aaStatus: 'idle',
    restart: 'none',
    busy: state.busy,
    settingsWritable: state.settingsWritable,
    browserAccess: state.browserAccess,
    mode: state.mode,
    confirmLan: state.confirmLan,
    setConfirmLan: state.setConfirmLan,
    setNetworkExposure: state.setNetworkExposure,
  }),
}))

vi.mock('../src/client/desktop-settings/general-tab.tsx', () => ({ DesktopSettingsGeneralTab: () => null }))
vi.mock('../src/client/desktop-settings/profiles-tab.tsx', () => ({ DesktopSettingsProfilesTab: () => null }))
vi.mock('../src/client/desktop-settings/access-tab.tsx', () => ({ DesktopSettingsAccessTab: () => null }))
vi.mock('../src/client/desktop-settings/diagnostics-tab.tsx', () => ({ DesktopSettingsDiagnosticsTab: () => null }))

import { DesktopSettingsSection, type DesktopSettingsSectionProps } from '../src/client/DesktopSettingsSection.tsx'
import { desktopTranslate } from '../src/client/settings.tsx'
import { installDialogKeyboardIsolation } from '../../dsh-plugin-desktop/src/client/modal-keyboard.ts'

afterEach(() => {
  state.hooks = []
  state.hookCursor = 0
  state.effects = []
  state.confirmLan = true
  state.busy = undefined
  state.settingsWritable = true
  state.browserAccess = true
  state.mode = 'compatibility'
  state.setConfirmLan.mockReset()
  state.setNetworkExposure.mockReset()
  vi.unstubAllGlobals()
})

class MockElement extends EventTarget {
  disabled = false
  attributes = new Map<string, string>()
  children: MockElement[] = []
  isConnected = true
  constructor(
    readonly id: string,
    private readonly owner: { activeElement: MockElement | null },
  ) {
    super()
  }
  focus(): void {
    if (!this.disabled) this.owner.activeElement = this
  }
  hasAttribute(name: string): boolean {
    if (name === 'disabled') return this.disabled
    return this.attributes.has(name)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  contains(target: unknown): boolean {
    return target === this || this.children.some(child => child.contains(target))
  }
  querySelectorAll(): MockElement[] {
    return this.children
  }
}

function findElement(node: unknown, predicate: (el: { type: unknown; props: Record<string, unknown> }) => boolean): { type: unknown; props: Record<string, unknown> } | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return undefined
  }
  const candidate = node as { type?: unknown; props?: Record<string, unknown> }
  if (candidate.props && predicate({ type: candidate.type, props: candidate.props })) return candidate as { type: unknown; props: Record<string, unknown> }
  if (candidate.props && 'children' in candidate.props) return findElement(candidate.props.children, predicate)
  return undefined
}

describe('Next DesktopSettingsSection LAN modal stability & keyboard isolation', () => {
  it('binds Next LAN modal isolation solely to confirmLan, handles backdrop dismiss, and defers disabled trigger focus restore', () => {
    const props = {
      t: desktopTranslate('zh'),
      api: { read: async () => ({}) },
      platform: 'darwin',
      version: '2.0.3',
      initialMode: 'compatibility',
      setMode: async () => {},
      desktopSettings: { getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, set: async () => true },
      notificationSettings: { getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, set: async () => true },
    } as unknown as DesktopSettingsSectionProps

    state.confirmLan = true
    state.busy = 'web'
    state.settingsWritable = false
    const tree = DesktopSettingsSection(props)
    expect(state.effects.map(entry => entry.deps)).toEqual([[true], ['web', true, false, true, 'compatibility']])

    const backdrop = findElement(tree, el => el.props.className === 'dshDesktopSettingsDialogBackdrop')!
    const cancelBtn = findElement(tree, el => String(el.props.className ?? '').includes('dshDesktopSettingsButtonSecondary'))!
    const confirmBtn = findElement(tree, el => String(el.props.className ?? '').includes('dshDesktopSettingsButtonDanger'))!
    const accessTab = findElement(tree, el => typeof el.type === 'function' && 'webGroupRef' in el.props)!

    ;(backdrop.props.onClick as (e: { target: unknown; currentTarget: unknown }) => void)({ target: 'dialog', currentTarget: 'backdrop' })
    expect(state.setConfirmLan).not.toHaveBeenCalled()

    ;(backdrop.props.onClick as (e: { target: unknown; currentTarget: unknown }) => void)({ target: 'same', currentTarget: 'same' })
    expect(state.setConfirmLan).toHaveBeenCalledWith(false)
    expect(state.setNetworkExposure).not.toHaveBeenCalled()

    state.setConfirmLan.mockReset()
    ;(cancelBtn.props.onClick as () => void)()
    expect(state.setConfirmLan).toHaveBeenCalledWith(false)
    expect(state.setNetworkExposure).not.toHaveBeenCalled()

    state.setConfirmLan.mockReset()
    ;(confirmBtn.props.onClick as () => void)()
    expect(state.setConfirmLan).toHaveBeenCalledWith(false)
    expect(state.setNetworkExposure).toHaveBeenCalledWith('lan')

    const docState: { activeElement: MockElement | null } = { activeElement: null }
    class FakeHTMLElement extends MockElement {}
    const FakeTrigger = new FakeHTMLElement('lan-trigger', docState)
    const FakeWebGroup = new FakeHTMLElement('web-group', docState)
    const FakeDialog = new FakeHTMLElement('lan-dialog', docState)
    const FakeCancel = new FakeHTMLElement('cancel', docState)
    FakeDialog.children = [FakeCancel]
    docState.activeElement = FakeTrigger

    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('Node', FakeHTMLElement)
    vi.stubGlobal('document', docState)
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })

    ;(state.hooks[0]!.current as unknown) = FakeCancel
    ;(state.hooks[1]!.current as unknown) = FakeDialog
    ;(accessTab.props.webGroupRef as { current: unknown }).current = FakeWebGroup

    const modalCleanup = state.effects[0]!.fn() as () => void
    expect(docState.activeElement).toBe(FakeCancel)

    FakeTrigger.disabled = true
    modalCleanup()
    expect(docState.activeElement).toBe(FakeWebGroup)

    state.effects = []
    state.hookCursor = 0
    state.confirmLan = false
    state.busy = undefined
    state.settingsWritable = true
    DesktopSettingsSection({ ...props })
    expect(state.effects.map(entry => entry.deps)).toEqual([[false], [undefined, false, true, true, 'compatibility']])

    FakeTrigger.disabled = false
    state.effects[1]!.fn()
    expect(docState.activeElement).toBe(FakeTrigger)

    // Disconnected trigger clears pending focus target without error or stealing focus.
    state.effects = []
    state.hookCursor = 0
    state.confirmLan = true
    DesktopSettingsSection({ ...props })
    docState.activeElement = FakeTrigger
    FakeTrigger.disabled = true
    const cleanup2 = state.effects[0]!.fn() as () => void
    cleanup2()
    expect(docState.activeElement).toBe(FakeWebGroup)

    FakeTrigger.isConnected = false
    FakeTrigger.disabled = false
    state.effects = []
    state.hookCursor = 0
    state.confirmLan = false
    DesktopSettingsSection({ ...props })
    state.effects[1]!.fn()
    expect(docState.activeElement).toBe(FakeWebGroup)
  })

  it('traps Tab/Shift+Tab, intercepts Escape in capture phase, and defers disabled trigger restoration', () => {
    const captureListeners = new Set<EventListenerOrEventListenerObject>()
    const bubbleListeners = new Set<EventListenerOrEventListenerObject>()
    const invokeListener = (listener: EventListenerOrEventListenerObject, event: Event) => {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
    const winTarget = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
        if (type !== 'keydown') return
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
        ;(capture ? captureListeners : bubbleListeners).add(listener)
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
        if (type !== 'keydown') return
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
        ;(capture ? captureListeners : bubbleListeners).delete(listener)
      },
      dispatchKeyEvent(ev: Event & { _stopped?: boolean }) {
        for (const listener of [...captureListeners]) {
          invokeListener(listener, ev)
          if (ev._stopped) return
        }
        for (const listener of [...bubbleListeners]) {
          invokeListener(listener, ev)
          if (ev._stopped) return
        }
      },
    }
    const docState: { activeElement: MockElement | null } = { activeElement: null }
    const dialog = new MockElement('lan-dialog', docState)

    class FakeHTMLElement extends MockElement {}
    const FakeTrigger = new FakeHTMLElement('lan-trigger', docState)
    const FakeCancel = new FakeHTMLElement('cancel', docState)
    const FakeConfirm = new FakeHTMLElement('confirm', docState)
    dialog.children = [FakeCancel, FakeConfirm]
    docState.activeElement = FakeTrigger

    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('Node', FakeHTMLElement)
    vi.stubGlobal('document', docState)
    vi.stubGlobal('window', {
      addEventListener: winTarget.addEventListener.bind(winTarget),
      removeEventListener: winTarget.removeEventListener.bind(winTarget),
    })

    const onDismiss = vi.fn()
    const onDisabledReturn = vi.fn()
    const parentEscape = vi.fn()
    winTarget.addEventListener('keydown', e => {
      if ((e as unknown as { key: string }).key === 'Escape') parentEscape()
    })

    const cleanup = installDialogKeyboardIsolation(
      dialog as unknown as HTMLElement,
      FakeCancel as unknown as HTMLElement,
      onDismiss,
      onDisabledReturn,
    )
    expect(docState.activeElement).toBe(FakeCancel)

    const makeKey = (key: string, shiftKey = false) => {
      let stopped = false
      const ev = new Event('keydown', { cancelable: true }) as Event & { key: string; shiftKey: boolean; _stopped?: boolean }
      ev.key = key
      ev.shiftKey = shiftKey
      const origStop = ev.stopPropagation.bind(ev)
      const origStopImmediate = ev.stopImmediatePropagation.bind(ev)
      ev.stopPropagation = () => {
        stopped = true
        ev._stopped = true
        origStop()
      }
      ev.stopImmediatePropagation = () => {
        stopped = true
        ev._stopped = true
        origStopImmediate()
      }
      return { ev, wasStopped: () => stopped }
    }

    FakeConfirm.focus()
    const fwdWrap = makeKey('Tab', false)
    winTarget.dispatchKeyEvent(fwdWrap.ev)
    expect(fwdWrap.ev.defaultPrevented).toBe(true)
    expect(docState.activeElement).toBe(FakeCancel)

    const backWrap = makeKey('Tab', true)
    winTarget.dispatchKeyEvent(backWrap.ev)
    expect(backWrap.ev.defaultPrevented).toBe(true)
    expect(docState.activeElement).toBe(FakeConfirm)

    const esc = makeKey('Escape')
    winTarget.dispatchKeyEvent(esc.ev)
    expect(esc.ev.defaultPrevented).toBe(true)
    expect(esc.wasStopped()).toBe(true)
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(parentEscape).not.toHaveBeenCalled()

    FakeTrigger.disabled = true
    cleanup()
    expect(onDisabledReturn).toHaveBeenCalledWith(FakeTrigger)
  })
})
