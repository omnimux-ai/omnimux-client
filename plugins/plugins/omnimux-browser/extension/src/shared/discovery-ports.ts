/**
 * Loopback instance discovery — the single source of truth for both the panel
 * and the background worker.
 *
 * The desktop shell binds its first default port and, when that port is taken,
 * walks forward one port at a time (see `app/dsh-plugin-desktop/src/webserver.ts`).
 * The known defaults are therefore probed first, then two small bounded windows
 * cover that collision walk. Never widen this into a full-port scan: every extra
 * port is an HTTP request the service worker has to finish before the panel can
 * render its instance list.
 *
 * Port defaults (identity is still read from the instance itself first — a
 * 44120 listener may be either the Prod app or a legacy Dev app):
 * - 45120: OmniMux Dev default;
 * - 44120: OmniMux Prod default; also used by older Dev builds;
 * - 43120: DSH Desktop;
 * - 43128: historical DSH Desktop fallback, deliberately unnamed now (it used
 *   to be mislabeled as "OmniMux PRD");
 * - 3080/3081/3090: `dsh web` CLI; 14389/43189: legacy desktop ports.
 */

export interface KnownInstanceMeta {
  id: string
  nameZh: string
  nameEn: string
  isRecommended?: boolean
}

/** Product-name fallbacks; an instance's own bridge-config identity wins over these. */
export const OMNIMUX_DEV_INSTANCE_NAME = 'OmniMux Dev'
export const OMNIMUX_PROD_INSTANCE_NAME = 'OmniMux Prod'

export const KNOWN_INSTANCE_NAMES: Record<number, KnownInstanceMeta> = {
  45120: { id: 'omnimux_dev', nameZh: OMNIMUX_DEV_INSTANCE_NAME, nameEn: OMNIMUX_DEV_INSTANCE_NAME, isRecommended: true },
  44120: { id: 'omnimux_prod', nameZh: OMNIMUX_PROD_INSTANCE_NAME, nameEn: OMNIMUX_PROD_INSTANCE_NAME },
  43120: { id: 'dsh_desktop', nameZh: 'DSH Desktop', nameEn: 'DSH Desktop' },
}

/** Named ports sort first inside one status group, in this order. */
export const KNOWN_PORT_PRIORITY: readonly number[] = [45120, 44120, 43120]

/**
 * Bounded collision windows for the two app channels. Keep each range small:
 * the desktop shell retries sequentially, and these windows cover the ordinary
 * one-or-two-port collisions without turning discovery into a scan.
 */
export const FALLBACK_PORT_RANGES: readonly (readonly [number, number])[] = [
  [45120, 45129],
  [44120, 44129],
]

const BASE_PORTS: readonly number[] = [45120, 44120, 43120, 43128, 3080, 3081, 3090, 14389, 43189]

/**
 * Keep the two channels' collision windows interleaved so a serial consumer
 * (host HTTP helpers) reaches a 4512x or 4412x fallback within two probes, not
 * after the whole Dev window. Ordering does not slow the concurrent discovery:
 * every probe starts at once and the winner answers immediately.
 */
function expandPorts(): number[] {
  const ports = [...BASE_PORTS]
  const windows = FALLBACK_PORT_RANGES.map(([start, end]) => {
    const list = []
    for (let port = start; port <= end; port += 1) list.push(port)
    return list
  })
  const interleaved: number[] = []
  for (let index = 0; index < Math.max(...windows.map((list) => list.length)); index += 1) {
    for (const list of windows) {
      if (list[index] !== undefined) interleaved.push(list[index]!)
    }
  }
  // Default ports first, then the interleaved collision windows, then the rest.
  const ordered = [45120, 44120, ...interleaved.filter((port) => port !== 45120 && port !== 44120), ...ports]
  return [...new Set(ordered)]
}

/** Every loopback port discovery may probe, in priority order. */
export const DISCOVERY_PORTS: readonly number[] = Object.freeze(expandPorts())

/** True for a port this module's bounded sweep knows about (known or collision window). */
export function isDiscoveryPort(port: number): boolean {
  return DISCOVERY_PORTS.includes(port) || port in KNOWN_INSTANCE_NAMES
}

/**
 * Identity fields the bridge-config endpoint may publish. They are optional so
 * older hosts that only send `wsUrl` keep working; the port fallback covers them.
 */
export interface BridgeConfigIdentity {
  wsUrl?: unknown
  locale?: unknown
  modelGroups?: unknown
  /** `dev` or `prod` when the host knows its release channel. */
  channel?: unknown
  /** Human-readable instance name; preferred over the port fallback. */
  name?: unknown
}

/** Resolve the bridge-config identity fields into a display name, if present. */
export function identityNameFromBridgeConfig(body: BridgeConfigIdentity): string {
  if (typeof body.name === 'string' && body.name.trim() !== '') return body.name.trim()
  if (body.channel === 'dev') return OMNIMUX_DEV_INSTANCE_NAME
  if (body.channel === 'prod') return OMNIMUX_PROD_INSTANCE_NAME
  return ''
}
