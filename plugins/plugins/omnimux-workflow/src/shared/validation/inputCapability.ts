/**
 * Upstream-input capability resolver (epic #63, issue #62).
 *
 * Single source of truth for one question: given the media actually connected
 * to a generate node and one model's contract, which listed operations can
 * consume that input, which operation should be selected, and which parameter
 * semantics do not exist on the target operation.
 *
 * Pure data in, pure data out — no React, no store, no hub imports. UI,
 * connection validation and execution preparation all call this module; #55
 * `normalizeVideoParamsForSchema` remains the only value normalizer.
 */

import type {
  CapabilityCatalog,
  ModelParameterSchema,
} from '../api.ts';
import {
  buildContractView,
  isMediaInputType,
  mapLegacyOperation,
  matchOperationInputs,
  resolveModelView,
  type ContractModelView,
  type ContractOperationView,
  type OperationMatch,
  type UpstreamFingerprint,
} from './compatKernel.ts';

export type InputCapabilityReasonCode =
  | 'catalog_unavailable'
  | 'unknown_model'
  | 'not_listed'
  | 'operation_incompatible'
  | 'unused_media'
  | 'missing_required_input'
  | 'main_input_required';

export interface InputCapabilityRejection {
  code: InputCapabilityReasonCode;
  message?: string;
  slot?: string;
  type?: string;
}

export interface InputCapabilityOperationState {
  id: string;
  label: string;
  outputType: string;
  /** Catalog declaration order within the model — R3's first tiebreaker. */
  order: number;
  /** R1: every connected media type has at least one matching slot. */
  consumes: boolean;
  /** R2 + R2b: usable for generation under the current connected inputs. */
  usable: boolean;
  /** R3 ordering: required media slots that are actually filled. */
  requiredMediaHits: number;
  /** R3 ordering: media slots with at least one occupied input. */
  mediaSlotHits: number;
  /** Deterministic explanation when `usable` is false. */
  rejections: InputCapabilityRejection[];
}

export interface InputCapabilityParamsProjection {
  /** Operation the projected bag targets. */
  operationId: string;
  /** Params with semantics that do not exist on the target operation removed. */
  params: Record<string, unknown>;
  /** Field names removed by the projection, in encounter order. */
  dropped: string[];
}

export interface InputCapabilityResult {
  modelId?: string;
  operationStates: InputCapabilityOperationState[];
  selectedOperationId?: string;
  paramsProjection?: InputCapabilityParamsProjection;
  /** True when no listed operation can consume the current connected inputs. */
  blocked: boolean;
  reasonCode?: InputCapabilityReasonCode;
  /** True when the fingerprint carries at least one media asset. */
  hasMedia: boolean;
}

export interface InputCapabilityArgs {
  catalog: CapabilityCatalog | null | undefined;
  modelId: string | undefined | null;
  outputType?: string;
  fingerprint: UpstreamFingerprint;
  /**
   * Current operation (or the last explicit user choice). R3 keeps it when
   * it is usable; it is never replaced by another usable candidate otherwise.
   */
  preferredOperationId?: string;
  /**
   * Operation id last written by automatic adaptation. When it equals
   * `preferredOperationId`, that id is system-derived rather than a user
   * choice and must not outrank the current media fingerprint (R3/R6).
   */
  autoOperationId?: string | null;
  /** Raw persisted params; when present a projection is returned (R7). */
  params?: Record<string, unknown> | null;
  /** User-parked supply edges: connected but explicitly not consumed by generation. */
  ignoredEdgeIds?: readonly string[];
}

/**
 * R2b — media main-input semantics, keyed by operation id only.
 *
 * Contract `required` cannot express "all slots optional but the operation is
 * meaningless without a medium" (image_to_image / voice_clone). This table is
 * the only product-level declaration; no model/brand-specific branches.
 */
const MEDIA_MAIN_INPUT: Readonly<Record<string, readonly ('image' | 'video' | 'audio')[]>> = Object.freeze({
  image_to_image: ['image'],
  multi_reference: ['image'],
  video_multi_ref: ['image', 'video', 'audio'],
  voice_clone: ['audio'],
  emotion_control: ['audio'],
});

const DEFAULT_OPERATION_BY_OUTPUT: Readonly<Record<string, string>> = Object.freeze({
  text: 'chat',
  image: 'text_to_image',
  video: 'text_to_video',
  audio: 'text_to_speech',
});

