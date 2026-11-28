import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { ClipDomainError, clipErrorValue, isClipRevision, isClipToken, safeClipLabel } from './errors.js'
import { readCanvasBinding, resolveWorkflowBinding, sameBinding } from './live/command-broker.js'
import { MAX_SNAPSHOT_FRAMES, persistSnapshot } from './live/snapshot.js'
import { authorizeClipEditOperations } from './media/authorizeToolMedia.js'
import { reconcileProjectMedia } from './media/reconcile.js'
import { assertProjectId } from './paths.js'
import { createNativeProject } from './store/nativeProject.js'
import { AUDIO_TYPES, CAPTION_ANIMATION_STYLES, EASING_TYPES, TEXT_ANIMATION_PRESETS } from '../lib/openreel-templates.js'
import { listClipTemplates } from './templates/catalog.js'
import { analyzeProjectTranscript } from './timeline/analyzeTranscript.js'
import { MEDIA_HANDLE_SCOPES, TRACK_TYPES, isRecord, isReferenceId, safeText, sourceProjection } from './timeline/nativeProjectFields.js'
import { diagnoseNativeProject, enrichDiagnosticsWithReconcile, nativeProjectView } from './timeline/nativeProjectView.js'

const DIMENSIONS = { landscape: [1920, 1080, '16:9'], portrait: [1080, 1920, '9:16'], square: [1080, 1080, '1:1'] }

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function objectParams(fields) {
  const properties = {}
  const required = []
  for (const [key, { required: requirement, ...spec }] of Object.entries(fields)) {
    properties[key] = Array.isArray(requirement) ? { ...spec, required: requirement } : spec
    if (requirement === true) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

const string = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength })
const boolean = { type: 'boolean' }
const seconds = { type: 'number', minimum: 0 }
const positive = { type: 'number', exclusiveMinimum: 0 }
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const oneOf = (...choices) => ({ oneOf: choices })
const arrayOf = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems })
const required = (schema) => ({ ...schema, required: true })
const choices = (...values) => ({ type: 'string', enum: values })
const projectIdArg = { ...string(128), description: 'Clip project ID. Omit to use the only visible editor in this conversation.' }
const targetArgs = {
  projectId: projectIdArg,
  windowInstanceId: { ...string(), description: 'Authenticated window ID from AMBIGUOUS_TARGET when several windows match.' },
  requestId: { ...string(128), description: 'Reuse this ID with the same arguments to recover the original result after a timeout.' },
}
const bindingArgs = {
  workspaceId: { ...string(131), description: 'Canvas workspace ID. Supply both workspaceId and nodeId for an uninitialized canvas project.' },
  nodeId: string(256),
}
const viewArgs = { view: choices('summary', 'tracks', 'clips', 'full'), trackId: string(256), clipId: string(256),
  fromSec: seconds, toSec: seconds }
