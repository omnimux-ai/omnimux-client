import { ClipDomainError } from '../../errors.js'
import { getBuiltInEditingTemplate } from '../openreel/core/editing-templates/registry'
import { resolveEditingTemplate } from '../openreel/core/editing-templates/resolver'
import type { EditingTemplatePrimitive } from '../openreel/core/editing-templates/types'
import { getBuiltInGraphicTemplate } from '../openreel/core/graphic-templates/built-in-templates'
import { coerceParamValue } from '../openreel/core/graphic-templates/expand'
import {
  commitGraphicInstance,
  getGraphicInstance,
  graphicMemberIds,
  insertGraphicTemplate,
  moveGraphic,
  removeGraphic,
  resizeGraphic,
  setGraphicParameters,
  ungroupGraphic,
} from '../openreel/core/graphic-templates/instances'
import type { GraphicTemplate } from '../openreel/core/graphic-templates/types'
import { validateGraphicTemplate } from '../openreel/core/graphic-templates/validate'
import { GraphicsEngine } from '../openreel/core/graphics/graphics-engine'
import type { ShapeClip } from '../openreel/core/graphics/types'
import { TitleEngine } from '../openreel/core/text/title-engine'
import type { AppliedEditingTemplate, Project } from '../openreel/core/types/project'
import type { Effect, Keyframe, Track } from '../openreel/core/types/timeline'
import { rekeyKeyframesToEffectInstance } from '../openreel/core/video/effect-instance-keyframes'
import { fields, invalid, number, onlyKeys, referenceId, text, type Fields } from './native-input'
import { requireItem, requireNewItemId, requireTrack, type NativeDraft } from './native-timeline'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function paramArrayToMap(entries: unknown, fieldName: string): Record<string, unknown> {
  if (entries === undefined) return Object.create(null)
  if (!Array.isArray(entries)) invalid(`${fieldName} must be an array`)
  const map: Record<string, unknown> = Object.create(null)
  for (const [index, entry] of entries.entries()) {
    const item = fields(entry, `${fieldName}[${index}]`)
    onlyKeys(item, ['id', 'value'], `${fieldName}[${index}]`)
    const id = text(item.id, `${fieldName}[${index}].id`, 80).trim()
    if (!id || FORBIDDEN_KEYS.has(id)) {
      throw new ClipDomainError('graphic-param-invalid', `Invalid parameter identifier in ${fieldName}`)
    }
    if (Object.hasOwn(map, id)) {
      throw new ClipDomainError('graphic-param-invalid', `Duplicate parameter "${id}" in ${fieldName}`)
    }
    if (item.value === undefined) {
      throw new ClipDomainError('graphic-param-invalid', `Missing value for parameter "${id}"`)
    }
    map[id] = item.value
  }
  return map
}

function validateGraphicParams(template: GraphicTemplate, paramMap: Record<string, unknown>): Record<string, unknown> {
  const validated: Record<string, unknown> = Object.create(null)
  for (const [id, raw] of Object.entries(paramMap)) {
    const param = template.parameters.find((candidate) => candidate.id === id)
    if (!param) {
      throw new ClipDomainError('graphic-param-invalid', `This graphic has no control "${id}".`)
    }
    const coerced = coerceParamValue(param, raw)
    if (coerced === undefined) {
      throw new ClipDomainError('graphic-param-invalid', `"${param.label}" does not accept that value.`)
    }
    validated[id] = coerced
  }
  return validated
}

