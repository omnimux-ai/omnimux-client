import * as probe from './capabilities/probe.js'
import * as trim from './capabilities/trim.js'
import * as merge from './capabilities/merge.js'
import * as split from './capabilities/split.js'
import * as audio from './capabilities/audio.js'
import * as thumb from './capabilities/thumb.js'
import * as inline from './capabilities/inline.js'
import * as scene from './capabilities/scene.js'
import * as slideshow from './capabilities/slideshow.js'
import * as videoExport from './capabilities/export.js'
import * as depth from './capabilities/depth.js'
import { executeVideoProcess } from './job.js'

/**
 * Slug registry: every capability module exposes
 * `{ slug, timeoutMs, destKind, validate, execute }`.
 */
export const CAPABILITIES = {
  media_metadata: probe,
  video_trim: trim,
  video_merge: merge,
  video_split: split,
  audio_extract: audio.extract,
  audio_prepare: audio.prepare,
  video_thumbnail_extract: thumb,
  video_inline_analysis_prepare: inline,
  video_scene_detect: scene,
  slideshow_export: slideshow,
  video_export: videoExport,
  video_depth: depth,
}

export const SLUGS = Object.keys(CAPABILITIES)

/**
 * Seam entry: `execute({ capability, input, dest, signal })`.
 * @param {object} req @returns {Promise<{ mode: 'live', files?: Array<{ path: string, kind: string, meta?: object }>, result?: object }>}
 */
export function execute(req) {
  return executeVideoProcess(req)
}