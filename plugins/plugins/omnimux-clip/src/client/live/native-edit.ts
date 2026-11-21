import { ClipDomainError } from '../../errors.js'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { cloneProjectForEdit } from '../openreel/web/stores/project/clone-project-for-edit'
import { useTimelineStore } from '../openreel/web/stores/timeline-store'
import { useUIStore } from '../openreel/web/stores/ui-store'
import { readOnlyReason } from '../openreel/web/services/project-lock'
import { loadEngineModules } from '../openreel/web/services/lazy-engines'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { reconcileMulticamAudio } from '../openreel/core/multicam/fixed-audio'
import { assertSafeFields, boolean, fields, invalid, referenceId, text, type Fields } from './native-input'
import { stageNativeMedia, type ResolvedNativeMedia } from './native-media'
import { editText, setClipEffect } from './native-overlays'
import { NativeDraft, addMediaClip, addTrack, addTransition, cutSilences, moveClip, removeClip, removeRange, removeTrack,
  removeTransition, requireClearConfirmation, setSpeed, setTrackState, setVolume, splitClip, trimClip } from './native-timeline'

export type { ResolvedNativeMedia } from './native-media'

function operationError(error: unknown, operationIndex: number) {
  const failure = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? new ClipDomainError(error.code, error.message, { ...('details' in error ? error.details as object : undefined), operationIndex })
    : new ClipDomainError('invalid-json', 'OpenReel could not plan the edit', { operationIndex })
  return Object.assign(failure, { operationIndex })
}

export interface NativeEditOptions {
  assertCurrent: () => void
  /** The caller resolves an approved Host media reference to bytes and its stable content identity. */
  resolveMedia?: (operation: Fields) => ResolvedNativeMedia | null | undefined | Promise<ResolvedNativeMedia | null | undefined>
}

const edits = {
  add_track: addTrack,
  remove_track: removeTrack,
  set_track_state: setTrackState,
  trim_clip: trimClip,
  split_clip: splitClip,
  move_clip: moveClip,
  remove_clip: removeClip,
  remove_range: removeRange,
  cut_silences: cutSilences,
  set_volume: setVolume,
  set_speed: setSpeed,
  add_text: editText,
  set_text: editText,
  set_subtitle_style: editText,
  add_transition: addTransition,
  remove_transition: removeTransition,
  set_clip_effect: setClipEffect,
}

async function planMedia(draft: NativeDraft, op: Fields, options: NativeEditOptions) {
  if (op.type === 'add_clip' && op.mediaType === 'text') return editText(draft, op)
  if (op.type === 'add_clip' && op.mediaId !== undefined) {
    const id = referenceId(op.mediaId, 'mediaId')
    const item = draft.project.mediaLibrary.items.find(item => item.id === id)
    if (!item) throw ClipDomainError.mediaMissing('The mediaId is not in this project')
    return addMediaClip(draft, op, item)
  }
  const { item, reused } = await stageNativeMedia(draft.project, op, options.resolveMedia, options.assertCurrent)
  if (!reused) {
    const { mediaLibrary } = draft.project
    const restored = mediaLibrary.items.some(existing => existing.id === item.id)
    const items = restored ? mediaLibrary.items.map(existing => existing.id === item.id ? item : existing) : [...mediaLibrary.items, item]
    draft.replace({ ...draft.project, mediaLibrary: { ...mediaLibrary, items } })
  }
  const place = op.type === 'add_clip' || boolean(op.placeOnTimeline, 'placeOnTimeline') !== false
  const placement = place ? await addMediaClip(draft, op, item, op.type === 'import_media') : undefined
  return { mediaId: item.id, reused, ...placement }
}

/** Plan the entire batch off-store; the last synchronous step publishes one native history action. */
export async function executeNativeEdit(args: unknown, options: NativeEditOptions) {
  const request = fields(args, 'clip_edit arguments')
  const description = text(request.description, 'description', 300).trim()
  if (!description) invalid('description is required')
  const validateOnly = boolean(request.validateOnly, 'validateOnly') === true
  const confirmDestructive = boolean(request.confirmDestructive, 'confirmDestructive') === true
  if (!Array.isArray(request.operations) || !request.operations.length) invalid('operations must be a non-empty array')
  const operations = request.operations.map((operation, index) => {
    try {
      const op = fields(operation, `operations[${index}]`)
      if (op.projectId !== undefined) invalid('Target the project on the command, not an individual operation')
      if (typeof op.type !== 'string' || (!Object.hasOwn(edits, op.type) && op.type !== 'add_clip' && op.type !== 'import_media')) {
        invalid(`operations[${index}].type is unsupported`)
      }
      assertSafeFields(op)
      return op
    } catch (error) {
      throw operationError(error, index)
    }
  })

  options.assertCurrent()
  const owner = useProjectStore.getState()
  if (!owner.hasOpenProject) throw ClipDomainError.previewNotReady('Open the project in Clip')
  const current = () => {
    options.assertCurrent()
    const state = useProjectStore.getState()
    if (!state.hasOpenProject || state.project !== owner.project || state.actionExecutor !== owner.actionExecutor) {
      throw new ClipDomainError('REVISION_CONFLICT', 'The active timeline changed while the edit was being prepared')
    }
    const readOnly = readOnlyReason()
    if (readOnly) throw new ClipDomainError('READ_ONLY', readOnly)
    if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) invalid('Editing is unavailable while the timeline is locked')
    return state
  }
  const previous = current().getFullProject()
  const draft = new NativeDraft(cloneProjectForEdit(previous), confirmDestructive)
  const results: Fields[] = []
  for (const [operationIndex, op] of operations.entries()) {
    const type = op.type as string
    try {
      const result = type === 'add_clip' || type === 'import_media'
        ? await planMedia(draft, op, { ...options, assertCurrent: current })
        : await edits[type as keyof typeof edits](draft, op)
      results.push({ type, ...result })
    } catch (error) {
      throw operationError(error, operationIndex)
    }
    current()
  }
  draft.replace(reconcileMulticamAudio(draft.project))
  requireClearConfirmation(previous, draft)
  const result = { projectId: previous.id, description, validateOnly, results, durationSec: calculateProjectDuration(draft.project) }
  if (validateOnly) return { ...result, persisted: false, undoStep: false }

  // In the native editor these modules are already warm. Resolve them before
  // the final ownership check so overlay synchronization stays synchronous.
  await loadEngineModules()
  const state = current()
  const commit = state.commitEditSnapshot(draft.project, description)
  if (!commit.success) throw new ClipDomainError(commit.error?.code === 'READ_ONLY' ? 'READ_ONLY' : 'invalid-json', commit.error?.message ?? 'OpenReel could not commit the edit')
  return { ...result, undoStep: true, actionId: commit.actionId }
}
