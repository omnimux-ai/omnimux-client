import { ClipDomainError } from './errors.js'
import { applyOperations } from './timeline/ops.js'
import { diagnoseTimeline } from './timeline/diagnostics.js'
import { projectView } from './timeline/views.js'
import { createEmptySchema, uid } from './client/store/timelineTypes.js'

/** clip_create resolution enum → canvas aspectRatio. */
const RESOLUTION_TO_ASPECT = { landscape: '16:9', portrait: '9:16', square: '1:1' }

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

/**
 * Compile a flat field table into a JSON Schema object. Raw `register`
 * does not run defineTool, so the wire schema must already be type:object.
 * @param {Record<string, Record<string, unknown> & { required?: boolean }>} fields
 */
export function objectParams(fields) {
  /** @type {Record<string, unknown>} */
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields)) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function requireProjectId(args) {
  const id = typeof args?.projectId === 'string' ? args.projectId.trim() : ''
  if (!id) throw ClipDomainError.invalidId('projectId is required')
  return id
}

/**
 * Build the nine `clip_*` tool specs. Host-side: persist via projectStore,
 * never return `{ ok: false }` as a successful value.
 *
 * @param {{
 *   store: ReturnType<typeof import('./store/projectStore.js').createProjectStore>,
 * }} deps
 */
export function createClipTools(deps) {
  const store = deps.store
  // Validate storage first so missing and incompatible projects keep their own error codes.
  async function requireConnectedEditor(args) {
    store.load(requireProjectId(args))
    throw ClipDomainError.uiUnavailable('The Host has no connection to the right-side clip editor. Use the editor controls for live operations.')
  }

  return [
    {
      name: 'clip_list',
      description:
        'List readable saved legacy clip projects, newest first. Files that require OpenReel migration or cannot be decoded appear under unavailableProjects.',
      timeoutMs: 10_000,
      parameters: objectParams({
        limit: { type: 'number', description: 'Max projects to return, 1-100. Default 50.' },
      }),
      output: jsonOut,
      async execute(args) {
        let limit
        if (args.limit != null) {
          if (typeof args.limit !== 'number' || !Number.isFinite(args.limit) || args.limit <= 0) {
            throw ClipDomainError.invalidJson('limit must be a positive number')
          }
          limit = Math.floor(args.limit)
        }
        const { projects, unavailableProjects, unavailableCount } = store.list({ limit })
        const items = projects.map((item) => ({
          id: item.id,
          projectName: item.projectName,
          updatedAt: item.updatedAt,
          durationSec: (item.durationMs || 0) / 1000,
          aspectRatio: item.aspectRatio,
          trackCount: item.trackCount,
          clipCount: item.clipCount,
        }))
        return { count: items.length, projects: items, unavailableProjects, unavailableCount }
      },
    },
    {
      name: 'clip_create',
      description:
        'Create and persist a new empty clip project (video/audio/text tracks, black canvas). resolution landscape|portrait|square (default landscape); fps default 30. Returns the id of a saved legacy TimelineSchema project for clip_get and clip_edit.',
      timeoutMs: 15_000,
      parameters: objectParams({
        name: { type: 'string', required: true, description: 'Project name, 1-80 chars after trim' },
        resolution: {
          type: 'string',
          enum: ['landscape', 'portrait', 'square'],
          description: 'Canvas shape. Default landscape (16:9); portrait=9:16; square=1:1.',
        },
        fps: { type: 'number', description: 'Canvas frame rate. Default 30.' },
      }),
      output: jsonOut,
      async execute(args) {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!name) throw ClipDomainError.invalidJson('name is required')
        if (name.length > 80) throw ClipDomainError.invalidJson('name must be <= 80 chars')
        const resolution = args.resolution || 'landscape'
        const aspectRatio = RESOLUTION_TO_ASPECT[resolution]
        if (!aspectRatio) {
          throw ClipDomainError.invalidJson('resolution must be landscape|portrait|square')
        }
        let fps = 30
        if (args.fps != null) {
          if (typeof args.fps !== 'number' || !Number.isFinite(args.fps) || args.fps <= 0) {
            throw ClipDomainError.invalidJson('fps must be a positive number')
          }
          fps = args.fps
        }
        const projectId = uid('clip')
        const schema = createEmptySchema({ projectId, aspectRatio, canvasConfig: { fps } })
        schema.name = name
        store.create(projectId, schema)
        return {
          projectId,
          name,
          aspectRatio,
          fps,
          durationSec: (schema.canvasConfig?.durationMs || 0) / 1000,
        }
      },
    },
    {
      name: 'clip_open',
      description: 'Validate a saved project for opening. Live editor navigation is currently unavailable from the Host.',
      timeoutMs: 10_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
      }),
      output: jsonOut,
      execute: requireConnectedEditor,
    },
    {
      name: 'clip_get',
      description:
        'Read a saved legacy OmniMux clip project timeline. view=summary|tracks|clips|full. Optional trackId/clipId/fromSec/toSec filter. Times in the response are seconds.',
      timeoutMs: 15_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
        view: {
          type: 'string',
          enum: ['summary', 'tracks', 'clips', 'full'],
          description: 'Projection. Default summary.',
        },
        trackId: { type: 'string', description: 'Restrict to one track' },
        clipId: { type: 'string', description: 'Restrict to one clip' },
        fromSec: { type: 'number', description: 'Range start in seconds' },
        toSec: { type: 'number', description: 'Range end in seconds' },
      }),
      output: jsonOut,
      async execute(args) {
        const id = requireProjectId(args)
        const envelope = store.load(id)
        return projectView(envelope, {
          view: args.view,
          trackId: args.trackId,
          clipId: args.clipId,
          fromSec: args.fromSec,
          toSec: args.toSec,
        })
      },
    },
    {
      name: 'clip_edit',
      description:
        'Apply a batch to a saved legacy TimelineSchema project as one stored undo step. Types: split_clip, trim_clip, remove_clip, remove_range, move_clip, add_clip, import_media, set_text, set_volume, set_speed, cut_silences (plus add_text / set_subtitle_style / add_transition). Input times are seconds. validateOnly=true checks without writing.',
      timeoutMs: 180_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
        description: {
          type: 'string',
          required: true,
          description: 'Human-readable undo label for this batch',
        },
        operations: {
          type: 'array',
          required: true,
          items: { type: 'object', additionalProperties: true },
          description: 'Atomic ops. Each object needs a type field.',
        },
        validateOnly: {
          type: 'boolean',
          description: 'If true, apply in-memory only and do not persist',
        },
      }),
      output: jsonOut,
      async execute(args) {
        const id = requireProjectId(args)
        const description = typeof args.description === 'string' ? args.description.trim() : ''
        if (!description) throw ClipDomainError.invalidJson('description is required')
        const envelope = store.load(id)
        const applied = applyOperations(envelope.schema, args.operations)
        if (args.validateOnly) {
          return {
            projectId: id,
            description,
            validateOnly: true,
            persisted: false,
            results: applied.results,
            durationSec: (applied.schema.canvasConfig?.durationMs || 0) / 1000,
          }
        }
        store.save(id, applied.schema, { recordUndo: true })
        return {
          projectId: id,
          description,
          validateOnly: false,
          persisted: true,
          undoStep: true,
          results: applied.results,
          durationSec: (applied.schema.canvasConfig?.durationMs || 0) / 1000,
        }
      },
    },
    {
      name: 'clip_view',
      description: 'Validate a saved project for playback. Live seek, play and pause are currently unavailable from the Host.',
      timeoutMs: 5_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
        action: {
          type: 'string',
          required: true,
          enum: ['seek', 'play', 'pause'],
          description: 'Playback command',
        },
        toSec: { type: 'number', description: 'Seek target in seconds (seek)' },
        fromSec: { type: 'number', description: 'Optional range start in seconds' },
      }),
      output: jsonOut,
      execute: requireConnectedEditor,
    },
    {
      name: 'clip_snapshot',
      description: 'Validate a saved project for frame capture. Live preview frames are currently unavailable from the Host.',
      timeoutMs: 60_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
        times: {
          type: 'array',
          items: { type: 'number' },
          description: 'Absolute times in seconds',
        },
        fromSec: { type: 'number', description: 'Range start (with toSec) sampled at midpoints' },
        toSec: { type: 'number', description: 'Range end in seconds' },
      }),
      output: jsonOut,
      execute: requireConnectedEditor,
    },
    {
      name: 'clip_diagnostics',
      description:
        'Inspect a saved legacy clip project for timeline_gap (black-frame holes on video tracks), clip_overlap, and media_missing. Returns the issue list; does not throw on findings.',
      timeoutMs: 10_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
      }),
      output: jsonOut,
      async execute(args) {
        const id = requireProjectId(args)
        const envelope = store.load(id)
        const report = diagnoseTimeline(envelope.schema)
        return { projectId: id, ...report }
      },
    },
    {
      name: 'clip_export',
      description: 'Validate a saved project for export. MP4 export is currently available through the right-side editor controls.',
      timeoutMs: 300_000,
      parameters: objectParams({
        projectId: { type: 'string', required: true, description: 'Clip project id' },
        resolution: {
          type: 'string',
          enum: ['720p', '1080p', '4k'],
          description: 'Output raster. Default 1080p.',
        },
        fps: { type: 'number', description: 'Output frame rate. Default project fps.' },
      }),
      output: jsonOut,
      execute: requireConnectedEditor,
    },
  ]
}