const revisionArgs = {
  baseRevision: { ...integer, description: 'Expected revision from clip_get. Defaults to the active editor lease revision.' },
  baseRevisionEpoch: { ...integer, description: 'Expected revisionEpoch from a live clip_get for this project and window. For a new epoch, pass it explicitly or read the target editor again.' },
}
const range = { fromSec: required(seconds), toSec: required(seconds) }
const clipId = required(string(256))
const trackId = required(string(256))
const timing = { startSec: seconds, durationSec: positive, sourceInSec: seconds, sourceOutSec: seconds }
const point = objectParams({ x: required({ type: 'number' }), y: required({ type: 'number' }) })
const textStyleFields = {
  fontSize: positive, fontFamily: string(96), fontWeight: oneOf(string(16), positive),
  color: string(80), backgroundColor: string(80), strokeColor: string(80), strokeWidth: seconds,
  textAlign: choices('left', 'center', 'right', 'justify'), position: oneOf(string(64), point), presetId: string(80),
}
const captionExtendedStyleFields = {
  highlightColor: string(80),
  upcomingColor: string(80),
  shadowColor: string(80),
  shadowBlur: { type: 'number', minimum: 0, maximum: 64 },
  boxPaddingX: { type: 'number', minimum: 0, maximum: 120 },
  boxPaddingY: { type: 'number', minimum: 0, maximum: 120 },
  boxRadius: { type: 'number', minimum: 0, maximum: 120 },
  safeMargin: { type: 'number', minimum: 0, maximum: 0.25 },
  animationStyle: choices(...CAPTION_ANIMATION_STYLES),
}
const captionStyleFields = {
  fontSize: positive, fontFamily: string(96), color: string(80), backgroundColor: string(80),
  position: oneOf(string(64), point), presetId: string(80),
  strokeColor: string(80), strokeWidth: { type: 'number', minimum: 0, maximum: 64 },
  ...captionExtendedStyleFields,
}
const subtitleWordEntry = objectParams({
  text: required(string(80)),
  startSec: required(seconds),
  endSec: required(seconds),
})
const subtitleCueEntry = objectParams({
  id: string(256),
  text: required(string(4096)),
  startSec: required(seconds),
  endSec: required(positive),
  speaker: string(80),
  language: string(32),
  words: arrayOf(subtitleWordEntry, 500),
})
const textFields = {
  ...textStyleFields, textStyle: objectParams(textStyleFields), content: { type: 'string', maxLength: 8192 },
  startSec: seconds, endSec: seconds, durationSec: positive,
}
const mediaSourceFields = {
  path: string(4096),
  sourceUrl: string(4096),
  libraryAssetId: string(256),
  fileId: string(256),
  canvasNodeId: string(256),
  outputIndex: integer,
  projectAssetId: string(256),
  workspaceId: string(131),
}
const transformFields = { opacity: { ...seconds, maximum: 1 }, position: point, scale: oneOf(positive, point), rotation: { type: 'number' } }
const paramEntry = objectParams({
  id: required(string(80)),
  value: required(oneOf({ type: 'string', maxLength: 4000 }, { type: 'number' }, boolean, point)),
})
const controlEntry = objectParams({
  id: required(string(80)),
  value: required(oneOf({ type: 'string', maxLength: 4000 }, { type: 'number' }, boolean)),
})
const KEYFRAME_PROPS = ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity']
const KEYFRAME_EASINGS = EASING_TYPES.filter((easing) => easing !== 'bezier')
const TEXT_ANIM_PRESETS = TEXT_ANIMATION_PRESETS.map((preset) => preset.id)
const EDIT_FIELDS = {
  add_track: { trackType: required(choices(...TRACK_TYPES)), name: string(256), trackId: string(256), position: integer },
  remove_track: { trackId },
  set_track_state: { trackId, muted: boolean, locked: boolean, hidden: boolean, visible: boolean, name: string(256) },
  import_media: { ...mediaSourceFields, mediaId: string(256), name: string(256),
    mediaType: choices('video', 'audio', 'image'), trackId: string(256), placeOnTimeline: boolean, append: boolean, ...timing },
  relink_media: { mediaId: required(string(256)), source: required(objectParams(mediaSourceFields)), allowVersionUpdate: boolean },
  add_clip: { trackId, mediaId: required(string(256)), clipId: string(256), append: boolean, ...timing },
  trim_clip: { clipId, ...timing },
  split_clip: { clipId, atSec: required(seconds) },
  move_clip: { clipId, trackId: string(256), startSec: required(seconds) },
  remove_clip: { clipId, ripple: boolean },
  remove_range: { ...range, trackId: string(256), ripple: boolean },
  cut_silences: { trackId: string(256), minSilenceSec: seconds, silences: arrayOf(objectParams(range), 250) },
  set_volume: { clipId, volume: { ...seconds, maximum: 2 }, muted: boolean },
  set_speed: { clipId, speed: required(positive) },
  add_text: { clipId: string(256), trackId: string(256), kind: choices('subtitle', 'title'), ...textFields, content: required(textFields.content) },
  set_text: { clipId, ...textFields },
  set_subtitle_style: { clipId, ...textFields, ...captionExtendedStyleFields, style: objectParams(captionStyleFields) },
  add_transition: { clipId, clipBId: string(256), transitionId: string(256), transition: string(80), edge: choices('in', 'out'), durationSec: positive },
  remove_transition: { transitionId: string(256), clipId: string(256), edge: choices('in', 'out') },
  set_clip_effect: { clipId, ...transformFields, transform: objectParams(transformFields), filterId: string(100), strength: { ...seconds, maximum: 1 },
    filterIntensity: { ...seconds, maximum: 100 } },
  add_graphic_instance: {
    templateId: string(128), libraryAssetId: string(256), fileId: string(256),
    instanceId: string(128), name: string(120), trackId: string(256),
    startSec: required(seconds), durationSec: positive,
    params: arrayOf(paramEntry, 64),
  },
  update_graphic_params: {
    instanceId: required(string(128)),
    params: arrayOf(paramEntry, 64),
    startSec: seconds, durationSec: positive, trackId: string(256),
  },
  remove_graphic_instance: { instanceId: required(string(128)), ungroup: boolean },
  apply_editing_template: {
    clipId: required(string(256)),
    templateId: required(string(128)),
    controls: arrayOf(controlEntry, 32),
  },
  set_keyframes: {
    clipId: required(string(256)),
    mode: choices('merge', 'replace'),
    keyframes: required(arrayOf(objectParams({
      property: required(choices(...KEYFRAME_PROPS)),
      timeSec: required(seconds),
      value: required({ type: 'number' }),
      easing: choices(...KEYFRAME_EASINGS),
    }), 64, 1)),
  },
  set_text_animation: {
    clipId: required(string(256)),
    preset: required(choices(...TEXT_ANIM_PRESETS)),
    inDurationSec: positive,
    outDurationSec: seconds,
    unit: choices('character', 'word', 'line'),
    staggerSec: seconds,
    outPreset: choices(...TEXT_ANIM_PRESETS),
  },
  import_subtitles: {
    srt: string(512_000),
    transcriptJson: string(512_000),
    cues: arrayOf(subtitleCueEntry, 2000, 1),
    mode: choices('append', 'replace'),
    captionTrackId: string(256),
    language: string(32),
    timeOffsetSec: { type: 'number', minimum: -86400, maximum: 86400 },
    ...captionStyleFields,
    style: objectParams(captionStyleFields),
  },
  set_caption_style: {
    clipId: string(256),
    clipIds: arrayOf(string(256), 500, 1),
    captionTrackId: string(256),
    ...captionStyleFields,
    style: objectParams(captionStyleFields),
  },
  cut_transcript_ranges: {
    mode: choices('ranges', 'pauses', 'fillers'),
    ranges: arrayOf(objectParams(range), 250, 1),
    captionTrackId: string(256),
    minPauseSec: { type: 'number', minimum: 0.05, maximum: 60 },
    keepPauseSec: seconds,
    fillerPhrases: arrayOf(string(64), 64, 1),
    paddingSec: { type: 'number', minimum: 0, maximum: 0.3 },
    maxCuts: { type: 'integer', minimum: 1, maximum: 250 },
  },
  set_marker: {
    markerId: string(256),
    timeSec: seconds,
    durationSec: seconds,
    label: string(120),
    color: string(80),
    comment: string(1000),
    kind: choices('comment', 'chapter', 'segmentation', 'web'),
  },
  remove_marker: {
    markerId: required(string(256)),
  },
  set_audio_ducking: {
    clipId,
    audioType: choices(...AUDIO_TYPES, 'none'),
    enabled: boolean,
    amountDb: { type: 'number', minimum: 1, maximum: 40 },
    attackMs: { type: 'number', minimum: 10, maximum: 3000 },
    releaseMs: { type: 'number', minimum: 10, maximum: 3000 },
    holdMs: { type: 'number', minimum: 0, maximum: 3000 },
  },
  sync_clips_to_beats: {
    clipIds: required(arrayOf(string(256), 100, 1)),
    beats: arrayOf(seconds, 1000, 2),
    audioClipId: string(256),
    audioStartSec: seconds,
    syncMode: choices('cut-to-beats', 'smart', 'one-per-beat', 'preserve-duration'),
    beatsPerClip: { type: 'integer', minimum: 1, maximum: 8 },
    subdivision: { type: 'integer', minimum: 1, maximum: 4 },
    offsetSec: { type: 'number', minimum: -10, maximum: 10 },
    snapToDownbeats: boolean,
  },
}
const editUnion = oneOf(...Object.entries(EDIT_FIELDS).map(([type, fields]) => objectParams({ type: required(choices(type)), ...fields })))