function validateEditingControls(
  controls: NonNullable<ReturnType<typeof getBuiltInEditingTemplate>>['controls'],
  controlMap: Record<string, unknown>,
): Record<string, EditingTemplatePrimitive> {
  const overrides: Record<string, EditingTemplatePrimitive> = Object.create(null)
  const definitions = controls ?? []
  for (const [id, raw] of Object.entries(controlMap)) {
    const def = definitions.find((candidate) => candidate.id === id)
    if (!def) {
      throw new ClipDomainError('graphic-param-invalid', `This editing template has no control "${id}".`)
    }
    if (def.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" requires a finite number.`)
      }
      if ((def.min !== undefined && raw < def.min) || (def.max !== undefined && raw > def.max)) {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" is out of range.`)
      }
      overrides[id] = raw
    } else if (def.type === 'toggle') {
      if (typeof raw !== 'boolean') {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" requires a boolean.`)
      }
      overrides[id] = raw
    } else if (def.type === 'color') {
      if (typeof raw !== 'string' || !/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(raw.trim())) {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" requires a valid CSS color.`)
      }
      overrides[id] = raw.trim()
    } else if (def.type === 'select') {
      const valid = def.options?.some((option) => option.value === raw)
      if (!valid || (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean')) {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" requires one of its allowed options.`)
      }
      overrides[id] = raw
    } else {
      if (typeof raw !== 'string' || raw.length > 4000) {
        throw new ClipDomainError('graphic-param-invalid', `Control "${id}" requires a text string.`)
      }
      overrides[id] = raw
    }
  }
  return overrides
}

function updateClipInTracks(
  project: Project,
  clipId: string,
  updater: (clip: Project['timeline']['tracks'][number]['clips'][number]) => Project['timeline']['tracks'][number]['clips'][number],
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === clipId ? updater(clip) : clip)),
      })),
    },
  }
}

export async function addGraphicInstance(draft: NativeDraft, operation: Fields) {
  let template: GraphicTemplate | undefined
  if (operation.resolvedTemplate !== undefined) {
    const checked = validateGraphicTemplate(operation.resolvedTemplate)
    if (!checked.ok) {
      throw new ClipDomainError('template-invalid', checked.errors[0] || 'Custom graphic template failed validation.')
    }
    template = checked.template
  } else {
    const templateId = referenceId(operation.templateId, 'templateId')
    template = getBuiltInGraphicTemplate(templateId)
    if (!template) {
      throw new ClipDomainError('template-not-found', `Graphic template not found: ${templateId}`)
    }
  }

  const startTime = number(operation.startSec, 'startSec')
  const duration = operation.durationSec === undefined ? undefined : number(operation.durationSec, 'durationSec', 1e-4)
  const trackId = operation.trackId === undefined ? undefined : requireTrack(draft.project, operation.trackId).id
  const name = operation.name === undefined ? undefined : text(operation.name, 'name', 120).trim()
  if (operation.name !== undefined && !name) invalid('name must not be empty')

  let requestedId: string | undefined
  if (operation.instanceId !== undefined) {
    requestedId = requireNewItemId(draft.project, operation.instanceId)
    if (draft.project.graphicInstances?.some((inst) => inst.id === requestedId)) {
      invalid('instanceId is already in use')
    }
  }

  const rawMap = paramArrayToMap(operation.params, 'params')
  const values = validateGraphicParams(template, rawMap)

  const inserted = insertGraphicTemplate(draft.project, template, {
    startTime,
    duration,
    trackId,
    values,
    name,
  })
  if (!inserted.ok || !inserted.instanceId) {
    throw new ClipDomainError('invalid-json', inserted.ok ? 'Could not insert graphic template' : inserted.message)
  }

  let nextProject = inserted.project
  let finalId = inserted.instanceId
  if (requestedId) {
    const temp = getGraphicInstance(nextProject, finalId)!
    const removed = removeGraphic(nextProject, finalId)
    if (!removed.ok) invalid(removed.message)
    nextProject = commitGraphicInstance(removed.project, { ...temp, id: requestedId })
    finalId = requestedId
  }

  draft.replace(nextProject)
  const created = getGraphicInstance(draft.project, finalId)!
  return {
    instanceId: created.id,
    templateId: created.template.id,
    trackId: created.trackId,
    startSec: created.startTime,
    durationSec: created.duration,
    memberClipIds: graphicMemberIds(created),
  }
}

