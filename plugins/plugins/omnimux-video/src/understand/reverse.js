import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { VideoError } from '../errors.js'
import { mapHubError } from './hub-errors.js'
import { assertLocalVideo } from './pack-video.js'
import { parseTaggedSections } from './parse-tags.js'
import { BUNDLED_REVERSE_PROMPT, loadPromptFile } from './prompts.js'

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
    '## 写作重心（必须）',
    '- 参考图/原片已决定人物与场景外观：prompt **不要**复述外貌、妆造、服装细节、场景装修、道具规格。',
    '- 重点写：人物动作、表情、氛围、情绪弧、视角、景别、运镜、分镜节拍与真实叙事感。',
    '- 用「如何把图中元素演出来」代替「图里有什么」。',
    '- **静默硬约束**：人物禁止任何对白/口播/旁白/可辨词语；禁止张嘴说话口型；只演氛围与情绪，不口述。',
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
    '输出必须严格使用 system prompt 规定的 <<<PROMPT>>> / <<<APPENDIX>>> 标记块。',
  )
  return lines.join('\n')
}

/**
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
 *   promptPath?: string,
 *   signal?: AbortSignal,
 *   textComplete?: { execute: (req: object) => Promise<{ text?: string, model?: string }> },
 *   understand: {
 *     defaultModel: string,
 *     maxTokens: number,
 *     maxVideoBytes: number,
 *     reversePromptPath: string,
 *   },
 * }} input
 */
export async function executeVideoReversePrompt(input) {
  const textComplete = input.textComplete
  if (!textComplete || typeof textComplete.execute !== 'function') {
    throw new VideoError('needs-provider', 'video_reverse_prompt requires hub textComplete')
  }

  const packed = await assertLocalVideo(input.video, { maxVideoBytes: input.understand.maxVideoBytes })
  const identityMode = resolveIdentityMode(input.identityMode ?? 'A')
  const promptPath = typeof input.promptPath === 'string' && input.promptPath.trim()
    ? input.promptPath.trim()
    : input.understand.reversePromptPath
  const loaded = await loadPromptFile(promptPath, BUNDLED_REVERSE_PROMPT)
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
    throw mapHubError(error, 'video-reverse-failed')
  }

  const raw = typeof result?.text === 'string' ? result.text.trim() : ''
  if (!raw) {
    throw new VideoError('video-reverse-failed', 'textComplete produced empty reverse prompt')
  }
  const sections = parseTaggedSections(raw)
  if (!sections.prompt.trim()) {
    throw new VideoError('video-reverse-failed', 'reverse prompt body is empty')
  }

  const dest = typeof input.dest === 'string' ? input.dest.trim() : ''
  const appendixDest = typeof input.appendixDest === 'string' ? input.appendixDest.trim() : ''
  if (dest) await writeDest(dest, sections.prompt)
  if (appendixDest && sections.appendix) await writeDest(appendixDest, sections.appendix)

  return {
    mode: 'live',
    kind: 'reverse_prompt',
    model: typeof result.model === 'string' ? result.model : model,
    prompt: sections.prompt,
    appendix: sections.appendix || undefined,
    parsed: sections.parsed,
    rawText: sections.rawText,
    dest: dest || undefined,
    appendixDest: appendixDest || undefined,
    identityMode,
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
