export const CLIP_API_PREFIX = '/omnimux-clip/api'

/**
 * @param {string} projectId
 * @param {{ title?: string, openreel?: unknown, schema?: unknown }} payload
 */
export async function putClipProject(projectId, payload) {
  const res = await fetch(`${CLIP_API_PREFIX}/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '3.0',
      projectId,
      title: payload.title || projectId,
      updatedAt: new Date().toISOString(),
      openreel: payload.openreel ?? payload.schema ?? null,
      schema: payload.schema ?? payload.openreel ?? null,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`save project failed: ${res.status} ${text}`)
  }
  return res.json().catch(() => ({ saved: true }))
}

/**
 * @param {string} projectId
 */
export async function getClipProject(projectId) {
  const res = await fetch(`${CLIP_API_PREFIX}/projects/${encodeURIComponent(projectId)}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json().catch(() => null)
}

export async function listClipProjects() {
  const res = await fetch(`${CLIP_API_PREFIX}/projects`)
  if (!res.ok) return []
  const body = await res.json().catch(() => ({}))
  return Array.isArray(body?.projects) ? body.projects : []
}
