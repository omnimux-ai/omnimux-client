import { basename } from 'node:path'
import { VideoError } from '../errors.js'
import { mapHubError } from './hub-errors.js'
import { assertLocalVideo } from './pack-video.js'
import { renderReversePromptParts, VIDEO_REVERSE_PROMPT_SCHEMA } from './schemas.js'
import { resolveHeadlessSkill, writeDest } from './seam.js'
import { VIDEO_REVERSE_PROMPT_SKILL } from './skills.js'

export const IDENTITY_MODES = Object.freeze({
  A: 'character_lock_upload_image',
  B: 'describe_anonymous',
  C: 'structure_only',
})

/**
 * @param {unknown} raw
 */
export function resolveIdentityMode(raw = 'A') {
  const key = String(raw || 'A').trim().toUpperCase()
  if (IDENTITY_MODES[key]) return IDENTITY_MODES[key]
  const asValue = String(raw || '').trim()
  if (Object.values(IDENTITY_MODES).includes(asValue)) return asValue
  throw new VideoError(
    'video-invalid-input',
    `identityMode must be A|B|C or ${Object.values(IDENTITY_MODES).join('|')}`,
  )
}

/**
 * Build the user turn for the `video-reverse-prompt` Skill.
 * The methodology, hard constraints and writing rules live in
 * `skills/video-reverse-prompt/SKILL.md`; this only carries run parameters.
 *
 * @param {{
 *   videoPath: string,
 *   identityMode: string,
 *   duration?: number | null,
 *   aspect?: string,
 *   notes?: string,
 *   productOrPropSwap?: string,
 * }} opts
 */
export function buildReverseUserText(opts) {
  const lines = [
    '请根据上传的参考视频，逆向输出 **I2V 友好** 的视频生成 prompt。',
    '视觉输入是整段视频（非抽帧拼图）；请按时间顺序理解动作因果、表演弧与镜头语法。',
    '',
    '## 静默硬约束',
    '- 人物禁止任何对白/口播/旁白/可辨词语；禁止张嘴说话口型；只演氛围与情绪，不口述。',
    '- 声音默认无人声；【强制约束】须写明「禁止口播对白」。',
    '',
    '## 视频元数据',
    `- 文件: ${basename(opts.videoPath)}`,
    `- 路径: ${opts.videoPath}`,
    '',
    '## 用户覆盖参数',
    `- identity_mode: ${opts.identityMode}`,
    `- target_duration_sec: ${opts.duration ?? '（跟原片）'}`,
    `- aspect_ratio: ${opts.aspect || '（跟原片）'}`,
    `- product_or_prop_swap: ${opts.productOrPropSwap || '（无；不写道具外观长描述）'}`,
    `- language: 中文`,
    `- generation_mode_bias: I2V（参考帧锁外观）`,
    `- safety: 结构/表演复刻；身份与品牌按 identity_mode 处理`,
  ]
  const notes = typeof opts.notes === 'string' ? opts.notes.trim() : ''
  if (notes) {
    lines.push('', '## 额外说明', notes)
  }
  lines.push(
    '',
    '输出要求：严格按 video-reverse-prompt 技能的 JSON 契约返回（prompt / appendix / beats / counts / assumptions），',
    'prompt 是可直接喂给 I2V 的完整正文；不要输出 <<<PROMPT>>> 标记块或 Markdown 标题。',
  )
  return lines.join('\n')
}

/**
 * `video_reverse_prompt` runs the bundled `video-reverse-prompt` Skill through
 * Hub `headlessSkill`; the I2V body and appendix come back as validated JSON
 * fields. `dest` / `appendixDest` keep writing the same plain-text files.
 *
 * @param {{
 *   video: string,
 *   dest?: string,
 *   appendixDest?: string,
 *   identityMode?: string,
 *   duration?: number,
 *   aspect?: string,
 *   notes?: string,
 *   productOrPropSwap?: string,
 *   model?: string,
 *   maxTokens?: number,
 *   targetId?: string,
 *   signal?: AbortSignal,
 *   headlessSkill?: { run: (request: object) => Promise<any> } | (() => unknown),
 *   understand: { defaultModel: string, maxTokens: number },
 * }} input
 */
export async function executeVideoReversePrompt(input) {
  const headlessSkill = resolveHeadlessSkill(input.headlessSkill)
  if (!headlessSkill) {
    throw new VideoError('needs-provider', 'video_reverse_prompt requires hub headlessSkill')
  }

  const packed = await assertLocalVideo(input.video)
  const identityMode = resolveIdentityMode(input.identityMode ?? 'A')
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim()
    : input.understand.defaultModel
  const maxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
    ? input.maxTokens
    : input.understand.maxTokens
  const duration = typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0
    ? input.duration
    : null
  const aspect = typeof input.aspect === 'string' ? input.aspect.trim() : ''
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  const productOrPropSwap = typeof input.productOrPropSwap === 'string'
    ? input.productOrPropSwap.trim()
    : ''

  const userText = buildReverseUserText({
    videoPath: packed.video,
    identityMode,
    duration,
    aspect,
    notes,
    productOrPropSwap,
  })

  let runResult
  try {
    runResult = await headlessSkill.run({
      skillName: VIDEO_REVERSE_PROMPT_SKILL,
      input: userText,
      references: [{ type: 'video', pathOrUrl: packed.video }],
      outputSchema: VIDEO_REVERSE_PROMPT_SCHEMA,
      modality: 'video',
      label: `反推提示词：${packed.name}`,
      ownerPlugin: 'omnimux-video',
      ...(typeof input.targetId === 'string' && input.targetId.trim() ? { targetId: input.targetId.trim() } : {}),
      ...(model ? { model } : {}),
      maxTokens,
      signal: input.signal,
    })
  } catch (error) {
    throw mapHubError(error, 'video-reverse-failed')
  }

  const data = runResult?.data
  if (runResult?.mode !== 'live' || !data || typeof data !== 'object') {
    throw new VideoError('video-reverse-failed', 'headlessSkill returned no live structured reverse prompt')
  }
  const parts = renderReversePromptParts(data)
  if (!parts.prompt) {
    throw new VideoError('video-reverse-failed', 'structured reverse prompt body is empty')
  }

  const dest = typeof input.dest === 'string' ? input.dest.trim() : ''
  const appendixDest = typeof input.appendixDest === 'string' ? input.appendixDest.trim() : ''
  if (dest) await writeDest(dest, parts.prompt)
  if (appendixDest && parts.appendix) await writeDest(appendixDest, parts.appendix)

  return {
    mode: 'live',
    kind: 'reverse_prompt',
    model: typeof runResult.model === 'string' ? runResult.model : model,
    prompt: parts.prompt,
    appendix: parts.appendix || undefined,
    parsed: true,
    rawText: JSON.stringify(data),
    data,
    jobId: typeof runResult.jobId === 'string' ? runResult.jobId : undefined,
    repaired: runResult.repaired === true,
    dest: dest || undefined,
    appendixDest: appendixDest || undefined,
    identityMode,
    video: packed.name,
    bytes: packed.bytes,
  }
}
