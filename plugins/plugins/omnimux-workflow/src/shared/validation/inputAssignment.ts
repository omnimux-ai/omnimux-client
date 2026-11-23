import type { CapabilityCatalog, ModelParameterSchema } from '../api.ts';
import { deriveSlotLayout, slotLayoutForOperation } from '../graph/feedSlot/deriveSlotLayout.ts';
import type { SlotSelection } from '../graph/feedSlot/assembleEffectiveInputs.ts';
import type { SlotBindings, SlotConflict, SlotLayout } from '../graph/feedSlot/types.ts';
import { normalizeVideoParamsForSchema, type NormalizedVideoParams } from '../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamNormalization.ts';
import { assignOperationSlots, countAssignedMedia, type InputCandidate, type SlotAssignment, type UnusedCandidate } from './assignOperationSlots.ts';
import { buildContractView, buildUpstreamFingerprint, canonicalJson, checkAssignedInputReadiness,
  isMediaInputType, mapLegacyOperation, resolveModelView, type CompatRejection,
  type ContractModelView, type ContractOperationView, type OperationMatch, type UpstreamFingerprint } from './compatKernel.ts';
import { findDeclaredParameterFailure } from './declaredParameterValidation.ts';
import type { InputCapabilityArgs, InputCapabilityOperationState, InputCapabilityParamsProjection } from './inputCapability.ts';

export type { InputCandidate, SlotAssignment, UnusedCandidate, UnusedReason } from './assignOperationSlots.ts';

export interface InputAssignmentArgs extends InputCapabilityArgs {
  slotBindings?: SlotBindings;
  slotConflicts?: readonly SlotConflict[];
  inputBindingVersion?: number;
  /** Managed groups and captured executions fix the operation before allocation. */
  forceOperationId?: string;
  deferVisualPrompt?: boolean;
}

export interface InputAssignment {
  modelId?: string;
  operationId?: string;
  layout: SlotLayout;
  operationStates: InputCapabilityOperationState[];
  operationMatches: ReadonlyMap<string, OperationMatch>;
  slots: SlotAssignment[];
  assigned: InputCandidate[];
  unused: UnusedCandidate[];
  blocked: CompatRejection[];
  ready: boolean;
  reasonCode?: CompatRejection['code'];
  bindings: SlotBindings;
  records: SlotSelection[];
  effectiveFingerprint: UpstreamFingerprint;
  paramsProjection?: InputCapabilityParamsProjection;
  videoNormalization?: NormalizedVideoParams;
  fingerprint: string;
  contractFingerprint: string;
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

/** Exported for tests / callers that need the raw operation schema merge. */
export function inputCapabilityParameterSchema(
  model: ContractModelView,
  operation: ContractOperationView,
): ModelParameterSchema {
  return mergeParameterSchema(model, operation) as ModelParameterSchema;
}

/** Short deterministic signature used for freshness comparisons in both runtimes. */
function assignmentFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x5bd1e995);
  }
  return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
}

function evaluateOperation(args: InputAssignmentArgs, model: ContractModelView, operation: ContractOperationView, order: number) {
  const layout = slotLayoutForOperation(args.catalog, model, operation);
  const plan = assignOperationSlots(layout, args.fingerprint, args);
  const { assigned, assignedBySlot, effectiveFingerprint } = plan;
  const blocked = [...plan.blocked, ...checkAssignedInputReadiness(operation, effectiveFingerprint, assignedBySlot, args.deferVisualPrompt ?? true)];
  const mediaSlots = layout.slots.filter(slot => isMediaInputType(slot.type));
  const missingMedia = mediaSlots.filter(slot => (assignedBySlot.get(slot.slot)?.length ?? 0) < slot.min);
  const main = MEDIA_MAIN_INPUT[operation.id];
  const mainSatisfied = !main || assigned.some(asset => asset.targetSlot && main.some(type => type === asset.type));
  if (!mainSatisfied && blocked.length === 0) blocked.push({ code: 'min_unsatisfied', message: '请添加此生成方式所需的素材' });
  const state: InputCapabilityOperationState = {
    id: operation.id, label: operation.label || operation.id, outputType: operation.output.type, order,
    consumes: true,
    usable: missingMedia.length === 0 && mainSatisfied,
    selectableBeforeInputs: true,
    potentialHits: countAssignedMedia(assigned),
    requiredMediaHits: mediaSlots.filter(slot => slot.min > 0 && assignedBySlot.get(slot.slot)!.length >= slot.min).length,
    mediaSlotHits: mediaSlots.filter(slot => assignedBySlot.get(slot.slot)!.length > 0).length,
    rejections: [
      ...missingMedia.map(slot => ({ code: 'missing_required_input' as const, slot: slot.slot })),
      ...(!mainSatisfied ? [{ code: 'main_input_required' as const }] : []),
    ],
  };
  const match: OperationMatch = {
    operationId: operation.id, accepts: true, ready: blocked.length === 0, potentialHits: state.potentialHits,
    rejections: [], pending: blocked,
    bindings: assigned.filter(asset => asset.targetSlot).map(asset => ({
      edgeId: asset.edgeId, sourceNodeId: asset.sourceNodeId, type: asset.type, slot: asset.targetSlot!, role: asset.role ?? '',
    })),
  };
  return { ...plan, state, match, operation, layout, blocked };
}