const domainSchemaKeywords = ['minimum', 'maximum', 'exclusiveMinimum', 'minLength', 'maxLength', 'minItems', 'maxItems']

// Project input schemas to the Harness vocabulary. validateValue enforces the domain bounds.
function toHarnessParameters(schema) {
  const parameters = { ...schema }
  for (const keyword of domainSchemaKeywords) delete parameters[keyword]
  if (schema.properties) {
    parameters.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, toHarnessParameters(child)]),
    )
  }
  if (schema.items) parameters.items = toHarnessParameters(schema.items)
  if (schema.oneOf) parameters.oneOf = schema.oneOf.map(toHarnessParameters)
  return parameters
}

function validateValue(value, schema, field) {
  if (schema.oneOf) {
    const operationSchemas = schema.oneOf.filter((option) => option.properties?.type?.enum)
    if (operationSchemas.length) {
      const match = operationSchemas.find((option) => option.properties.type.enum.includes(value?.type))
      if (match) return validateValue(value, match, field)
      throw ClipDomainError.invalidJson(`${field}.type is not a supported edit operation.`)
    }
    const matches = schema.oneOf.filter((option) => {
      try { validateValue(value, option, field); return true } catch { return false }
    })
    if (matches.length === 1) return
  } else if (schema.type === 'object') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) throw ClipDomainError.invalidJson(`${field}.${key} is required.`)
      }
      for (const [key, child] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties, key)) {
          if (/^(?:approved|trusted|expressions?|sourcecode|script|code|shader|motioncompositions|motioninstances)$/i.test(key.replace(/[_-]/g, ''))) {
            throw new ClipDomainError('motion-expression-denied', 'Motion code and approval fields are unavailable in Clip tools.')
          }
          throw ClipDomainError.invalidJson(`${field} contains an unsupported field.`)
        }
        if (child !== undefined) validateValue(child, schema.properties[key], `${field}.${key}`)
      }
      return
    }
  } else if (schema.type === 'array') {
    if (Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems) {
      value.forEach((item, index) => validateValue(item, schema.items, `${field}[${index}]`))
      return
    }
  } else if (schema.type === 'string') {
    if (typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity)
      && (!schema.enum || schema.enum.includes(value))) return
  } else if (schema.type === 'boolean') {
    if (typeof value === 'boolean') return
  } else if (Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value))
    && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity) && value > (schema.exclusiveMinimum ?? -Infinity)) return
  throw ClipDomainError.invalidJson(`${field} has an invalid value.`)
}

function targetFor({ projectId, windowInstanceId, workspaceId, nodeId }) {
  if (windowInstanceId !== undefined && !isClipToken(windowInstanceId)) throw ClipDomainError.invalidJson('Invalid windowInstanceId.')
  if (projectId !== undefined) assertProjectId(projectId)
  const binding = workspaceId !== undefined || nodeId !== undefined
    ? readCanvasBinding(projectId, { workspaceId, nodeId, projectId }) : undefined
  return { projectId, windowInstanceId, binding }
}

function sessionOf(exec) {
  return exec?.agent?.session?.id != null ? exec.agent.session : exec?.session
}

const TRACK_FIELDS = 'id index name type locked syncLock hidden muted solo soloSafe clipCount'
const CLIP_FIELDS = 'id name trackId trackIndex trackType kind startSec endSec durationSec mediaId mediaType sourceInSec sourceOutSec speed volume audioType text graphicInstanceId keyframeCount textAnimationPreset hasEffects hasColorGrading'
const STYLE_FIELDS = 'fontFamily fontSize fontWeight color backgroundColor strokeColor strokeWidth textAlign position highlightColor upcomingColor shadowColor shadowBlur boxPaddingX boxPaddingY boxRadius safeMargin'

function readFields(row, keys) {
  const selected = {}
  for (const key of keys.split(' ')) {
    const value = row?.[key]
    if (key === 'id' || key.endsWith('Id')) {
      if (isReferenceId(value)) selected[key] = value
    } else if (typeof value === 'string') {
      selected[key] = safeText(value, key === 'text' ? 4000 : key === 'comment' ? 1000 : 160)
    } else if (typeof value === 'boolean' || Number.isFinite(value)) {
      selected[key] = value
    }
  }
  return selected
}

