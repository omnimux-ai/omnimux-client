import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

export interface HeadlessSkillReference {
  type: 'image' | 'video' | 'audio' | 'document';
  pathOrUrl: string;
  mime?: string;
}

export interface HeadlessSkillRunRequest {
  skillName: string;
  input: string;
  references?: HeadlessSkillReference[];
  outputSchema: Record<string, unknown>;
  modality?: 'text' | 'image' | 'video';
  label?: string;
  ownerPlugin?: string;
  targetId?: string;
  inputFingerprint?: string;
  verifyFingerprint?: () => boolean | Promise<boolean>;
  model?: string;
  cwd?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  signal?: AbortSignal;
}

export interface HeadlessSkillRunResult<T = Record<string, unknown>> {
  mode?: string;
  jobId?: string;
  skillName?: string;
  model?: string;
  data?: T;
  repaired?: boolean;
  inputFingerprint?: string;
}

export interface HeadlessSkillSeam {
  run: <T = Record<string, unknown>>(request: HeadlessSkillRunRequest) => Promise<HeadlessSkillRunResult<T>>;
  listJobs?: (filter?: Record<string, unknown>) => unknown[];
  getJob?: (jobId: string) => unknown;
  cancel?: (jobId: string, reason?: string) => unknown;
}

export interface StructuredVideoDeconstructData {
  summary?: unknown;
  core_goal?: unknown;
  influence?: unknown;
  narrative_structure?: unknown;
  visual_analysis?: unknown;
  replication_strategy?: unknown;
}

export interface StructuredStoryboardShot {
  time_range?: unknown;
  shot_type?: unknown;
  visual_description?: unknown;
  key_action?: unknown;
  dialogue?: unknown;
}

export interface StructuredVideoStoryboardData {
  shots?: unknown;
}

export interface NormalizedDimensionItem {
  dimension: string;
  content: string;
}

export interface NormalizedStoryboardShot {
  shotNo: number;
  timeRange: string;
  shotType: string;
  description: string;
  dialogue: string;
}

/** Strict JSON Schema validated by Hub `headlessSkill` for five-dimension video deconstruction. */
export const VIDEO_DECONSTRUCT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  required: [
    'summary',
    'core_goal',
    'influence',
    'narrative_structure',
    'visual_analysis',
    'replication_strategy',
  ],
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    core_goal: { type: 'string' },
    influence: { type: 'string' },
    narrative_structure: { type: 'string' },
    visual_analysis: { type: 'string' },
    replication_strategy: { type: 'string' },
  },
});

/** Strict JSON Schema validated by Hub `headlessSkill` for shot-by-shot video storyboard extraction. */
export const VIDEO_STORYBOARD_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  required: ['shots'],
  additionalProperties: false,
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['time_range', 'shot_type', 'visual_description', 'key_action', 'dialogue'],
        additionalProperties: false,
        properties: {
          time_range: { type: 'string' },
          shot_type: { type: 'string' },
          visual_description: { type: 'string' },
          key_action: { type: 'string' },
          dialogue: { type: 'string' },
        },
      },
    },
  },
});

/** Strict JSON Schema validated by Hub `headlessSkill` for director reference-image staging analysis. */
export const DIRECTOR_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  required: ['elements'],
  additionalProperties: false,
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'type', 'x', 'depth'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['person', 'object'] },
          x: { type: 'number', minimum: 0, maximum: 1 },
          depth: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
});

const DIMENSION_FIELDS: ReadonlyArray<{ key: keyof StructuredVideoDeconstructData; label: string }> = [
  { key: 'summary', label: '一句话描述' },
  { key: 'core_goal', label: '核心目标' },
  { key: 'influence', label: '影响力' },
  { key: 'narrative_structure', label: '叙事结构' },
  { key: 'visual_analysis', label: '画面分析' },
  { key: 'replication_strategy', label: '复刻策略' },
];

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Build concise user input for five-dimension deconstruction.
 * Methodology and constraints stay in `skills/workflow-video-deconstruct/SKILL.md`.
 */
export function buildVideoDeconstructInput(title: string): string {
  const safeTitle = title.trim() || '画布视频';
  return [
    '任务类型：视频五维内容拆解（deconstruct）',
    `视频标题：${safeTitle}`,
    '请依据附带视频的真实画面与音频，输出一句话描述、核心目标、影响力、叙事结构、画面分析与复刻策略。',
  ].join('\n');
}

/**
 * Build concise user input for shot-by-shot storyboard extraction.
 * Methodology and constraints stay in `skills/workflow-video-deconstruct/SKILL.md`.
 */