function compareOperations(left: InputCapabilityOperationState, right: InputCapabilityOperationState): number {
  return right.potentialHits - left.potentialHits
    || Number(right.usable) - Number(left.usable)
    || right.requiredMediaHits - left.requiredMediaHits
    || right.mediaSlotHits - left.mediaSlotHits
    || left.order - right.order || left.id.localeCompare(right.id);
}

export function resolveInputAssignment(args: InputAssignmentArgs): InputAssignment {
  const view = buildContractView(args.catalog);
  const model = resolveModelView(view, args.modelId);
  const operations = model?.operations.filter(op => op.listed && (!args.outputType || args.outputType === op.output.type)) ?? [];
  const evaluated = model ? operations.map((op, order) => evaluateOperation(args, model, op, order)) : [];
  const operationStates = evaluated.map(item => item.state);
  const operationMatches = new Map(evaluated.map(item => [item.operation.id, item.match]));
  const preferred = mapLegacyOperation(args.preferredOperationId);
  const auto = mapLegacyOperation(args.autoOperationId);
  const forced = mapLegacyOperation(args.forceOperationId);
  const pick = (id: string) => evaluated.find(item => item.operation.id === id);
  const ranked = [...evaluated].sort((left, right) => compareOperations(left.state, right.state));
  const best = ranked[0];
  const defaultId = args.outputType ? DEFAULT_OPERATION_BY_OUTPUT[args.outputType] : undefined;
  const zeroMedia = !best?.state.potentialHits && (defaultId ? ranked.find(item => item.operation.id === defaultId && item.state.usable) : undefined);
  const requested = args.outputType !== 'image' && preferred && preferred !== auto ? pick(preferred) : undefined;
  // A request distinct from the recorded automatic mode is a user choice.
  // For older graphs without provenance, keep the saved mode when its inputs support it.
  const keepRequested = requested && (args.autoOperationId === null || auto !== '' || requested.state.potentialHits > 0
    || requested.records.some(record => record.occupant.pinned) || (requested.state.usable && !best?.state.potentialHits));
  // Pending or invalid pins still reserve their image slots and block generation.
  const reservedImage = args.outputType === 'image' && zeroMedia
    ? ranked.find(item => item.records.some(({ slot, occupant, state }) =>
      slot.type === 'image' && occupant.pinned && (state === 'pending' || state === 'invalid')))
    : undefined;
  const selected = forced ? pick(forced) : (keepRequested ? requested : undefined) || reservedImage || zeroMedia || best;
  if (!view.available || !model || !selected) {
    const reasonCode = !view.available ? 'catalog_unavailable' : !model ? 'unknown_model'
      : operations.length === 0 ? 'not_listed' : 'operation_incompatible';
    return { modelId: model?.id, layout: deriveSlotLayout(undefined, undefined, undefined), operationStates, operationMatches,
      slots: [], assigned: [], unused: [], blocked: [], ready: false, reasonCode,
      bindings: {}, records: [], effectiveFingerprint: buildUpstreamFingerprint({}), fingerprint: '', contractFingerprint: '' };
  }
  const { operation, layout, records, bindings, assigned, unused, effectiveFingerprint } = selected;
  const blocked = [...selected.blocked];
  const parameters = args.params ? projectParamsForOperation(model, operation, args.params) : undefined;
  let videoNormalization: NormalizedVideoParams | undefined;
  if (parameters) {
    const catalog = args.catalog;
    if (operation.output.type === 'video' && catalog?.source === 'omnimux'
      && !catalog.models?.find(row => row.id === model.id)?.effectiveVideoProjection) {
      videoNormalization = normalizeVideoParamsForSchema({ params: { ...parameters.params, model: model.id }, operationId: operation.id, catalog });
      for (const field of videoNormalization.blocked) blocked.push({ code: 'parameter_unsupported', message: field.message, meta: { field: field.field } });
    }
    const invalid = findDeclaredParameterFailure(videoNormalization?.params ?? parameters.params, operation.parameters, model.parameters);
    if (invalid) blocked.push({ code: 'parameter_unsupported', message: invalid.message, meta: { field: invalid.field } });
  }
  const slots = layout.slots.map(slot => ({ slot, assigned: selected.assignedBySlot.get(slot.slot) ?? [],
    unused: unused.filter(asset => asset.targetSlot === slot.slot || (!asset.targetSlot && asset.type === slot.type)),
    blocked: blocked.filter(issue => issue.slot === slot.slot) }));
  const contractFingerprint = assignmentFingerprint({ model: model.id, operation: operation.id, output: operation.output,
    inputs: operation.inputs, inputGroups: operation.inputGroups, parameters: mergeParameterSchema(model, operation),
    inputMaxByType: layout.inputMaxByType, routing: args.params?.routing,
  });
  const fingerprint = assignmentFingerprint({ contractFingerprint,
    params: { ...(videoNormalization?.params ?? parameters?.params ?? effectiveFingerprint.nodeFields), model: model.id },
    prompt: effectiveFingerprint.prompt, assigned: assigned.map(({ edgeId, sourceNodeId, outputId, type, targetSlot, role, textContent,
      documentText, mimeType, sizeBytes, durationSec }) => ({ edgeId, sourceNodeId, outputId, type, targetSlot, role, textContent,
      documentText, mimeType, sizeBytes, durationSec })),
  });
  return { modelId: model.id, operationId: operation.id, layout, operationStates, operationMatches, slots, assigned, unused, blocked,
    reasonCode: blocked[0]?.code, ready: blocked.length === 0, bindings, records, effectiveFingerprint,
    fingerprint, contractFingerprint, paramsProjection: parameters, videoNormalization };
}
