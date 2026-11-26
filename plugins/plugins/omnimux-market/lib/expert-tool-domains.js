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
 * - External / user-installed third-party MCP tools that do not match any OmniMux
 *   managed domain rule below are passed through untouched (never accidentally hidden).
 */
export const ALL_EXPERT_TOOL_DOMAINS = Object.freeze([
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
]);
export const MANAGED_DOMAIN_RULES = Object.freeze({
    products: Object.freeze({ prefixes: Object.freeze(['products_']) }),
    assets: Object.freeze({ prefixes: Object.freeze(['assets_', 'avatar_']) }),
    inspiration: Object.freeze({ prefixes: Object.freeze(['inspiration_', 'omnimux_inspiration_']) }),
    workflow: Object.freeze({ prefixes: Object.freeze(['workflow_', 'canvas_']) }),
    clip: Object.freeze({ prefixes: Object.freeze(['clip_']) }),
    media_gen: Object.freeze({ prefixes: Object.freeze(['omnimux_image_', 'omnimux_video_', 'omnimux_audio_', 'video_']) }),
    tiktok_selection: Object.freeze({ prefixes: Object.freeze(['tiktok_selection_']) }),
    social_data: Object.freeze({
        prefixes: Object.freeze(['omnimux_tiktok_shop_']),
        exact: Object.freeze(['omnimux_social_data', 'omnimux_page_fetch', 'omnimux_text_complete', 'omnimux_jev_decision']),
    }),
    publish_accounts: Object.freeze({ prefixes: Object.freeze(['publish_', 'accounts_', 'omnimux_publish_', 'omnimux_accounts_']) }),
    analytics: Object.freeze({ prefixes: Object.freeze(['analytics_', 'omnimux_analytics_']) }),
    browser: Object.freeze({ prefixes: Object.freeze(['browser_']) }),
    pibrowse: Object.freeze({ prefixes: Object.freeze(['pibrowse_', 'mcp__pibrowse__']) }),
    viewer: Object.freeze({ exact: Object.freeze(['display_file']) }),
    market: Object.freeze({ prefixes: Object.freeze(['skillhub_', 'plaza_', 'plugin_', 'connector_']) }),
    workbench: Object.freeze({ prefixes: Object.freeze(['workbench_']) }),
});
/**
 * Resolve which OmniMux managed Host domain owns `toolName`, or `null` when
 * `toolName` belongs to an external/third-party plugin or MCP server.
 */
export function resolveManagedToolDomain(toolName) {
    if (typeof toolName !== 'string' || !toolName)
        return null;
    for (const domain of ALL_EXPERT_TOOL_DOMAINS) {
        const rule = MANAGED_DOMAIN_RULES[domain];
        if (rule.exact && rule.exact.includes(toolName))
            return domain;
        if (rule.prefixes && rule.prefixes.some((prefix) => toolName.startsWith(prefix)))
            return domain;
    }
    return null;
}
/**
 * Compute the sorted list of global Host tools to hide for an expert whose
 * allowed OmniMux domains are `allowedDomains`.
 *
 * Only tools present in `globalToolNames` are ever returned so calling
 * `ctx.tools.restrict({ deny })` never fails on unloaded optional plugins.
 */
export function computeDeniedTools(globalToolNames, allowedDomains) {
    const allowed = new Set(allowedDomains);
    const seen = new Set();
    const denied = [];
    for (const raw of globalToolNames) {
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        const domain = resolveManagedToolDomain(name);
        if (domain !== null && !allowed.has(domain)) {
            denied.push(name);
        }
    }
    return denied.sort();
}