/** Control-level parameter keys that only exist when the target schema declares them. */
const CONTROL_PARAM_FIELDS = [
  'aspectRatio', 'duration', 'resolution', 'sound', 'seed', 'watermark',
  'outputFormat', 'referenceTaskType', 'generationType', 'returnLastFrame',
  'webSearch', 'nsfwCheck', 'quality', 'voice', 'instrumental',
] as const;

function usableAssets(
  fingerprint: UpstreamFingerprint,
  ignoredEdgeIds: readonly string[] | undefined,
): UpstreamFingerprint {
  const ignored = new Set(ignoredEdgeIds ?? []);
  // Waiting / unavailable media is not generation input yet; it must not make
  // every operation look blocked. Missing availability is legacy "ready".
  const assets = fingerprint.assets.filter((asset) => {
    if (asset.edgeId && ignored.has(asset.edgeId)) return false;
    if (!isMediaInputType(asset.type)) return true;
    return asset.availability === undefined || asset.availability === 'ready';
  });
  return { ...fingerprint, assets, mediaAssets: assets.filter((asset) => isMediaInputType(asset.type)) };
}

function mediaCounts(fingerprint: UpstreamFingerprint): Record<'image' | 'video' | 'audio', number> {
  const counts = { image: 0, video: 0, audio: 0 };
  for (const asset of fingerprint.mediaAssets) {
    if (asset.type === 'image' || asset.type === 'video' || asset.type === 'audio') counts[asset.type] += 1;
  }
  return counts;
}

function mainInputSatisfied(operationId: string, counts: Record<'image' | 'video' | 'audio', number>): boolean {
  const required = MEDIA_MAIN_INPUT[operationId];
  if (!required) return true;
  return required.some((type) => counts[type] > 0);
}

function slotAssets(match: OperationMatch, slotName: string): number {
  return match.bindings.filter((binding) => binding.slot === slotName).length;
}

function requiredMediaSatisfied(op: ContractOperationView, match: OperationMatch): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const slot of op.inputs) {
    if (!isMediaInputType(slot.type) || slot.min < 1 || slot.source === 'node_field') continue;
    if (slotAssets(match, slot.slot) < slot.min) missing.push(slot.slot);
  }
  return { ok: missing.length === 0, missing };
}

function evaluateOperation(
  op: ContractOperationView,
  order: number,
  fingerprint: UpstreamFingerprint,
  counts: Record<'image' | 'video' | 'audio', number>,
  options: { ignoreUnused?: boolean } = {},
): InputCapabilityOperationState {
  const match = matchOperationInputs(op, fingerprint, options);
  const rejections: InputCapabilityRejection[] = [];
  if (!match.accepts) {
    for (const item of match.rejections) {
      rejections.push({
        code: item.code === 'operation_incompatible' || item.code === 'slot_capacity'
          || item.code === 'mime_unsupported' || item.code === 'size_exceeded'
          || item.code === 'duration_exceeded' || item.code === 'role_conflict'
          ? 'operation_incompatible'
          : 'unused_media',
        ...(item.message ? { message: item.message } : {}),
        ...(item.slot ? { slot: item.slot } : {}),
        ...(typeof item.meta?.type === 'string' ? { type: item.meta.type } : {}),
      });
    }
  }
  const required = requiredMediaSatisfied(op, match);
  for (const slot of required.missing) {
    rejections.push({ code: 'missing_required_input', slot });
  }
  if (!mainInputSatisfied(op.id, counts)) {
    rejections.push({ code: 'main_input_required' });
  }
  // Required node fields are generation-time metadata gates (R8), not mode
  // availability: keep the mode selectable and let the existing validation
  // mechanism surface the missing value.
  const usable = match.accepts && required.ok && mainInputSatisfied(op.id, counts);

  const assignedSlots = new Set(match.bindings.map((binding) => binding.slot));
  const mediaSlots = op.inputs.filter((slot) => isMediaInputType(slot.type) && slot.source !== 'node_field');
  const requiredMediaHits = mediaSlots.filter((slot) => slot.min >= 1 && assignedSlots.has(slot.slot)).length;
  const mediaSlotHits = mediaSlots.filter((slot) => assignedSlots.has(slot.slot)).length;

  return {
    id: op.id,
    label: op.label || op.id,
    outputType: op.output.type,
    order,
    consumes: match.accepts,
    usable,
    requiredMediaHits,
    mediaSlotHits,
    rejections,
  };
}

