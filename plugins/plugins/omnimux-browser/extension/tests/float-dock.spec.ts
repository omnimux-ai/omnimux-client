// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { dockFloatToNativeSidePanel } from '../src/panel/float-dock.ts'

describe('dockFloatToNativeSidePanel', () => {
  const hostLocation = { ancestorOrigins: ['https://example.com'] }

  it('opens the native side panel and collapses the workstation with unload', () => {
    const open = vi.fn(async () => {})
    const postMessage = vi.fn()
    dockFloatToNativeSidePanel(
      {
        sidePanel: { open },
        windows: { WINDOW_ID_CURRENT: -2 },
      },
      { parent: { postMessage }, location: hostLocation },
      true,
    )
    expect(open).toHaveBeenCalledWith({ windowId: -2 })
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'COLLAPSE_WORKSTATION', unload: true },
      'https://example.com',
    )
  })

  it('can collapse without unloading when unload is false', () => {
    const open = vi.fn(async () => {})
    const postMessage = vi.fn()
    dockFloatToNativeSidePanel(
      {
        sidePanel: { open },
        windows: { WINDOW_ID_CURRENT: 7 },
      },
      { parent: { postMessage }, location: hostLocation },
      false,
    )
    expect(open).toHaveBeenCalledWith({ windowId: 7 })
    expect(postMessage).toHaveBeenCalledWith({ type: 'COLLAPSE_WORKSTATION' }, 'https://example.com')
  })

  it('still posts collapse when sidePanel.open is missing', () => {
    const postMessage = vi.fn()
    dockFloatToNativeSidePanel(
      { windows: { WINDOW_ID_CURRENT: 1 } },
      { parent: { postMessage }, location: hostLocation },
    )
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'COLLAPSE_WORKSTATION', unload: true },
      'https://example.com',
    )
  })

  it('swallows open failures without throwing', () => {
    const open = vi.fn(() => {
      throw new Error('no gesture')
    })
    const postMessage = vi.fn()
    expect(() => dockFloatToNativeSidePanel(
      {
        sidePanel: { open },
        windows: { WINDOW_ID_CURRENT: 1 },
      },
      { parent: { postMessage }, location: hostLocation },
    )).not.toThrow()
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'COLLAPSE_WORKSTATION', unload: true },
      'https://example.com',
    )
  })
})
