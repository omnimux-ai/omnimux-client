import { randomUUID } from 'node:crypto'
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
      const projectId = payload.projectId ?? payload.draftSchema?.projectId ?? payload.draftSchema?.id ?? `clip_${randomUUID()}`
      const binding = payload.binding ?? (payload.source === 'canvas' ? payload : undefined)
      const draftSchema = payload.draftSchema ?? (payload.canvasConfig
        ? createEmptySchema({ projectId, canvasConfig: payload.canvasConfig }) : undefined)
      store.materialize(projectId, { binding, draftSchema, title: payload.nodeTitle ?? payload.title })
      return { projectId }
    },

    async get(projectId, opts) {
      return store.load(projectId, opts).project
    },

    async save(payload) {
      const { projectId = payload?.project?.id, project, expectedRevision, revision, binding, backupCurrent } = payload ?? {}
      if (!projectId) throw ClipDomainError.invalidId('save requires projectId')
      if (!project) throw ClipDomainError.invalidJson('save requires an OpenReel project')
      return store.save(projectId, project, { expectedRevision, revision, binding, backupCurrent })
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
          `Export file for project ${projectId} is not ready. Open the project in the right-side clip editor and choose Export.`,
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
