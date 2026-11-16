/**
 * Pure video parameter normalization shared by the read side, execution
 * preparation, history recovery and the parameter-selection write path.
 *
 * The effective truth is one schema: model parameters, operation-level
 * overrides, and the selected channel line narrowing. Every caller must pass
 * raw persisted params through this function before displaying, validating,
 * persisting or dispatching them.
 */

import type {
  CapabilityCatalog,
  CapabilityModelItem,
  CatalogModelDto,
  ModelParameterSchema,
  OperationContractDto,
} from '../../../../../../shared/api.ts';
import {
  narrowModelByLineConstraints,
  type LineConstraints,
} from '../../../../../../shared/validation/lineConstraints.ts';
import { directoryChannelGroups, resolveLineConstraints } from '../channelGroups.ts';

export interface NormalizedVideoParamsBlocked {
  field: string;
  message: string;
  required: boolean;
}

export interface NormalizedVideoParams {
  params: Record<string, unknown>;
  notices: string[];
  blocked: NormalizedVideoParamsBlocked[];
}

export interface NormalizeVideoParamsForSchemaArgs {
  params: Record<string, unknown>;
  modelItem?: CapabilityModelItem;
  operationId?: string;
  catalog?: CapabilityCatalog | null;
  lineConstraints?: LineConstraints | null;
}

type AnyRecord = Record<string, unknown>;

const BOOLEAN_FIELDS = [
  ['sound', '声音'],
  ['watermark', '水印'],
  ['returnLastFrame', '返回尾帧'],
  ['webSearch', '联网搜索'],
  ['nsfwCheck', '内容审核'],
] as const;

const ENUM_FIELDS = [
  ['outputFormat', '输出格式'],
  ['referenceTaskType', '参考任务类型'],
  ['generationType', '生成类型'],
  ['quality', '质量'],
] as const;

const FIELD_LABELS: Record<string, string> = {
  aspectRatio: '画幅',
  duration: '时长',
  resolution: '清晰度',
  sound: '声音',
  seed: '随机种子',
  watermark: '水印',
  outputFormat: '输出格式',
  referenceTaskType: '参考任务类型',
  generationType: '生成类型',
  returnLastFrame: '返回尾帧',
  webSearch: '联网搜索',
  nsfwCheck: '内容审核',
  quality: '质量',
};

const CONTROL_FIELDS = new Set<string>([
  'aspectRatio', 'duration', 'resolution', 'sound', 'seed',
  'watermark', 'outputFormat', 'referenceTaskType', 'generationType',
  'returnLastFrame', 'webSearch', 'nsfwCheck', 'quality', 'voice', 'instrumental',
]);

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSchema(value: unknown): value is ModelParameterSchema {
  return isRecord(value);
}

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

/** Operation fields replace the corresponding model-level declaration. */
export function mergeVideoParameterSchema(
  base: ModelParameterSchema | undefined,
  override: Record<string, unknown> | undefined,
): ModelParameterSchema {
  return {
    ...(base ?? {}),
    ...((override ?? {}) as ModelParameterSchema),
  };
}

export function optionValue<T extends string | number>(
  value: unknown,
  options: Array<{ value: T }>,
  fallback: T,
  caseInsensitive = false,
): T {
  const exact = options.find((option) => Object.is(option.value, value));
  if (exact) return exact.value;
  if (caseInsensitive && typeof value === 'string') {
    const folded = value.toLowerCase();
    const match = options.find(
      (option) => typeof option.value === 'string' && option.value.toLowerCase() === folded,
    );
    if (match) return match.value;
  }
  return fallback;
}

export function durationIsValid(value: unknown, schema: ModelParameterSchema['duration']): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !schema) return false;
  if (schema.allowAuto && value === -1) return true;
  if (schema.options?.some((option) => Object.is(option.value, value))) return true;
  const range = schema.range;
  if (!range || value < range.min || value > range.max) return false;
  const step = range.step ?? 1;
  return Math.abs((value - range.min) / step - Math.round((value - range.min) / step)) <= Number.EPSILON;
}

function isRequired(definition: unknown): boolean {
  return isRecord(definition) && definition.required === true;
}

export function integerIsValid(value: unknown, schema: ModelParameterSchema['seed']): value is number {
  if (!schema || !Number.isInteger(value)) return false;
  if (!schema.range) return true;
  const numeric = value as number;
  if (numeric < schema.range.min || numeric > schema.range.max) return false;
  const step = schema.range.step ?? 1;
  return Math.abs((numeric - schema.range.min) / step - Math.round((numeric - schema.range.min) / step)) <= Number.EPSILON;
}

