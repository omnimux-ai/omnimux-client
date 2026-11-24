import { VideoError } from '../errors.js'
import { mapHubError } from './hub-errors.js'
import { assertLocalVideo } from './pack-video.js'
import { renderAnalyzeMarkdown, VIDEO_ANALYZE_SCHEMA } from './schemas.js'
import { resolveHeadlessSkill, writeDest } from './seam.js'
import { VIDEO_ANALYZE_SKILL } from './skills.js'

/**
 * Build the concise user turn for the `video-analyze` Skill.
 * Methodology and output rules stay in `skills/video-analyze/SKILL.md`.
 *
 * @param {{ notes?: string, videoName?: string, durationSeconds?: number }} opts
 */
export function buildAnalyzeUserInput(opts = {}) {
  const notes = typeof opts.notes === 'string' ? opts.notes.trim() : ''
  const duration = typeof opts.durationSeconds === 'number' && Number.isFinite(opts.durationSeconds) && opts.durationSeconds > 0
    ? `${opts.durationSeconds}s`
    : '（跟原片）'
  const lines = [
    `分析对象：${opts.videoName ? `本地短视频《${opts.videoName}》` : '本地短视频'}`,
    '输入范围：整段视频原生输入（按时间顺序理解动作因果、表演弧与镜头语法，不要当互不相关的静帧）。',
    `目标时长：${duration}`,
    '输出要求：严格按 video-analyze 技能的 JSON 契约返回，分镜时间码首尾相接覆盖全片；不要输出 Markdown。',
  ]
  if (notes) lines.push('', '## 额外说明', notes)
  return lines.join('\n')
}

/**
 * `video_analyze` runs the bundled `video-analyze` Skill through Hub
 * `headlessSkill`, so the model output is schema-validated JSON instead of
 * Markdown that downstream code would have to regex-parse.
 *
 * `dest` keeps writing the same Markdown report as before (now rendered from
 * the validated JSON), and the return value keeps the legacy fields while
 * adding the structured `data`.
 *
 * @param {{
 *   video: string,
 *   dest?: string,
 *   model?: string,
 *   maxTokens?: number,
 *   notes?: string,
 *   targetId?: string,
 *   signal?: AbortSignal,
 *   headlessSkill?: { run: (request: object) => Promise<any> } | (() => unknown),
 *   understand: { defaultModel: string, maxTokens: number },
 * }} input
 */
export async function executeVideoAnalyze(input) {
  const headlessSkill = resolveHeadlessSkill(input.headlessSkill)
  if (!headlessSkill) {
    throw new VideoError('needs-provider', 'video_analyze requires hub headlessSkill')
  }

  const packed = await assertLocalVideo(input.video)
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim()
    : input.understand.defaultModel
  const maxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
    ? input.maxTokens
    : input.understand.maxTokens
  const userText = buildAnalyzeUserInput({ notes: input.notes, videoName: packed.name })

  let runResult
  try {
    runResult = await headlessSkill.run({
      skillName: VIDEO_ANALYZE_SKILL,
      input: userText,
      references: [{ type: 'video', pathOrUrl: packed.video }],
      outputSchema: VIDEO_ANALYZE_SCHEMA,
      modality: 'video',
      label: `五维拆解：${packed.name}`,
      ownerPlugin: 'omnimux-video',
      ...(typeof input.targetId === 'string' && input.targetId.trim() ? { targetId: input.targetId.trim() } : {}),
      ...(model ? { model } : {}),
      maxTokens,
      signal: input.signal,
    })
  } catch (error) {
    throw mapHubError(error, 'video-analyze-failed')
  }

  const data = runResult?.data
  if (runResult?.mode !== 'live' || !data || typeof data !== 'object') {
    throw new VideoError('video-analyze-failed', 'headlessSkill returned no live structured analysis')
  }
  const markdown = renderAnalyzeMarkdown(data)
  if (!markdown.trim()) {
    throw new VideoError('video-analyze-failed', 'structured analysis rendered empty markdown')
  }

  const dest = typeof input.dest === 'string' ? input.dest.trim() : ''
  if (dest) await writeDest(dest, markdown)

  return {
    mode: 'live',
    kind: 'analyze',
    model: typeof runResult.model === 'string' ? runResult.model : model,
    text: markdown,
    data,
    jobId: typeof runResult.jobId === 'string' ? runResult.jobId : undefined,
    repaired: runResult.repaired === true,
    dest: dest || undefined,
    video: packed.name,
    bytes: packed.bytes,
  }
}