export async function updateGraphicParams(draft: NativeDraft, operation: Fields) {
  const instanceId = referenceId(operation.instanceId, 'instanceId')
  const existing = getGraphicInstance(draft.project, instanceId)
  if (!existing) throw ClipDomainError.notFound('The graphic instance does not exist in this timeline')
  requireTrack(draft.project, existing.trackId)

  const hasParams = operation.params !== undefined
  const hasStart = operation.startSec !== undefined
  const hasDuration = operation.durationSec !== undefined
  const hasTrack = operation.trackId !== undefined
  if (!hasParams && !hasStart && !hasDuration && !hasTrack) {
    invalid('Provide params, startSec, durationSec, or trackId to update the graphic instance')
  }

  let next = draft.project
  if (hasParams) {
    const rawMap = paramArrayToMap(operation.params, 'params')
    const validated = validateGraphicParams(existing.template, rawMap)
    const updated = setGraphicParameters(next, instanceId, validated)
    if (!updated.ok) throw new ClipDomainError('graphic-param-invalid', updated.message)
    next = updated.project
  }

  if (hasStart || hasTrack) {
    const startTime = hasStart ? number(operation.startSec, 'startSec') : undefined
    const trackId = hasTrack ? requireTrack(next, operation.trackId).id : undefined
    const moved = moveGraphic(next, instanceId, { startTime, trackId })
    if (!moved.ok) {
      if (moved.message.includes('no room')) throw ClipDomainError.clipOverlap(moved.message)
      if (moved.message.includes('locked')) throw new ClipDomainError('TRACK_LOCKED', moved.message)
      throw ClipDomainError.invalidJson(moved.message)
    }
    next = moved.project
  }

  if (hasDuration) {
    const duration = number(operation.durationSec, 'durationSec', 1e-4)
    const resized = resizeGraphic(next, instanceId, { duration })
    if (!resized.ok) throw ClipDomainError.invalidJson(resized.message)
    next = resized.project
  }

  draft.replace(next)
  const current = getGraphicInstance(draft.project, instanceId)!
  return {
    instanceId: current.id,
    templateId: current.template.id,
    trackId: current.trackId,
    startSec: current.startTime,
    durationSec: current.duration,
    memberClipIds: graphicMemberIds(current),
  }
}

export async function removeGraphicInstance(draft: NativeDraft, operation: Fields) {
  const instanceId = referenceId(operation.instanceId, 'instanceId')
  const existing = getGraphicInstance(draft.project, instanceId)
  if (!existing) throw ClipDomainError.notFound('The graphic instance does not exist in this timeline')
  requireTrack(draft.project, existing.trackId)
  const ungroup = operation.ungroup === true
  const res = ungroup ? ungroupGraphic(draft.project, instanceId) : removeGraphic(draft.project, instanceId)
  if (!res.ok) throw ClipDomainError.invalidJson(res.message)
  draft.replace(res.project)
  return { instanceId, ungrouped: ungroup }
}

