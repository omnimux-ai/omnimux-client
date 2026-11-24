/**
 * Structured output contracts for the two backend video Skills.
 *
 * Both tools run through Hub `headlessSkill`, which validates the model's JSON
 * against these schemas (one automatic repair, then `headless-skill-schema-invalid`),
 * so downstream code consumes typed fields instead of regex-parsing Markdown.
 */

/** Strict JSON Schema for `video-analyze`. */
export const VIDEO_ANALYZE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['summary', 'goal', 'hook', 'impact', 'narrative', 'visual', 'replication', 'shots'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    goal: {
      type: 'object',
      required: ['primary_goal', 'core_style', 'emotional_tone', 'evidence', 'virality_factors'],
      additionalProperties: false,
      properties: {
        primary_goal: { type: 'string' },
        core_style: { type: 'string' },
        emotional_tone: { type: 'string' },
        evidence: { type: 'string' },
        virality_factors: { type: 'array', items: { type: 'string' } },
      },
    },
    hook: {
      type: 'object',
      required: ['time_range', 'means', 'evidence'],
      additionalProperties: false,
      properties: {
        time_range: { type: 'string' },
        means: { type: 'string' },
        evidence: { type: 'string' },
        script: { type: 'string' },
      },
    },
    impact: {
      type: 'object',
      required: ['explicit_selling_points', 'implicit_value'],
      additionalProperties: false,
      properties: {
        explicit_selling_points: { type: 'array', items: { type: 'string' } },
        implicit_value: {
          type: 'object',
          additionalProperties: false,
          properties: {
            identity: { type: 'string' },
            emotion: { type: 'string' },
            lifestyle: { type: 'string' },
            empowerment: { type: 'string' },
          },
        },
      },
    },
    narrative: {
      type: 'object',
      required: ['vehicle', 'persona', 'performance_style', 'vocal_dna', 'structure'],
      additionalProperties: false,
      properties: {
        vehicle: { type: 'string' },
        persona: { type: 'string' },
        performance_style: { type: 'string' },
        vocal_dna: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tone: { type: 'string' },
            pacing: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
          },
        },
        structure: {
          type: 'object',
          required: ['hook', 'body', 'cta'],
          additionalProperties: false,
          properties: {
            hook: { type: 'string' },
            body: { type: 'string' },
            cta: { type: 'string' },
          },
        },
      },
    },
    visual: {
      type: 'object',
      required: ['environment', 'cinematography', 'character_sheet'],
      additionalProperties: false,
      properties: {
        environment: { type: 'string' },
        cinematography: { type: 'string' },
        character_sheet: { type: 'string' },
        color_palette: { type: 'string' },
      },
    },
    replication: {
      type: 'object',
      required: ['formula', 'soul', 'shell'],
      additionalProperties: false,
      properties: {
        formula: { type: 'string' },
        soul: { type: 'array', items: { type: 'string' } },
        shell: {
          type: 'array',
          items: {
            type: 'object',
            required: ['variable', 'meaning'],
            additionalProperties: false,
            properties: {
              variable: { type: 'string' },
              meaning: { type: 'string' },
            },
          },
        },
      },
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'time_range', 'description'],
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          time_range: { type: 'string' },
          start_seconds: { type: 'number' },
          end_seconds: { type: 'number' },
          shot_type: { type: 'string' },
          description: { type: 'string' },
          action: { type: 'string' },
          script: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
    },
  },
})

/** Strict JSON Schema for `video-reverse-prompt`. */
export const VIDEO_REVERSE_PROMPT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['prompt', 'beats'],
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', minLength: 1 },
    appendix: { type: 'string' },
    identity_mode: {
      type: 'string',
      enum: ['character_lock_upload_image', 'describe_anonymous', 'structure_only'],
    },
    duration_seconds: { type: 'number' },
    aspect_ratio: { type: 'string' },
    atmosphere: { type: 'string' },
    camera: { type: 'string' },
    performance: { type: 'string' },
    sound: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
    counts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        main_shots: { type: 'number' },
        shot_size_changes: { type: 'number' },
        hard_cuts: { type: 'number' },
        moving_shots: { type: 'number' },
      },
    },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'start_seconds', 'end_seconds', 'performance', 'camera'],
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          start_seconds: { type: 'number' },
          end_seconds: { type: 'number' },
          shot_size: { type: 'string' },
          view: { type: 'string' },
          camera: { type: 'string' },
          performance: { type: 'string' },
          emotion: { type: 'string' },
          purpose: { type: 'string' },
        },
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
})

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function list(items, render) {
  return Array.isArray(items) ? items.map(render).filter(Boolean) : []
}

function section(title, body) {
  const value = text(body)
  return value ? `## ${title}\n${value}` : ''
}

/**
 * Render the legacy Markdown report from the structured payload.
 * `dest` keeps accepting the same file shape as before the headlessSkill migration,
 * but the Markdown is now a projection of validated JSON, never the model's raw text.
 *
 * @param {Record<string, any>} data
 */
