import { parseDurationSeconds } from './structure-script.js'

export const DIRECTION_KEYS = ['content', 'expression', 'creative']

const DIRECTION_TITLES = {
  content: '内容理解',
  expression: '表达方法',
  creative: '创作借鉴',
}

/** Strict JSON Schema validated by Hub `headlessSkill` for `inspiration-deconstruct`. */
export const INSPIRATION_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['summary', 'sections', 'shots'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    content_type: { type: 'string', enum: ['video', 'image', 'carousel', 'text'] },
    hook_highlight: { type: 'string' },
    target_goal: { type: 'string' },
    narrative_strategy: { type: 'string' },
    visual_breakdown: { type: 'string' },
    replication_action: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'analysis'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          direction: { type: 'string', enum: ['content', 'expression', 'creative'] },
          title: { type: 'string', minLength: 1 },
          quote: { type: 'string' },
          analysis: { type: 'string', minLength: 1 },
        },
      },
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['time_range', 'title', 'description'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          time_range: { type: 'string' },
          start_seconds: { type: 'number', minimum: 0 },
          end_seconds: { type: 'number', minimum: 0 },
          stage: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          script: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
    },
  },
})

/** Strict JSON Schema validated by Hub `headlessSkill` for `inspiration-translate`. */
export const INSPIRATION_TRANSLATION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['text', 'segments'],
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1 },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          text: { type: 'string', minLength: 1 },
        },
      },
    },
  },
})

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function inferContentType(item, references, scope) {
  if (scope === 'body') return 'text'
  const videoCount = references.filter((r) => r.type === 'video').length
  const imageCount = references.filter((r) => r.type === 'image').length
  if (videoCount > 0) return 'video'
  if (imageCount > 1) return 'carousel'
  if (imageCount === 1) return 'image'
  const rawType = String(item?.content_shape || item?.type || '').toLowerCase()
  if (rawType === 'gallery' || rawType === 'carousel') return 'carousel'
  if (rawType === 'image' || rawType === 'photo') return 'image'
  if (rawType === 'video') return 'video'
  return 'text'
}

/**
 * Build concise structured user input for `inspiration-deconstruct` Skill.
 * Methodology and constraints stay in `skills/inspiration-deconstruct/SKILL.md`.
 *
 * @param {Record<string, any>} item
 * @param {{ scope: 'post'|'body'|'media', media_index?: number, directions: string[] }} selection
 * @param {Array<{ type: 'image'|'video', pathOrUrl: string }>} references
 */
export function buildAnalysisUserInput(item, selection, references) {
  const scopeLabel = selection.scope === 'post'
    ? '整帖（完整正文与全部已保存素材）'
    : selection.scope === 'body'
      ? '正文（仅分析原文）'
      : `单个素材（第 ${(selection.media_index ?? 0) + 1} 项）`
  const body = String(item?.content || '')
  const context = selection.scope === 'post' && (item?.quoted || (Array.isArray(item?.thread_items) && item.thread_items.length))
    ? { quoted: item.quoted || null, thread_items: item.thread_items || [] }
    : null
  const contentType = inferContentType(item, references, selection.scope)

  const lines = [
    `分析对象：${scopeLabel}`,
    `素材形态：${contentType}`,
    `所选分析方向：${selection.directions.map((d) => `${d}（${DIRECTION_TITLES[d] || d}）`).join('、')}`,
    `原标题：${cleanString(item?.title)}`,
    `附件顺序：${references.map((ref, idx) => `${idx + 1}. ${ref.type}`).join('，') || '无'}`,
    '',
    '完整原文：',
    body || '（无正文）',
  ]
  if (context) {
    lines.push('', `帖子引用与串帖语境：${JSON.stringify(context)}`)
  }
  return lines.join('\n')
}

/**
 * Build concise structured user input for `inspiration-translate` Skill.
 *
 * @param {{ lang: string, source: string, segmentIds?: string[] }} params
 */
export function buildTranslationUserInput({ lang, source, segmentIds = [] }) {
  const ids = Array.isArray(segmentIds) ? segmentIds.filter(Boolean) : []
  return [
    `目标语言：${lang}`,
    `片段 ID 列表：${JSON.stringify(ids)}`,
    '',
    '源文本：',
    String(source || ''),
  ].join('\n')
}