function modelIdOf(args: NormalizeVideoParamsForSchemaArgs): string {
  const explicit = typeof args.modelItem?.id === 'string' ? args.modelItem.id.trim() : '';
  if (explicit) return explicit;
  return typeof args.params.model === 'string' ? args.params.model.trim() : '';
}

function findCatalogRow(catalog: CapabilityCatalog | null | undefined, modelId: string): CatalogModelDto | undefined {
  if (!catalog || !Array.isArray(catalog.models) || !modelId) return undefined;
  return catalog.models.find((row) => row.id === modelId
    || (Array.isArray(row.aliases) && row.aliases.includes(modelId)));
}

/** Build the same bucket-shaped item callers already pass for the current model. */
export function catalogRowToModelItem(row: CatalogModelDto): CapabilityModelItem {
  const item: CapabilityModelItem = { id: row.id, label: row.label };
  if (isSchema(row.parameters)) item.parameters = row.parameters;
  if (Array.isArray(row.aliases)) item.aliases = row.aliases;
  if (Array.isArray(row.channelGroups)) item.channelGroups = row.channelGroups;
  return item;
}

function operationsOf(row: CatalogModelDto | undefined, modelItem: CapabilityModelItem | undefined): OperationContractDto[] {
  const raw = row?.operations ?? (isRecord(modelItem) && Array.isArray((modelItem as AnyRecord).operations)
    ? (modelItem as AnyRecord).operations as OperationContractDto[]
    : []);
  return raw.filter((operation): operation is OperationContractDto => Boolean(operation)
    && typeof operation === 'object'
    && typeof (operation as OperationContractDto).id === 'string'
    && (operation as OperationContractDto).listed !== false
    && ((operation as OperationContractDto).output?.type ?? 'video') === 'video');
}