export async function applyEditingTemplateToDraft(draft: NativeDraft, operation: Fields) {
  const target = requireItem(draft.project, operation.clipId)
  if (target.kind !== 'media') {
    throw ClipDomainError.invalidJson('apply_editing_template requires a video or image clip')
  }
  const ownerClip = target.item
  const mediaItem = draft.project.mediaLibrary.items.find((item) => item.id === ownerClip.mediaId)
  const targetType = mediaItem?.type === 'image' ? 'image' : mediaItem?.type === 'video' ? 'video' : null
  if (!targetType) {
    throw ClipDomainError.invalidJson('apply_editing_template requires a video or image clip')
  }

  const templateId = referenceId(operation.templateId, 'templateId')
  const template = getBuiltInEditingTemplate(templateId)
  if (!template) {
    throw new ClipDomainError('template-not-found', `Editing template not found: ${templateId}`)
  }
  if (template.supportedTargets && !template.supportedTargets.includes(targetType)) {
    throw ClipDomainError.invalidJson(`Editing template "${templateId}" does not support ${targetType} clips`)
  }

  const rawControls = paramArrayToMap(operation.controls, 'controls')
  const overrides = validateEditingControls(template.controls, rawControls)

  const assetUrls = draft.project.mediaLibrary.items.reduce<Record<string, string>>((urls, item) => {
    const url = item.originalUrl ?? item.thumbnailUrl ?? undefined
    if (url) urls[item.id] = url
    return urls
  }, {})

  const resolved = resolveEditingTemplate(
    template,
    {
      clip: {
        id: ownerClip.id,
        startTime: ownerClip.startTime,
        duration: ownerClip.duration,
        name: mediaItem?.name,
      },
      assetUrls,
    },
    overrides,
  )

  const applicationId = `editing-template-${crypto.randomUUID()}`
  const appliedTemplate: AppliedEditingTemplate = {
    templateId: template.id,
    applicationId,
    name: template.name,
    category: template.category,
    appliedAt: Date.now(),
    controlValues: resolved.controlValues,
  }
  const templateSource = {
    templateId: template.id,
    applicationId,
    ownerClipId: ownerClip.id,
    ownerTrackId: ownerClip.trackId,
    controlValues: resolved.controlValues,
  }

  const buildKeyframes = (prefix: string, items: readonly { time: number; property: string; value: unknown; easing: Keyframe['easing'] }[]): Keyframe[] =>
    items.map((kf, index) => ({
      id: `${prefix}-keyframe-${index + 1}`,
      time: kf.time,
      property: kf.property,
      value: kf.value,
      easing: kf.easing,
    }))

  const addedEffects: Effect[] = resolved.effects.map((effect, index) => ({
    id: `template-effect-${applicationId}-${index + 1}-${effect.id}`,
    type: effect.type,
    params: effect.params,
    enabled: effect.enabled,
    metadata: { templateSource },
  }))
  const addedAudioEffects: Effect[] = resolved.audioEffects.map((effect, index) => ({
    id: `template-audio-effect-${applicationId}-${index + 1}-${effect.id}`,
    type: effect.type,
    params: effect.params,
    enabled: effect.enabled,
    metadata: { templateSource },
  }))
  const addedKeyframes: Keyframe[] = [
    ...resolved.effects.flatMap((effect, index) =>
      buildKeyframes(
        `template-keyframe-${applicationId}-video-${index + 1}`,
        rekeyKeyframesToEffectInstance(addedEffects[index]!, effect.keyframes),
      ),
    ),
    ...resolved.audioEffects.flatMap((effect, index) =>
      buildKeyframes(`template-keyframe-${applicationId}-audio-${index + 1}`, effect.keyframes),
    ),
  ]

  let nextProject: Project = draft.project
  const resolvedTrackIds: Partial<Record<'text' | 'graphics', string>> = {}
  const ensureOverlayTrack = (trackType: 'text' | 'graphics'): string => {
    const cached = resolvedTrackIds[trackType]
    if (cached) return cached
    const existingTrack = nextProject.timeline.tracks.find((candidate) => candidate.type === trackType && !candidate.locked)
    if (existingTrack) {
      resolvedTrackIds[trackType] = existingTrack.id
      return existingTrack.id
    }
    const createdTrack: Track = {
      id: `track-${crypto.randomUUID()}`,
      type: trackType,
      name: trackType === 'text' ? 'Recipe Text' : 'Recipe Graphics',
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    }
    nextProject = {
      ...nextProject,
      timeline: {
        ...nextProject.timeline,
        tracks: [createdTrack, ...nextProject.timeline.tracks],
      },
    }
    resolvedTrackIds[trackType] = createdTrack.id
    return createdTrack.id
  }

  // Materialize overlays purely on detached engines so validateOnly and rollback never mutate live singletons.
  const titleEngine = new TitleEngine()
  const graphicsEngine = new GraphicsEngine()
  const addedOverlayClipIds: string[] = []
  const newTextClips = [...(nextProject.textClips ?? [])]
  const newShapeClips = [...(nextProject.shapeClips ?? [])]
  const newStickerClips = [...(nextProject.stickerClips ?? [])]

  for (const [index, overlay] of resolved.overlays.entries()) {
    const overlayTrackId = ensureOverlayTrack(overlay.trackType)
    const overlayId = `template-overlay-${applicationId}-${index + 1}-${overlay.id}`
    const metadata = {
      templateSource,
      templateManaged: true,
      templateTrackType: overlay.trackType,
    }
    if (overlay.type === 'text') {
      titleEngine.createTextClip({
        id: overlayId,
        trackId: overlayTrackId,
        startTime: overlay.timing.startTime,
        duration: overlay.timing.duration,
        text: overlay.content.text,
        style: overlay.content.style,
        transform: overlay.transform,
        animation: overlay.content.animation
          ? {
              preset: overlay.content.animation.preset,
              params: overlay.content.animation.params || {},
              inDuration: overlay.content.animation.inDuration,
              outDuration: overlay.content.animation.outDuration,
              stagger: overlay.content.animation.stagger,
              unit: overlay.content.animation.unit,
            }
          : undefined,
        metadata,
      })
      const updated = titleEngine.updateTextClip(overlayId, {
        keyframes: buildKeyframes(overlayId, overlay.keyframes),
        blendMode: overlay.blendMode,
        blendOpacity: overlay.blendOpacity,
        emphasisAnimation: overlay.emphasisAnimation,
        metadata,
      })
      if (!updated) throw new ClipDomainError('invalid-json', 'Could not create text overlay from editing template')
      newTextClips.push(updated)
      addedOverlayClipIds.push(overlayId)
    } else if (overlay.type === 'shape') {
      graphicsEngine.createShape(
        {
          id: overlayId,
          shapeType: overlay.content.shapeType,
          width: overlay.content.width,
          height: overlay.content.height,
          extent: { width: overlay.content.width, height: overlay.content.height },
          style: overlay.content.style,
          points: overlay.content.points as ShapeClip['points'],
          pathData: overlay.content.pathData,
          closed: overlay.content.closed,
          metadata,
        },
        overlayTrackId,
        overlay.timing.startTime,
        overlay.timing.duration,
      )
      const updated = graphicsEngine.updateShapeClip(overlayId, {
        transform: overlay.transform,
        keyframes: buildKeyframes(overlayId, overlay.keyframes),
        blendMode: overlay.blendMode,
        blendOpacity: overlay.blendOpacity,
        emphasisAnimation: overlay.emphasisAnimation,
      })
      if (!updated) throw new ClipDomainError('invalid-json', 'Could not create shape overlay from editing template')
      newShapeClips.push(updated)
      addedOverlayClipIds.push(overlayId)
    } else if (overlay.type === 'image') {
      if (!overlay.content.imageUrl) {
        throw new ClipDomainError('invalid-json', 'Editing template image overlay is missing its imageUrl')
      }
      graphicsEngine.addStickerClip({
        id: overlayId,
        trackId: overlayTrackId,
        startTime: overlay.timing.startTime,
        duration: overlay.timing.duration,
        type: 'sticker',
        imageUrl: overlay.content.imageUrl,
        name: overlay.content.name,
        transform: overlay.transform,
        keyframes: buildKeyframes(overlayId, overlay.keyframes),
        blendMode: overlay.blendMode,
        blendOpacity: overlay.blendOpacity,
        emphasisAnimation: overlay.emphasisAnimation,
        metadata,
      })
      const created = graphicsEngine.getStickerClip(overlayId)
      if (!created) throw new ClipDomainError('invalid-json', 'Could not create sticker overlay from editing template')
      newStickerClips.push(created)
      addedOverlayClipIds.push(overlayId)
    }
  }

  nextProject = updateClipInTracks(nextProject, ownerClip.id, (clip) => ({
    ...clip,
    effects: [...clip.effects, ...addedEffects],
    audioEffects: [...clip.audioEffects, ...addedAudioEffects],
    keyframes: [...clip.keyframes, ...addedKeyframes],
    metadata: {
      ...(clip.metadata || {}),
      appliedTemplates: [...(clip.metadata?.appliedTemplates || []), appliedTemplate],
    },
  }))

  draft.replace({
    ...nextProject,
    textClips: newTextClips,
    shapeClips: newShapeClips,
    stickerClips: newStickerClips,
    modifiedAt: Date.now(),
  })

  return {
    clipId: ownerClip.id,
    templateId: template.id,
    applicationId,
    addedOverlayClipIds,
  }
}
