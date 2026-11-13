import { findItem, installItem, removeMcpRow } from './expert/install.js'
import {
  renderConnectorInstall,
  renderConnectorList,
  renderConnectorSearch,
  renderConnectorUninstall,
} from './host-render.js'
import type { MarketToolSpec } from './types.js'

export const CONNECTOR_PROMPT_LINES = [
  'If the user did not name MCP / 连接器, you MUST NOT call connector_*.',
  'In the same user message, pick at most one of plaza_search, skillhub_search, plugin_search, connector_search.',
  'After connector_search, reply with AT MOST one short sentence. Do NOT list connectors as markdown. Do NOT print install commands.',
  'Marketplace connector rows are display-only. Do not write a long apology; suggest the sidebar or wait for a later release.',
  'After connector_install / connector_uninstall, say the result and that the user must restart Host themselves. Never claim you already restarted.',
  'Do not plaza_summon a connector. Use connector_install, not plaza_install, as the Agent path.',
]

export interface ConnectorToolDeps {
  roots: () => { home: string; profileDir: string; packageRoot: string }
  loadCatalog: () => { items: Array<Record<string, unknown>> }
  listMarketplace: () => { items: Array<{ id: string; name: string; installable: boolean; sourceKind: string }> }
  installItem: typeof installItem
  removeMcpRow: typeof removeMcpRow
  findItem: typeof findItem
  lock: <T>(fn: () => Promise<T>) => Promise<T>
}

function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw)
  const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
  return Math.max(1, Math.min(8, base))
}

function text(render: (value: unknown) => string) {
  return (_args: unknown, value: unknown) => [{ type: 'text' as const, text: render(value) }]
}

function connectorHay(item: Record<string, unknown>): string {
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : ''
  return `${item.id || ''} ${item.title || ''} ${item.name || ''} ${item.summary || ''} ${item.serverName || ''} ${tags}`.toLowerCase()
}

function matchQuery(item: Record<string, unknown>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return connectorHay(item).includes(q)
}

function assertConnector(item: Record<string, unknown> | undefined, id: string): Record<string, unknown> {
  if (!item) throw new Error(`unknown item ${id}`)
  if (item.kind !== 'connector') throw new Error(`${id} is not a connector`)
  return item
}

