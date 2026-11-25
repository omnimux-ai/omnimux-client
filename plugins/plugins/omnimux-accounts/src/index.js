import { createAccountMetaStore, mergeMeta } from './account-meta.js'

export const name = 'omnimux-accounts'
export const inject = ['tools']

export const ACCOUNTS_TOOL_NAMES = [
  'accounts_list',
  'accounts_update_group',
]

function objectParams(fields) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields)) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const ACCOUNTS_PROVIDER = 'tiktok_direct'

/**
 * Whitelist-copy account publishing capabilities, same four keys as the hub
 * (`upload_draft`, `publish_direct`, `max_media_items`, `max_images`).
 * @param {unknown} raw
 * @returns {{ upload_draft?: boolean, publish_direct?: boolean, max_media_items?: number, max_images?: number } | undefined}
 */
function pickCapabilities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = /** @type {Record<string, unknown>} */ (raw)
  /** @type {{ upload_draft?: boolean, publish_direct?: boolean, max_media_items?: number, max_images?: number }} */
  const out = {}
  if (typeof src.upload_draft === 'boolean') out.upload_draft = src.upload_draft
  if (typeof src.publish_direct === 'boolean') out.publish_direct = src.publish_direct
  if (typeof src.max_media_items === 'number' && Number.isInteger(src.max_media_items) && src.max_media_items > 0) {
    out.max_media_items = src.max_media_items
  }
  if (typeof src.max_images === 'number' && Number.isInteger(src.max_images) && src.max_images > 0) {
    out.max_images = src.max_images
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * @param {{
 *   tools: { register: (tool: object) => unknown },
 *   get?: (name: string) => unknown,
 *   effect?: (factory: () => () => void, label?: string) => void,
 * }} ctx
 */
export function apply(ctx) {
  const homeDir = process.env.DSH_HOME || process.env.HOME || '.'
  const metaStore = createAccountMetaStore({ home: homeDir })

  /**
   * Connected-account rows come from the Hub's `omnimuxAccounts` seam.
   *
   * The seam resolves lazily so plugin load order is not this plugin's
   * contract, and it keeps the credential lane inside the hub. Reading the
   * `omnimux_accounts_list` tool definition and calling its `execute` would
   * bypass the tool pipeline (pre-execute policy, guards, result audit) — see
   * docs/contracts/headless-skill-execution.md.
   */
  async function listDirectAccounts() {
    const seam = typeof ctx.get === 'function' ? ctx.get('omnimuxAccounts') : undefined
    if (!seam || typeof seam.list !== 'function') {
      throw new Error('needs-hub: install the OmniMux execution hub')
    }
    const res = await seam.list({ provider: ACCOUNTS_PROVIDER })
    if (res?.success === false) throw new Error(res.error?.message || res.message || 'account list failed')
    const rows = Array.isArray(res?.accounts) ? res.accounts : res?.data?.accounts
    if (!Array.isArray(rows)) throw new Error('invalid account list response')
    return rows.filter((acc) => acc?.provider === ACCOUNTS_PROVIDER)
  }

  ctx.tools.register({
    name: 'accounts_list',
    description: 'List connected social accounts with local group and agent_usable settings. Optional platform, group, or agent_usable filter.',
    parameters: objectParams({
      platform: { type: 'string', description: 'tiktok | instagram | youtube | x' },
      group: { type: 'string', description: 'Filter by account group name' },
      agent_usable_only: { type: 'boolean', description: 'Only return accounts enabled for Agent use' },
    }),
    output: jsonOut,
    async execute(args) {
      const rawAccounts = await listDirectAccounts()
      const meta = metaStore.read()
      let accounts = rawAccounts.map((acc) => {
        const id = String(acc.id || '')
        const overlaid = meta[id] ? mergeMeta(acc, meta[id]) : { ...acc }
        const capabilities = pickCapabilities(acc.capabilities)
        return {
          id,
          platform: overlaid.platform,
          provider: overlaid.provider,
          account_name: overlaid.account_name || overlaid.display_name || overlaid.name || id,
          avatar_url: overlaid.avatar_url,
          group: overlaid.group || null,
          agent_usable: overlaid.agent_usable !== false,
          status: overlaid.status || 'active',
          ...(capabilities ? { capabilities } : {}),
        }
      })

      if (args.platform) {
        const p = String(args.platform).trim().toLowerCase()
        accounts = accounts.filter((a) => String(a.platform).toLowerCase() === p)
      }
      if (args.group !== undefined && args.group !== '') {
        const g = String(args.group).trim()
        accounts = accounts.filter((a) => a.group === g)
      }
      if (args.agent_usable_only) {
        accounts = accounts.filter((a) => a.agent_usable === true)
      }

      return { count: accounts.length, accounts }
    },
  })

  ctx.tools.register({
    name: 'accounts_update_group',
    description: 'Update the business group name for a social account.',
    parameters: objectParams({
      id: { type: 'string', required: true, description: 'Social account unique ID' },
      group: { type: 'string', description: 'New business group name (empty string to unassign)' },
    }),
    output: jsonOut,
    async execute(args) {
      if (Object.hasOwn(args, 'agent_usable')) throw new Error('account-permission-owner-only: change permissions in account settings')
      const id = String(args.id)
      const rows = await listDirectAccounts()
      if (!rows.some((acc) => String(acc.id) === id)) {
        throw new Error('account-provider-mismatch: account does not belong to tiktok_direct')
      }
      const patch = {}
      if (args.group !== undefined) patch.group = args.group === '' ? null : String(args.group)
      const updated = metaStore.patch(id, patch)
      return { ok: true, id, meta: updated }
    },
  })
}