function sortCandidates(a: InputCapabilityOperationState, b: InputCapabilityOperationState): number {
  if (a.requiredMediaHits !== b.requiredMediaHits) return b.requiredMediaHits - a.requiredMediaHits;
  if (a.mediaSlotHits !== b.mediaSlotHits) return b.mediaSlotHits - a.mediaSlotHits;
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mergeParameterSchema(
  model: ContractModelView,
  operation: ContractOperationView,
): Record<string, unknown> {
  return {
    ...((model.parameters ?? {}) as Record<string, unknown>),
    ...((operation.parameters ?? {}) as Record<string, unknown>),
  };
}

function hasSlot(op: ContractOperationView, slotName: string, role?: string): boolean {
  return op.inputs.some((slot) => slot.slot === slotName || (role !== undefined && slot.role === role));
}

function hasMediaSlotOfType(op: ContractOperationView, type: string): boolean {
  return op.inputs.some((slot) => slot.type === type);
}

/**
 * R7 step 1 — drop parameter semantics the target operation does not have.
 * Value normalization (legal keep → default → blocked) stays in #55.
 */
export function projectParamsForOperation(
  model: ContractModelView,
  operation: ContractOperationView,
  params: Record<string, unknown>,
): InputCapabilityParamsProjection {
  const next: Record<string, unknown> = { ...params };
  const dropped: string[] = [];
  const hasAnySchema = Boolean(model.parameters) || Boolean(operation.parameters);
  const schema = mergeParameterSchema(model, operation);
  if (hasAnySchema) {
    for (const field of CONTROL_PARAM_FIELDS) {
      if (next[field] === undefined) continue;
      if (!(field in schema)) {
        delete next[field];
        dropped.push(field);
      }
    }
  }
  const supports = {
    fileUrl: hasMediaSlotOfType(operation, 'document') || hasSlot(operation, 'file_url'),
    linkUrl: hasSlot(operation, 'link_url'),
    firstFrameUrl: hasSlot(operation, 'first_frame', 'first_frame'),
    lastFrameUrl: hasSlot(operation, 'last_frame', 'last_frame') || hasSlot(operation, 'end_frame', 'last_frame'),
  };
  for (const [field, supported] of Object.entries(supports)) {
    if (next[field] !== undefined && !supported) {
      delete next[field];
      dropped.push(field);
    }
  }
  if (next.referenceImages !== undefined && !hasMediaSlotOfType(operation, 'image')) {
    delete next.referenceImages;
    dropped.push('referenceImages');
  }
  next.operation = operation.id;
  return { operationId: operation.id, params: next, dropped };
}

export function buildInputCapability(args: InputCapabilityArgs): InputCapabilityResult {
  const rawFingerprint = usableAssets(args.fingerprint, args.ignoredEdgeIds);
  const rawCounts = mediaCounts(rawFingerprint);
  const rawHasMedia = rawCounts.image + rawCounts.video + rawCounts.audio > 0;
  const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
  const view = buildContractView(args.catalog);
  if (!view.available) {
    return { operationStates: [], blocked: true, reasonCode: 'catalog_unavailable', hasMedia: rawHasMedia };
  }
  const model = resolveModelView(view, modelId);
  if (!model) {
    return { operationStates: [], blocked: true, reasonCode: 'unknown_model', hasMedia: rawHasMedia };
  }
  const listed = model.operations
    .map((operation, order) => ({ operation, order }))
    .filter(({ operation }) => operation.listed)
    .filter(({ operation }) => !args.outputType || operation.output.type === args.outputType);
  if (listed.length === 0) {
    return { modelId: model.id, operationStates: [], blocked: true, reasonCode: 'not_listed', hasMedia: rawHasMedia };
  }

  const isVideoCapability = args.outputType === 'video';
  // #62 rework / #88 (video first case): a media type that no listed video
  // operation of this model can ever consume is irrelevant supply (e.g. audio
  // on Muse). Keep the edge, but drop it from capability scoring so it cannot
  // disable an otherwise valid operation. Types that are consumable somewhere
  // stay in the fingerprint; an operation with no slot for them remains
  // unavailable (AC-1). Other output types keep the historical strict matrix.
  const consumableTypes = isVideoCapability
    ? new Set(listed.flatMap(({ operation }) => operation.inputs
      .filter((slot) => isMediaInputType(slot.type))
      .map((slot) => slot.type)))
    : null;
  const fingerprint: UpstreamFingerprint = consumableTypes
    ? {
        ...rawFingerprint,
        assets: rawFingerprint.assets.filter((asset) =>
          !isMediaInputType(asset.type) || consumableTypes.has(asset.type)),
        mediaAssets: rawFingerprint.mediaAssets.filter((asset) => consumableTypes.has(asset.type)),
      }
    : rawFingerprint;
  const counts = mediaCounts(fingerprint);
  const hasMedia = counts.image + counts.video + counts.audio > 0;

  // #62 rework / #88: for video, capacity/format are assignment concerns, not
  // operation availability gates. The selected operation still needs its own
  // required slots satisfied; extra ready supply is silently unused.
  const ignoreUnused = isVideoCapability;
  const operationStates = listed.map(({ operation, order }) =>
    evaluateOperation(operation, order, fingerprint, counts, { ignoreUnused }),
  );
  const candidates = operationStates.filter((state) => state.usable);
  const preferredRaw = typeof args.preferredOperationId === 'string' && args.preferredOperationId.trim()
    ? mapLegacyOperation(args.preferredOperationId.trim())
    : '';
  const autoRaw = typeof args.autoOperationId === 'string' && args.autoOperationId.trim()
    ? mapLegacyOperation(args.autoOperationId.trim())
    : '';
  let selected: InputCapabilityOperationState | undefined;
  // An automatically derived operation is not a creative preference: only an
  // explicit user choice may keep a usable operation against the fingerprint.
  const preferred = preferredRaw && preferredRaw !== autoRaw
    ? operationStates.find((state) => state.id === preferredRaw)
    : undefined;
  if (preferred?.usable) {
    selected = preferred;
  } else if (candidates.length > 0) {
    if (!hasMedia) {
      const defaultId = args.outputType ? DEFAULT_OPERATION_BY_OUTPUT[args.outputType] : undefined;
      selected = defaultId ? candidates.find((state) => state.id === defaultId) : undefined;
    }
    selected ??= [...candidates].sort(sortCandidates)[0];
  }

  const result: InputCapabilityResult = {
    modelId: model.id,
    operationStates,
    ...(selected ? { selectedOperationId: selected.id } : {}),
    blocked: !selected,
    ...(selected ? {} : { reasonCode: 'operation_incompatible' as const }),
    hasMedia,
  };
  if (selected && args.params && typeof args.params === 'object') {
    const operation = model.operations.find((entry) => entry.id === selected.id);
    if (operation) result.paramsProjection = projectParamsForOperation(model, operation, args.params);
  }
  return result;
}

/**
 * R5/R10 type-level gate: does the model publish at least one listed operation
 * (for this output type) with an input slot of the connected media type?
 *
 * Capacity, MIME and cardinality remain per-operation concerns handled by the
 * full `buildInputCapability` result; R5 rejects only when the type itself has
 * no consuming slot anywhere in the model.
 */
export function modelCanConsumeMediaType(args: {
  catalog: CapabilityCatalog | null | undefined;
  modelId: string | undefined | null;
  outputType?: string;
  mediaType: string;
}): boolean {
  const view = buildContractView(args.catalog);
  const model = resolveModelView(view, typeof args.modelId === 'string' ? args.modelId : '');
  if (!model) return false;
  return model.operations.some((operation) =>
    operation.listed
    && (!args.outputType || operation.output.type === args.outputType)
    && operation.inputs.some((slot) => slot.type === args.mediaType),
  );
}

/** R10: the model can produce this output type and has at least one usable operation. */
export function modelHasUsableOperation(args: Omit<InputCapabilityArgs, 'preferredOperationId' | 'params'>): boolean {
  return buildInputCapability({ ...args, preferredOperationId: undefined, params: undefined })
    .operationStates.some((state) => state.usable);
}

/** Exported for tests / callers that need the raw operation schema merge. */
export function inputCapabilityParameterSchema(
  model: ContractModelView,
  operation: ContractOperationView,
): ModelParameterSchema {
  return mergeParameterSchema(model, operation) as ModelParameterSchema;
}