export function createConnectorTools(deps: ConnectorToolDeps, limits: () => { maxResults: number } = () => ({ maxResults: 6 })): MarketToolSpec[] {
  return [
    {
      name: 'connector_search',
      description:
        'Search bundled OmniMux catalog connectors (kind=connector). Marketplace rows are attached as display-only (installable=false). Use only when the user named MCP / 连接器. Do not recommend as experts.',
      parameters: {
        query: { type: 'string', description: 'Keyword, e.g. tencent or notion. Optional to browse.' },
        limit: { type: 'number', description: 'Cards to return, 1–8. Default 6.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: text((value) => renderConnectorSearch(value as { items?: Array<{ id?: string }> })),
        presentationMeta: (_args, value) => ({ kind: 'connector-search', ...(value as object) }),
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `连接器 · ${String(args.query || '浏览')}`,
        kind: 'search',
        content: [],
      }),
      presentResult: (_args, { isError, meta }) => ({
        card: 'generic',
        title: isError ? '连接器搜索失败' : `连接器 · ${(meta as { items?: unknown[] } | undefined)?.items?.length ?? 0} 条`,
        content: [],
      }),
      async execute(args) {
        const query = String(args.query || '').trim()
        const limit = clampLimit(args.limit, limits().maxResults)
        const catalog = deps.loadCatalog()
        const bundled = catalog.items
          .filter((item) => item.kind === 'connector' && matchQuery(item, query))
          .map((item) => ({
            id: String(item.id || ''),
            title: String(item.title || item.id || ''),
            summary: String(item.summary || '').slice(0, 200),
            kind: 'connector',
            serverName: String(item.serverName || ''),
            installed: Boolean(item.installed),
            installable: true,
            sourceKind: 'catalog',
          }))
        const market = deps.listMarketplace().items
          .filter((item) => matchQuery(item as unknown as Record<string, unknown>, query))
          .map((item) => ({
            id: item.id,
            title: item.name,
            name: item.name,
            kind: 'connector',
            installed: false,
            installable: false,
            sourceKind: 'marketplace',
          }))
        const items = [...bundled, ...market].slice(0, limit)
        return {
          query,
          total: bundled.length + market.length,
          marketplaceDisplayOnly: market.length,
          items,
        }
      },
    },
    {
      name: 'connector_install',
      description:
        'Install a bundled catalog connector by id (writes the managed MCP row). Marketplace connectors are display-only. Does not restart Host. Prefer this over plaza_install.',
      parameters: {
        id: { type: 'string', required: true, description: 'Catalog connector id, e.g. cn-tencent-docs' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: text((value) => renderConnectorInstall(value as { id?: string })),
        presentationMeta: (_args, value) => ({ kind: 'connector-install', ...(value as object) }),
      },
      presentCall: (args) => ({ card: 'generic', title: `安装连接器 · ${args.id}`, content: [] }),
      presentResult: (_args, { isError, meta }) => ({
        card: 'generic',
        title: isError ? '连接器安装失败' : `已安装 · ${(meta as { id?: string } | undefined)?.id || ''}`,
        content: [],
      }),
      async execute(args) {
        const id = String(args.id || '').trim()
        if (!id) throw new Error('缺少 id')
        const market = deps.listMarketplace().items.find((it) => it.id === id)
        if (market && (market.sourceKind === 'marketplace' || market.installable === false)) {
          throw new Error('marketplace connectors are display-only')
        }
        const item = assertConnector(deps.findItem(deps.loadCatalog(), id) as Record<string, unknown> | undefined, id)
        if (item.installable === false || item.sourceKind === 'marketplace') {
          throw new Error('marketplace connectors are display-only')
        }
        const r = deps.roots()
        const result = await deps.lock(async () => deps.installItem({
          catalog: deps.loadCatalog() as never,
          id,
          home: r.home,
          profileDir: r.profileDir,
          packageRoot: r.packageRoot,
        })) as { id: string; installed?: boolean; already?: boolean; kind?: string }
        return {
          id: result.id,
          installed: true,
          already: Boolean(result.already),
          kind: result.kind || 'connector',
          restartRequired: true,
        }
      },
    },
    {
      name: 'connector_uninstall',
      description:
        'Uninstall a bundled catalog connector by removing its managed MCP row. Idempotent. Does not restart Host.',
      parameters: {
        id: { type: 'string', required: true, description: 'Catalog connector id' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: text((value) => renderConnectorUninstall(value as { id?: string })),
        presentationMeta: (_args, value) => ({ kind: 'connector-uninstall', ...(value as object) }),
      },
      presentCall: (args) => ({ card: 'generic', title: `卸载连接器 · ${args.id}`, content: [] }),
      presentResult: (_args, { isError, meta }) => ({
        card: 'generic',
        title: isError ? '连接器卸载失败' : `已卸载 · ${(meta as { id?: string } | undefined)?.id || ''}`,
        content: [],
      }),
      async execute(args) {
        const id = String(args.id || '').trim()
        if (!id) throw new Error('缺少 id')
        assertConnector(deps.findItem(deps.loadCatalog(), id) as Record<string, unknown> | undefined, id)
        const r = deps.roots()
        await deps.lock(async () => {
          deps.removeMcpRow(r.profileDir, { id })
        })
        return { id, installed: false, kind: 'connector', restartRequired: true }
      },
    },
    {
      name: 'connector_list',
      description:
        'List bundled catalog connectors that are currently installed (MCP row present). Marketplace sources stay display-only.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: text((value) => renderConnectorList(value as { items?: Array<{ id?: string }>; marketplaceDisplayOnly?: number })),
        presentationMeta: (_args, value) => ({ kind: 'connector-list', ...(value as object) }),
      },
      presentCall: () => ({ card: 'generic', title: '已装连接器', content: [] }),
      presentResult: (_args, { isError, meta }) => ({
        card: 'generic',
        title: isError ? '列出失败' : `已装连接器 · ${(meta as { items?: unknown[] } | undefined)?.items?.length ?? 0} 个`,
        content: [],
      }),
      async execute() {
        const catalog = deps.loadCatalog()
        const items = catalog.items
          .filter((item) => item.kind === 'connector' && item.installed === true)
          .map((item) => ({
            id: String(item.id || ''),
            title: String(item.title || item.id || ''),
            serverName: String(item.serverName || ''),
            kind: 'connector',
            installed: true,
          }))
        return {
          items,
          marketplaceDisplayOnly: deps.listMarketplace().items.length,
        }
      },
    },
  ]
}
