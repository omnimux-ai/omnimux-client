import { FILTER_PRESETS } from '../openreel/core/video/filter-presets'
import { getTimelineItemCapabilities } from '../openreel/core/timeline/timeline-items'
import { graphicInstanceOfClip } from '../openreel/core/graphic-templates/instances'
import { createDefaultAnimation, TEXT_ANIMATION_PRESETS } from '../openreel/core/text/text-animation-presets'
import { EASING_TYPES, type EasingType, type Effect, type Keyframe, type Subtitle, type Transform } from '../openreel/core/types/timeline'
import { TitleEngine } from '../openreel/core/text/title-engine'
import { SUBTITLE_STYLE_PRESETS } from '../openreel/core/text/subtitle-engine'
import type { TextAnimation, TextAnimationPreset, TextStyle } from '../openreel/core/text/types'
import { filterPresetEffectsForPreview } from '../openreel/web/services/filter-preset-application'
import { ClipDomainError } from '../../errors.js'
import { fields, invalid, number, onlyKeys, seconds, text, type Fields } from './native-input'
import { addTrack, requireItem, requireNewItemId, requirePlacement, requireTrack, type NativeDraft } from './native-timeline'

const styleKeys = ['fontSize', 'fontFamily', 'fontWeight', 'color', 'strokeColor', 'strokeWidth', 'backgroundColor', 'textAlign', 'position', 'presetId', 'preset', 'content'] as const

function color(value: unknown, key: string): string {
  const cssColor = text(value, key, 80)
  if (!/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d.%, +/\-]+\))$/i.test(cssColor)) invalid(`${key} must be a CSS color`)
  return cssColor
}