export function buildVideoStoryboardInput(
  title: string,
  scenes: ReadonlyArray<{ start: number; end?: number }> = [],
): string {
  const safeTitle = title.trim() || '画布视频';
  const lines = [
    '任务类型：视频逐镜头分镜提取（storyboard）',
    `视频标题：${safeTitle}`,
    '请依据附带视频的真实画面与音频，按时间顺序输出逐镜头分镜数组 shots。',
  ];
  if (scenes.length > 0) {
    const hints = scenes
      .slice(0, 64)
      .map((scene, idx) => {
        const start = Number.isFinite(scene.start) ? scene.start.toFixed(1) : '0.0';
        const end = typeof scene.end === 'number' && Number.isFinite(scene.end) ? scene.end.toFixed(1) : '';
        return end ? `#${idx + 1} ${start}s-${end}s` : `#${idx + 1} ${start}s`;
      })
      .join(', ');
    lines.push(`切镜时间戳参考（仅辅助对齐）：${hints}`);
  }
  return lines.join('\n');
}

/**
 * Build concise user input for director reference image staging analysis.
 * Methodology and security constraints stay in `skills/workflow-director-analyze/SKILL.md`.
 */
export function buildDirectorAnalyzeInput(input: {
  workspaceId: string;
  nodeId: string;
  imageRef: string;
  width?: number;
  height?: number;
}): string {
  const lines = [
    'Task: analyze the attached reference image for simplified director camera staging.',
    `Reference key: ${input.imageRef}`,
  ];
  if (typeof input.width === 'number' && typeof input.height === 'number' && input.width > 0 && input.height > 0) {
    lines.push(`Image dimensions: ${input.width}x${input.height}`);
  }
  lines.push('Return strict JSON matching the output schema (at most 16 reliable elements).');
  return lines.join('\n');
}

/**
 * Normalize validated structured five-dimension payload into table rows without Markdown regex parsing.
 */
export function normalizeDeconstructDimensions(data: unknown): NormalizedDimensionItem[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const record = data as StructuredVideoDeconstructData;
  const rows: NormalizedDimensionItem[] = [];
  for (const field of DIMENSION_FIELDS) {
    const content = cleanString(record[field.key]);
    if (content) {
      rows.push({ dimension: field.label, content });
    }
  }
  return rows;
}

/**
 * Render structured five-dimension rows into display Markdown for backwards-compatible response payloads.
 */
export function renderDimensionsMarkdown(dimensions: ReadonlyArray<NormalizedDimensionItem>): string {
  return dimensions.map((item) => `## ${item.dimension}\n${item.content}`).join('\n\n');
}

/**
 * Normalize validated structured storyboard payload into shot rows without Markdown table parsing.
 */
export function normalizeStoryboardShots(data: unknown): NormalizedStoryboardShot[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const rawShots = (data as StructuredVideoStoryboardData).shots;
  if (!Array.isArray(rawShots)) return [];

  const shots: NormalizedStoryboardShot[] = [];
  for (const entry of rawShots) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as StructuredStoryboardShot;
    const timeRange = cleanString(raw.time_range);
    const shotType = cleanString(raw.shot_type);
    const visual = cleanString(raw.visual_description);
    const action = cleanString(raw.key_action);
    const dialogue = cleanString(raw.dialogue);

    if (!timeRange && !shotType && !visual && !action && !dialogue) continue;

    const description = action ? (visual ? `${visual}；${action}` : action) : visual;
    shots.push({
      shotNo: shots.length + 1,
      timeRange,
      shotType,
      description,
      dialogue: dialogue || '（无对白/环境音）',
    });
  }
  return shots;
}

/**
 * Deterministic fingerprint for a local file or remote media URL plus caller scope.
 */
export function computeMediaInputFingerprint(input: {
  operation: string;
  workspaceId: string;
  nodeId: string;
  mediaPathOrUrl: string;
  model: string;
  extra?: Record<string, unknown>;
}): string {
  let fileStat: { size: number; mtimeMs: number } | null = null;
  if (!/^https?:\/\//i.test(input.mediaPathOrUrl) && existsSync(input.mediaPathOrUrl)) {
    try {
      const st = statSync(input.mediaPathOrUrl);
      if (st.isFile()) {
        fileStat = { size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
      }
    } catch {
      fileStat = null;
    }
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: input.operation,
        workspaceId: input.workspaceId,
        nodeId: input.nodeId,
        mediaPathOrUrl: input.mediaPathOrUrl,
        fileStat,
        model: input.model,
        ...(input.extra ? { extra: input.extra } : {}),
      }),
    )
    .digest('hex');
}
