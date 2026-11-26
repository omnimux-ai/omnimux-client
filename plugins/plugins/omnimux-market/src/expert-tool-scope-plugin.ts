/**
 * @file plugins/omnimux-market/src/expert-tool-scope-plugin.ts
 * Scoped Agent-plane plugin mounted inside hired Market Expert presets.
 *
 * Uses official DSH `ctx.tools.restrict({ deny })` to hide unrelated OmniMux
 * managed Host-plane tools for each specialized SOP expert while keeping:
 * - all Agent-plane core tools (`read`, `write`, `bash`, `skill`, `subagent`, etc.),
 * - all domains declared in `allowedDomains`, and
 * - all external / user-installed third-party MCP tools untouched.
 *
 * Reconciles dynamically on `tools/change` so late-loading Host plugins (e.g.
 * MCP servers) are also scoped cleanly, using a sorted signature guard +
 * re-entrancy lock to prevent recursive `tools/change` loops.
 */

import {
  ALL_EXPERT_TOOL_DOMAINS,
  computeDeniedTools,
  type ExpertToolDomain,
} from './expert-tool-domains.js'

export const name = 'omnimux-market-expert-tool-scope'
export const inject = ['tools']

export interface ExpertToolScopePluginConfig {
  presetId?: string
  allowedDomains?: readonly ExpertToolDomain[]
}

interface ToolsServiceLike {
  definitions?: (scope?: unknown) => ReadonlyArray<{ name?: string }>
  restrict?: (filter: { allow?: readonly string[], deny?: readonly string[] }) => () => void
}

interface ScopedContextLike {
  tools?: ToolsServiceLike
  on?: (event: string, listener: () => void) => () => void
  effect?: (callback: () => (() => void) | void) => () => void
}

const VALID_DOMAIN_SET = new Set<string>(ALL_EXPERT_TOOL_DOMAINS)

function normalizeAllowedDomains(raw: readonly unknown[] | undefined): ExpertToolDomain[] {
  if (!Array.isArray(raw)) return []
  const out: ExpertToolDomain[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const val = typeof item === 'string' ? item.trim() : ''
    if (!val || seen.has(val) || !VALID_DOMAIN_SET.has(val)) continue
    seen.add(val)
    out.push(val as ExpertToolDomain)
  }
  return out
}

export function apply(ctx: unknown, config: ExpertToolScopePluginConfig = {}): () => void {
  const allowedDomains = normalizeAllowedDomains(config?.allowedDomains)
  if (!allowedDomains.length || !ctx || typeof ctx !== 'object') return () => {}

  const scopedCtx = ctx as ScopedContextLike
  let tools: ToolsServiceLike | undefined
  try {
    tools = scopedCtx.tools
  } catch (err) {
    console.warn('[omnimux-market] expert-tool-scope ctx.tools unavailable:', err instanceof Error ? err.message : String(err))
    return () => {}
  }

  if (!tools || typeof tools.definitions !== 'function' || typeof tools.restrict !== 'function') {
    console.warn(`[omnimux-market] expert-tool-scope(${config.presetId || 'preset'}): ctx.tools.restrict/definitions unavailable; skipping tool scoping`)
    return () => {}
  }

  let disposed = false
  let reconciling = false
  let pendingReconcile = false
  let appliedKey = ''
  let releaseRestriction: (() => void) | null = null

  const clearRestriction = () => {
    const prev = releaseRestriction
    releaseRestriction = null
    appliedKey = ''
    if (prev) {
      try {
        prev()
      } catch (err) {
        console.warn('[omnimux-market] expert-tool-scope release failed:', err instanceof Error ? err.message : String(err))
      }
    }
  }

  const reconcile = () => {
    if (disposed) return
    if (reconciling) {
      pendingReconcile = true
      return
    }
    reconciling = true
    try {
      let iterations = 0
      do {
        pendingReconcile = false
        iterations += 1
        // Calling definitions() with no scope returns the global (Host-plane)
        // tool definitions only, matching `restrictableNames` for this preset scope.
        const globalDefs = tools!.definitions!()
        const globalNames = Array.isArray(globalDefs)
          ? globalDefs.map((def) => (def && typeof def.name === 'string' ? def.name : '')).filter(Boolean)
          : []
        const deny = computeDeniedTools(globalNames, allowedDomains)
        const nextKey = deny.join('\0')
        if (nextKey === appliedKey) continue

        clearRestriction()
        if (deny.length === 0) continue

        try {
          releaseRestriction = tools!.restrict!({ deny })
          appliedKey = nextKey
        } catch (err) {
          console.warn(
            `[omnimux-market] expert-tool-scope(${config.presetId || 'preset'}) restrict failed:`,
            err instanceof Error ? err.message : String(err),
          )
          releaseRestriction = null
          appliedKey = ''
        }
      } while (pendingReconcile && !disposed && iterations < 4)
    } finally {
      reconciling = false
    }
  }

  reconcile()

  let unsubscribe: (() => void) | null = null
  if (typeof scopedCtx.on === 'function') {
    try {
      unsubscribe = scopedCtx.on('tools/change', () => {
        if (!reconciling && !disposed) reconcile()
      })
    } catch (err) {
      console.warn('[omnimux-market] expert-tool-scope tools/change subscribe failed:', err instanceof Error ? err.message : String(err))
    }
  }

  const cleanup = () => {
    if (disposed) return
    disposed = true
    if (unsubscribe) {
      try {
        unsubscribe()
      } catch (err) {
        console.warn('[omnimux-market] expert-tool-scope unsubscribe failed:', err instanceof Error ? err.message : String(err))
      }
      unsubscribe = null
    }
    clearRestriction()
  }

  if (typeof scopedCtx.effect === 'function') {
    try {
      scopedCtx.effect(() => cleanup)
    } catch (err) {
      console.warn('[omnimux-market] expert-tool-scope effect registration failed:', err instanceof Error ? err.message : String(err))
    }
  } else if (typeof scopedCtx.on === 'function') {
    try {
      scopedCtx.on('dispose', cleanup)
    } catch (err) {
      console.warn('[omnimux-market] expert-tool-scope dispose hook failed:', err instanceof Error ? err.message : String(err))
    }
  }

  return cleanup
}