function textStyle(operation: Fields): { style: Partial<TextStyle>; content: unknown; position?: Transform['position'] } {
  const options = operation.textStyle ?? operation.style
  const nested = options === undefined ? {} : fields(options, 'text style')
  onlyKeys(nested, styleKeys, 'text style')
  const input = { ...operation, ...nested }
  const presetValue = input.presetId ?? input.preset
  const presetName = presetValue === 'subtitle' ? 'default' : presetValue
  if (presetName !== undefined && (typeof presetName !== 'string' || !Object.hasOwn(SUBTITLE_STYLE_PRESETS, presetName))) invalid('Choose an OpenReel subtitle preset')
  const preset = presetName === undefined ? undefined : SUBTITLE_STYLE_PRESETS[presetName as string]
  const style: { -readonly [K in keyof TextStyle]?: TextStyle[K] } = preset ? {
    fontFamily: preset.fontFamily, fontSize: preset.fontSize, color: preset.color, backgroundColor: preset.backgroundColor,
  } : {}
  if (input.fontFamily !== undefined) {
    const family = text(input.fontFamily, 'fontFamily', 96)
    if (!/^[\p{L}\p{N}_ ,.'"-]+$/u.test(family)) invalid('Choose a font family name')
    style.fontFamily = family
  }
  if (input.fontSize !== undefined) style.fontSize = number(input.fontSize, 'fontSize', 1, 800)
  if (input.fontWeight !== undefined) {
    const weight = typeof input.fontWeight === 'string' && /^\d00$/.test(input.fontWeight) ? Number(input.fontWeight) : input.fontWeight
    if (weight === 'normal' || weight === 'bold' || (typeof weight === 'number' && weight >= 100 && weight <= 900 && weight % 100 === 0)) {
      style.fontWeight = weight as TextStyle['fontWeight']
    } else invalid('Choose a supported font weight')
  }
  for (const key of ['color', 'strokeColor', 'backgroundColor'] as const) {
    if (input[key] !== undefined) style[key] = color(input[key], key)
  }
  if (input.strokeWidth !== undefined) style.strokeWidth = number(input.strokeWidth, 'strokeWidth', 0, 64)
  if (input.textAlign !== undefined) {
    const alignment = input.textAlign as TextStyle['textAlign']
    if (!['left', 'center', 'right', 'justify'].includes(alignment)) invalid('Choose a text alignment')
    style.textAlign = alignment
  }
  const placement = input.position ?? preset?.position
  let position: Transform['position'] | undefined
  if (placement === 'top' || placement === 'center' || placement === 'bottom') {
    position = { x: 0.5, y: placement === 'top' ? 0.15 : placement === 'center' ? 0.5 : 0.85 }
  } else if (placement !== undefined) {
    const point = fields(placement, 'position')
    onlyKeys(point, ['x', 'y'], 'position')
    position = { x: number(point.x, 'position.x', 0.05, 0.95), y: number(point.y, 'position.y', 0.05, 0.95) }
  }
  return { style, content: input.content ?? operation.text, position }
}

async function editCue(draft: NativeDraft, cue: Subtitle, operation: Fields, { style, content, position }: ReturnType<typeof textStyle>,
  { start, duration, end }: { start?: number; duration?: number; end?: number }) {
  if (cue.captionTrackId && draft.project.timeline.tracks.some(track => track.id === cue.captionTrackId)) requireTrack(draft.project, cue.captionTrackId)
  if (operation.trackId !== undefined && operation.trackId !== cue.captionTrackId) invalid('Use the captions editor to move this cue to another caption track')
  const startTime = start ?? cue.startTime
  const length = end !== undefined ? end - startTime : duration ?? cue.endTime - cue.startTime
  if (!(length > 0) || !Number.isFinite(startTime + length)) invalid('Provide a valid subtitle interval')
  if (end !== undefined && duration !== undefined && Math.abs(length - duration) > 1e-7) invalid('Duration must match the text interval')
  const { textAlign, fontWeight, ...stylePatch } = style
  if (fontWeight !== undefined || textAlign === 'justify') invalid('The native caption style does not support this font weight or alignment')
  const subtitleText = content === undefined ? cue.text : text(content, 'content', 8192)
  const endTime = startTime + length
  const changedWords = subtitleText !== cue.text || startTime !== cue.startTime || endTime !== cue.endTime
  const cueSettings: Subtitle['cueSettings'] = position || textAlign ? {
    ...cue.cueSettings,
    ...(textAlign ? { align: textAlign } : {}),
    ...(position ? { snapToLines: false, line: position.y * 100, lineAlign: 'center', position: position.x * 100, positionAlign: 'center' } : {}),
  } : cue.cueSettings
  const subtitle: Subtitle = {
    ...cue, text: subtitleText, startTime, endTime, cueSettings,
    ...(changedWords ? { words: undefined } : {}),
    ...(Object.keys(stylePatch).length ? { style: { ...SUBTITLE_STYLE_PRESETS.default, ...cue.style, ...stylePatch } } : {}),
  }
  await draft.action('subtitle/replace', { subtitleId: cue.id, subtitle })
  return { clipId: cue.id, trackId: cue.captionTrackId, startSec: startTime, durationSec: length }
}

export async function editText(draft: NativeDraft, operation: Fields) {
  const { project } = draft
  const create = operation.type === 'add_text' || operation.type === 'add_clip' || operation.clipId === undefined
  const options = textStyle(operation)
  const { style, content, position } = options
  const start = seconds(operation, 'startSec', 'startTimeMs')
  const duration = seconds(operation, 'durationSec', 'durationMs')
  const end = seconds(operation, 'endSec', 'endTimeMs')
  if (operation.kind !== undefined && operation.kind !== 'title' && operation.kind !== 'subtitle' && operation.kind !== 'caption') invalid('kind must be title or subtitle')
  const title = operation.kind === 'title'
  if (create) {
    const id = requireNewItemId(project, operation.clipId)
    const textValue = text(content ?? operation.name, 'content', 8192)
    if (!textValue.trim()) invalid('Text content is required')
    const trackId = operation.trackId ?? project.timeline.tracks.find(track => !track.locked && !track.hidden
      && (title ? track.type === 'graphics' : track.role === 'captions' || track.name === 'Captions'))?.id
      ?? (await addTrack(draft, { trackType: title ? 'graphics' : 'text' }, title ? undefined : 'captions')).trackId
    const track = requireTrack(draft.project, trackId)
    const startTime = start ?? 0
    const length = end !== undefined ? end - startTime : duration ?? 3
    if (end !== undefined && duration !== undefined && Math.abs(length - duration) > 1e-7) invalid('Duration must match the text interval')
    requirePlacement(draft.project, track.id, startTime, length)
    const clip = new TitleEngine().createTextClip({
      id, trackId: track.id, text: textValue, startTime, duration: length, style,
      transform: { position: position ?? { x: 0.5, y: title ? 0.5 : 0.85 } },
      metadata: title ? undefined : { wrapWidthRatio: 0.9 },
    })
    await draft.action('text/create', { clip })
    return { clipId: id, trackId: track.id, created: true, startSec: startTime, durationSec: length }
  }
  const cue = project.timeline.subtitles.find(item => item.id === operation.clipId)
  if (cue) return editCue(draft, cue, operation, options, { start, duration, end })
  const target = requireItem(project, operation.clipId)
  if (target.kind !== 'text') invalid('Choose an editable subtitle or title clip')
  if (graphicInstanceOfClip(project, target.item.id)) {
    throw new ClipDomainError('graphic-member-readonly', 'Update this graphic through update_graphic_params or ungroup it first.')
  }
  if (operation.trackId !== undefined && operation.trackId !== target.trackId) invalid('Use move_clip to change the text track')
  const clip = target.item
  const startTime = start ?? clip.startTime
  const length = end !== undefined ? end - startTime : duration ?? clip.duration
  if (end !== undefined && duration !== undefined && Math.abs(length - duration) > 1e-7) invalid('Duration must match the text interval')
  if (start !== undefined || duration !== undefined || end !== undefined) requirePlacement(project, clip.trackId, startTime, length, [clip.id])
  const next = {
    startTime, duration: length,
    ...(content === undefined ? {} : { text: text(content, 'content', 8192) }),
    style: { ...clip.style, ...style },
    ...(position ? { transform: { ...clip.transform, position } } : {}),
  }
  await draft.action('text/update', { clipId: clip.id, updates: next })
  return { clipId: clip.id, trackId: clip.trackId, startSec: startTime, durationSec: length }
}

function pair(value: unknown, property: string, min: number, max: number): { x: number; y: number } {
  const options = fields(value, property)
  onlyKeys(options, ['x', 'y'], property)
  return { x: number(options.x, `${property}.x`, min, max), y: number(options.y, `${property}.y`, min, max) }
}

export async function setClipEffect(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  if (item.kind !== 'media' || !getTimelineItemCapabilities(item).visual) invalid('Choose a visual media clip')
  const options = operation.transform === undefined ? operation : fields(operation.transform, 'transform')
  if (options !== operation) onlyKeys(options, ['opacity', 'scale', 'position', 'rotation'], 'transform')
  const transform = { ...item.item.transform }
  if (options.opacity !== undefined) transform.opacity = number(options.opacity, 'opacity', 0, 1)
  if (options.rotation !== undefined) transform.rotation = number(options.rotation, 'rotation', -3600, 3600)
  if (options.scale !== undefined) {
    transform.scale = typeof options.scale === 'number'
      ? { x: number(options.scale, 'scale', 0.01, 100), y: options.scale } : pair(options.scale, 'scale', 0.01, 100)
  }
  if (options.position !== undefined) transform.position = pair(options.position, 'position', -100000, 100000)
  const filter = operation.filter === undefined || typeof operation.filter === 'string' ? {} : fields(operation.filter, 'filter')
  onlyKeys(filter, ['id', 'presetId', 'intensity', 'strength'], 'filter')
  const filterId = (typeof operation.filter === 'string' ? operation.filter : undefined) ?? operation.filterId ?? operation.filterPresetId ?? filter.presetId ?? filter.id
  const intensityValue = operation.filterIntensity ?? operation.intensity ?? filter.intensity
  const strength = operation.strength ?? filter.strength
  const hasFilter = filterId !== undefined || intensityValue !== undefined || strength !== undefined
  const hasTransform = ['opacity', 'rotation', 'scale', 'position'].some(key => options[key] !== undefined)
  if (!hasFilter && !hasTransform) invalid('Provide a static transform or filter parameter')
  if (hasTransform) await draft.action('transform/update', { clipId: item.id, transform })
  if (hasFilter) {
    const current = item.item.effects.find(effect => effect.metadata?.filterPreset)?.metadata?.filterPreset
    const preset = FILTER_PRESETS.find(preset => preset.id === (filterId ?? current?.presetId))
    if (!preset) invalid('Choose a built-in OpenReel filter preset')
    const intensity = strength !== undefined ? number(strength, 'filter strength', 0, 1) * 100
      : intensityValue === undefined ? 100 : number(intensityValue, 'filter intensity', 0, 100)
    const applicationId = current?.applicationId ?? crypto.randomUUID()
    const group = filterPresetEffectsForPreview(preset, intensity).map((effect, index): Effect => ({
      ...effect,
      id: item.item.effects.find(old => old.metadata?.filterPreset?.applicationId === applicationId && old.type === effect.type
        && old.metadata.filterPreset.index === index)?.id ?? crypto.randomUUID(),
      enabled: true,
      metadata: { filterPreset: { presetId: preset.id, applicationId, index } },
    }))
    const first = item.item.effects.findIndex(effect => effect.metadata?.filterPreset?.applicationId === applicationId)
    const effects = item.item.effects.filter(effect => effect.metadata?.filterPreset?.applicationId !== applicationId)
    effects.splice(first < 0 ? effects.length : first, 0, ...group)
    await draft.action('effect/setStack', { clipId: item.id, effects })
  }
  return { clipId: item.id }
}

const KEYFRAME_PROPERTY_BOUNDS: Record<string, readonly [number, number]> = {
  'position.x': [-100_000, 100_000],
  'position.y': [-100_000, 100_000],
  'scale.x': [0.01, 100],
  'scale.y': [0.01, 100],
  rotation: [-3600, 3600],
  opacity: [0, 1],
}
const VALID_EASINGS = new Set<string>(EASING_TYPES.filter((easing) => easing !== 'bezier'))
const VALID_TEXT_PRESETS = new Set<string>(TEXT_ANIMATION_PRESETS.map((preset) => preset.id))
const TEXT_ANIMATION_UNITS = new Set(['character', 'word', 'line'])

export async function setKeyframes(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  const supported = (item.kind === 'media' && getTimelineItemCapabilities(item).visual)
    || item.kind === 'text' || item.kind === 'shape' || item.kind === 'svg'
  if (!supported) invalid('Choose a visual media, text, shape, or svg clip')
  if (item.kind !== 'media' && graphicInstanceOfClip(draft.project, item.id)) {
    throw new ClipDomainError('graphic-member-readonly', 'Update this graphic through update_graphic_params or ungroup it first.')
  }

  const mode = operation.mode ?? 'merge'
  if (mode !== 'merge' && mode !== 'replace') invalid('mode must be merge or replace')
  if (!Array.isArray(operation.keyframes) || operation.keyframes.length === 0 || operation.keyframes.length > 64) {
    invalid('keyframes must be an array of 1 to 64 keyframes')
  }

  const duration = item.item.duration
  const incoming: Keyframe[] = operation.keyframes.map((entry, index) => {
    const kf = fields(entry, `keyframes[${index}]`)
    onlyKeys(kf, ['property', 'timeSec', 'value', 'easing'], `keyframes[${index}]`)
    const property = text(kf.property, `keyframes[${index}].property`, 64)
    const bounds = KEYFRAME_PROPERTY_BOUNDS[property]
    if (!bounds) {
      throw new ClipDomainError('keyframe-out-of-range', `Unsupported keyframe property "${property}"`)
    }
    if (typeof kf.timeSec !== 'number' || !Number.isFinite(kf.timeSec) || kf.timeSec < 0 || kf.timeSec > duration + 1e-6) {
      throw new ClipDomainError('keyframe-out-of-range', `Keyframe timeSec ${String(kf.timeSec)} is outside [0, ${duration}]`)
    }
    const time = Math.min(duration, Math.max(0, kf.timeSec))
    if (typeof kf.value !== 'number' || !Number.isFinite(kf.value) || kf.value < bounds[0] || kf.value > bounds[1]) {
      throw new ClipDomainError('keyframe-out-of-range', `Keyframe value ${String(kf.value)} for ${property} must be between ${bounds[0]} and ${bounds[1]}`)
    }
    const easingRaw = kf.easing ?? 'ease-in-out'
    if (typeof easingRaw !== 'string' || !VALID_EASINGS.has(easingRaw)) {
      invalid(`Unsupported easing "${String(easingRaw)}"`)
    }
    return {
      id: crypto.randomUUID(),
      time,
      property,
      value: kf.value,
      easing: easingRaw as EasingType,
    }
  })

  const base: Keyframe[] = mode === 'replace' ? [] : [...(item.item.keyframes ?? [])]
  for (const kf of incoming) {
    const existingIndex = base.findIndex((candidate) => candidate.property === kf.property && Math.abs(candidate.time - kf.time) < 1e-4)
    if (existingIndex >= 0) base[existingIndex] = kf
    else base.push(kf)
  }
  const nextKeyframes = base.sort((left, right) => left.property.localeCompare(right.property) || left.time - right.time)

  if (item.kind === 'media') {
    await draft.action('keyframe/setAll', { clipId: item.id, keyframes: nextKeyframes })
  } else if (item.kind === 'text') {
    await draft.action('text/update', { clipId: item.id, updates: { keyframes: nextKeyframes } })
  } else if (item.kind === 'shape') {
    await draft.action('shape/update', { clipId: item.id, updates: { keyframes: nextKeyframes } })
  } else {
    await draft.action('svg/update', { clipId: item.id, updates: { keyframes: nextKeyframes } })
  }
  return { clipId: item.id, keyframeCount: nextKeyframes.length }
}

export async function setTextAnimation(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  if (item.kind !== 'text') invalid('set_text_animation requires an editable text clip')
  if (graphicInstanceOfClip(draft.project, item.id)) {
    throw new ClipDomainError('graphic-member-readonly', 'Update this graphic through update_graphic_params or ungroup it first.')
  }

  const preset = text(operation.preset, 'preset', 64) as TextAnimationPreset
  if (!VALID_TEXT_PRESETS.has(preset)) invalid('Choose a supported OpenReel text animation preset')

  const outPreset = operation.outPreset === undefined ? undefined : (text(operation.outPreset, 'outPreset', 64) as TextAnimationPreset)
  if (outPreset !== undefined && !VALID_TEXT_PRESETS.has(outPreset)) invalid('Choose a supported OpenReel exit text animation preset')

  const unit = operation.unit === undefined ? undefined : (text(operation.unit, 'unit', 32) as TextAnimation['unit'])
  if (unit !== undefined && !TEXT_ANIMATION_UNITS.has(unit)) invalid('unit must be character, word, or line')

  const stagger = operation.staggerSec === undefined ? undefined : number(operation.staggerSec, 'staggerSec', 0, 2)
  const duration = item.item.duration
  const defaults = createDefaultAnimation(preset)

  let animation: TextAnimation
  if (preset === 'none' && !outPreset) {
    animation = { preset: 'none', params: {}, inDuration: 0, outDuration: 0 }
  } else {
    const inDuration = operation.inDurationSec === undefined
      ? Math.min(duration, defaults.inDuration > 0 ? defaults.inDuration : Math.min(0.4, duration))
      : number(operation.inDurationSec, 'inDurationSec', 1e-4, duration)
    const outDuration = operation.outDurationSec === undefined
      ? Math.min(Math.max(0, duration - inDuration), defaults.outDuration > 0 ? defaults.outDuration : 0.3)
      : number(operation.outDurationSec, 'outDurationSec', 0, duration)
    if (inDuration + outDuration > duration + 1e-6) {
      invalid('inDurationSec + outDurationSec must not exceed the text clip duration')
    }
    const outDefaults = outPreset ? createDefaultAnimation(outPreset) : undefined
    animation = {
      preset,
      params: defaults.params,
      inDuration,
      outDuration,
      unit: unit ?? defaults.unit,
      stagger: stagger ?? defaults.stagger,
      ...(outPreset ? {
        out: {
          preset: outPreset,
          params: outDefaults?.params ?? {},
          unit: unit ?? outDefaults?.unit ?? defaults.unit,
          stagger: stagger ?? outDefaults?.stagger ?? defaults.stagger,
        },
      } : {}),
    }
  }

  await draft.action('text/update', { clipId: item.id, updates: { animation } })
  return { clipId: item.id, preset }
}
