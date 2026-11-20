/**
 * Image generation mode is derived, not chosen.
 *
 * A picture node exposes one optional reference well. The operation submitted
 * for the current input is the model's `text_to_image` when no reference is
 * consumed, otherwise the listed operation that consumes reference images
 * (`image_to_image` / `multi_reference`, as published by the gateway).
 *
 * The compatibility kernel already owns the hard rules (reference capacity,
 * required media, MIME and parameter contracts); this module only supplies the
 * model-level display layout and a single entry point so UI, picker, mutation
 * and execution all derive from the same result.
 */

import type { CapabilityCatalog } from '../../api.ts';
import type { SlotLayout } from './types.ts';
import {
  bindableSlots,
  buildContractView,
  isMediaInputType,
  resolveModelView,
  type ContractModelView,
  type ContractOperationView,
} from '../../validation/compatKernel.ts';
import { buildInputCapability, type InputCapabilityResult } from '../../validation/inputCapability.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import type { UpstreamFingerprint } from '../../validation/compatKernel.ts';

function listedImageOperations(model: ContractModelView): ContractOperationView[] {
  return model.operations.filter((operation) => operation.listed && operation.output.type === 'image');
}

function hasImageInput(operation: ContractOperationView): boolean {
  return bindableSlots(operation).some((slot) => slot.type === 'image');
}

/** Operations such as inpaint need a mask, so they are not a plain reference fallback. */
function hasOtherRequiredMedia(operation: ContractOperationView): boolean {
  return bindableSlots(operation).some((slot) =>
    isMediaInputType(slot.type) && slot.type !== 'image' && slot.min > 0);
}

function imageCapacity(operation: ContractOperationView): number {
  const slots = bindableSlots(operation).filter((slot) => slot.type === 'image');
  if (slots.some((slot) => slot.max === null)) return Number.POSITIVE_INFINITY;
  return slots.reduce((sum, slot) => sum + (slot.max ?? 0), 0);
}

function chooseReferenceOperation(operations: ContractOperationView[]): ContractOperationView | undefined {
  const candidates = operations.filter((operation) => hasImageInput(operation) && !hasOtherRequiredMedia(operation));
  if (candidates.length === 0) return undefined;
  const rank = (operation: ContractOperationView): number => {
    const capacity = imageCapacity(operation);
    return capacity === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : capacity;
  };
  const priority = (operation: ContractOperationView): number =>
    operation.id === 'multi_reference' ? 0 : operation.id === 'image_to_image' ? 1 : 2;
  return [...candidates].sort((left, right) => rank(right) - rank(left) || priority(left) - priority(right))[0];
}

function chooseTextOperation(operations: ContractOperationView[]): ContractOperationView | undefined {
  return operations.find((operation) => operation.id === 'text_to_image')
    ?? operations.find((operation) => !bindableSlots(operation).some((slot) => isMediaInputType(slot.type)));
}

/**
 * Model-level material layout for an image generation node.
 *
 * The reference operation supplies the well shape even when the saved operation
 * is still `text_to_image`; when the model also supports pure text generation,
 * reference wells are optional in the display so an empty node can submit.
 * `displayOnlyFromOperation` records the operation that must be selected once
 * one of those wells is filled.
 */
export function deriveImageGenerationLayout(
  catalog: CapabilityCatalog | null | undefined,
  modelId: string | undefined,
  currentOperationId?: string,
): SlotLayout | undefined {
  const model = resolveModelView(buildContractView(catalog), modelId);
  if (!model) return undefined;
  const operations = listedImageOperations(model);
  if (operations.length === 0) return undefined;

  const textOperation = chooseTextOperation(operations);
  const referenceOperation = chooseReferenceOperation(operations);
  const layoutOperation = referenceOperation ?? textOperation;
  if (!layoutOperation) return undefined;

  const layout = deriveSlotLayout(catalog, modelId, layoutOperation.id, { outputType: 'image' });
  if (layout.preset === 'none' && layout.slots.length === 0 && !textOperation) return undefined;

  const current = typeof currentOperationId === 'string'
    && operations.some((operation) => operation.id === currentOperationId)
    ? currentOperationId
    : (textOperation?.id ?? referenceOperation?.id ?? '');
  const slots = textOperation && referenceOperation
    ? layout.slots.map((slot) => slot.type === 'text' ? slot : { ...slot, min: 0 })
    : layout.slots;

  return {
    ...layout,
    operationId: current,
    slots,
    ...(textOperation && referenceOperation && current !== referenceOperation.id
      ? { displayOnlyFromOperation: referenceOperation.id }
      : {}),
  };
}


/**
 * Pure operation choice for a known number of consumed reference images.
 * Used by picker/mutation paths that have not materialised a full upstream
 * fingerprint yet; execution paths should prefer buildImageGenerationCapability.
 */
export function resolveImageOperationForReferenceCount(
  catalog: CapabilityCatalog | null | undefined,
  modelId: string | undefined,
  referenceCount: number,
): string | undefined {
  const model = resolveModelView(buildContractView(catalog), modelId);
  if (!model) return undefined;
  const operations = listedImageOperations(model);
  if (operations.length === 0) return undefined;
  const textOperation = chooseTextOperation(operations);
  if (!Number.isFinite(referenceCount) || referenceCount <= 0) return textOperation?.id;
  const candidates = operations
    .filter((operation) => hasImageInput(operation) && !hasOtherRequiredMedia(operation))
    .filter((operation) => {
      const imageSlots = bindableSlots(operation).filter((slot) => slot.type === 'image');
      if (imageSlots.some((slot) => slot.max !== null && slot.max < 1)) return false;
      return imageCapacity(operation) >= referenceCount;
    });
  if (candidates.length === 0) return undefined;
  if (referenceCount === 1) {
    const exact = candidates.find((operation) => operation.id === 'image_to_image');
    if (exact) return exact.id;
  }
  return [...candidates].sort((left, right) => {
    const capacityDiff = imageCapacity(left) - imageCapacity(right);
    if (capacityDiff !== 0) return capacityDiff;
    const leftPriority = left.id === 'multi_reference' ? 0 : left.id === 'image_to_image' ? 1 : 2;
    const rightPriority = right.id === 'multi_reference' ? 0 : right.id === 'image_to_image' ? 1 : 2;
    return leftPriority - rightPriority;
  })[0]?.id;
}

export function buildImageGenerationCapability(args: {
  catalog: CapabilityCatalog | null | undefined;
  modelId: string | undefined;
  fingerprint: UpstreamFingerprint;
  ignoredEdgeIds?: readonly string[];
}): InputCapabilityResult {
  return buildInputCapability({
    catalog: args.catalog,
    modelId: args.modelId,
    outputType: 'image',
    fingerprint: args.fingerprint,
    ...(args.ignoredEdgeIds ? { ignoredEdgeIds: args.ignoredEdgeIds } : {}),
  });
}

/** The single operation a picture node should submit for the current inputs. */
export function resolveImageGenerationOperation(args: {
  catalog: CapabilityCatalog | null | undefined;
  modelId: string | undefined;
  fingerprint: UpstreamFingerprint;
  ignoredEdgeIds?: readonly string[];
}): string | undefined {
  return buildImageGenerationCapability(args).selectedOperationId;
}
