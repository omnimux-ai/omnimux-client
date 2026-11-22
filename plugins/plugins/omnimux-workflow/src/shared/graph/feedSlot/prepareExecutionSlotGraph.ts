import type { CapabilityCatalog } from '../../api.ts';
import { readCanvasParams } from '../canvasInputSources.ts';
import { resolveGenerationPrompt } from '../generationPrompt.ts';
import { readNodeInputSource } from '../nodeInputSource.ts';
import { resolveNodeKind } from '../materialNode.ts';
import { materialTools } from '../../specs/nodes/materialNodeSpec.ts';
import {
  buildContractView, buildUpstreamFingerprint, isMediaInputType, isVisualGeneration,
  readExplicitTargetSlot, resolveModelView, type UpstreamAssetFingerprint,
} from '../../validation/compatKernel.ts';
import { resolveInputAssignment, type InputAssignment } from '../../validation/inputAssignment.ts';
import { narrowCatalogByRouting, resolveEffectiveVideoGroup, resolveEffectiveVideoOperation } from '../../validation/lineConstraints.ts';
import { parseModelAndGroup } from '../../validation/channelRouting.ts';
import { managedVideoLineFingerprint } from '../../validation/managedVideoExecution.ts';
import { assetFromUpstreamSnapshot, readPreferredOperationId, type UpstreamMediaSnapshot } from '../../validation/operationUi.ts';
import type { CanvasNode } from '../canvasInputMutationGateway.ts';
import type { LegacySlotEdge } from './hydrateSlotBindings.ts';
import type { SlotBindings, SlotConflict } from './types.ts';
import { projectCanvasInputSources } from './legacyH3Slots.ts';
import { slotBindingConflicts } from './slotBindingConflicts.ts';
import { readVideoSlotDrafts, videoSlotDraftKey } from './videoSlotDrafts.ts';

export interface ExecutionSlotNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

type ExecutionSlotEdge = LegacySlotEdge & { target: string };

export interface ExecutionSlotGraphOptions {
  workspaceId?: string;
  resolvedInputs?: ReadonlyMap<string, UpstreamMediaSnapshot[]>;
  normalizeVideoParams?: boolean;
}

export interface RunInput {
  edgeId: string;
  sourceNodeId: string;
  outputId?: string;
  type: string;
  targetSlot?: string;
  role?: string;
  ordinal: number;
  /** Text composition keeps connection order across named slots and loose documents. */
  promptOrdinal?: number;
}

export interface ReadyRunInput extends RunInput {
  availability: 'ready';
  url?: string;
  textContent?: string;
  documentText?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSec?: number;
}

export interface RunSnapshot {
  readonly modelId: string;
  readonly operationId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly assigned: readonly ReadyRunInput[];
  readonly unusedEdgeIds: readonly string[];
  readonly fingerprint: string;
  readonly contractFingerprint: string;
  readonly capturedAt: number;
  readonly localText: string;
  /** These edges have assigned positions, but the scheduler still owes their output. */
  readonly deferred: readonly RunInput[];
  readonly blockingInput?: { reasonCode: string; message: string };
}

export type RunSnapshotProof = Pick<RunSnapshot, 'fingerprint' | 'contractFingerprint'>;

interface PreparedExecutionInputs {
  assignment: InputAssignment;
  snapshot?: RunSnapshot;
  documentFailure?: UpstreamAssetFingerprint;
  /** Admission checks the original intent; dispatch checks the version frozen for this run. */
  reviewedLine: unknown;
}

// Keep derived run state out of canvas JSON and the persisted execution graph.
const preparedInputs = Symbol('preparedExecutionInputs');

export function readPreparedExecutionInputs(data: Record<string, unknown> | undefined): PreparedExecutionInputs | undefined {
  return (data as { [preparedInputs]?: PreparedExecutionInputs } | undefined)?.[preparedInputs];
}

export function isCatalogGeneration(node: ExecutionSlotNode): boolean {
  const data = node.data ?? {};
  if (node.type !== 'material' || resolveNodeKind(data) !== 'generate') return false;
  const capabilityId = typeof data.outputCapabilityId === 'string' ? data.outputCapabilityId.trim() : '';
  return !capabilityId || !materialTools[capabilityId]?.executorKey;
}

