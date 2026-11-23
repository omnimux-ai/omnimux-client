const PREFIX = '/omnimux/tiktok-selection'

function buildQuery(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'all') continue
    qs.set(k, String(v))
  }
  const str = qs.toString()
  return str ? `?${str}` : ''
}

export async function selectionRequest(path, { method = 'GET', body, params } = {}) {
  const url = `${PREFIX}${path}${params ? buildQuery(params) : ''}`
  const opts = {
    method,
    headers: { Accept: 'application/json' },
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url, opts)
  let payload = null
  try {
    payload = await res.json()
  } catch (err) {
    payload = { error: 'parse-error', message: err?.message || `HTTP ${res.status}` }
  }
  if (!res.ok) {
    const err = new Error(payload?.message || payload?.error || `HTTP ${res.status}`)
    err.code = payload?.error || `http-${res.status}`
    err.status = res.status
    err.payload = payload
    throw err
  }
  return payload
}

export const api = {
  getOverview: () => selectionRequest('/overview'),
  queryRank: (body) => selectionRequest('/discovery/rank', { method: 'POST', body }),
  searchProducts: (body) => selectionRequest('/discovery/search', { method: 'POST', body }),
  importSnapshot: (body) => selectionRequest('/discovery/import', { method: 'POST', body }),
  getProductDetail: (body) => selectionRequest('/discovery/detail', { method: 'POST', body }),
  gateDryRun: (body) => selectionRequest('/gate/dry-run', { method: 'POST', body }),
  createTask: (body) => selectionRequest('/tasks', { method: 'POST', body }),
  listTasks: (params) => selectionRequest('/tasks', { params }),
  getTask: (id) => selectionRequest(`/tasks/${encodeURIComponent(id)}`),
  controlTask: (id, body) => selectionRequest(`/tasks/${encodeURIComponent(id)}/control`, { method: 'POST', body }),
  listLibrary: (params) => selectionRequest('/library', { params }),
  ingestProducts: (body) => selectionRequest('/library/ingest', { method: 'POST', body }),
  updateStatus: (body) => selectionRequest('/library/status', { method: 'POST', body }),
  removeProducts: (body) => selectionRequest('/library/remove', { method: 'POST', body }),
  generateAssets: (body) => selectionRequest('/assets/generate', { method: 'POST', body }),
  listSchedules: () => selectionRequest('/schedules'),
  manageSchedule: (body) => selectionRequest('/schedules', { method: 'POST', body }),
  listRuns: (params) => selectionRequest('/runs', { params }),
  listRiskWords: (params) => selectionRequest('/risk-words', { params }),
  manageRiskWords: (body) => selectionRequest('/risk-words', { method: 'POST', body }),
  getSettings: () => selectionRequest('/settings'),
  manageSettings: (body) => selectionRequest('/settings', { method: 'POST', body }),
}