function readItems(rows, keys, withStyle = false) {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The native snapshot is missing its requested projection.')
  }
  return rows.map((row) => ({
    ...readFields(row, keys),
    ...(withStyle && row.style ? { style: readFields(row.style, STYLE_FIELDS) } : {}),
    ...(withStyle && isRecord(row.liveDucking) && typeof row.liveDucking.enabled === 'boolean'
      ? { liveDucking: readFields(row.liveDucking, 'enabled amountDb attackMs releaseMs holdMs') }
      : {}),
    ...(withStyle && Array.isArray(row.words)
      ? { words: row.words.slice(0, 200).filter(isRecord).map((word) => readFields(word, 'text startSec endSec')) }
      : {}),
  }))
}

function validateAnalyze(result, command) {
  const { mode } = command.args
  if (!isRecord(result) || result.projectId !== command.projectId || result.mode !== mode) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return the requested Clip analysis.')
  }
  if (mode === 'transcript') {
    if (!Number.isFinite(result.subtitleCount) || !Number.isFinite(result.wordCount)
      || !Number.isFinite(result.sentenceCount) || !Array.isArray(result.sentences)
      || !Array.isArray(result.pauses) || !Array.isArray(result.fillers)) {
      throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return a valid transcript analysis.')
    }
    return {
      ...readFields(result, 'projectId revision revisionEpoch mode durationSec subtitleCount wordCount sentenceCount estimatedWordCount'),
      speakers: Array.isArray(result.speakers) ? result.speakers.slice(0, 100).map((speaker) => safeText(speaker, 80)).filter(Boolean) : [],
      sentences: result.sentences.slice(0, 500).filter(isRecord).map((row) => readFields(row, 'index startSec endSec text speaker wordStart wordEnd')),
      pauses: result.pauses.slice(0, 250).filter(isRecord).map((row) => readFields(row, 'startSec endSec gapSec cutFromSec cutToSec')),
      fillers: result.fillers.slice(0, 250).filter(isRecord).map((row) => readFields(row, 'startSec endSec text phrase wordStart wordEnd')),
      ...(Array.isArray(result.matches)
        ? { matches: result.matches.slice(0, 100).filter(isRecord).map((row) => readFields(row, 'startSec endSec text wordStart wordEnd')) }
        : {}),
    }
  }
  if (mode === 'beats') {
    if (!Number.isFinite(result.bpm) || !Number.isFinite(result.beatCount) || !Array.isArray(result.beats)) {
      throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return a valid beat analysis.')
    }
    return {
      ...readFields(result, 'projectId mode clipId mediaId bpm confidence audioDurationSec beatCount downbeatCount truncated'),
      beats: result.beats.slice(0, 500).filter(isRecord).map((row) => readFields(row, 'timeSec sourceTimeSec strength index isDownbeat isSubdivision')),
      downbeats: Array.isArray(result.downbeats) ? result.downbeats.slice(0, 500).filter(Number.isFinite) : [],
    }
  }
  if (!Number.isFinite(result.highlightCount) || !Array.isArray(result.highlights)) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return a valid highlight analysis.')
  }
  return {
    ...readFields(result, 'projectId mode clipId mediaId audioDurationSec highlightCount'),
    highlights: result.highlights.slice(0, 20).filter(isRecord).map((row) => readFields(row, 'startSec endSec durationSec score title reason')),
  }
}

function validateRead(result, command) {
  const { revision, revisionEpoch = 0, view } = result
  if (result.projectId !== command.projectId || view !== command.args.view || !isClipRevision(revision)
    || revisionEpoch !== (command.revisionEpoch ?? 0) || !Number.isFinite(result.durationSec) || !Number.isFinite(result.playheadSec)) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return the requested native Clip projection.')
  }
  const snapshot = { ...readFields(result, 'title durationSec fps width height aspectRatio playheadSec isPlaying trackCount clipCount mediaCount missingMediaCount subtitleCount markerCount graphicInstanceCount'),
    view, revision, revisionEpoch, mode: command.mode, selectedClips: readItems(result.selectedClips, 'id name trackId startSec endSec').slice(0, 3) }
  if (Number.isFinite(result.updatedAt)) snapshot.updatedAt = result.updatedAt
  if (command.binding) Object.assign(snapshot, { workspaceId: command.binding.workspaceId, nodeId: command.binding.nodeId })
  if (view === 'summary') return snapshot
  if (view === 'tracks') return { ...snapshot, tracks: readItems(result.tracks, TRACK_FIELDS) }
  const clips = readItems(result.clips, CLIP_FIELDS, true)
  if (view === 'clips') return { ...snapshot, clips }
  const tracks = readItems(result.tracks, TRACK_FIELDS).map((track, index) => ({
    ...track, clips: readItems(result.tracks[index].clips, CLIP_FIELDS, true),
    transitions: readItems(result.tracks[index].transitions ?? [], 'id clipAId clipBId edge type durationSec'),
  }))
  const media = readItems(result.media, 'id mediaId name type missing durationSec width height').map((item, index) => {
    const source = sourceProjection(result.media[index].omnimuxSource)
    return source ? { ...item, omnimuxSource: source } : item
  })
  const graphicInstances = Array.isArray(result.graphicInstances)
    ? readItems(result.graphicInstances, 'id name templateId category trackId startSec durationSec').map((row, index) => {
        const rawValues = result.graphicInstances[index]?.values
        const values = {}
        if (isRecord(rawValues)) {
          for (const [k, v] of Object.entries(rawValues)) {
            if (!isReferenceId(k)) continue
            if (typeof v === 'string') values[k] = safeText(v, 4000) ?? ''
            else if (typeof v === 'boolean' || Number.isFinite(v)) values[k] = v
            else if (isRecord(v) && Number.isFinite(v.x) && Number.isFinite(v.y)) values[k] = { x: v.x, y: v.y }
          }
        }
        return { ...row, values }
      })
    : undefined
  return {
    ...snapshot,
    tracks,
    clips,
    media,
    ...(graphicInstances ? { graphicInstances } : {}),
    ...(Array.isArray(result.markers) ? { markers: readItems(result.markers, 'id timeSec durationSec label color comment kind') } : {}),
    subtitles: readItems(result.subtitles, 'id trackId text startSec endSec hidden animationStyle speaker language wordCount', true),
  }
}

