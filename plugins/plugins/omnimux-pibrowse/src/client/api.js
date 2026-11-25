const BASE = '/omnimux/pibrowse'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    method: options.method || 'GET',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch (err) {
      throw new Error(`Invalid JSON response (${res.status}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`)
    err.code = data?.error || `http-${res.status}`
    err.status = res.status
    throw err
  }
  return data
}

function buildQuery(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const str = sp.toString()
  return str ? `?${str}` : ''
}

export const api = {
  getOverview: () => request('/overview'),
  runtime: (body) => request('/runtime', { method: 'POST', body }),

  listProfiles: (query) => request(`/profiles${buildQuery(query)}`),
  listPersonas: () => request('/personas'),
  upsertProfile: (body) => request('/profiles', { method: 'POST', body }),
  batchCreateProfiles: (body) => request('/profiles/batch', { method: 'POST', body }),
  manageProfiles: (body) => request('/profiles/manage', { method: 'POST', body }),
  launchProfile: (id, body = {}) => request(`/profiles/${encodeURIComponent(id)}/launch`, { method: 'POST', body }),
  stopProfile: (id) => request(`/profiles/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }),

  listProxies: () => request('/proxies'),
  upsertProxy: (body) => request('/proxies', { method: 'POST', body }),
  importProxies: (body) => request('/proxies/import', { method: 'POST', body }),
  checkProxy: (body) => request('/proxies/check', { method: 'POST', body }),
  deleteProxy: (body) => request('/proxies/delete', { method: 'POST', body }),

  listBlocklists: () => request('/blocklists'),
  getBlocklist: (name) => request(`/blocklists/${encodeURIComponent(name)}`),
  manageBlocklists: (body) => request('/blocklists', { method: 'POST', body }),

  listExtensions: () => request('/extensions'),
  manageExtensions: (body) => request('/extensions', { method: 'POST', body }),

  teamStatus: () => request('/team/status'),
  teamLogin: (body) => request('/team/login', { method: 'POST', body }),
  teamSignup: (body) => request('/team/signup', { method: 'POST', body }),
  teamUnlock: (password) => request('/team/unlock', { method: 'POST', body: { password } }),
  teamSync: (body) => request('/team/sync', { method: 'POST', body }),
}