/**
 * Register clip_* tools + the clip:ops prompt. Uses ctx.effect so unload reverses.
 *
 * @param {{
 *   tools?: { register: Function },
 *   systemPrompt?: { section: Function },
 *   effect?: Function,
 * }} ctx
 * @param {ReturnType<typeof createClipTools>} tools
 */
export function registerClipTools(ctx, tools) {
  if (!ctx.tools || typeof ctx.tools.register !== 'function') return
  const register = () => {
    for (const tool of tools) {
      ctx.tools.register({
        ...tool,
        async execute(args) {
          try {
            return await tool.execute(args)
          } catch (error) {
            if (!(error instanceof ClipDomainError)) throw error
            // The Harness error renderer exposes the message of an ordinary Error.
            throw new ClipDomainError(error.code, `[${error.code}] ${error.message}`)
          }
        },
      })
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(register, 'omnimux-clip: tools')
  else register()
}

export const CLIP_PROMPT = `OmniMux Clip offers manual multi-track editing in the right-side editor.
clip_list, clip_get and clip_diagnostics read saved legacy TimelineSchema projects. clip_list also identifies files that need migration. Use the actual projectId and read the saved timeline before stating facts about it.
clip_create and clip_edit work on saved legacy TimelineSchema only. An edit call records one stored undo step (times in seconds). These tools do not control the visible OpenReel timeline.
clip_open, clip_view, clip_snapshot and clip_export currently lack a live editor connection. They report storage errors first and otherwise return ui-unavailable. Use the right-side controls for opening, playback and export. Do not retry these tools by switching tabs.
Follow skills/clip-craft/SKILL.md for pacing, caption size, and black-frame checks.`
