import type { CapabilityCatalog, CapabilityModelItem, ModelParameterSchema } from '../../../../../../shared/api.ts';
import { buildEffectiveOpsUiState, buildUiUpstreamFingerprint, readPreferredOperationId, setParamsOperation, type UpstreamMediaSnapshot } from '../../../../../../shared/validation/operationUi.ts';
import { findDeclaredParameterFailure } from '../../../../../../shared/validation/declaredParameterValidation.ts';
import { narrowModelByLineConstraints } from '../../../../../../shared/validation/lineConstraints.ts';
import { directoryChannelGroups, resolveLineConstraints, type RuntimeByokChannelSettings } from '../channelGroups.ts';
import { mergeVideoParameterSchema } from './videoParamAdapter.ts';
import { catalogRowToModelItem, normalizeVideoParamsForSchema } from './videoParamNormalization.ts';
import { DEFAULT_PARAM_CONTROL_POLICY } from './paramControlTable.ts';

export type VideoControlValues = Record<string, string | number | boolean>;
export interface VideoParameterSelections {
  version: 1;
  byModel: Record<string, { lastOperationId: string; byOperation: Record<string, VideoControlValues> }>;
  /** Transient normalization notices; never persisted by the selection writer. */
  notices?: string[];
}
export interface ReadVideoParameterSelectionsContext {
  catalog?: CapabilityCatalog | null;
  /** When set, only this model's history is normalized; other rows stay structural. */
  modelId?: string;
}
export interface VideoParameterSelectionArgs {
  params: Record<string, unknown>;
  parameterSelections?: VideoParameterSelections;
  currentModelItem?: CapabilityModelItem;
  targetModelItem?: CapabilityModelItem;
  catalog?: CapabilityCatalog | null;
  upstreams?: UpstreamMediaSnapshot[];
  prompt?: string;
  nextOperationId?: string;
  explicitModelSelection?: boolean;
  /** Undefined preserves routing; null selects automatic routing. */
  routing?: Record<string, unknown> | null;
  runtimeSettings?: RuntimeByokChannelSettings | null;
}
export interface VideoParameterSelectionResult {
  params: Record<string, unknown>;
  parameterSelections?: VideoParameterSelections;
  notices: string[];
  errors: string[];
}

