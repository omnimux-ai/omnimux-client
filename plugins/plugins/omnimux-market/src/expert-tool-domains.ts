/**
 * @file plugins/omnimux-market/src/expert-tool-domains.ts
 * Single Source of Truth for OmniMux managed Host-plane tool domains.
 *
 * Scoped Market Experts declare only the OmniMux domains they need (`toolDomains`).
 * Any currently registered global Host tool belonging to a managed OmniMux domain
 * outside that allowlist is denied via DSH native `ctx.tools.restrict({ deny })`.
 *
 * Critical invariants:
 * - Tools registered in the Agent's own scope (`read`, `write`, `bash`, `skill`,
 *   `subagent`, `ask_user_question`, `web_fetch`, etc.) are automatically exempt
 *   by `@deepseek-ai/dsh-tools`.
 * - Shared Hub core utilities (`omnimux_text_complete`, `omnimux_page_fetch`,
 *   `omnimux_jev_decision`, `omnimux_speech_to_text`) are intentionally unmanaged
 *   so every expert retains multimodal inspection, web reading, and transcription.
 * - External / user-installed third-party MCP tools (`mcp__*` other than
 *   `mcp__pibrowse__*`) and third-party Cordis plugins are passed through untouched;
 *   generic non-`omnimux_*` domains use explicit exact tool lists to avoid false positives.
 */

export type ExpertToolDomain =
  | 'products'
  | 'assets'
  | 'inspiration'
  | 'workflow'
  | 'clip'
  | 'media_gen'
  | 'tiktok_selection'
  | 'social_data'
  | 'publish_accounts'
  | 'analytics'
  | 'browser'
  | 'pibrowse'
  | 'viewer'
  | 'market'
  | 'workbench'

export interface ManagedDomainRule {
  readonly prefixes?: readonly string[]
  readonly exact?: readonly string[]
}

export const ALL_EXPERT_TOOL_DOMAINS: readonly ExpertToolDomain[] = Object.freeze([
  'products',
  'assets',
  'inspiration',
  'workflow',
  'clip',
  'media_gen',
  'tiktok_selection',
  'social_data',
  'publish_accounts',
  'analytics',
  'browser',
  'pibrowse',
  'viewer',
  'market',
  'workbench',
])

