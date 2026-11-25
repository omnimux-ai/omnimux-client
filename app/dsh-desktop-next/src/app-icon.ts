/** OmniMux ships a single branded app icon; legacy upstream `'classic'` values normalize to `'default'`. */

/**
 * Only `'default'` (the OmniMux icon every package installs) is active. Upstream's `'classic'`
 * DeepSeek whale choice is retired and normalized on read so existing preference files stay valid.
 */
export type DesktopAppIcon = 'default'

export const DESKTOP_APP_ICONS: readonly DesktopAppIcon[] = Object.freeze(['default'])

export function isDesktopAppIcon(value: unknown): value is DesktopAppIcon {
  return value === 'default'
}

/**
 * Normalize stored preference values, mapping retired upstream `'classic'` to `'default'`.
 * Returns `undefined` for unrecognized values so callers can still reject or warn on corruption.
 */
export function normalizeDesktopAppIcon(value: unknown): DesktopAppIcon | undefined {
  if (value === 'default' || value === 'classic') return 'default'
  return undefined
}