const CONTENT_FIELDS = new Set(['model', 'operation', 'mode', 'routing', 'prompt', 'negativePrompt', 'pendingVideoParamAdjustment', 'fileUrl', 'linkUrl', 'firstFrameUrl', 'lastFrameUrl']);
const FIELD_LABELS: Record<string, string> = { resolution: '清晰度', aspectRatio: '画幅', duration: '时长', sound: '声音', seed: '随机种子' };
function controlDefinitions(schema: ModelParameterSchema): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(schema).filter(([key, definition]) =>
    !CONTENT_FIELDS.has(key) && !/(?:url|media|slot|runtime|prompt)/i.test(key)
    && definition && typeof definition === 'object' && !Array.isArray(definition),
  )) as Record<string, Record<string, unknown>>;
}
function scalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
function validatedControls(values: Record<string, unknown>, definitions: Record<string, Record<string, unknown>>) {
  const controls: VideoControlValues = {};
  const notices: string[] = [];
  const errors: string[] = [];
  for (const [field, definition] of Object.entries(definitions)) {
    if (definition.supported === false) continue;
    const value = values[field];
    const supplied = value !== undefined && value !== null && value !== '';
    const valid = (candidate: unknown) => scalar(candidate) && !findDeclaredParameterFailure({[field]:candidate}, {[field]:definition}, undefined);
    if (supplied && valid(value)) {
      const options = Array.isArray(definition.options) ? definition.options : [];
      const canonical = definition.caseInsensitive === true && typeof value === 'string'
        ? options.find((option) => typeof option?.value === 'string' && option.value.toLowerCase() === value.toLowerCase())?.value
        : undefined;
      controls[field] = canonical ?? value;
    } else if (valid(definition.defaultValue)) {
      controls[field] = definition.defaultValue as string | number | boolean;
      if (supplied) notices.push(`${FIELD_LABELS[field] ?? field} ${String(value)} 已失效，已调整为 ${String(controls[field])}`);
    } else {
      if (supplied) notices.push(`${FIELD_LABELS[field] ?? field} ${String(value)} 已失效，已移除`);
      if (definition.required === true) errors.push(`请设置${FIELD_LABELS[field] ?? field}：当前契约没有合法默认值`);
    }
  }
  return { controls, notices, errors };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function readVideoParameterSelections(
  value: unknown,
  context: ReadVideoParameterSelectionsContext = {},
): VideoParameterSelections {
  const result: VideoParameterSelections = {version:1, byModel:{}};
  const notices: string[] = [];
  if (!record(value) || value.version !== 1 || !record(value.byModel)) return result;
  for (const [modelId, model] of Object.entries(value.byModel)) {
    if (!record(model) || typeof model.lastOperationId !== 'string' || !record(model.byOperation)) continue;
    const byOperation: Record<string, VideoControlValues> = {};
    const shouldNormalize = Boolean(context.catalog) && (!context.modelId || context.modelId === modelId);
    const row = shouldNormalize
      ? context.catalog?.models?.find((candidate) => candidate.id === modelId
        || (Array.isArray(candidate.aliases) && candidate.aliases.includes(modelId)))
      : undefined;
    if (shouldNormalize && !row) continue;
    for (const [operationId, controls] of Object.entries(model.byOperation)) {
      if (!record(controls)) continue;
      const scalarControls = Object.fromEntries(Object.entries(controls).filter((entry): entry is [string, string | number | boolean] => scalar(entry[1])));
      if (!row || !context.catalog) {
        byOperation[operationId] = scalarControls;
        continue;
      }
      const normalized = normalizeVideoParamsForSchema({
        params: {model: modelId, operation: operationId, ...scalarControls},
        modelItem: catalogRowToModelItem(row),
        operationId,
        catalog: context.catalog,
      });
      const normalizedOperation = typeof normalized.params.operation === 'string' ? normalized.params.operation : '';
      if (normalizedOperation && normalizedOperation !== operationId) continue;
      if (normalized.blocked.length > 0) {
        for (const item of normalized.blocked) {
          if (!notices.includes(item.message)) notices.push(item.message);
        }
        continue;
      }
      for (const message of normalized.notices) {
        if (!notices.includes(message)) notices.push(message);
      }
      const cleaned: VideoControlValues = {};
      for (const [key, entryValue] of Object.entries(normalized.params)) {
        if (key === 'model' || key === 'operation' || CONTENT_FIELDS.has(key)) continue;
        if (scalar(entryValue)) cleaned[key] = entryValue;
      }
      byOperation[operationId] = cleaned;
    }
    Object.defineProperty(result.byModel, modelId, {value:{lastOperationId:model.lastOperationId, byOperation}, enumerable:true, writable:true, configurable:true});
  }
  if (notices.length > 0) result.notices = notices;
  return result;
}

/** Node-local immutable editing state; the returned params are the sole execution source. */
export function buildVideoParameterSelection(args: VideoParameterSelectionArgs): VideoParameterSelectionResult {
  const unchanged = (error: string): VideoParameterSelectionResult => ({params: args.params, parameterSelections: args.parameterSelections, notices: [], errors: [error]});
  const requestedTargetId = args.targetModelItem?.id
    ?? (typeof args.params.model === 'string' ? args.params.model : '');
  const requestedTargetRow = args.catalog?.models?.find((model) => model.id === requestedTargetId
    || (Array.isArray(model.aliases) && model.aliases.includes(requestedTargetId)));
  const targetModelItem = args.targetModelItem ?? (requestedTargetRow ? catalogRowToModelItem(requestedTargetRow) : undefined);
  if (!args.catalog || !targetModelItem) return unchanged('模型配置尚未就绪');
  // A narrow line accepts far less than the contract publishes; narrowing before any
  // control is derived keeps the panel, the operation list and the slot layout honest.
  const routingIntent = args.routing === undefined ? args.params.routing : args.routing;
  const lineConstraints = resolveLineConstraints(
    targetModelItem.id,
    routingIntent,
    directoryChannelGroups(args.catalog, targetModelItem.id),
    args.runtimeSettings,
  );
  const target = narrowModelByLineConstraints(
    targetModelItem,
    targetModelItem.id,
    lineConstraints,
  );
  // The operation list and the operation-level parameter declarations must carry the same
  // narrowing as the model itself: reading them from the raw catalog re-publishes what the
  // line refuses (extra generation modes, and controls the line does not expose at all).
  const catalog = args.catalog.models
    ? {
        ...args.catalog,
        models: args.catalog.models.map((model) => (model.id === targetModelItem.id
          ? narrowModelByLineConstraints(model, targetModelItem.id, lineConstraints)
          : model)),
      }
    : args.catalog;
  const currentId = typeof args.params.model === 'string' ? args.params.model : '';
  const resolvedCurrent = args.catalog.models?.find(model => model.id === currentId || model.aliases?.includes(currentId));
  const currentModelItem = args.currentModelItem ?? (resolvedCurrent ? catalogRowToModelItem(resolvedCurrent) : undefined);
  const currentMatches = Boolean(currentModelItem && resolvedCurrent?.id === currentModelItem.id);
  if (!currentMatches && !args.explicitModelSelection) return unchanged('当前模型配置不可用');
  const history = readVideoParameterSelections(args.parameterSelections, {catalog, modelId: target.id});
  const historyNotices = history.notices ? [...history.notices] : [];
  delete history.notices;
  const fingerprint = buildUiUpstreamFingerprint({prompt: args.prompt, upstreams: args.upstreams});
  function branch(model: CapabilityModelItem, preferred?: string) {
    const state = buildEffectiveOpsUiState({catalog, modelId:model.id, fingerprint, outputType:'video', ...(preferred ? {preferredOperationId:preferred} : {})});
    const operation = preferred
      ? state.effectiveOps.find(op => op.id === preferred)
      : (state.effectiveOps.find(op => op.id === 'text_to_video') ?? state.effectiveOps.find(op => op.id === state.selectedOperationId) ?? state.effectiveOps[0]);
    if (!operation) return undefined;
    return {id:operation.id, definitions:controlDefinitions(mergeVideoParameterSchema(model.parameters, operation.parameters))};
  }
  const current = currentMatches ? currentModelItem : undefined;
  const currentBranch = current ? branch(current, readPreferredOperationId(args.params)) : undefined;
  const sameModel = current?.id === target.id;
  let preferred = args.nextOperationId ?? (sameModel ? readPreferredOperationId(args.params) : history.byModel[target.id]?.lastOperationId);
  // 1. 若渠道线明确限制了允许的操作集（例如口型版仅允许 digital_human），且原首选不在此范围内，自适应到渠道允许的操作
  if (preferred && lineConstraints?.operations && lineConstraints.operations.length > 0 && !lineConstraints.operations.includes(preferred)) {
    preferred = lineConstraints.operations[0];
  }
  // 2. 若跨模型切换且历史记录的操作在新模型中不存在，平滑回退
  const targetDecl = catalog.models?.find(m => m.id === target.id || m.aliases?.includes(target.id));
  const targetOps = (target as CapabilityModelItem & { operations?: Array<{ id: string }> }).operations ?? targetDecl?.operations;
  if (!sameModel && preferred && targetOps && !targetOps.some((op: { id: string }) => op.id === preferred)) {
    preferred = undefined;
  }
  const targetBranch = branch(target, preferred);
  if (!targetBranch) return unchanged('当前生成方式不可用，请重新选择');
  const notices: string[] = [...historyNotices];
  if (current && currentBranch) {
    const normalizedCurrent = normalizeVideoParamsForSchema({
      params: args.params,
      modelItem: current,
      operationId: currentBranch.id,
      catalog,
      lineConstraints,
    });
    const snapshot = validatedControls(normalizedCurrent.params, currentBranch.definitions);
    history.byModel[current.id] = {
      lastOperationId:currentBranch.id,
      byOperation:{...history.byModel[current.id]?.byOperation, [currentBranch.id]:snapshot.controls},
    };
  }
  const sameBranch = sameModel && currentBranch?.id === targetBranch.id;
  const source = sameBranch ? args.params : (history.byModel[target.id]?.byOperation[targetBranch.id] ?? {});
  // The old params are normalized against the target schema as well: this is
  // the user-visible "画幅 9:16 → 自适应" notice on model/operation/channel switches.
  const normalizedOld = normalizeVideoParamsForSchema({
    params: args.params,
    modelItem: target,
    operationId: targetBranch.id,
    catalog,
    lineConstraints,
  });
  for (const message of normalizedOld.notices) {
    if (!notices.includes(message)) notices.push(message);
  }
  const normalizedSource = normalizeVideoParamsForSchema({
    params: {...source, model: target.id, operation: targetBranch.id},
    modelItem: target,
    operationId: targetBranch.id,
    catalog,
    lineConstraints,
  });
  const selection = validatedControls(normalizedSource.params, targetBranch.definitions);
  for (const message of normalizedSource.notices) {
    if (!notices.includes(message)) notices.push(message);
  }
  notices.push(...selection.notices.filter((message) => !notices.includes(message)));
  let params = {...args.params};
  const knownControls = DEFAULT_PARAM_CONTROL_POLICY.writeAllowlist.filter(field => !CONTENT_FIELDS.has(field));
  for (const field of new Set([...knownControls, ...Object.keys(currentBranch?.definitions ?? {}), ...Object.keys(targetBranch.definitions)])) delete params[field];
  delete params.pendingVideoParamAdjustment;
  params = setParamsOperation({...params, model:target.id, ...selection.controls}, targetBranch.id);
  if (args.routing === null) delete params.routing;
  else if (args.routing !== undefined) params.routing = structuredClone(args.routing);
  history.byModel[target.id] = {lastOperationId:targetBranch.id, byOperation:{...history.byModel[target.id]?.byOperation, [targetBranch.id]:selection.controls}};
  const errors = [
    ...normalizedSource.blocked.map((item) => item.message),
    ...selection.errors,
  ].filter((message, index, all) => all.indexOf(message) === index);
  return {params, parameterSelections:history, notices, errors};
}