export const MANAGED_DOMAIN_RULES: Readonly<Record<ExpertToolDomain, ManagedDomainRule>> = Object.freeze({
  products: Object.freeze({
    exact: Object.freeze([
      'products_list',
      'products_search',
      'products_get',
      'products_read_media',
      'products_create',
      'products_update',
      'products_delete',
    ]),
  }),
  assets: Object.freeze({
    exact: Object.freeze([
      'assets_list',
      'assets_search',
      'assets_cloud_save',
      'assets_get',
      'assets_create',
      'assets_update',
      'assets_delete',
      'assets_upload',
    ]),
  }),
  inspiration: Object.freeze({
    prefixes: Object.freeze(['inspiration_', 'omnimux_inspiration_']),
    exact: Object.freeze([
      'omnimux_creative_templates_search',
      'omnimux_creative_template_get',
      'omnimux_marketing_presets_search',
    ]),
  }),
  workflow: Object.freeze({
    exact: Object.freeze([
      'workflow_connect',
      'workflow_disconnect',
      'workflow_execution_control',
      'workflow_list',
      'workflow_run',
      'workflow_snapshot',
      'workflow_create',
      'workflow_node_add',
      'workflow_node_update',
      'workflow_node_remove',
      'workflow_director',
      'canvas_write_table_node',
      'canvas_get_table_node',
    ]),
  }),
  clip: Object.freeze({
    exact: Object.freeze([
      'clip_list',
      'clip_create',
      'clip_open',
      'clip_get',
      'clip_edit',
      'clip_view',
      'clip_snapshot',
      'clip_diagnostics',
      'clip_export',
    ]),
  }),
  media_gen: Object.freeze({
    prefixes: Object.freeze(['omnimux_image_', 'omnimux_video_', 'omnimux_audio_']),
    exact: Object.freeze([
      'video_process',
      'video_depth',
      'video_analyze',
      'video_reverse_prompt',
    ]),
  }),
  tiktok_selection: Object.freeze({
    prefixes: Object.freeze(['tiktok_selection_']),
  }),
  social_data: Object.freeze({
    prefixes: Object.freeze(['omnimux_tiktok_', 'omnimux_instagram_', 'omnimux_x_', 'omnimux_youtube_']),
    exact: Object.freeze(['omnimux_social_data']),
  }),
  publish_accounts: Object.freeze({
    prefixes: Object.freeze(['omnimux_publish_', 'omnimux_accounts_']),
    exact: Object.freeze([
      'accounts_list',
      'accounts_update_group',
      'publish_list_records',
      'publish_create_draft',
      'publish_update_draft',
      'publish_delete_draft',
      'publish_list_accounts',
      'publish_assign_accounts',
      'publish_submit',
      'publish_get_record',
      'publish_retry_task',
    ]),
  }),
  analytics: Object.freeze({
    prefixes: Object.freeze(['omnimux_analytics_']),
    exact: Object.freeze([
      'analytics_query_metrics',
      'analytics_get_summary',
    ]),
  }),
  browser: Object.freeze({
    exact: Object.freeze([
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_press',
      'browser_scroll',
      'browser_navigate',
      'browser_open_tab',
      'browser_list_tabs',
      'browser_get_text',
      'browser_wait',
      'browser_follow_tab',
      'browser_close_tab',
      'browser_back',
      'browser_forward',
      'browser_reload',
    ]),
  }),
  pibrowse: Object.freeze({
    prefixes: Object.freeze(['pibrowse_', 'mcp__pibrowse__']),
  }),
  viewer: Object.freeze({
    exact: Object.freeze(['display_file']),
  }),
  market: Object.freeze({
    prefixes: Object.freeze(['skillhub_', 'plaza_']),
    exact: Object.freeze([
      'plugin_search',
      'plugin_install',
      'plugin_uninstall',
      'plugin_list',
      'connector_search',
      'connector_install',
      'connector_uninstall',
      'connector_list',
    ]),
  }),
  workbench: Object.freeze({
    exact: Object.freeze([
      'workbench_get_active_view',
      'workbench_open_tab',
    ]),
  }),
})

/**
 * Resolve which OmniMux managed Host domain owns `toolName`, or `null` when
 * `toolName` is a shared Hub core utility or belongs to an external/third-party
 * plugin or MCP server.
 */
export function resolveManagedToolDomain(toolName: string): ExpertToolDomain | null {
  if (typeof toolName !== 'string' || !toolName) return null
  for (const domain of ALL_EXPERT_TOOL_DOMAINS) {
    const rule = MANAGED_DOMAIN_RULES[domain]
    if (rule.exact && rule.exact.includes(toolName)) return domain
    if (rule.prefixes && rule.prefixes.some((prefix) => toolName.startsWith(prefix))) return domain
  }
  return null
}

/**
 * Compute the sorted list of global Host tools to hide for an expert whose
 * allowed OmniMux domains are `allowedDomains`.
 *
 * Only tools present in `globalToolNames` are ever returned so calling
 * `ctx.tools.restrict({ deny })` never fails on unloaded optional plugins.
 */
export function computeDeniedTools(
  globalToolNames: readonly string[],
  allowedDomains: readonly ExpertToolDomain[],
): string[] {
  const allowed = new Set<ExpertToolDomain>(allowedDomains)
  const seen = new Set<string>()
  const denied: string[] = []
  for (const raw of globalToolNames) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const domain = resolveManagedToolDomain(name)
    if (domain !== null && !allowed.has(domain)) {
      denied.push(name)
    }
  }
  return denied.sort()
}