function validateView(result, command) {
  const { action, durationSec, playheadSec, isPlaying, selectedClipIds, revision } = result
  if (result.projectId !== command.projectId || action !== command.args.action || !isClipRevision(revision)
    || !Number.isFinite(durationSec) || durationSec < 0 || !Number.isFinite(playheadSec) || playheadSec < 0
    || typeof isPlaying !== 'boolean' || !Array.isArray(selectedClipIds) || !selectedClipIds.every(isReferenceId)) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not return the requested native playback state.')
  }
  return { action, durationSec, playheadSec, isPlaying, selectedClipIds, revision }
}

const EDIT_RESULT_FIELDS = 'type trackId clipId mediaId rightClipId transitionId instanceId templateId applicationId markerId startSec durationSec sourceInSec sourceOutSec atSec fromSec toSec timeSec label color kind created updated reused relinked versionUpdated ungrouped keyframeCount preset clampedClipCount speed volume muted mode count closed minSilenceSec subtitleCount animationStyle cutDurationSec syncMode bpm beatCount audioType captionTrackId'

function projectEditResult(row) {
  const result = readFields(row, EDIT_RESULT_FIELDS)
  for (const key of ['createdClipIds', 'removedClipIds', 'updatedClipIds', 'memberClipIds', 'addedOverlayClipIds']) {
    if (Array.isArray(row[key])) result[key] = row[key].filter(isReferenceId)
  }
  if (MEDIA_HANDLE_SCOPES.includes(row.scope)) result.scope = row.scope
  const source = sourceProjection(row.omnimuxSource)
  if (source) result.omnimuxSource = source
  if (isRecord(row.transition)) result.transition = readFields(row.transition, 'type durationSec')
  if (isRecord(row.liveDucking) && typeof row.liveDucking.enabled === 'boolean') {
    result.liveDucking = readFields(row.liveDucking, 'enabled amountDb attackMs releaseMs holdMs')
  }
  if (Array.isArray(row.syncedClips)) {
    result.syncedClips = row.syncedClips
      .filter(isRecord)
      .map((entry) => readFields(entry, 'clipId startSec durationSec'))
  }
  if (Array.isArray(row.adjustedClips)) {
    result.adjustedClips = row.adjustedClips
      .filter(isRecord)
      .map((entry) => readFields(entry, 'clipId trackId previousOutSec outSec previousDurationSec durationSec'))
  }
  if (Array.isArray(row.removed)) {
    result.removed = row.removed.filter(isRecord).map((range) => ({
      ...readFields(range, 'fromSec toSec'),
      createdClipIds: Array.isArray(range.createdClipIds) ? range.createdClipIds.filter(isReferenceId) : [],
      removedClipIds: Array.isArray(range.removedClipIds) ? range.removedClipIds.filter(isReferenceId) : [],
    }))
  }
  return result
}

function validateEdit(result, command) {
  const { operations, validateOnly } = command.args
  if (result.projectId !== command.projectId || !isClipRevision(result.revision)
    || !Array.isArray(result.results) || result.results.length !== operations.length
    || !result.results.every((row, index) => isRecord(row) && row.type === operations[index].type)
    || typeof result.persisted !== 'boolean' || (result.synchronized === true && !result.persisted)
    || (validateOnly ? result.revision !== command.baseRevision || result.undoStep !== false || result.persisted
      : result.revision <= command.baseRevision || result.undoStep !== true)) {
    throw new ClipDomainError('INVALID_RECEIPT', 'The editor did not report the expected revision and batch result.')
  }
  return { ...readFields(result, 'description durationSec revision undoStep persisted synchronized conflict actionId'),
    validateOnly, results: result.results.map(projectEditResult) }
}

function exportResult(jobs, id) {
  const job = jobs.get(id)
  if (job.status === 'awaiting-upload' || (job.binding && job.status === 'file-saved')) return null
  if (!job.fileSaved) {
    throw new ClipDomainError(job.error?.code ?? 'export-upload-failed', job.error?.message ?? 'The Clip export has no verified MP4.',
      { requestId: job.requestId, exportJobId: job.exportJobId })
  }
  const { output: { durationMs, ...output }, ...result } = job
  return { ...result, output: { ...output, durationSec: durationMs / 1000 } }
}

