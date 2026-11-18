// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopOnboarding, registerDesktopOnboarding } from '../src/client/onboarding.tsx'
import type { DesktopOnboardingBridge, DesktopOnboardingSnapshot } from '../src/setup-onboarding-bridge.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => createElement('button', props, children),
  Toast: () => null,
}))

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

function bridge(value: DesktopOnboardingSnapshot | null): DesktopOnboardingBridge {
  return {
    read: vi.fn().mockResolvedValue(value),
    finish: vi.fn().mockResolvedValue(undefined),
    dismissAccount: vi.fn().mockResolvedValue(undefined),
  }
}

async function mount(value: DesktopOnboardingSnapshot | null, options: {
  accountStatus?: 'loading' | 'error' | 'signed-out' | 'credential-stored'
  renderSlot?: (name: string, owner: unknown, opts?: { fallback?: ReactNode }) => ReactNode
} = {}) {
  const renderSurface = vi.fn((children: ReactNode) => children)
  const renderLoading = vi.fn(() => createElement('div', { 'data-loading': '' }))
  const renderNext = vi.fn(() => createElement('div', { 'data-official-next': '' }))
  const renderNavigation = vi.fn((_options: unknown) => createElement('footer', { 'data-navigation': '' }))
  const renderSlot = vi.fn(options.renderSlot ?? ((_name: string, _owner: unknown, opts?: { fallback?: ReactNode }) =>
    createElement('div', { 'data-runtime-slot': '' }, opts?.fallback ?? null)))
  const content = vi.fn(() => createElement('div', { 'data-setup': '' }))
  const props = {
    bridge: bridge(value),
    content,
    zh: true,
    renderSurface,
    renderLoading,
    renderNext,
    renderNavigation,
    renderSlot,
    accountStatus: options.accountStatus ?? 'signed-out',
    openLogin: vi.fn(),
  }
  await act(async () => {
    root!.render(createElement(DesktopOnboarding, props as never))
    await Promise.resolve()
  })
  return { ...props, renderSlot, renderSurface, renderNext, content }
}

describe('runtime-only onboarding child slot (#77)', () => {
  it('declares the runtime child on the desktop onboarding registration', () => {
    const register = vi.fn()
    const inject = vi.fn((_name: string, callback: () => unknown) => callback())
    const ctx = {
      slots: { inject, register },
      locale: { getLocale: () => ({ active: 'zh' }) },
    }
    const previousBridge = (window as unknown as { dshDesktopSetup?: unknown }).dshDesktopSetup
    ;(window as unknown as { dshDesktopSetup?: unknown }).dshDesktopSetup = {}
    try {
      registerDesktopOnboarding(ctx as never, () => null)
      expect(inject).toHaveBeenCalledWith('onboarding.desktop.before', expect.any(Function))
      expect(register).toHaveBeenCalledWith(expect.objectContaining({
        name: 'onboarding.desktop.before',
        children: { 'onboarding.desktop.runtime': { kind: 'single', scope: 'root' } },
      }), DesktopOnboarding)
    } finally {
      ;(window as unknown as { dshDesktopSetup?: unknown }).dshDesktopSetup = previousBridge
    }
  })

  it('renders the runtime slot when no Desktop setup is pending', async () => {
    const mounted = await mount(null)
    expect(mounted.renderSlot).toHaveBeenCalledWith('onboarding.desktop.runtime', {
      accountStatus: 'signed-out',
      openLogin: expect.any(Function),
      renderSurface: expect.any(Function),
      renderNavigation: expect.any(Function),
    }, { fallback: null })
    expect(mounted.renderNext).not.toHaveBeenCalled()
    expect(container!.querySelector('[data-runtime-slot]')).not.toBeNull()
    expect(container!.querySelector('[data-official-next]')).toBeNull()
  })

  it('returns no page when the runtime child declines', async () => {
    const mounted = await mount(null, { renderSlot: () => null })
    expect(mounted.renderSlot).toHaveBeenCalledWith(
      'onboarding.desktop.runtime',
      expect.any(Object),
      { fallback: null },
    )
    expect(container!.innerHTML).toBe('')
  })

  it('keeps the stock fallback while removing OmniMux controller side effects', () => {
    const patch = readFileSync(resolve(process.cwd(), '../patches/dsh-client-ui-settings-account@0.2.1-rc.3.patch'), 'utf8')
    expect(patch).toContain('fallback: globalThis.dshDesktopSetup ? null : renderNext()')
    expect(patch).toContain('const controller = globalThis.dshDesktopSetup === void 0')
    expect(patch).toContain("'onboarding.desktop.runtime': { kind: 'single'; scope: 'root'; owner:")
    expect(patch).toContain('...controller === void 0 ? {} : { onboarding: controller.state }')
  })

  it('keeps the Desktop setup wizard ahead of the runtime slot', async () => {
    const setup = {
      required: true,
      profile: 'default',
      edition: 'desktop',
      input: { platform: 'darwin' },
    } as unknown as DesktopOnboardingSnapshot
    const mounted = await mount(setup)
    expect(mounted.content).toHaveBeenCalledTimes(1)
    expect(mounted.renderSlot).not.toHaveBeenCalled()
    expect(mounted.renderNext).not.toHaveBeenCalled()
    expect(container!.querySelector('[data-setup]')).not.toBeNull()
  })
})
