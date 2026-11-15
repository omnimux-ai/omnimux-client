/**
 * JSON document input contract for canvas material nodes.
 *
 * Product convention (Issue #27):
 * - `prompt` (string) contributes to the generation prompt.
 * - `duration` (positive finite number) is applied when the selected model
 *   declares a duration parameter.
 * - every other field is preserved in the file and reported as ignored.
 * - empty / malformed / structurally unusable JSON is an explicit input error,
 *   never a silent empty prompt.
 */

export interface JsonDocumentParseResult {
  ok: boolean;
  /** True only for a missing or whitespace-only file. */
  empty: boolean;
  error?: string;
  prompt?: string;
  duration?: number;
  /** Keys present in the JSON object but not consumed by the product contract. */
  ignoredFields: string[];
}

const KNOWN_FIELDS = new Set(['prompt', 'duration']);

function schemaError(message: string, ignoredFields: string[]): JsonDocumentParseResult {
  return { ok: false, empty: false, error: `JSON 字段不符合约定：${message}`, ignoredFields };
}

/** Parse one JSON file as the video-generation prompt/parameter document. */
export function parseJsonDocumentText(text: string | null | undefined): JsonDocumentParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, empty: true, error: 'JSON 文件为空，无法读取', ignoredFields: [] };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '语法错误';
    return { ok: false, empty: false, error: `JSON 文件解析失败：${detail}`, ignoredFields: [] };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, empty: false, error: 'JSON 文件顶层必须是对象', ignoredFields: [] };
  }

  const record = value as Record<string, unknown>;
  const ignoredFields = Object.keys(record).filter((key) => !KNOWN_FIELDS.has(key));
  const promptRaw = record.prompt;
  const durationRaw = record.duration;

  if (promptRaw !== undefined && typeof promptRaw !== 'string') {
    return schemaError('prompt 必须是字符串', ignoredFields);
  }
  if (durationRaw !== undefined) {
    if (typeof durationRaw !== 'number' || !Number.isFinite(durationRaw) || durationRaw <= 0) {
      return schemaError('duration 必须是大于 0 的数字', ignoredFields);
    }
  }

  const prompt = typeof promptRaw === 'string' && promptRaw.trim() ? promptRaw.trim() : undefined;
  const duration = typeof durationRaw === 'number' ? durationRaw : undefined;
  if (prompt === undefined && duration === undefined) {
    return {
      ok: false,
      empty: false,
      error: 'JSON 文件中没有可用的 prompt 或 duration 字段',
      ignoredFields,
    };
  }

  return {
    ok: true,
    empty: false,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ignoredFields,
  };
}
