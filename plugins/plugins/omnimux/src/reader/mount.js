import { assertCapabilityEnabled, isToolEnabled } from '../gate/guard.js'
import { OmnimuxError } from '../media/errors.js'
import { fetchPage } from './fetch.js'

/**
 * @param {{
 *   tools: { register: (tool: object) => unknown },
 *   provide?: (name: string, value: unknown) => void,
 *   get?: (name: string) => unknown,
 * }} ctx
 * @param {{
 *   hub: { official: { mount: boolean }, gate?: object },
 *   gate?: object,
 *   env?: Record<string, string | undefined>,
 *   fetcher?: typeof fetch,
 *   resolveApiKey?: () => Promise<string | undefined> | string | undefined,
 *   objectParams: Function,
 *   jsonOut: object,
 *   rethrow: (error: unknown) => never,
 * }} deps
 */
export function mountReader(ctx, deps) {
  if (!deps.hub?.official?.mount) return
  const gate = deps.gate ?? deps.hub?.gate ?? ctx.get?.('gate')
  const toolName = 'omnimux_page_fetch'

  if (!isToolEnabled(gate, toolName)) return

  /**
   * Read one public page. Both the tool surface and the shared seam call this
   * exact function, so the capability gate, credential lane and error codes
   * cannot drift between them.
   * @param {{ url: string }} args
   */
  async function readPage(args) {
    assertCapabilityEnabled(gate, toolName, 'tool')
    return fetchPage(
      { env: deps.env, fetcher: deps.fetcher, resolveApiKey: deps.resolveApiKey },
      args,
    )
  }

  // Domain plugins read pages through this seam. Calling `.execute()` on the
  // tool definition obtained from `ctx.tools.get()` would bypass the tool
  // pipeline (pre-execute policy, guards, result audit) — see
  // docs/contracts/headless-skill-execution.md.
  if (typeof ctx.provide === 'function') {
    ctx.provide('pageFetch', {
      /** @param {{ url: string }} args */
      fetch: (args) => readPage(args ?? {}),
    })
  }

  ctx.tools.register({
    name: toolName,
    description:
      'Fetch a public web page as markdown via OmniMux Jina Reader (POST /v1/reader, model jina-reader-v1). Official-only; uses OMNIMUX_API_KEY. Pass an http(s) url. Returns {mode, model, url, title, pageContent}. Do not invent page text if this tool fails.',
    parameters: deps.objectParams({
      url: { type: 'string', required: true, description: 'Public http(s) URL to read' },
    }),
    output: deps.jsonOut,
    async execute(args) {
      try {
        return await readPage(args)
      } catch (error) {
        if (error instanceof OmnimuxError) throw error
        return deps.rethrow(error)
      }
    },
  })
}
