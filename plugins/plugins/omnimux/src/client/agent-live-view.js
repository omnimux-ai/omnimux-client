/**
 * Pure view rules for the local-CLI panel. They live apart from the React tree
 * so the reads (which URL, how many CLIs are installed, where a model list came
 * from, when a focus may re-scan) are directly testable.
 */

/** A focus may re-scan at most once per window; a scan costs local process calls. */
export const AGENT_AUTO_REFRESH_MS = 30000

/**
 * @param {boolean} [refresh] bypass the Host's model-probe cache
 * @returns {string}
 */
export function agentScanUrl(refresh) {
  return refresh === true ? '/omnimux/agents?refresh=1' : '/omnimux/agents'
}

/**
 * @param {boolean} [refresh] bypass the update-check cache
 * @returns {string}
 */
export function agentUpdatesUrl(refresh) {
  return refresh === true ? '/omnimux/agents/updates?refresh=1' : '/omnimux/agents/updates'
}

/**
 * How many of the known CLIs are actually installed.
 * @param {Array<{ installed?: boolean }>} agents
 * @returns {number}
 */
export function countInstalledAgents(agents) {
  if (!Array.isArray(agents)) return 0
  return agents.filter((agent) => agent && agent.installed === true).length
}

/**
 * The line under a CLI's name: its version, or why it cannot be used yet.
 * @param {(key: string, params?: Record<string, string>) => string} t
 * @param {{ version?: string, auth?: { state?: string, loginSupported?: boolean } } | null} agent
 * @returns {string}
 */
export function agentStatusText(t, agent) {
  if (agent && agent.auth && agent.auth.state === 'signed-out') {
    return agent.auth.loginSupported === true ? t('runtime.cliNeedsLogin') : t('runtime.unconfigured')
  }
  return (agent && typeof agent.version === 'string' && agent.version) || t('runtime.notDetected')
}

/**
 * Which provenance marker a row carries, or an empty string when the Host did
 * not say. Never invent one.
 * @param {{ modelsSource?: string } | null} agent
 * @returns {'live'|'preset'|''}
 */
export function agentModelSource(agent) {
  if (!agent) return ''
  if (agent.modelsSource === 'live') return 'live'
  if (agent.modelsSource === 'preset') return 'preset'
  return ''
}

/**
 * Whether a focus/visibility event may trigger a background re-scan.
 * @param {number} lastAt epoch ms of the previous automatic refresh (0 = never)
 * @param {number} now epoch ms
 * @param {string} [visibilityState]
 * @returns {boolean}
 */
export function shouldAutoRefresh(lastAt, now, visibilityState = 'visible') {
  if (visibilityState === 'hidden') return false
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true
  return now - lastAt >= AGENT_AUTO_REFRESH_MS
}

/**
 * Whether an agent card can be clicked/selected by the user.
 * Subscription-capable agents (Codex, Claude, Kimi) are selectable even when
 * the local CLI binary is not installed because Route 1 OAuth runs in-app.
 * @param {{ installed?: boolean, subscription?: { supported?: boolean } } | null} agent
 * @returns {boolean}
 */
export function isAgentSelectable(agent) {
  return Boolean(agent && (agent.installed === true || agent.subscription?.supported === true))
}

/**
 * Whether Route 2 (controlled read-only local CLI credential reuse) is ready.
 * @param {{ subscription?: { cliImport?: { importable?: boolean } } } | null} agent
 * @returns {boolean}
 */
export function canImportCliAuth(agent) {
  return Boolean(agent?.subscription?.cliImport?.importable === true)
}

/**
 * Compact connection status pill for an agent card, or null when unconfigured
 * and not selectable.
 * @param {(key: string, params?: Record<string, string>) => string} t
 * @param {{ installed?: boolean, subscription?: { supported?: boolean, connected?: boolean, cliImport?: { importable?: boolean } } } | null} agent
 * @returns {{ kind: 'connected' | 'cli-ready' | 'oauth' | 'cli-only', label: string } | null}
 */
export function agentConnectionBadge(t, agent) {
  if (!agent) return null
  const sub = agent.subscription
  if (sub && sub.supported === true) {
    if (sub.connected === true) return { kind: 'connected', label: t('runtime.badgeConnected') }
    if (sub.cliImport?.importable === true) return { kind: 'cli-ready', label: t('runtime.badgeCliReady') }
    return { kind: 'oauth', label: t('runtime.badgeOAuth') }
  }
  if (agent.installed === true) {
    return { kind: 'cli-only', label: t('runtime.badgeCliOnly') }
  }
  return null
}

/**
 * Secondary line under an agent card title. Preserves existing CLI version
 * behavior while surfacing OAuth availability when no local CLI is installed.
 * @param {(key: string, params?: Record<string, string>) => string} t
 * @param {{ installed?: boolean, version?: string, auth?: { state?: string, loginSupported?: boolean }, subscription?: { supported?: boolean, connected?: boolean, liveModels?: string[] } } | null} agent
 * @returns {string}
 */
export function agentCardSubtitle(t, agent) {
  if (!agent) return t('runtime.notDetected')
  const sub = agent.subscription
  if (sub && sub.supported === true) {
    if (sub.connected === true) {
      if (agent.installed === true && typeof agent.version === 'string' && agent.version) {
        return agent.version
      }
      const count = Array.isArray(sub.liveModels) ? sub.liveModels.length : 0
      if (count > 0) return t('runtime.modelsReadyCount', { count: String(count) })
      return t('runtime.badgeConnected')
    }
    if (agent.installed !== true) {
      return t('runtime.noCliNeeded')
    }
  }
  return agentStatusText(t, agent)
}
