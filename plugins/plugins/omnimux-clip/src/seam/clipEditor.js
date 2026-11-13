import { existsSync, copyFileSync } from 'node:fs'
import { ClipDomainError } from '../errors.js'
import { exportMp4Path } from '../paths.js'
import { createEmptySchema } from '../client/store/timelineTypes.js'

/**
 * Cordis seam `clipEditor`. Verticals / drama talk to this; the canvas
 * island uses DOM events instead (it is not on the Cordis ctx).
 *
 * @param {{
 *   store: ReturnType<typeof import('../store/projectStore.js').createProjectStore>,
 *   fs?: { existsSync: Function, copyFileSync: Function },
 * }} deps
 */
export function createClipEditorSeam(deps) {
  const store = deps.store
  const fs = deps.fs ?? { existsSync, copyFileSync }

  return {
    /**
     * @param {import('./types.js').OpenClipEditorPayload | object} payload
     */
    async open(payload = {}) {
      const projectId = typeof payload.projectId === 'string' && payload.projectId
        ? payload.projectId
        : (payload.draftSchema?.projectId || `clip_${Date.now().toString(36)}`)
      if (payload.draftSchema) {
        store.save(projectId, payload.draftSchema, { recordUndo: false })
      } else if (!store.exists(projectId)) {
        store.create(projectId, createEmptySchema({
          projectId,
          canvasConfig: payload.canvasConfig,
        }))
      }
      return { projectId }
    },

    async get(projectId) {
      return store.load(projectId).schema
    },

    /**
     * @param {{ projectId?: string, schema: object }} payload
     */
    async save(payload) {
      const projectId = payload?.projectId || payload?.schema?.projectId
      if (!projectId) throw ClipDomainError.invalidId('save requires projectId')
      if (!payload.schema) throw ClipDomainError.invalidJson('save requires schema')
      store.save(projectId, payload.schema, { recordUndo: true })
    },

    /**
     * Copy an already-exported MP4 to `dest`, or report the canonical export path.
     * Pixel encode is owned by the overlay WebCodecs pipeline.
     *
     * @param {string} projectId
     * @param {string} [dest]
     */
    async export(projectId, dest) {
      const src = exportMp4Path(store.paths, projectId)
      if (!fs.existsSync(src)) {
        throw ClipDomainError.exportEncodeFailed(
          `export file not ready: ${src}. Open the clip overlay and export, or call clip_export first.`,
        )
      }
      if (dest && dest !== src) {
        fs.copyFileSync(src, dest)
      }
      return {
        mode: 'live',
        files: [{ path: dest || src, kind: 'video' }],
      }
    },

    async getActive() {
      return null
    },
  }
}
