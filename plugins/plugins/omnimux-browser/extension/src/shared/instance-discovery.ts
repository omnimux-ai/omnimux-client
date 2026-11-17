/**
 * Instance dynamic discovery — single source of truth for the panel-side
 * instance selector (spec: specs/instance-dynamic-discovery.md).
 *
 * - DISCOVERY_PORTS, KNOWN_INSTANCE_NAMES and KNOWN_PORT_PRIORITY live in
 *   ./discovery-ports.ts and are shared with src/background/index.ts; neither
 *   side keeps a second copy.
 * - The recommended badge attaches to the Dev default (45120) only.
 * - probeInstance / discoverInstances implement the three-way verdict:
 *     online      — 200 + JSON whose `wsUrl` starts with `ws://`
 *     unavailable — an HTTP response arrived but carried no usable `wsUrl`
 *     offline     — timeout / network error / anything else
 */

import { loopbackFetch } from './loopback-fetch.ts'
import {
  DISCOVERY_PORTS,
  KNOWN_INSTANCE_NAMES,
  KNOWN_PORT_PRIORITY,
  identityNameFromBridgeConfig,
  isDiscoveryPort,
  type BridgeConfigIdentity,
} from './discovery-ports.ts'

export { DISCOVERY_PORTS, KNOWN_INSTANCE_NAMES, KNOWN_PORT_PRIORITY } from './discovery-ports.ts'

export type InstanceStatus = 'online' | 'unavailable' | 'offline'

export interface DiscoveredInstance {
  id: string
  port: number
  nameZh: string
  nameEn: string
  status: InstanceStatus
  latencyMs?: number
  isRecommended: boolean
  /** True when the port came from the caller's extras rather than the discovery list. */
  isCustom: boolean
}

const PROBE_TIMEOUT_MS = 1200

/**
 * Probe a single port's /ext/bridge-config. Any HTTP response at all means a
 * service listens there; only a `ws://` wsUrl marks it bridge-ready.
 *
 * The instance's own identity (`name` / `channel` in the response) wins over the
 * static port name: 44120 may be either OmniMux Prod or a legacy Dev instance,
 * so the port alone cannot decide the label.
 */
export async function probeInstance(port: number): Promise<DiscoveredInstance> {
  const known = KNOWN_INSTANCE_NAMES[port]
  const base = {
    id: known?.id ?? `local_${port}`,
    port,
    nameZh: known?.nameZh ?? '本地实例',
    nameEn: known?.nameEn ?? 'Local',
    isRecommended: known?.isRecommended ?? false,
    isCustom: !isDiscoveryPort(port),
  }
  const start = Date.now()
  try {
    const response = await loopbackFetch(`http://127.0.0.1:${port}/ext/bridge-config`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const latencyMs = Date.now() - start
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as BridgeConfigIdentity
      if (typeof body.wsUrl === 'string' && body.wsUrl.startsWith('ws://')) {
        const identityName = identityNameFromBridgeConfig(body)
        return {
          ...base,
          nameZh: identityName !== '' ? identityName : base.nameZh,
          nameEn: identityName !== '' ? identityName : base.nameEn,
          status: 'online',
          latencyMs,
        }
      }
    }
    // 有响应但没有可用的 wsUrl（含 403 forbidden）：实例在跑但未开放 bridge。
    return { ...base, status: 'unavailable', latencyMs }
  } catch {
    return { ...base, status: 'offline' }
  }
}

function statusRank(status: InstanceStatus): number {
  return status === 'online' ? 0 : status === 'unavailable' ? 1 : 2
}

function portRank(port: number): number {
  const pri = KNOWN_PORT_PRIORITY.indexOf(port)
  if (pri >= 0) return pri
  const idx = DISCOVERY_PORTS.indexOf(port)
  return KNOWN_PORT_PRIORITY.length + (idx >= 0 ? idx : DISCOVERY_PORTS.length)
}

/**
 * Probe DISCOVERY_PORTS (plus any caller-supplied ports, e.g. the saved custom
 * target) concurrently and return the visible row list in spec order:
 * online → unavailable → offline; within a group, ports in KNOWN_PORT_PRIORITY
 * keep that order, unnamed DISCOVERY_PORTS follow in DISCOVERY_PORTS order, and
 * custom extras sort ascending last. Extras that duplicate a known port
 * collapse onto the known entry; offline rows render only for
 * KNOWN_INSTANCE_NAMES ports — an unreachable unnamed port has no useful
 * identity and is dropped.
 */
export async function discoverInstances(extraPorts: readonly number[] = []): Promise<DiscoveredInstance[]> {
  const extras = [...new Set(extraPorts)].filter(
    (p) => Number.isInteger(p) && p > 0 && p <= 65535 && !DISCOVERY_PORTS.includes(p),
  )
  const ports = [...DISCOVERY_PORTS, ...extras]
  const results = await Promise.allSettled(ports.map((p) => probeInstance(p)))

  const instances: DiscoveredInstance[] = []
  for (const res of results) {
    const inst = res.status === 'fulfilled'
      ? res.value
      : {
          id: 'unknown',
          port: 0,
          nameZh: '本地实例',
          nameEn: 'Local',
          status: 'offline' as const,
          isRecommended: false,
          isCustom: true,
        }
    // 离线行只对 KNOWN_INSTANCE_NAMES 内的已知端口渲染；映射表外的端口
    // （未命名 DISCOVERY_PORTS 与 custom extras）离线一律不展示——
    // 离线的未知端口没有可用身份。extraPorts 与已知端口同号时收敛为已知条目
    // （probeInstance 已按端口表判定）。
    if (inst.status === 'offline' && !KNOWN_INSTANCE_NAMES[inst.port]) continue
    instances.push(inst)
  }

  instances.sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status)
    if (byStatus !== 0) return byStatus
    const aKnown = !a.isCustom
    const bKnown = !b.isCustom
    if (aKnown !== bKnown) return aKnown ? -1 : 1
    return aKnown ? portRank(a.port) - portRank(b.port) : a.port - b.port
  })

  return instances
}

export type UiLocale = 'zh' | 'en'

/** spec §4 文案字典（逐字锁定，不得增删元素）。 */
export const INSTANCE_SELECTOR_COPY = {
  zh: {
    selectInstance: '选择实例',
    localInstance: '本地实例',
    recommended: '推荐',
    statusOnline: (ms: number) => `在线 · ${ms}ms`,
    statusUnavailable: '未开放',
    statusOffline: '离线',
    emptyInstances: '未发现可用实例',
    detecting: '检测中',
    refresh: '刷新',
    customPort: '自定义端口',
    customPortPlaceholder: '端口号',
    customConfirm: '确定',
  },
  en: {
    selectInstance: 'Select instance',
    localInstance: 'Local',
    recommended: 'Recommended',
    statusOnline: (ms: number) => `Online · ${ms}ms`,
    statusUnavailable: 'Unavailable',
    statusOffline: 'Offline',
    emptyInstances: 'No instances found',
    detecting: 'Detecting',
    refresh: 'Refresh',
    customPort: 'Custom port',
    customPortPlaceholder: 'Port',
    customConfirm: 'Add',
  },
} as const

export function instanceStatusText(inst: DiscoveredInstance, locale: UiLocale): string {
  const copy = INSTANCE_SELECTOR_COPY[locale]
  if (inst.status === 'online') return copy.statusOnline(inst.latencyMs ?? 0)
  if (inst.status === 'unavailable') return copy.statusUnavailable
  return copy.statusOffline
}