export function createClipTools({
  store,
  broker,
  exportJobs,
  getWorkflowClip,
  getMediaResolver,
  getAssetLibrary,
  mediaTransfers,
  getAttachments,
}) {
  const snapshotsWithAttachments = new WeakMap()
  function withAttachments(value) {
    if (!snapshotsWithAttachments.has(value)) {
      const attachments = getAttachments?.()
      if (!attachments?.saveImage) return value
      const attached = (async () => {
        const frames = []
        for (const frame of value.frames) {
          try {
            const attachment = await attachments.saveImage({ data: await readFile(frame.path), mediaType: 'image/png', name: basename(frame.path) })
            frames.push(attachment ? { ...frame, attachment } : frame)
          } catch {
            // Keep the verified file link when an attachment cannot be stored.
            frames.push(frame)
          }
        }
        return { ...value, frames }
      })()
      snapshotsWithAttachments.set(value, attached)
    }
    return snapshotsWithAttachments.get(value)
  }

  function live(operation, timeoutMs, args, exec, options = {}) {
    const session = sessionOf(exec)
    if (!session?.id && options.savedFallback && args.projectId && !args.windowInstanceId) return null
    if (!broker) throw new ClipDomainError('EDITOR_OFFLINE', 'The Clip Host cannot reach the live editor.')
    const { requestId, baseRevision, baseRevisionEpoch, projectId, windowInstanceId, ...parameters } = args
    return broker.run({ operation, sessionId: session?.id, signal: exec?.signal, selector: targetFor(args), requestId, baseRevision, baseRevisionEpoch,
      args: parameters, timeoutMs, ...options })
  }

  function tool(name, description, timeoutMs, fields, run, output = jsonOut) {
    const validationSchema = objectParams(fields)
    return { name, description, timeoutMs, parameters: toHarnessParameters(validationSchema), output, async execute(args, exec) {
      validateValue(args, validationSchema, name)
      return run(args, exec)
    } }
  }

  return [
    tool('clip_list', 'List saved OpenReel projects, including projects migrated from older timelines. Unreadable entries are reported separately.', 10_000,
      { limit: { type: 'integer', minimum: 1, maximum: 100 } }, ({ limit }) => {
        const { projects, unavailableProjects, unavailableCount } = store.list({ limit })
        const rows = projects.map(({ durationMs, ...item }) => ({ ...item, durationSec: durationMs / 1000 }))
        return { count: rows.length, projects: rows, unavailableProjects, unavailableCount }
      }),
    tool('clip_templates', 'List built-in and validated asset-library graphic templates, editing templates, and text animation presets.', 10_000,
      {
        kind: choices('all', 'graphic', 'editing', 'text_animation'),
        category: string(64),
        templateId: string(128),
        includeAssetLibrary: boolean,
      }, (args) => listClipTemplates(args, { getAssetLibrary })),
    tool('clip_analyze', 'Analyze project subtitles/transcript (sentences, pauses, filler words, search matches) or live editor audio (BPM beats or energetic highlights). Transcript mode works on live or saved projects; beats and highlights require an open editor with audio.', 60_000,
      {
        ...targetArgs,
        mode: required(choices('transcript', 'beats', 'highlights')),
        captionTrackId: string(256),
        minPauseSec: { type: 'number', minimum: 0.05, maximum: 60 },
        keepPauseSec: { type: 'number', minimum: 0, maximum: 60 },
        fillerPhrases: arrayOf(string(64), 64, 1),
        query: string(160),
        clipId: string(256),
        mediaId: string(256),
        minBpm: { type: 'number', minimum: 30, maximum: 240 },
        maxBpm: { type: 'number', minimum: 30, maximum: 300 },
        sensitivity: { type: 'number', minimum: 0.05, maximum: 1 },
        subdivision: { type: 'integer', minimum: 1, maximum: 4 },
        snapToDownbeats: boolean,
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        targetClipCount: { type: 'integer', minimum: 1, maximum: 20 },
        minClipDurationSec: { type: 'number', minimum: 1, maximum: 120 },
        maxClipDurationSec: { type: 'number', minimum: 1, maximum: 300 },
      }, async (args, exec) => {
        if (args.mode === 'transcript') {
          for (const key of ['clipId', 'mediaId', 'minBpm', 'maxBpm', 'sensitivity', 'subdivision', 'snapToDownbeats', 'limit', 'targetClipCount', 'minClipDurationSec', 'maxClipDurationSec']) {
            if (args[key] !== undefined) throw ClipDomainError.invalidJson(`${key} is not supported in transcript analysis mode.`)
          }
          targetFor(args)
          const result = await live('clip_analyze', 15_000, args, exec, { savedFallback: true, validateResult: validateAnalyze })
          if (result !== null) return result
          const loaded = store.load(assertProjectId(args.projectId))
          return {
            projectId: loaded.projectId,
            revision: loaded.revision,
            revisionEpoch: 0,
            mode: 'transcript',
            durationSec: loaded.project.timeline.duration,
            ...analyzeProjectTranscript(loaded.project, args),
          }
        }
        for (const key of ['minPauseSec', 'keepPauseSec', 'fillerPhrases', 'query']) {
          if (args[key] !== undefined) throw ClipDomainError.invalidJson(`${key} is only supported in transcript analysis mode.`)
        }
        if (args.mode === 'beats') {
          for (const key of ['captionTrackId', 'targetClipCount', 'minClipDurationSec', 'maxClipDurationSec']) {
            if (args[key] !== undefined) throw ClipDomainError.invalidJson(`${key} is not supported in beats analysis mode.`)
          }
          if (args.minBpm !== undefined && args.maxBpm !== undefined && args.maxBpm < args.minBpm) {
            throw ClipDomainError.invalidJson('maxBpm must be at least minBpm.')
          }
          if (args.subdivision !== undefined && args.subdivision !== 1 && args.subdivision !== 2 && args.subdivision !== 4) {
            throw ClipDomainError.invalidJson('subdivision must be 1, 2, or 4.')
          }
        } else {
          for (const key of ['minBpm', 'maxBpm', 'sensitivity', 'subdivision', 'snapToDownbeats', 'limit']) {
            if (args[key] !== undefined) throw ClipDomainError.invalidJson(`${key} is not supported in highlights analysis mode.`)
          }
          if (args.minClipDurationSec !== undefined && args.maxClipDurationSec !== undefined && args.maxClipDurationSec < args.minClipDurationSec) {
            throw ClipDomainError.invalidJson('maxClipDurationSec must be at least minClipDurationSec.')
          }
        }
        return live('clip_analyze', 55_000, args, exec, { savedFallback: false, validateResult: validateAnalyze })
      }),
    tool('clip_create', 'Create a saved, empty standalone OpenReel project. Use clip_open to show it when the user asks.', 15_000,
      { name: required(string(80)), resolution: choices('landscape', 'portrait', 'square'), fps: positive }, ({ name, resolution = 'landscape', fps = 30 }) => {
        name = name.trim()
        if (!name) throw ClipDomainError.invalidJson('name is required.')
        const projectId = `clip_${randomUUID()}`
        const [width, height, aspectRatio] = DIMENSIONS[resolution]
        const project = createNativeProject(projectId, name)
        project.settings = { ...project.settings, width, height, frameRate: fps }
        project.timeline.tracks = ['video', 'audio', 'text'].map((type) => ({ id: randomUUID(), name: type, type, clips: [], transitions: [] }))
        const { revision } = store.create(projectId, project)
        return { projectId, name, mode: 'standalone', aspectRatio, fps, revision, durationSec: 0 }
      }),
    tool('clip_open', 'Open a specific Clip project in its native standalone tab or canvas node. Use only when the user requests opening it.', 25_000,
      { ...targetArgs, ...bindingArgs, projectId: required(projectIdArg) }, (args, exec) => {
        if (!broker) throw new ClipDomainError('EDITOR_OFFLINE', 'The Clip Host cannot open the live editor.')
        const selector = targetFor(args)
        const { projectId, binding } = selector
        const sessionId = sessionOf(exec)?.id
        return broker.open({ selector, requestId: args.requestId, signal: exec?.signal, sessionId, timeoutMs: 22_000,
          resolveTarget() {
            const saved = store.exists(projectId) ? store.load(projectId) : null
            if (saved?.binding && binding && !sameBinding(saved.binding, binding)) {
              throw new ClipDomainError('clip-binding-mismatch', 'The Clip project belongs to another composition node.')
            }
            const target = binding ?? saved?.binding
            if (target) {
              resolveWorkflowBinding(getWorkflowClip?.(), target, sessionId)
              return { projectId, mode: 'canvas', binding: target }
            }
            if (projectId.startsWith('clip_node_')) throw ClipDomainError.projectNotMaterialized(projectId)
            if (!saved) store.load(projectId)
            return { projectId, mode: 'standalone' }
          },
        })
      }),
    tool('clip_get', 'Read a native Clip snapshot with revision and revisionEpoch. Prefers the visible editor, or reads a saved project by ID. A live read also returns windowInstanceId. Views: summary, tracks, clips, full. Times are seconds.', 15_000,
      { ...targetArgs, ...viewArgs }, async (args, exec) => {
        if (args.fromSec !== undefined && args.toSec !== undefined && args.toSec < args.fromSec) {
          throw ClipDomainError.invalidJson('toSec must be at least fromSec.')
        }
        targetFor(args)
        const result = await live('clip_get', 10_000, { ...args, view: args.view ?? 'summary' }, exec, { savedFallback: true, validateResult: validateRead })
        return result ?? JSON.parse(JSON.stringify(nativeProjectView(store.load(assertProjectId(args.projectId)), args)))
      }, {
        ...jsonOut,
        schema: {
          ...jsonOut.schema,
          properties: {
            revision: { type: 'integer' },
            revisionEpoch: { type: 'integer' },
            windowInstanceId: { type: 'string' },
          },
          required: ['revision', 'revisionEpoch'],
        },
      }),
    tool('clip_edit', 'Apply an atomic OpenReel edit batch with one undo step. All times are seconds. validateOnly checks a batch without saving. Set confirmDestructive only with explicit user intent to delete a populated track or clear the timeline.', 180_000,
      { ...targetArgs, ...revisionArgs, description: required(string(300)), operations: required(arrayOf(editUnion, 100, 1)),
        validateOnly: boolean, confirmDestructive: boolean }, (args, exec) => {
        if (!args.description.trim()) throw ClipDomainError.invalidJson('description is required.')
        const cwd = sessionOf(exec)?.header?.cwd
        return live('clip_edit', 175_000, { ...args, description: args.description.trim(), validateOnly: args.validateOnly === true,
          confirmDestructive: args.confirmDestructive === true }, exec, {
          checkRevision: true, validateResult: validateEdit,
          prepareArgs: (input, command, sessionId) => authorizeClipEditOperations(input, {
            command,
            sessionId,
            cwd,
            getMediaResolver,
            getWorkflowClip,
            getAssetLibrary,
            mediaTransfers,
            signal: exec?.signal,
          }),
        })
      }),
    tool('clip_view', 'Control playback and selection in the visible editor. seek uses toSec and select_clips uses clipIds.', 12_000,
      { ...targetArgs, action: required(choices('seek', 'play', 'pause', 'select_clips')), toSec: seconds, fromSec: seconds,
        clipIds: arrayOf(string(256), 100) }, (args, exec) => {
        if (args.action === 'seek' && args.toSec === undefined) throw ClipDomainError.invalidJson('seek requires toSec.')
        if (args.action === 'select_clips' && !Array.isArray(args.clipIds)) throw ClipDomainError.invalidJson('select_clips requires clipIds.')
        return live('clip_view', 10_000, args, exec, { validateResult: validateView })
      }),
    tool('clip_snapshot', 'Capture up to six real PNG frames from the visible OpenReel preview at the specified times or across a range in seconds.', 60_000,
      { ...targetArgs, times: arrayOf(seconds, MAX_SNAPSHOT_FRAMES, 1), fromSec: seconds, toSec: seconds,
        count: { ...integer, minimum: 1, maximum: MAX_SNAPSHOT_FRAMES } }, async (args, exec) => {
        const wantsRange = args.fromSec !== undefined || args.toSec !== undefined || args.count !== undefined
        if (wantsRange && (args.times || args.fromSec === undefined || args.toSec === undefined || args.toSec <= args.fromSec)) {
          throw ClipDomainError.invalidJson('Specify times or a valid fromSec/toSec range.')
        }
        return withAttachments(await live('clip_snapshot', 55_000, args, exec, {
          validateResult: (result, command) => persistSnapshot(store.paths, result, command),
        }))
      }, {
        schema: jsonOut.schema,
        render: (_args, value) => [{ type: 'text', text: value.frames.map((frame) =>
          `[${frame.timeSec}s · ${frame.width}×${frame.height} PNG](<${frame.path}>)`).join('\n') }, ...value.frames.flatMap(({ attachment }) =>
          attachment ? [{ type: 'image', attachment }] : [])],
      }),
    tool('clip_diagnostics', 'Diagnose a saved Clip project for black-frame gaps, clip overlaps, missing media (with structured Host recovery reasons) and invalid source bounds. Times are seconds.', 10_000,
      { projectId: required(projectIdArg) }, async ({ projectId }, exec) => {
        const envelope = store.load(assertProjectId(projectId))
        const base = diagnoseNativeProject(envelope)
        const resolver = getMediaResolver?.()
        if (!resolver || typeof resolver.stat !== 'function') return base
        const sessionId = sessionOf(exec)?.id
        if (envelope.binding && !sessionId) return base
        const reconciled = await reconcileProjectMedia(
          { store, getMediaResolver, getWorkflowClip },
          { projectId: envelope.projectId, mode: 'inspect', binding: envelope.binding, sessionId, signal: exec?.signal },
        )
        return enrichDiagnosticsWithReconcile(base, reconciled)
      }),
    tool('clip_export', 'Render and save an MP4 for the visible Clip project. Set confirm only when the user explicitly asks for an export. Returns the saved file and actual canvas commit status.', 300_000,
      { ...targetArgs, ...revisionArgs, confirm: required(boolean), resolution: choices('720p', '1080p', '4k'), fps: positive }, (args, exec) => {
        if (args.confirm !== true) throw new ClipDomainError('CONFIRMATION_REQUIRED', 'Clip export requires an explicit request from the user.')
        if (!exportJobs) throw ClipDomainError.exportEncodeFailed('The Clip export service is unavailable.')
        return live('clip_export', 295_000, args, exec, { checkRevision: true,
          prepare: ({ requestId, projectId, baseRevision, binding, revisionEpoch, editorInstanceId, draftWriterId }) =>
            exportJobs.begin({ requestId, projectId, projectRevision: baseRevision, binding, revisionEpoch, editorInstanceId, draftWriterId }),
          observe: ({ exportJobId }) => exportResult(exportJobs, exportJobId),
        })
      }),
  ]
}

