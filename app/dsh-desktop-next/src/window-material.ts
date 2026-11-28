/** Match the existing Desktop's native materials. Windows always renders an opaque window. */
import type { DesktopPreferences } from './desktop-contract.ts'
import type { DesktopPlatform, DesktopShellMode } from './runtime.ts'

export function windowMaterial(preferences: DesktopPreferences, platform = process.platform): 'off' | 'transparent' {
  if (platform === 'darwin') return preferences.macosMaterial
  return 'off'
}

export type MacosWindowMaterial = 'off' | 'transparent'
/** Windows no longer offers a selectable material; windows are always opaque. */
export type WindowsWindowMaterial = 'off'
/** Electron-native window transparency used by Linux generations. */
export type LinuxWindowMaterial = 'off' | 'transparent'
/** Persisted compatibility values accepted only so pre-removal settings still boot. */
export type PersistedWindowsWindowMaterial = WindowsWindowMaterial | 'acrylic' | 'mica'
export type DesktopWindowMaterial = MacosWindowMaterial | WindowsWindowMaterial | LinuxWindowMaterial

export const DEFAULT_MACOS_WINDOW_MATERIAL: MacosWindowMaterial = 'transparent'
export const DEFAULT_WINDOWS_WINDOW_MATERIAL: WindowsWindowMaterial = 'off'
export const DEFAULT_LINUX_WINDOW_MATERIAL: LinuxWindowMaterial = 'off'

export function parseMacosWindowMaterial(value: unknown): MacosWindowMaterial {
  if (value === undefined) return DEFAULT_MACOS_WINDOW_MATERIAL
  if (value === 'off' || value === 'transparent') return value
  throw new Error('dsh-desktop.macosMaterial must be "off" or "transparent"')
}

export function parseWindowsWindowMaterial(value: unknown): WindowsWindowMaterial {
  if (value === undefined) return DEFAULT_WINDOWS_WINDOW_MATERIAL
  if (value === 'off') return value
  if (value === 'acrylic' || value === 'mica') return 'off'
  throw new Error('dsh-desktop.windowsMaterial must be "off"')
}

export function parseLinuxWindowMaterial(value: unknown): LinuxWindowMaterial {
  if (value === undefined) return DEFAULT_LINUX_WINDOW_MATERIAL
  if (value === 'off' || value === 'transparent') return 'off'
  throw new Error('dsh-desktop.linuxMaterial must be "off" or "transparent"')
}

/** Resolve the actual generation material without making settings non-portable. */
export function effectiveDesktopWindowMaterial(
  mode: DesktopShellMode,
  platform: DesktopPlatform,
  macosMaterial: MacosWindowMaterial,
  linuxMaterial: LinuxWindowMaterial = DEFAULT_LINUX_WINDOW_MATERIAL,
): DesktopWindowMaterial {
  void mode
  if (platform === 'linux') return linuxMaterial
  if (platform === 'darwin') return macosMaterial
  return 'off'
}
