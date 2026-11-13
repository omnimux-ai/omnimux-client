/**
 * Shared request helpers for Host JSON routes. Domain pickers drop unknown keys.
 * @param {string} path
 * @param {{
 *   method?: string,
 *   body?: unknown,
 *   pick?: (raw: unknown) => unknown,
 *   requireJson?: boolean,
 *   notMounted?: string,
 * }} [opts]
 */
export async function jsonRequest(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const contentType = response.headers.get('content-type') || ''
  if (opts.requireJson && !contentType.includes('json')) {
    return {
      ok: false,
      status: response.status,
      body: { error: response.status === 404 ? (opts.notMounted || 'route not mounted') : `unexpected ${contentType || 'response'}` },
    }
  }
  let json = {}
  try {
    json = await response.json()
  } catch {
    json = opts.requireJson ? {} : { error: `HTTP ${String(response.status)}` }
  }
  const body = opts.pick ? opts.pick(json) : json
  return { ok: response.ok, status: response.status, body }
}
