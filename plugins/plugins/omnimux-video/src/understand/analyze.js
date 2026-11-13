import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { VideoError } from '../errors.js'
import { mapHubError } from './hub-errors.js'
import { assertLocalVideo } from './pack-video.js'
import { BUNDLED_ANALYZE_PROMPT, loadPromptFile } from './prompts.js'

const DEFAULT_USER_TEXT =
  '请对上传的视频进行完整的五维度内容拆解，严格遵循 system prompt 的输出结构。'

/**
 * @param {{
 *   video: string,
 *   dest?: string,
 *   model?: string,
 *   maxTokens?: number,
 *   promptPath?: string,
 *   notes?: string,
 *   signal?: AbortSignal,
 *   textComplete?: { execute: (req: object) => Promise<{ text?: string, model?: string, mode?: string }> },
 *   understand: {
 *     defaultModel: string,
 *     maxTokens: number,
 *     maxVideoBytes: number,
 *     analyzePromptPath: string,
 *   },
 * }} input
 */
export async function executeVideoAnalyze(input) {
  const textComplete = input.textComplete
  if (!textComplete || typeof textComplete.execute !== 'function') {
    throw new VideoError('needs-provider', 'video_analyze requires hub textComplete')
  }

  const packed = await assertLocalVideo(input.video, { maxVideoBytes: input.understand.maxVideoBytes })
  const promptPath = typeof input.promptPath === 'string' && input.promptPath.trim()
    ? input.promptPath.trim()
    : input.understand.analyzePromptPath
  const loaded = await loadPromptFile(promptPath, BUNDLED_ANALYZE_PROMPT)
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim()
    : input.understand.defaultModel
  const maxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
    ? input.maxTokens
    : input.understand.maxTokens
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  const userText = notes
    ? `${DEFAULT_USER_TEXT}\n\n## 额外说明\n${notes}`
    : DEFAULT_USER_TEXT

  let result
  try {
    result = await textComplete.execute({
      prompt: userText,
      system: loaded.text,
      video: packed.video,
      model,
      maxTokens,
      signal: input.signal,
    })
  } catch (error) {
    throw mapHubError(error, 'video-analyze-failed')
  }

  const markdown = typeof result?.text === 'string' ? result.text.trim() : ''
  if (!markdown) {
    throw new VideoError('video-analyze-failed', 'textComplete produced empty analyze markdown')
  }

  const dest = typeof input.dest === 'string' ? input.dest.trim() : ''
  if (dest) {
    await writeDest(dest, markdown)
  }

  return {
    mode: 'live',
    kind: 'analyze',
    model: typeof result.model === 'string' ? result.model : model,
    text: markdown,
    dest: dest || undefined,
    promptPath: loaded.path,
    video: packed.name,
    bytes: packed.bytes,
  }
}

/**
 * @param {string} dest
 * @param {string} body
 */
async function writeDest(dest, body) {
  if (!isAbsolute(dest)) {
    throw new VideoError('video-invalid-input', 'dest path must be absolute')
  }
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, body, 'utf8')
}