function pickOperation(
  operations: OperationContractDto[],
  requested: string,
): { operation?: OperationContractDto; operationId: string; fallbackNotice?: string } {
  if (operations.length === 0) return { operationId: requested };
  const matched = requested
    ? operations.find((operation) => operation.id === requested
      || (Array.isArray(operation.aliases) && operation.aliases.includes(requested)))
    : undefined;
  if (matched) return { operation: matched, operationId: matched.id };
  const fallback = operations.find((operation) => operation.id === 'text_to_video')
    ?? operations.find((operation) => operation.listed !== false)
    ?? operations[0];
  if (!fallback) return { operationId: requested };
  return {
    operation: fallback,
    operationId: fallback.id,
    ...(requested ? { fallbackNotice: `当前生成方式不可用，已切换为 ${fallback.label ?? fallback.id}` } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeAspectRatio(
  next: AnyRecord,
  schema: ModelParameterSchema,
  notices: string[],
  blocked: NormalizedVideoParamsBlocked[],
): void {
  const definition = schema.aspectRatio;
  if (!definition || !Array.isArray(definition.options) || definition.options.length === 0) {
    if (definition && isRequired(definition)) {
      delete next.aspectRatio;
      blocked.push({ field: 'aspectRatio', message: '请设置画幅：当前契约没有合法默认值', required: true });
    } else {
      delete next.aspectRatio;
    }
    return;
  }
  const options = definition.options
    .map((option) => option?.value)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (options.length === 0) {
    if (isRequired(definition)) {
      delete next.aspectRatio;
      blocked.push({ field: 'aspectRatio', message: '请设置画幅：当前契约没有合法默认值', required: true });
    } else {
      delete next.aspectRatio;
    }
    return;
  }
  const raw = typeof next.aspectRatio === 'string' && next.aspectRatio.trim() ? next.aspectRatio.trim() : undefined;
  if (raw !== undefined && options.includes(raw)) return;
  const configuredDefault = typeof definition.defaultValue === 'string' && options.includes(definition.defaultValue)
    ? definition.defaultValue
    : undefined;
  // A required field without a declared default must block: picking options[0]
  // would silently choose a value the contract never authorized as default.
  const fallback = configuredDefault ?? (isRequired(definition) ? undefined : options[0]);
  if (!fallback) {
    delete next.aspectRatio;
    if (isRequired(definition)) {
      blocked.push({ field: 'aspectRatio', message: '请设置画幅：当前契约没有合法默认值', required: true });
    }
    return;
  }
  next.aspectRatio = fallback;
  if (raw === undefined) return;
  if (options.length === 1 && (options[0] === 'adaptive' || options[0] === 'auto')) {
    pushUnique(notices, `当前生成方式画幅已自适应为 ${fallback === 'adaptive' ? '自适应' : fallback}`);
  } else {
    pushUnique(notices, `画幅已调整为 ${fallback}`);
  }
}

function normalizeDuration(
  next: AnyRecord,
  schema: ModelParameterSchema,
  notices: string[],
  blocked: NormalizedVideoParamsBlocked[],
): void {
  const definition = schema.duration;
  if (!definition) {
    delete next.duration;
    return;
  }
  const raw = next.duration;
  if (raw === undefined || raw === null || raw === '') {
    if (typeof definition.defaultValue === 'number' && durationIsValid(definition.defaultValue, definition)) {
      next.duration = definition.defaultValue;
    } else if (isRequired(definition)) {
      delete next.duration;
      blocked.push({ field: 'duration', message: '请设置时长：当前契约没有合法默认值', required: true });
    } else {
      delete next.duration;
    }
    return;
  }
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(numeric) && durationIsValid(numeric, definition)) {
    next.duration = numeric;
    return;
  }
  const options = definition.options ?? [];
  const range = definition.range;
  if (range && Number.isFinite(numeric)) {
    let clamped = Math.min(Math.max(numeric, range.min), range.max);
    const step = range.step ?? 1;
    if (step > 0) {
      clamped = range.min + Math.round((clamped - range.min) / step) * step;
      clamped = Math.min(Math.max(clamped, range.min), range.max);
    }
    next.duration = clamped;
    pushUnique(notices, `时长已调整为 ${clamped}s`);
    return;
  }
  const configuredDefault = typeof definition.defaultValue === 'number' && durationIsValid(definition.defaultValue, definition)
    ? definition.defaultValue
    : undefined;
  const optionalFallback = !isRequired(definition)
    ? options.map((option) => option.value).find((value) => durationIsValid(value, definition))
    : undefined;
  const fallback = configuredDefault ?? optionalFallback;
  if (fallback !== undefined) {
    next.duration = fallback;
    pushUnique(notices, `时长已调整为 ${fallback}s`);
    return;
  }
  delete next.duration;
  if (isRequired(definition)) {
    blocked.push({ field: 'duration', message: '请设置时长：当前契约没有合法默认值', required: true });
  } else {
    pushUnique(notices, `时长 ${String(raw)} 已失效，已移除`);
  }
}

function normalizeResolution(
  next: AnyRecord,
  schema: ModelParameterSchema,
  notices: string[],
  blocked: NormalizedVideoParamsBlocked[],
): void {
  const definition = schema.resolution;
  if (!definition || !Array.isArray(definition.options) || definition.options.length === 0) {
    if (definition && isRequired(definition)) {
      delete next.resolution;
      blocked.push({ field: 'resolution', message: '请设置清晰度：当前契约没有合法默认值', required: true });
    } else {
      delete next.resolution;
    }
    return;
  }
  const options = definition.options
    .map((option) => option?.value)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (options.length === 0) {
    if (isRequired(definition)) {
      delete next.resolution;
      blocked.push({ field: 'resolution', message: '请设置清晰度：当前契约没有合法默认值', required: true });
    } else {
      delete next.resolution;
    }
    return;
  }
  const raw = typeof next.resolution === 'string' && next.resolution.trim() ? next.resolution.trim() : undefined;
  if (raw !== undefined) {
    const canonical = definition.caseInsensitive === true
      ? options.find((value) => value.toLowerCase() === raw.toLowerCase())
      : options.find((value) => value === raw);
    if (canonical !== undefined) {
      next.resolution = canonical;
      return;
    }
  }
  const configuredDefault = typeof definition.defaultValue === 'string' && options.includes(definition.defaultValue)
    ? definition.defaultValue
    : undefined;
  const fallback = configuredDefault ?? (isRequired(definition) ? undefined : options[0]);
  if (!fallback) {
    delete next.resolution;
    if (isRequired(definition)) {
      blocked.push({ field: 'resolution', message: '请设置清晰度：当前契约没有合法默认值', required: true });
    }
    return;
  }
  next.resolution = fallback;
  if (raw !== undefined) pushUnique(notices, `清晰度已调整为 ${fallback}（原 ${raw}）`);
}

function normalizeBooleanField(
  next: AnyRecord,
  schema: ModelParameterSchema,
  field: (typeof BOOLEAN_FIELDS)[number][0],
  label: string,
  notices: string[],
): void {
  const definition = schema[field];
  if (!definition || definition.supported !== true) {
    if (next[field] === true) pushUnique(notices, `当前渠道不支持${label}，已关闭`);
    delete next[field];
    return;
  }
  if (typeof next[field] === 'boolean') return;
  next[field] = typeof definition.defaultValue === 'boolean' ? definition.defaultValue : false;
}

function normalizeEnumField(
  next: AnyRecord,
  schema: ModelParameterSchema,
  field: (typeof ENUM_FIELDS)[number][0],
  label: string,
  notices: string[],
  blocked: NormalizedVideoParamsBlocked[],
): void {
  const definition = schema[field];
  if (!definition || !Array.isArray(definition.options) || definition.options.length === 0) {
    delete next[field];
    return;
  }
  const options = definition.options
    .map((option) => option?.value)
    .filter((value): value is string => typeof value === 'string');
  if (options.length === 0) {
    delete next[field];
    return;
  }
  const raw = typeof next[field] === 'string' && next[field].trim() ? next[field].trim() : undefined;
  if (raw !== undefined && options.includes(raw)) return;
  const configuredDefault = typeof definition.defaultValue === 'string' && options.includes(definition.defaultValue)
    ? definition.defaultValue
    : undefined;
  const fallback = configuredDefault ?? (isRequired(definition) ? undefined : options[0]);
  if (!fallback) {
    delete next[field];
    if (isRequired(definition)) {
      blocked.push({ field, message: `请设置${label}：当前契约没有合法默认值`, required: true });
    }
    return;
  }
  next[field] = fallback;
  if (raw !== undefined) pushUnique(notices, `${label}已调整为 ${fallback}`);
}

function normalizeSeed(
  next: AnyRecord,
  schema: ModelParameterSchema,
  notices: string[],
): void {
  const definition = schema.seed;
  if (!definition) {
    delete next.seed;
    return;
  }
  if (next.seed === undefined || next.seed === null) return;
  if (integerIsValid(next.seed, definition)) return;
  const fallback = typeof definition.range?.min === 'number' ? definition.range.min : 0;
  next.seed = fallback;
  pushUnique(notices, '随机种子已重置');
}

function normalizeReferenceImages(
  next: AnyRecord,
  operation: OperationContractDto | undefined,
  notices: string[],
): void {
  const value = next.referenceImages;
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    next.referenceImages = [];
    pushUnique(notices, '参考图数据异常，已自动重置为空');
    return;
  }
  if (!operation) return;
  const imageSlots = operation.inputs.filter((slot) => slot.type === 'image' && slot.role !== 'prompt');
  if (imageSlots.length === 0) {
    if (value.length > 0) {
      next.referenceImages = [];
      pushUnique(notices, '当前渠道不支持参考图，已自动移除');
    }
    return;
  }
  const numericCeilings = imageSlots.map((slot) => slot.max).filter((max): max is number => typeof max === 'number');
  if (numericCeilings.length !== imageSlots.length) return;
  const max = numericCeilings.reduce((sum, current) => sum + current, 0);
  if (value.length <= max) return;
  next.referenceImages = value.slice(0, max);
  if (max === 0) pushUnique(notices, '当前渠道不支持参考图，已自动移除');
  else if (max === 1) pushUnique(notices, '该渠道仅支持单张参考图');
  else pushUnique(notices, `该渠道最多支持 ${max} 张参考图，已自动截取`);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeUrlFields(
  next: AnyRecord,
  operation: OperationContractDto | undefined,
  notices: string[],
): void {
  if (!operation) return;
  const slotNames = new Set(operation.inputs.map((slot) => slot.slot));
  const slotRoles = new Set(operation.inputs.map((slot) => slot.role));
  const checks: Array<{ field: string; supported: boolean; label: string }> = [
    { field: 'fileUrl', supported: slotNames.has('file_url') || operation.inputs.some((slot) => slot.type === 'document'), label: '文档' },
    { field: 'linkUrl', supported: slotNames.has('link_url'), label: '网页链接' },
    { field: 'firstFrameUrl', supported: slotNames.has('first_frame') || slotRoles.has('first_frame'), label: '首帧素材' },
    { field: 'lastFrameUrl', supported: slotNames.has('last_frame') || slotRoles.has('last_frame'), label: '尾帧素材' },
  ];
  for (const check of checks) {
    const value = next[check.field];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!check.supported) {
      delete next[check.field];
      pushUnique(notices, `当前生成方式不支持${check.label}，已移除`);
      continue;
    }
    if (!isHttpUrl(value.trim())) {
      delete next[check.field];
      pushUnique(notices, `请输入有效的${check.label} URL`);
    }
  }
}

function schemaFor(
  modelParameters: ModelParameterSchema,
  operation: OperationContractDto | undefined,
): ModelParameterSchema {
  return mergeVideoParameterSchema(modelParameters, operation?.parameters);
}

/**
 * Normalize raw persisted video params against the effective model + operation
 * + channel-line schema. The input is never mutated; content fields (prompt,
 * attachments, slots, links) are preserved.
 */
export function normalizeVideoParamsForSchema(args: NormalizeVideoParamsForSchemaArgs): NormalizedVideoParams {
  const source = isRecord(args.params) ? args.params : {};
  const next: AnyRecord = { ...source };
  const notices: string[] = [];
  const blocked: NormalizedVideoParamsBlocked[] = [];
  const modelId = modelIdOf(args);
  const row = findCatalogRow(args.catalog, modelId);
  const modelItem = args.modelItem ?? (row ? catalogRowToModelItem(row) : undefined);

  if (!args.catalog || (!modelItem && !row)) {
    blocked.push({ field: 'model', message: '模型配置尚未就绪', required: true });
    return { params: next, notices, blocked };
  }

  const effectiveLineConstraints = args.lineConstraints !== undefined
    ? args.lineConstraints
    : (row && args.catalog ? resolveLineConstraints(
        modelId,
        source.routing,
        directoryChannelGroups(args.catalog, modelId),
        null,
      ) : null);
  const narrowedRow = row && effectiveLineConstraints
    ? narrowModelByLineConstraints(row, modelId, effectiveLineConstraints) as CatalogModelDto
    : row;
  const operations = operationsOf(narrowedRow, modelItem);
  const requested = typeof args.operationId === 'string' && args.operationId.trim()
    ? args.operationId.trim()
    : (typeof source.operation === 'string' ? source.operation.trim() : '');
  const selection = pickOperation(operations, requested);
  if (selection.fallbackNotice) pushUnique(notices, selection.fallbackNotice);
  if (modelId) next.model = modelId;
  if (selection.operationId) next.operation = selection.operationId;
  else if (operations.length === 0 && requested) next.operation = requested;

  const modelParameters = isSchema(narrowedRow?.parameters)
    ? narrowedRow.parameters
    : (modelItem?.parameters ?? {});
  const schema = schemaFor(modelParameters, selection.operation);

  normalizeAspectRatio(next, schema, notices, blocked);
  normalizeDuration(next, schema, notices, blocked);
  normalizeResolution(next, schema, notices, blocked);
  normalizeSeed(next, schema, notices);
  normalizeReferenceImages(next, selection.operation, notices);
  normalizeUrlFields(next, selection.operation, notices);

  for (const [field, label] of BOOLEAN_FIELDS) {
    if (field === 'sound') {
      normalizeSound(next, schema, notices);
      continue;
    }
    normalizeBooleanField(next, schema, field, label, notices);
  }
  for (const [field, label] of ENUM_FIELDS) {
    normalizeEnumField(next, schema, field, label, notices, blocked);
  }

  // Drop any control field the effective operation does not declare at all:
  // stale duration/resolution/sound/seed must never reach the request payload.
  const blockedFields = new Set(blocked.map((item) => item.field));
  for (const field of CONTROL_FIELDS) {
    if (field === 'sound') continue;
    if (!(field in schema) && !blockedFields.has(field)) delete next[field];
  }

  return { params: next, notices, blocked };
}

function normalizeSound(
  next: AnyRecord,
  schema: ModelParameterSchema,
  notices: string[],
): void {
  const definition = schema.sound;
  if (!definition || definition.supported !== true) {
    if (next.sound === true) pushUnique(notices, '当前渠道不支持声音同步，已关闭');
    delete next.sound;
    return;
  }
  if (typeof next.sound === 'boolean') return;
  next.sound = typeof definition.defaultValue === 'boolean' ? definition.defaultValue : false;
}