function normalizeShot(raw, index) {
  const timeRange = cleanString(raw?.time_range)
  const rangeParts = timeRange ? timeRange.split(/[-–—~]/).map((p) => p.trim()) : []
  const start = typeof raw?.start_seconds === 'number' && Number.isFinite(raw.start_seconds)
    ? raw.start_seconds
    : (rangeParts[0] ? parseDurationSeconds(rangeParts[0]) : null)
  const end = typeof raw?.end_seconds === 'number' && Number.isFinite(raw.end_seconds)
    ? raw.end_seconds
    : (rangeParts[1] ? parseDurationSeconds(rangeParts[1]) : null)
  return {
    id: cleanString(raw?.id) || `shot_${index + 1}`,
    time_range: timeRange,
    ...(start !== null ? { start_seconds: start } : {}),
    ...(end !== null ? { end_seconds: end } : {}),
    stage: cleanString(raw?.stage) || 'Body',
    title: cleanString(raw?.title) || `分镜 ${index + 1}`,
    description: cleanString(raw?.description),
    script: cleanString(raw?.script),
    prompt: cleanString(raw?.prompt),
  }
}

/**
 * Convert validated JSON Schema payload into the canonical persisted analysis record.
 * Never invokes Markdown regex parsing (`analyzer.js` remains legacy read-only only).
 *
 * @param {Record<string, any>} data
 * @param {{ scope?: string, directions?: string[] }} [selection]
 */
export function normalizeStructuredAnalysisResult(data, selection = {}) {
  const summary = cleanString(data?.summary)
  const contentType = cleanString(data?.content_type)
  const hookHighlight = cleanString(data?.hook_highlight)
  const targetGoal = cleanString(data?.target_goal)
  const narrativeStrategy = cleanString(data?.narrative_strategy)
  const visualBreakdown = cleanString(data?.visual_breakdown)
  const replicationAction = cleanString(data?.replication_action)

  const sections = (Array.isArray(data?.sections) ? data.sections : [])
    .map((sec, idx) => {
      const title = cleanString(sec?.title)
      const analysis = cleanString(sec?.analysis)
      if (!title && !analysis) return null
      return {
        id: cleanString(sec?.id) || `sec_${idx + 1}`,
        ...(cleanString(sec?.direction) ? { direction: cleanString(sec.direction) } : {}),
        title: title || `分析 ${idx + 1}`,
        quote: cleanString(sec?.quote),
        analysis,
        source_segment_ids: [],
      }
    })
    .filter(Boolean)

  const shots = (Array.isArray(data?.shots) ? data.shots : [])
    .map((shot, idx) => normalizeShot(shot, idx))
    .filter((shot) => shot.title || shot.description || shot.script)

  const segments = shots.map((shot, idx) => ({
    id: `seg_${idx + 1}`,
    start: shot.start_seconds ?? null,
    end: shot.end_seconds ?? null,
    time_range: shot.time_range,
    text: shot.script || shot.title || `分镜 ${idx + 1}`,
    section: shot.stage || 'Body',
  }))

  const structure = [
    { stage: 'Hook', title: '黄金钩子', description: hookHighlight },
    { stage: 'Goal', title: '核心目标', description: targetGoal },
    { stage: 'Narrative', title: '叙事结构', description: narrativeStrategy },
    { stage: 'Visual', title: '视觉表达', description: visualBreakdown },
    { stage: 'Replication', title: '复刻策略', description: replicationAction },
  ].filter((item) => item.description)

  const mdLines = []
  if (summary) mdLines.push(`## 摘要\n${summary}`)
  for (const sec of sections) {
    mdLines.push(`## ${sec.title}\n${sec.quote ? `> ${sec.quote}\n\n` : ''}${sec.analysis}`)
  }
  if (!sections.length) {
    for (const block of structure) {
      mdLines.push(`## ${block.title}\n${block.description}`)
    }
  }
  const markdown = mdLines.join('\n\n')

  return {
    schema_version: 2,
    ...(contentType ? { content_type: contentType } : {}),
    ...(Array.isArray(selection?.directions) ? { directions: [...selection.directions] } : {}),
    summary,
    ...(hookHighlight ? { hook: hookHighlight } : {}),
    hook_highlight: hookHighlight,
    target_goal: targetGoal,
    narrative_strategy: narrativeStrategy,
    visual_breakdown: visualBreakdown,
    replication_action: replicationAction,
    sections,
    shots,
    segments,
    structure,
    markdown,
    raw_markdown: markdown,
  }
}