export function resolveExecutionContract(data: Record<string, unknown>, sourceCatalog: CapabilityCatalog | null | undefined,
  params = readCanvasParams({ data }),
) {
  const outputType = typeof data.materialType === 'string' ? data.materialType : 'text';
  const model = params.model ?? sourceCatalog?.defaults?.[outputType as keyof NonNullable<CapabilityCatalog['defaults']>];
  const requestedModel = typeof model === 'string' ? model : undefined;
  const visual = isVisualGeneration(outputType);
  const modelId = visual ? parseModelAndGroup(requestedModel).modelId : requestedModel;
  const managed = outputType === 'video' ? resolveEffectiveVideoGroup(sourceCatalog, requestedModel, params.routing) : null;
  const variant = managed?.group ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
  const catalog = visual ? narrowCatalogByRouting(sourceCatalog, requestedModel, params.routing, params) : sourceCatalog;
  return { outputType, requestedModel, catalog, model: resolveModelView(buildContractView(catalog), modelId), managed, variant };
}

function edgeId(edge: ExecutionSlotEdge, ordinal: number): string {
  return edge.id ?? `feed-${edge.source}-${ordinal}`;
}

function executionCandidates(
  visible: UpstreamAssetFingerprint[], incoming: ExecutionSlotEdge[],
  byId: ReadonlyMap<string, ExecutionSlotNode>, options: ExecutionSlotGraphOptions,
): UpstreamAssetFingerprint[] {
  if (!options.workspaceId && !options.resolvedInputs) return visible;
  const byEdge = new Map(visible.map(asset => [asset.edgeId, asset]));
  return incoming.flatMap((edge, ordinal) => {
    const id = edgeId(edge, ordinal);
    const asset = byEdge.get(id);
    const resolved = options.resolvedInputs?.get(edge.source);
    const binding = edge.data?.slotBinding as { role?: string; mirror?: boolean } | undefined;
    const hints = {
      role: asset?.role ?? (typeof edge.data?.role === 'string' ? edge.data.role : binding?.mirror === true ? undefined : binding?.role),
      targetSlot: asset?.targetSlot ?? readExplicitTargetSlot(edge.data ?? {}, edge.targetHandle),
    };
    if (resolved?.length) return resolved.map(input => assetFromUpstreamSnapshot({ ...input, nodeId: edge.source, edgeId: id, ordinal, ...hints }));
    const node = byId.get(edge.source);
    if (!asset) return options.resolvedInputs ? [{ edgeId: id, ordinal, sourceNodeId: edge.source, ...hints,
      type: String(edge.data?.feedType ?? 'text'), availability: 'waiting' as const }] : [];
    if (!node || !options.workspaceId || !isMediaInputType(asset.type)) return [asset];
    const source = readNodeInputSource(node, options.workspaceId);
    return [{ ...asset, ...source.metadata, availability: source.availability, availabilityMessage: source.message,
      outputId: source.outputId, url: source.output.mediaAssets?.[0]?.url,
    }];
  });
}

