/**
 * Line-level narrowing of a model declaration.
 *
 * A gateway line (a channel group) may accept far less than the model declares: the
 * per-task line behind Seedance 2.5 takes nine images, no video, one resolution and a
 * fixed length, while the model contract publishes the widest union across all lines.
 * The canvas already renders straight from the contract, so narrowing here — before the
 * declaration reaches slot layout, operation lists or parameter controls — makes every
 * downstream surface correct without touching a single renderer.
 *
 * The contract always wins: a line value the declaration rejects is dropped instead of
 * written, and an empty intersection leaves the declaration untouched rather than
 * producing a parameter with no selectable value.
 */

import type { CapabilityCatalog, CatalogChannelGroupDto, CatalogModelDto, OperationContractDto } from '../api.ts';
import { canonicalJson } from './compatKernel.ts';
import { findDeclaredParameterFailure } from './declaredParameterValidation.ts';

export interface LineParameterConstraint {
  /** Explicitly remove a parameter the selected line does not expose. */
  supported?: boolean;
  /** The line accepts exactly this value. */
  fixed?: unknown;
  /** Restrict to these values; values the contract does not publish are never introduced. */
  only?: unknown[];
}

export interface LineConstraints {
  /** Operations this line serves; omitted means no restriction. */
  operations?: string[];
  /** Per-field narrowing of the model/operation parameter declarations. */
  parameters?: Record<string, LineParameterConstraint>;
  /** Per-input-type ceiling (`max: 0` means the line takes no such input at all). */
  inputs?: Record<string, { max?: number } | undefined>;
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

export interface EffectiveVideoGroupSelection {
  model: CatalogModelDto;
  group?: CatalogChannelGroupDto;
}

export function hasEffectiveVideoOperations(group: CatalogChannelGroupDto): boolean {
  return group.enabled !== false && (group.effectiveOperations ?? []).some(operation =>
    operation.output?.type === 'video' && operation.listed !== false);
}

export function groupMatchesEffectiveVideoVersion(group: CatalogChannelGroupDto, version: string): boolean {
  return hasEffectiveVideoOperations(group) && (group.effectiveVersion === undefined || group.effectiveVersion === version);
}

/** Null means a legacy route. A managed model without a matching group stays unconfigured. */
export function resolveEffectiveVideoGroup(catalog: CapabilityCatalog | null | undefined,
  modelId: unknown, routing: unknown): EffectiveVideoGroupSelection | null {
  if (typeof modelId !== 'string' || !modelId.trim()) return null;
  const id = modelId.trim();
  const model = catalog?.models?.find(row => row.id === id || row.aliases?.includes(id));
  const intent = asRecord(routing);
  const allowed = Array.isArray(intent?.allowedGroups) ? intent.allowedGroups : [];
  const requested = [...new Set([intent?.channelGroupId, ...allowed]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(value => value.trim()))];
  if (!model || intent?.sourceType === 'byok'
    || (requested.length > 0 && requested.every(group => group.startsWith('byok-')))) return null;
  if (model.effectiveVideoVersion === undefined) return typeof intent?.videoLineQuote === 'string' ? { model } : null;
  if (!requested.length || requested.includes('auto') || model.visible === false || model.selectable === false) return { model };
  const group = model.channelGroups?.find(candidate => groupMatchesEffectiveVideoVersion(candidate, model.effectiveVideoVersion!)
    && requested.every(id => candidate.id === id || candidate.wireGroup === id));
  return group ? { model, group } : { model };
}

export function effectiveVideoOperations(group: CatalogChannelGroupDto | undefined): OperationContractDto[] {
  return (group?.effectiveOperations ?? []).filter(operation => operation.listed !== false && operation.output?.type === 'video');
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** The editor takes these material inputs from named URL controls. */
const VIDEO_ASSET_FIELDS = { fileUrl: 'file_url', linkUrl: 'link_url' } as const;

export function effectiveVideoAssetFields(variant: OperationContractDto | undefined): Array<keyof typeof VIDEO_ASSET_FIELDS> {
  return (Object.keys(VIDEO_ASSET_FIELDS) as Array<keyof typeof VIDEO_ASSET_FIELDS>).filter(key =>
    variant?.inputs.some(input => input.slot === VIDEO_ASSET_FIELDS[key]
      && (input.source === 'node_field' || input.valueSources?.includes('local_field'))));
}

function matchesVariantParameters(variant: OperationContractDto, params: AnyRecord, fields: Set<string>): boolean {
  const definitions = variant.parameters ?? {};
  return [...fields].every(key => !hasValue(params[key]) || Object.hasOwn(definitions, key))
    && Object.keys(VIDEO_ASSET_FIELDS).every(key => !hasValue(params[key])
      || effectiveVideoAssetFields(variant).includes(key as keyof typeof VIDEO_ASSET_FIELDS))
    && !findDeclaredParameterFailure(params, definitions, undefined);
}

/** Prefer an already published superset when the same controls serve identical input roles. */
function hasWiderInputLimits(candidate: OperationContractDto, current: OperationContractDto): boolean {
  if (candidate.gatewayProtocol !== current.gatewayProtocol || candidate.modeKind !== current.modeKind
    || candidate.inputs.length !== current.inputs.length
    || canonicalJson(candidate.parameters) !== canonicalJson(current.parameters)
    || canonicalJson(candidate.inputGroups) !== canonicalJson(current.inputGroups)
    || canonicalJson(candidate.output) !== canonicalJson(current.output)) return false;
  let increased = false;
  for (const [index, input] of candidate.inputs.entries()) {
    const { min = 0, max, limitSource: _source, ...rule } = input;
    const { min: oldMin = 0, max: oldMax, limitSource: _oldSource, ...oldRule } = current.inputs[index]!;
    const limit = max ?? Infinity;
    const oldLimit = oldMax ?? Infinity;
    if (min > oldMin || limit < oldLimit || canonicalJson(rule) !== canonicalJson(oldRule)) return false;
    increased ||= min < oldMin || limit > oldLimit;
  }
  return increased;
}

/** Every supplied control must fit one whole variant. Missing required controls are assessed by readiness. */
export function resolveEffectiveVideoOperation(group: CatalogChannelGroupDto | undefined,
  operationId: unknown, params: AnyRecord = {}): OperationContractDto | undefined {
  const variants = effectiveVideoOperations(group);
  const fields = new Set(variants.flatMap(variant => Object.keys(variant.parameters ?? {})));
  let selected: OperationContractDto | undefined;
  for (const variant of variants) {
    const matches = variant.id === operationId || typeof operationId === 'string' && variant.aliases?.includes(operationId);
    if (matches && matchesVariantParameters(variant, params, fields)
      && (!selected || hasWiderInputLimits(variant, selected))) selected = variant;
  }
  return selected;
}

export function requiredEffectiveVideoParameter(variant: OperationContractDto, params: AnyRecord): string | undefined {
  return Object.entries(variant.parameters ?? {}).find(([key, value]) => {
    const definition = asRecord(value);
    return definition?.required === true && !hasValue(params[key]);
  })?.[0];
}

/** Build a selection as one edit, resetting controls only when its model, line or mode changed. */
export function transitionEffectiveVideoParams(
  catalog: CapabilityCatalog,
  selection: EffectiveVideoGroupSelection,
  previous: AnyRecord,
  routing: unknown,
  change: { operationId?: string; parameter?: { key: string; value: unknown } } = {},
): AnyRecord | undefined {
  const group = selection.group;
  if (!group) return;
  const variants = effectiveVideoOperations(group);
  const previousGroup = resolveEffectiveVideoGroup(catalog, previous.model, previous.routing)?.group;
  const sameModel = previous.model === selection.model.id;
  const sameGroup = sameModel && previousGroup?.id === group.id;
  const advertisedDefault = group.defaultOperationId;
  const modeIds = [...new Set(variants.map(variant => variant.id))];
  const priorMode = typeof previous.operation === 'string' && modeIds.includes(previous.operation) ? previous.operation : undefined;
  const operationId = change.operationId ?? (sameModel ? priorMode : undefined)
    ?? (advertisedDefault && modeIds.includes(advertisedDefault) ? advertisedDefault : undefined)
    ?? (modeIds.length === 1 ? modeIds[0] : undefined);
  const next: AnyRecord = { model: selection.model.id, routing };
  if (!operationId) return change.parameter ? undefined : next;
  next.operation = operationId;
  const forMode = variants.filter(variant => variant.id === operationId);
  if (!forMode.length) return;
  const oldValues = sameGroup && operationId === priorMode ? previous : {};
  const edit = change.parameter;
  const matchingEdit = forMode.filter(variant => !edit
    || (typeof edit.value === 'string' && effectiveVideoAssetFields(variant).includes(edit.key as keyof typeof VIDEO_ASSET_FIELDS))
    || (Object.hasOwn(variant.parameters ?? {}, edit.key)
      && !findDeclaredParameterFailure({ [edit.key]: edit.value }, { [edit.key]: variant.parameters?.[edit.key] }, undefined)));
  const currentVariant = resolveEffectiveVideoOperation(group, operationId, oldValues);
  const variant = currentVariant && matchingEdit.includes(currentVariant) ? currentVariant : matchingEdit[0];
  if (!variant) return;
  for (const [key, value] of Object.entries(variant.parameters ?? {})) {
    const definition = asRecord(value);
    if (!definition || definition.supported === false) continue;
    const options = Array.isArray(definition.options) ? definition.options : [];
    const range = asRecord(definition.range);
    const singleOption = options.length === 1 && !range ? valueOf(options[0]) : undefined;
    const fixedRange = range && options.length === 0 && typeof range.min === 'number' && range.max === range.min
      ? range.min : undefined;
    const oldValue = key === edit?.key ? edit.value : oldValues[key];
    const candidate = hasValue(oldValue) && !findDeclaredParameterFailure({ [key]: oldValue }, { [key]: definition }, undefined)
      ? oldValue : definition.defaultValue ?? singleOption ?? fixedRange;
    if (hasValue(candidate) && !findDeclaredParameterFailure({ [key]: candidate }, { [key]: definition }, undefined)) next[key] = candidate;
  }
  for (const key of effectiveVideoAssetFields(variant)) {
    const value = key === edit?.key ? edit.value : oldValues[key];
    if (typeof value === 'string') next[key] = value;
  }
  return next;
}

function valueOf(option: unknown): unknown {
  const record = asRecord(option);
  return record ? record.value : option;
}

function withinBounds(range: AnyRecord, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const min = typeof range.min === 'number' ? range.min : undefined;
  const max = typeof range.max === 'number' ? range.max : undefined;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** Keep only the declared options whose value is allowed, preserving labels and order. */
function restrictOptions(options: unknown[], allowed: unknown[]): unknown[] {
  return options.filter((option) => allowed.some((candidate) => Object.is(candidate, valueOf(option))));
}

/**
 * Apply one field's line constraint to a contract parameter declaration.
 * Returns `null` when the constraint cannot be honoured, so the caller keeps the contract.
 */
function applyParameterConstraint(definition: AnyRecord, constraint: LineParameterConstraint): AnyRecord | null {
  if (constraint.supported === false) return { supported: false, options: [] };
  const options = Array.isArray(definition.options) ? definition.options : [];
  const range = asRecord(definition.range);

  if (typeof constraint.fixed !== 'undefined') {
    const allowed = [constraint.fixed];
    if (options.length > 0) {
      const kept = restrictOptions(options, allowed);
      if (kept.length === 0) return null;
      return { ...definition, options: kept, defaultValue: constraint.fixed, range: undefined, allowAuto: undefined };
    }
    if (range && !withinBounds(range, constraint.fixed)) return null;
    return { ...definition, options: [{ value: constraint.fixed }], defaultValue: constraint.fixed, range: undefined, allowAuto: undefined };
  }

  if (Array.isArray(constraint.only)) {
    if (options.length === 0) return null;
    const kept = restrictOptions(options, constraint.only);
    if (kept.length === 0) return null;
    const keepsDefault = kept.some((option) => Object.is(valueOf(option), definition.defaultValue));
    return { ...definition, options: kept, ...(keepsDefault ? {} : { defaultValue: valueOf(kept[0]) }) };
  }

  return null;
}

function narrowParameterMap(parameters: AnyRecord, constraints: Record<string, LineParameterConstraint>): AnyRecord {
  let changed = false;
  const next: AnyRecord = { ...parameters };
  for (const [field, constraint] of Object.entries(constraints)) {
    const definition = asRecord(parameters[field]);
    if (!definition || !constraint) continue;
    const applied = applyParameterConstraint(definition, constraint);
    if (!applied) continue;
    next[field] = applied;
    changed = true;
  }
  return changed ? next : parameters;
}

/** Drop inputs the line refuses, and lower the ceiling of the ones it accepts. */
function narrowInputs(inputs: unknown[], constraints: Record<string, { max?: number } | undefined>): unknown[] {
  const kept: unknown[] = [];
  for (const input of inputs) {
    const record = asRecord(input);
    const type = record && typeof record.type === 'string' ? record.type : '';
    const limit = constraints[type];
    if (limit && typeof limit.max === 'number') {
      if (limit.max <= 0) continue;
      const current = typeof record?.max === 'number' ? (record.max as number) : undefined;
      kept.push({ ...record, max: current === undefined ? limit.max : Math.min(current, limit.max) });
      continue;
    }
    kept.push(input);
  }
  return kept;
}

/**
 * Narrow a model declaration to what one line accepts.
 *
 * @param model Contract model declaration (never mutated).
 * @param modelId Canonical model id; empty input leaves the declaration untouched.
 * @param constraints Resolved line constraints, or nothing for automatic routing.
 */
export function narrowModelByLineConstraints<M>(model: M, modelId: string, constraints: LineConstraints | undefined): M {
  if (typeof modelId !== 'string' || !modelId) return model;
  if (!constraints || !model) return model;
  const record = asRecord(model);
  if (!record) return model;

  const operationsFilter = Array.isArray(constraints.operations) && constraints.operations.length > 0 ? constraints.operations : null;
  const parameterConstraints = constraints.parameters && Object.keys(constraints.parameters).length > 0 ? constraints.parameters : null;
  const inputConstraints = constraints.inputs && Object.keys(constraints.inputs).length > 0 ? constraints.inputs : null;
  if (!operationsFilter && !parameterConstraints && !inputConstraints) return model;

  const operations = Array.isArray(record.operations) ? record.operations : [];
  const nextOperations = operations.flatMap((operation) => {
    const operationRecord = asRecord(operation);
    if (!operationRecord) return [operation];
    if (operationsFilter && !(typeof operationRecord.id === 'string' && operationsFilter.includes(operationRecord.id))) return [];
    const nextInputs = inputConstraints && Array.isArray(operationRecord.inputs)
      ? narrowInputs(operationRecord.inputs, inputConstraints)
      : operationRecord.inputs;
    const operationParameters = asRecord(operationRecord.parameters);
    const nextParameters = parameterConstraints && operationParameters
      ? narrowParameterMap(operationParameters, parameterConstraints)
      : operationRecord.parameters;
    if (nextInputs === operationRecord.inputs && nextParameters === operationRecord.parameters) return [operation];
    return [{ ...operationRecord, inputs: nextInputs, parameters: nextParameters }];
  });

  const modelParameters = asRecord(record.parameters);
  const nextModelParameters = parameterConstraints && modelParameters
    ? narrowParameterMap(modelParameters, parameterConstraints)
    : record.parameters;

  return { ...record, operations: nextOperations, parameters: nextModelParameters } as unknown as M;
}

/**
 * Resolves the constraints of the lines a node routes to.
 *
 * The lines live on the catalog rows the resolver is handed (`channelGroups`,
 * projected from the gateway snapshot by the hub), so the lookup is injected
 * instead of imported: shared code owns slot layout and operation lists, while
 * the canvas owns the resolution rules.
 */
export type LineConstraintResolver = (
  modelId: string,
  routing: unknown,
  catalog?: unknown,
) => LineConstraints;

let resolver: LineConstraintResolver | null = null;

/**
 * Register the line-constraint lookup.
 *
 * Without a resolver every surface keeps the full model declaration, which is
 * the safe default.
 */
export function setLineConstraintResolver(next: LineConstraintResolver | null): void {
  resolver = next;
}

/**
 * Narrow the routed model inside a catalog copy.
 *
 * Slot layout, operation lists and parameter controls all read the model out of
 * the catalog, so narrowing once here keeps every downstream surface honest — the slot count,
 * the input types and the operation list follow from the same declaration.
 *
 * The catalog travels with the call because the routed lines are part of it.
 */
export function narrowCatalogByRouting<C>(
  catalog: C | null | undefined,
  modelId: unknown,
  routing: unknown,
  params: AnyRecord = {},
): C | null | undefined {
  if (!catalog || typeof catalog !== 'object') return catalog;
  if (typeof modelId !== 'string' || !modelId) return catalog;
  const catalogRecord = catalog as unknown as Record<string, unknown>;
  const models = Array.isArray(catalogRecord.models) ? catalogRecord.models : null;
  const managed = resolveEffectiveVideoGroup(catalog as unknown as CapabilityCatalog, modelId, routing);
  if (managed) {
    const variants = effectiveVideoOperations(managed.group);
    const operationIds = new Set(variants.map(operation => operation.id));
    const selected = resolveEffectiveVideoOperation(managed.group, params.operation, params);
    const operations = [...operationIds].flatMap(id => {
      const variant = selected?.id === id ? selected : resolveEffectiveVideoOperation(managed.group, id);
      // Keep a mode's contract renderable so an outdated parameter choice can be repaired.
      // Submission validates the persisted choice against the exact matching variant above.
      return variant ? [variant] : [];
    });
    const projectedModel = { ...managed.model, parameters: {}, operations, effectiveVideoProjection: true };
    return {
      ...catalogRecord,
      models: (models ?? []).map(model => (asRecord(model)?.id === managed.model.id ? projectedModel : model)),
      ...(Array.isArray(catalogRecord.video) ? { video: catalogRecord.video.map(model =>
        asRecord(model)?.id === managed.model.id ? { ...model, parameters: {} } : model) } : {}),
    } as unknown as C;
  }
  if (!resolver) return catalog;
  if (!models || !models.some((model) => asRecord(model)?.id === modelId)) return catalog;
  const constraints = resolver(modelId, routing, catalogRecord);
  if (!constraints || Object.keys(constraints).length === 0) return catalog;
  return {
    ...catalogRecord,
    models: models.map((model) => (asRecord(model)?.id === modelId
      ? narrowModelByLineConstraints(model, modelId, constraints)
      : model)),
  } as unknown as C;
}