export function renderAnalyzeMarkdown(data) {
  const blocks = []
  blocks.push(section('一句话视频描述', data?.summary))

  // The hook is a required root field, so it must survive the Markdown
  // projection. The heading and the `[0-3秒] 黄金钩子 (Hook)` line keep the
  // legacy breakdown parser (regex over this report) able to read it.
  const hook = data?.hook || {}
  const hookLines = [
    text(hook.time_range) ? `**[0-3秒] 黄金钩子 (Hook)**: ${text(hook.time_range)}` : '',
    text(hook.means) ? `- **钩子手段**: ${text(hook.means)}` : '',
    text(hook.evidence) ? `- **证据点**: ${text(hook.evidence)}` : '',
    text(hook.script) ? `- **口播脚本**: ${text(hook.script)}` : '',
  ].filter(Boolean)
  blocks.push(section('⚡ 黄金 3 秒 HOOK', hookLines.join('\n')))

  const goal = data?.goal || {}
  const goalLines = [
    text(goal.primary_goal) ? `**视频目标**: ${text(goal.primary_goal)}` : '',
    text(goal.core_style) ? `**核心风格**: ${text(goal.core_style)}` : '',
    text(goal.emotional_tone) ? `**情绪基调**: ${text(goal.emotional_tone)}` : '',
    text(goal.evidence) ? `**证据点**: ${text(goal.evidence)}` : '',
    ...list(goal.virality_factors, (factor, index) => `${index + 1}. ${text(factor)}`)
      .map((line, index) => `**爆款基因 ${index + 1}**: ${line.replace(/^\d+\.\s*/, '')}`),
  ].filter(Boolean)
  blocks.push(section('I. 核心目标 (Global Goal)', goalLines.join('\n')))

  const impact = data?.impact || {}
  const implicit = impact.implicit_value || {}
  const impactLines = [
    ...list(impact.explicit_selling_points, (item) => `- **明线卖点**: ${text(item)}`),
    ...list([
      ['身份认同', implicit.identity],
      ['情绪共鸣', implicit.emotion],
      ['生活方式暗示', implicit.lifestyle],
      ['赋权与自我接受', implicit.empowerment],
    ], ([label, value]) => (text(value) ? `- **${label}**: ${text(value)}` : '')),
  ].filter(Boolean)
  blocks.push(section('II. 影响力分析 (Influence & Value Proposition)', impactLines.join('\n')))

  const narrative = data?.narrative || {}
  const vocal = narrative.vocal_dna || {}
  const structure = narrative.structure || {}
  const narrativeLines = [
    text(narrative.vehicle) ? `**核心叙事载体**: ${text(narrative.vehicle)}` : '',
    text(narrative.persona) ? `**人物原型**: ${text(narrative.persona)}` : '',
    text(narrative.performance_style) ? `**表演风格**: ${text(narrative.performance_style)}` : '',
    text(vocal.tone) ? `**语气**: ${text(vocal.tone)}` : '',
    text(vocal.pacing) ? `**语速**: ${text(vocal.pacing)}` : '',
    list(vocal.keywords, (word) => text(word)).length ? `**关键词**: ${list(vocal.keywords, (word) => text(word)).join('、')}` : '',
    text(structure.hook) ? `**[钩子]**: ${text(structure.hook)}` : '',
    text(structure.body) ? `**[中段]**: ${text(structure.body)}` : '',
    text(structure.cta) ? `**[CTA]**: ${text(structure.cta)}` : '',
  ].filter(Boolean)
  blocks.push(section('III. 叙事分析 (Narrative Analysis)', narrativeLines.join('\n')))

  const visual = data?.visual || {}
  const visualLines = [
    text(visual.environment) ? `**场景设置**: ${text(visual.environment)}` : '',
    text(visual.cinematography) ? `**镜头语言**: ${text(visual.cinematography)}` : '',
    text(visual.character_sheet) ? `**角色设定卡**: ${text(visual.character_sheet)}` : '',
    text(visual.color_palette) ? `**色板**: ${text(visual.color_palette)}` : '',
  ].filter(Boolean)
  blocks.push(section('IV. 画面分析 (Visual Analysis)', visualLines.join('\n')))

  const shots = Array.isArray(data?.shots) ? data.shots : []
  if (shots.length) {
    const rows = shots.map((shot, index) => {
      const time = text(shot?.time_range) || `${shot?.start_seconds ?? '?'}-${shot?.end_seconds ?? '?'}s`
      return `| ${time} | ${text(shot?.shot_type) || ''} | ${text(shot?.description)} | ${text(shot?.action)} | ${text(shot?.script)} | ${text(shot?.prompt)} |`
    })
    blocks.push([
      '### 逐帧拆解 (Shot-by-Shot Breakdown)',
      '| 时间 | 景别 | 画面描述 | 关键动作 | 脚本模板 | 生成提示词 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...rows,
    ].join('\n'))
  }

  const replication = data?.replication || {}
  const replicationLines = [
    text(replication.formula) ? `**抽象公式**: \`${text(replication.formula)}\`` : '',
    ...list(replication.soul, (item) => `- **必须复刻**: ${text(item)}`),
    ...list(replication.shell, (item) => {
      const variable = text(item?.variable)
      const meaning = text(item?.meaning)
      return variable ? `- **${variable}**: ${meaning}` : ''
    }),
  ].filter(Boolean)
  blocks.push(section('V. 核心复刻策略 (Core Replication Strategy)', replicationLines.join('\n')))
  return blocks.filter(Boolean).join('\n\n')
}

/**
 * The reverse Skill returns the I2V prompt and appendix as structured fields;
 * `dest` / `appendixDest` keep writing the same plain-text files as before.
 *
 * @param {Record<string, any>} data
 * @returns {{ prompt: string, appendix: string }}
 */
export function renderReversePromptParts(data) {
  return {
    prompt: text(data?.prompt),
    appendix: text(data?.appendix),
  }
}