function keepLegacyPendingRules(assignment: InputAssignment): InputAssignment {
  const blocked = assignment.blocked.flatMap(issue => {
    if (issue.code !== 'input_waiting' && issue.code !== 'input_unavailable') return [issue];
    const record = assignment.records.find(item => item.occupant.edgeId === issue.meta?.edgeId
      && item.occupant.sourceNodeId === issue.meta?.sourceNodeId && (item.state === 'pending' || item.state === 'invalid'));
    if (!record || !isMediaInputType(record.slot.type) || record.slot.type === 'document') return [issue];
    const readyCount = assignment.assigned.filter(asset => asset.targetSlot === record.slot.slot).length;
    if (readyCount >= record.slot.min) return [];
    return [{ ...issue, code: 'input_unavailable' as const, slot: record.slot.slot }];
  });
  return { ...assignment, blocked, ready: blocked.length === 0, reasonCode: blocked[0]?.code };
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareExecutionSlotGraph<N extends ExecutionSlotNode, E extends ExecutionSlotEdge>(
  nodes: N[], edges: E[], sourceCatalog: CapabilityCatalog | null | undefined,
  scheduledNodeIds?: ReadonlySet<string>, options: ExecutionSlotGraphOptions = {},
): { nodes: N[]; edges: E[]; runSnapshots: ReadonlyMap<string, RunSnapshot> } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ordinalByTarget = new Map<string, number>();
  let nextEdges = edges.map((edge) => {
    const ordinal = ordinalByTarget.get(edge.target) ?? 0;
    ordinalByTarget.set(edge.target, ordinal + 1);
    const source = byId.get(edge.source);
    return { ...structuredClone(edge), id: edgeId(edge, ordinal), data: {
      ...structuredClone(edge.data), feedType: source ? readNodeInputSource(source).materialType : edge.data?.feedType,
    } };
  }) as E[];
  const runSnapshots = new Map<string, RunSnapshot>();
  const nextNodes = nodes.map((node) => {
    if (!isCatalogGeneration(node)) return structuredClone(node);
    const rawData = structuredClone(node.data ?? {});
    let params = readCanvasParams({ data: rawData });
    const { outputType, requestedModel, catalog, model, managed, variant } = resolveExecutionContract(rawData, sourceCatalog, params);
    const inline = isVisualGeneration(outputType) && parseModelAndGroup(requestedModel).group;
    const modelForParams = inline ? requestedModel : model?.id ?? requestedModel;
    if (variant) params = { ...params, operation: variant.id };
    const projected = projectCanvasInputSources(node.id, { ...rawData, params }, nodes as unknown as CanvasNode[], nextEdges, catalog, model);
    nextEdges = projected.edges;
    const data = projected.data;
    const incoming = nextEdges.filter(edge => edge.target === node.id);
    const rawAssets = executionCandidates(projected.fingerprint.assets, incoming, byId, options);
    const localText = projected.fingerprint.localText ?? resolveGenerationPrompt(data);
    const standby = (data.slotStandbyEdgeIds ?? []) as string[];
    const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null ? data.autoOperationId : undefined;
    const draftKey = videoSlotDraftKey(variant);
    const drafts = readVideoSlotDrafts(data.videoSlotDrafts);
    const slotBindings = draftKey && Object.hasOwn(drafts, draftKey) ? drafts[draftKey] : data.slotBindings as SlotBindings | undefined;
    const slotConflicts = data.slotConflicts as SlotConflict[] | undefined;
    const inputBindingVersion = data.inputBindingVersion === 1 ? 1 : undefined;
    const resolverArgs = { catalog, modelId: model?.id ?? requestedModel, outputType, ignoredEdgeIds: standby,
      preferredOperationId: readPreferredOperationId(params, autoOperationId), autoOperationId,
      slotBindings, slotConflicts, inputBindingVersion };
    const assign = (assets: UpstreamAssetFingerprint[], fields: Record<string, unknown>, forceOperationId?: string) => resolveInputAssignment({
      ...resolverArgs, params: { ...fields, ...(model ? { model: model.id } : {}) }, forceOperationId,
      fingerprint: buildUpstreamFingerprint({ prompt: localText, localText, assets, nodeFields: fields }),
    });
    const visible = assign(rawAssets, params, variant?.id);
    const visibleEdges = new Set(visible.effectiveFingerprint.assets.map(asset => asset.edgeId));
    const plannedEdges = new Set<string>();
    const assets = rawAssets.map(asset => {
      const source = byId.get(asset.sourceNodeId);
      if (!asset.edgeId || source?.type !== 'material' || !scheduledNodeIds?.has(source.id)
        || resolveNodeKind(source.data ?? {}) !== 'generate') return asset;
      const freeText = (asset.type === 'text' || asset.type === 'table') && visible.layout.acceptsText
        && !visible.layout.slots.some(slot => slot.type === 'text' && slot.composition);
      // A dependency that already has an output still has to qualify for consumption.
      // Pending dependencies may supply unfilled requirements in this run.
      if (!visibleEdges.has(asset.edgeId) && (asset.availability === 'ready' || visible.ready && !freeText)) return asset;
      plannedEdges.add(asset.edgeId);
      const { outputId, mimeType, declaredExtension, sizeBytes, durationSec, url, textContent, documentText, ...planned } = asset;
      return { ...planned, availability: 'ready' as const,
        ...(isMediaInputType(asset.type) ? { url: 'scheduled:pending' } : { textContent: '\ufffc' }) };
    });
    const planned = plannedEdges.size ? assign(assets, params, variant?.id ?? (visible.ready ? visible.operationId : undefined)) : visible;
    const assignment = inputBindingVersion || managed ? planned : keepLegacyPendingRules(planned);
    if (options.normalizeVideoParams !== false) {
      if (!managed && outputType === 'video') params = assignment.videoNormalization?.params ?? assignment.paramsProjection?.params ?? params;
      params = { ...params, ...(modelForParams ? { model: modelForParams } : {}),
        ...(assignment.operationId ? { operation: assignment.operationId } : {}) };
      // The allocator projects and normalizes video parameters against this operation.
      // Managed groups retain only a whole variant previously admitted by their line.
    }
    data.params = params;
    if (!inputBindingVersion || managed) {
      const conflicts = slotBindingConflicts(assignment.layout, slotBindings ?? {}, rawAssets.map((asset, ordinal) => ({
        ...asset, edgeId: asset.edgeId ?? `feed-${asset.sourceNodeId}-${ordinal}`,
        ordinal: asset.ordinal ?? ordinal, availability: asset.availability ?? 'waiting',
      })));
      const existing = slotConflicts ?? [];
      data.slotBindings = assignment.bindings;
      data.slotConflicts = [...existing, ...conflicts.filter(conflict => conflict.occupant.pinned && !existing.some(item =>
        item.slot === conflict.slot && item.occupant.edgeId === conflict.occupant.edgeId))];
    }
    const reviewedLine = data.managedVideoGeneration;
    if (managed) {
      data.managedVideoGeneration = managed.group ? managedVideoLineFingerprint(managed.group, managed.model.effectiveVideoVersion) : true;
      data.inputBindingVersion = 1;
    }
    const used = new Set<string>();
    const assigned: ReadyRunInput[] = [];
    const deferred: RunInput[] = [];
    for (const [ordinal, asset] of assignment.assigned.entries()) {
      if (!asset.edgeId || asset.availability && asset.availability !== 'ready') continue;
      const identity = { edgeId: asset.edgeId, sourceNodeId: asset.sourceNodeId, type: asset.type,
        role: asset.role, targetSlot: asset.targetSlot, ordinal,
        ...(!isMediaInputType(asset.type) || asset.type === 'document' ? { promptOrdinal: asset.ordinal } : {}) };
      used.add(asset.edgeId);
      if (plannedEdges.has(asset.edgeId)) deferred.push(identity);
      else assigned.push({ ...identity, availability: 'ready', outputId: asset.outputId,
        url: asset.url, textContent: asset.textContent, documentText: asset.documentText,
        mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, durationSec: asset.durationSec });
    }
    const documentFailure = assignment.layout.acceptsDocuments && !assignment.layout.requireBoundDocuments
      ? rawAssets.find(asset => asset.type === 'document' && asset.availability && asset.availability !== 'ready'
        && !standby.includes(asset.edgeId ?? '')) : undefined;
    const issue = assignment.blocked[0];
    const blockingInput = documentFailure ? {
      reasonCode: documentFailure.availability === 'waiting' ? 'input_waiting' : 'input_unavailable',
      message: documentFailure.availabilityMessage ?? 'JSON 文件不可用，请修复或移除该输入',
    } : issue && { reasonCode: issue.code, message: issue.message ?? '当前输入尚不满足生成要求' };
    const snapshot = assignment.modelId && assignment.operationId ? freezeJson<RunSnapshot>({
      modelId: assignment.modelId, operationId: assignment.operationId, params: structuredClone(params),
      assigned, deferred, unusedEdgeIds: incoming.map(edgeId).filter(id => !used.has(id)),
      fingerprint: assignment.fingerprint, contractFingerprint: assignment.contractFingerprint,
      capturedAt: Date.now(), localText: assignment.effectiveFingerprint.localText ?? '',
      ...(blockingInput ? { blockingInput } : {}),
    }) : undefined;
    if (snapshot) runSnapshots.set(node.id, snapshot);
    Object.defineProperty(data, preparedInputs, { value: { assignment, snapshot, documentFailure, reviewedLine } });
    return { ...node, data };
  });
  return { nodes: nextNodes, edges: nextEdges, runSnapshots };
}
