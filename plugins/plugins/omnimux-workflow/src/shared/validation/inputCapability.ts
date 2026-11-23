/** Compatibility projection of the canvas assignment. */
import type { CapabilityCatalog } from '../api.ts';
import { buildContractView, resolveModelView, type UpstreamFingerprint } from './compatKernel.ts';
import { resolveInputAssignment, type InputAssignmentArgs } from './inputAssignment.ts';
export { projectParamsForOperation, inputCapabilityParameterSchema } from './inputAssignment.ts';

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
  /** The user can choose this mode before attaching its inputs. Readiness still checks the chosen slots. */
  selectableBeforeInputs?: boolean;
  /** R3 ordering: distinct source outputs actually assigned across all slots. */
  potentialHits: number;
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
   * Current operation (or the last explicit user choice). A user-picked
   * video operation remains selected while the catalog lists it.
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

export function buildInputCapability(args: InputAssignmentArgs): InputCapabilityResult {
  const assignment = resolveInputAssignment(args);
  const unavailable = assignment.reasonCode === 'catalog_unavailable' || assignment.reasonCode === 'unknown_model'
    || assignment.reasonCode === 'not_listed' ? assignment.reasonCode : 'operation_incompatible';
  return {
    modelId: assignment.modelId,
    operationStates: assignment.operationStates,
    selectedOperationId: assignment.operationId,
    paramsProjection: assignment.paramsProjection,
    blocked: !assignment.operationId,
    ...(!assignment.operationId ? { reasonCode: unavailable } : {}),
    hasMedia: assignment.assigned.some(item => item.type === 'image' || item.type === 'video' || item.type === 'audio'),
  };
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