export function registerClipTools(ctx, tools) {
  if (!ctx.tools || typeof ctx.tools.register !== 'function') return
  const register = () => {
    const disposers = tools.map((tool) => ctx.tools.register({
      ...tool,
      async execute(args, exec) {
        try {
          return await tool.execute(args, exec)
        } catch (error) {
          if (!(error instanceof ClipDomainError)) throw error
          // Harness renders the message of ordinary Errors. Retain typed details for direct consumers too.
          const { code, message, details } = clipErrorValue(error)
          const detailText = details ? ` ${JSON.stringify(details)}` : ''
          throw new ClipDomainError(code, `[${code}] ${safeClipLabel(message, 'The Clip operation failed.')}${detailText}`, details)
        }
      },
    }))
    return () => { for (const dispose of disposers) if (typeof dispose === 'function') dispose() }
  }
  if (typeof ctx.effect === 'function') ctx.effect(register, 'omnimux-clip: tools')
  else register()
}

export const CLIP_PROMPT = `Use OmniMux Clip tools to read or operate the right-side OpenReel editor. Before editing, read the target with live clip_get and reuse its revision and revisionEpoch as baseRevision and baseRevisionEpoch for the same project and window. All tool times are seconds.
Use clip_get or clip_diagnostics to read saved projects and diagnose offline/drifted media reasons. Use clip_templates to discover built-in or asset-library graphic templates, editing templates, and text animation presets before applying them. Use clip_analyze to inspect subtitles/pauses/filler words (mode: "transcript", supports live or saved projects) or run local BPM beat and highlight analysis on open editor audio (mode: "beats" | "highlights"). When AMBIGUOUS_TARGET lists multiple projects or windows, resolve the target from the user's instruction or ask which one they mean. Use clip_open only when asked to open a specific editor.
Use clip_edit for the requested changes (including import_media, relink_media, add_graphic_instance/update_graphic_params/remove_graphic_instance, apply_editing_template, set_keyframes, set_text_animation, import_subtitles, set_caption_style, cut_transcript_ranges, set_marker, remove_marker, set_audio_ducking, and sync_clips_to_beats), optionally with validateOnly first. Set confirmDestructive only with explicit user intent to delete a populated track or clear the timeline. Use clip_export only on an explicit export request, with confirm=true.
On REVISION_CONFLICT, read the current revision and reconsider the edit. For outcome-unknown, recheck the same request ID. Follow skills/clip-craft/SKILL.md for editing decisions and skills/clip-recreate/SKILL.md for reference recreation workflows.`
