/**
 * ResourcePicker 纯策略：列出画布资源、过滤、MIME 映射、提交计划。
 * 无 React 依赖，供 node:test 直接断言。
 *
 * 提交计划必须只包含 gateway 能一次放行的 mutation（全有或全无），
 * 因此非法连线 / 已连接节点在此预筛，避免整批被拒。
 */

import type { Edge } from '@xyflow/react';
import type { MaterialType } from '../../types/materialNode.ts';
import { createImportNode } from '../../../shared/graph/nodeFactory.ts';
import { isNodeConnectionValid } from '../../../shared/graph/connectionConfig.ts';
import { validateCanvasConnectionStructure } from '../../../shared/graph/canvasConnectionStructure.ts';
import { resolveNodeKind } from '../../../shared/graph/materialNode.ts';
import { planCanvasInputMutation, planCanvasInputSelection, validateCanvasInputSelection } from '../../../shared/graph/canvasInputMutationGateway.ts';
import { readNodeInputSource, type NodeInputSource } from '../../../shared/graph/nodeInputSource.ts';
import { deriveSlotLayout } from '../../../shared/graph/feedSlot/deriveSlotLayout.ts';
import { deriveImageGenerationLayout } from '../../../shared/graph/feedSlot/imageGeneration.ts';
import { resolveSlotOperation } from '../../../shared/graph/feedSlot/resolveSlotOperation.ts';
import { acceptsFeedAsset } from '../../../shared/graph/feedSlot/autoFillSlots.ts';
import { resolveSlotOccupantOrdinal, type SlotSelection } from '../../../shared/graph/feedSlot/assembleEffectiveInputs.ts';
import { effectiveInputDisplay } from '../../../shared/graph/feedSlot/effectiveInputDisplay.ts';
import { feedFromFingerprint } from '../../../shared/graph/feedSlot/effectiveFingerprint.ts';
import { projectVideoSlotBindings, readVideoOperationDraft, readVideoSlotDrafts, videoSlotDraftKey } from '../../../shared/graph/feedSlot/videoSlotDrafts.ts';
import { buildCanvasUpstreamFingerprint, readCanvasParams } from '../../../shared/graph/canvasInputSources.ts';
import { narrowCatalogByRouting, resolveEffectiveVideoGroup, resolveEffectiveVideoOperation } from '../../../shared/validation/lineConstraints.ts';
import { buildContractView, canonicalJson, isMediaInputType, isOrderedImageReferenceSlot, resolveModelView, type UpstreamAssetFingerprint } from '../../../shared/validation/compatKernel.ts';
import { projectCanvasInputSources } from '../../../shared/graph/feedSlot/legacyH3Slots.ts';
import { readPreferredOperationId } from '../../../shared/validation/operationUi.ts';
import { parseModelAndGroup } from '../../../shared/validation/channelRouting.ts';
import { readVisualLineSelection } from '../../../shared/validation/executionReadiness.ts';
import { resolveInputAssignment } from '../../../shared/validation/inputAssignment.ts';
import { captureSlotIntent, readSlotIntent, validateSlotIntent, type SlotIntent, type SlotIntentState, type SlotIntentTarget } from '../../../shared/validation/slotIntent.ts';
import type {
  CanvasInputSelectionRequest,
  CanvasInputSelectionVerdict,
  CanvasMutationRuntimeContext,
  CanvasInputMutationState,
  CanvasInputMutation,
  CanvasInputNodePatch,
  CanvasNode,
} from '../../../shared/graph/canvasInputMutationGateway.ts';
import type { SlotBindings, SlotConflict, SlotOccupant, SlotSpec } from '../../../shared/graph/feedSlot/index.ts';
import { resolveMediaPreviewUrl, type MediaAssetLike } from './mediaUrl.ts';
import { buildImportedMediaData, extensionOf, looksAbsolutePath, materialTypeFromFilename, mimeFromFilename, projectFileMediaUrl } from '../../../shared/localMedia.ts';
import { buildMediaMetadata } from '../../../shared/mediaMetadata.ts';
import { forbiddenRelativePathCode } from '../../../shared/projectAssets.ts';
import { getDefaultNodeHeight, getDefaultNodeWidth } from './nodeSizeConfig.ts';
import type {
  NodeSlotEngineState,
  SlotBindingItem,
  OverflowAssetItem,
} from '../../../shared/graph/slotContractTypes.ts';
import { promoteOverflowAsset } from '../../../shared/graph/slotEngine.ts';
import { normalizeCanvasEdge } from '../../../shared/graph/canvasConnectionUtils.ts';

export type ResourceTypeFilter = 'all' | 'text' | 'image' | 'video' | 'audio' | 'document';
export type ResourcePickerTab = 'canvas' | 'local';
export type ResourcePickerView = 'grid' | 'list';
export type ResourcePickerMode = 'add' | 'replace';

const MEDIA_TYPES: readonly MaterialType[] = ['image', 'video', 'audio'];
const IMPORTABLE_TYPES: readonly MaterialType[] = ['image', 'video', 'audio', 'document'];
const UPSTREAM_GAP_X = 80;
const UPSTREAM_STACK_Y = 40;
const IMPORT_STACK_Y = 40;

export interface CanvasResourceItem {
  nodeId: string;
  outputId?: string;
  textContent?: string;
  inUse?: boolean;
  selectable?: boolean;
  reasonCode?: string;
  materialType: MaterialType;
  title: string;
  titleKey?: string;
  previewUrl?: string;
  alreadyConnected: boolean;
  subtitle: string;
  width?: number;
  height?: number;
}

export function pickerCandidateAvailability(item: Pick<CanvasResourceItem, 'inUse' | 'alreadyConnected' | 'selectable'>,
  mode: ResourcePickerMode, allowConnectedSelection: boolean): { isAssigned: boolean; disabled: boolean } {
  const isAssigned = item.inUse === true || (mode === 'add' && item.alreadyConnected && !allowConnectedSelection);
  return { isAssigned, disabled: isAssigned || item.selectable === false };
}

/** Source-selection intent: a cancelled file choice leaves the current selection intact. */
export function updatePickerLocalDrafts(mode: ResourcePickerMode, selectedIds: string[], localFiles: LocalFileDraft[], incoming: LocalFileDraft[]) {
  if (!incoming.length) return { selectedIds, localFiles };
  return mode === 'replace' ? { selectedIds: [], localFiles: [incoming[incoming.length - 1]!] }
    : { selectedIds, localFiles: [...localFiles, ...incoming] };
}

export interface LocalFileDraft {
  id: string;
  name: string;
  mime: string;
  size: number;
  durationSec?: number | null;
  realPath: string;
  materialType: MaterialType;
  documentText?: string;
  /** Transient picker-only metadata. */
  previewUrl?: string;
  fileRevision?: string;
}

/** Project assets carry their owning workspace; they never become native disk paths. */
export interface ProjectFileDraft extends Omit<LocalFileDraft, 'realPath' | 'size'> {
  relativePath: string;
  workspaceId: string;
  assetId?: string;
  size: number | null;
  durationSec?: number | null;
}

export type ImportFileDraft = LocalFileDraft | ProjectFileDraft;

export interface ResourcePickerCommitInput {
  nodes: CanvasNode[];
  edges: Edge[];
  catalog?: CanvasMutationRuntimeContext['catalog'];
  targetNodeId: string;
  selectedCanvasNodeIds: string[];
  localFiles: LocalFileDraft[];
  /** T03：装填目标 slot；选中后 pinned 进该槽位而非仅连线。 */
  targetSlot?: string;
  /** Replace this occupant in the current named slot, never an index from a stale view. */
  replaceEdgeId?: string;
  /** 目标 slot 接受的素材类型；不匹配的选中项按 unsupported 预筛。 */
  acceptedTypes?: readonly string[];
  /** 目标 slot 上限（max 1 → 替换；null → 官方未公布上限，追加）。 */
  slotMax?: number | null;
  mode?: 'add' | 'replace';
  targetSlotIndex?: number;
  slotState?: NodeSlotEngineState;
}

export interface ResourcePickerReplaceCommitInput {
  nodes: CanvasNode[];
  edges: Edge[];
  targetNodeId: string;
  targetSlotIndex: number;
  slotState?: NodeSlotEngineState;
  selectedCanvasNodeId?: string;
  localFile?: LocalFileDraft;
}

/**
 * 防重锁判定纯函数：
 * - 如果 item.nodeId 已经被当前节点的某个活跃卡槽占用：
 *   - 若 mode === 'replace' 且正是当前正在被替换的槽位（slotIndex === targetSlotIndex）：标为 isCurrentSlot: true，显示「当前使用中」，置灰不可重选。
 *   - 若被其他槽位占用：标为 isAssigned: true，显示「✓ 已添加」，覆盖半透明遮罩，置灰禁用不可点击。
 * - 如果在当前节点的溢出候选池中：标为可选，显示标签「候选池中」。
 * - 画布上其他未连线节点与本地上传：正常可选。
 */
export function evaluateResourcePickerAvailability(args: {
  item: { nodeId: string; mediaUrl?: string };
  mode: 'add' | 'replace';
  targetSlotIndex?: number;
  slotState?: NodeSlotEngineState;
}): { isAssigned: boolean; isCurrentSlot: boolean; disabled: boolean; badgeLabel?: string } {
  const { item, mode, targetSlotIndex, slotState } = args;

  if (!slotState) {
    return {
      isAssigned: false,
      isCurrentSlot: false,
      disabled: false,
    };
  }

  const activeSlot = slotState.activeSlots.find((s) => s.sourceNodeId === item.nodeId);
  if (activeSlot) {
    if (mode === 'replace' && typeof targetSlotIndex === 'number' && activeSlot.slotIndex === targetSlotIndex) {
      return {
        isAssigned: false,
        isCurrentSlot: true,
        disabled: true,
        badgeLabel: '当前使用中',
      };
    }
    return {
      isAssigned: true,
      isCurrentSlot: false,
      disabled: true,
      badgeLabel: '✓ 已添加',
    };
  }

  const inOverflow = slotState.overflowPool.some((o) => o.sourceNodeId === item.nodeId);
  if (inOverflow) {
    return {
      isAssigned: false,
      isCurrentSlot: false,
      disabled: false,
      badgeLabel: '候选池中',
    };
  }

  return {
    isAssigned: false,
    isCurrentSlot: false,
    disabled: false,
  };
}

export interface ResourcePickerRejection {
  id: string;
  reason: 'already_connected' | 'self' | 'missing' | 'type_contract' | 'unsupported' | 'slot_capacity';
}

export interface ResourcePickerCommitPlan extends CanvasInputMutation {
  hasWork: boolean;
  rejected: ResourcePickerRejection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function nodeData(node: CanvasNode): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {};
}

function asMaterialType(value: unknown): MaterialType | null {
  if (value === 'text' || value === 'image' || value === 'video' || value === 'audio' || value === 'document') {
    return value;
  }
  return null;
}

export function mimeToMaterialType(mime: string, filename = ''): MaterialType | null {
  const type = materialTypeFromFilename(filename, mime);
  return type && MEDIA_TYPES.includes(type) ? type : null;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dimensionPair(data: Record<string, unknown>): { width?: number; height?: number } {
  const dims = data.dimensions;
  if (isRecord(dims) && typeof dims.width === 'number' && typeof dims.height === 'number') {
    return { width: dims.width, height: dims.height };
  }
  const width = typeof data.nodeWidth === 'number' ? data.nodeWidth : undefined;
  const height = typeof data.nodeHeight === 'number' ? data.nodeHeight : undefined;
  return { width, height };
}

function resourceTitle(data: Record<string, unknown>, nodeId: string): string {
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (label) return label;
  const content = typeof data.content === 'string' ? data.content.trim() : '';
  if (content) return content;
  return nodeId;
}

function resourceSubtitle(
  data: Record<string, unknown>,
  title: string,
  nodeId: string,
  size?: { width?: number; height?: number },
): string {
  const parts: string[] = [];
  if (size?.width && size?.height) {
    parts.push(`${Math.round(size.width)} × ${Math.round(size.height)}`);
  }
  if (title && title !== nodeId) parts.push(nodeId);
  return parts.join(' · ');
}

function incomingSourceIds(edges: Edge[], targetNodeId: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.target === targetNodeId && edge.source) ids.add(edge.source);
  }
  return ids;
}

function hasListableMedia(materialType: MaterialType, data: Record<string, unknown>): boolean {
  if (materialType === 'document') {
    return Boolean(data.mediaUrl || data.relativePath || data.realPath)
      && (data.status === 'ready' || data.status === 'completed' || data.status === undefined);
  }
  if (!MEDIA_TYPES.includes(materialType)) return false;
  const preview = resolveMediaPreviewUrl(
    materialType,
    data.mediaAssets as MediaAssetLike[] | undefined,
    typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
  );
  if (preview) return true;
  const status = data.status;
  return status === 'ready' || status === 'completed';
}

/** PM display projection of this current output; never persisted as source metadata. */
export function canvasResourceDisplayName(node: CanvasNode, source = readNodeInputSource(node)): { title: string; titleKey?: string } {
  const data = nodeData(node);
  const currentAsset = Array.isArray(data.mediaAssets)
    ? data.mediaAssets.find(asset => isRecord(asset) && asset.type === source.materialType) as Record<string, unknown> | undefined : undefined;
  const nodeOwnsCurrent = !currentAsset || Boolean(currentAsset.url && currentAsset.url === data.mediaUrl)
    || Boolean(currentAsset.assetId && currentAsset.assetId === data.assetId)
    || Boolean(currentAsset.relativePath && currentAsset.relativePath === data.relativePath)
    || Boolean(currentAsset.path && currentAsset.path === data.realPath);
  const identities = new Set([node.id, source.outputId, data.assetId, data.taskId, currentAsset?.assetId, currentAsset?.outputId]);
  const candidates = [data.label, currentAsset?.title, nodeOwnsCurrent ? data.title : undefined,
    currentAsset?.originalName, nodeOwnsCurrent ? data.originalName : undefined,
    currentAsset?.name, nodeOwnsCurrent ? data.name : undefined];
  const title = candidates.find(value => typeof value === 'string' && value.trim() && !identities.has(value.trim())
    && !/^(?:[a-z][a-z\d+.-]*:\/\/|data:|blob:|\/|[a-z]:[\\/])/i.test(value.trim())) as string | undefined;
  if (title) return { title: title.trim() };
  if (source.materialType === 'text' && source.output.text?.trim()) return { title: source.output.text.trim() };
  return { title: '', titleKey: source.materialType === 'text' ? 'node.type.text' : `panel.slot.${source.materialType}` };
}

function managedPickerGroup(target: CanvasNode | undefined, context: CanvasMutationRuntimeContext, params = target ? readCanvasParams(target) : {}) {
  return target?.data.materialType === 'video' ? resolveEffectiveVideoGroup(context.catalog, params.model, params.routing) : null;
}

export function usesQualifiedResourcePicker(target: CanvasNode | undefined, context: CanvasMutationRuntimeContext): boolean {
  return target?.data.inputBindingVersion === 1 || Boolean(managedPickerGroup(target, context));
}

/** Current operation candidates are projections of the same strict selection planner. */
function resourcePickerLayout({ nodes, edges }: CanvasInputMutationState, targetNodeId: string, context: CanvasMutationRuntimeContext) {
  const target = nodes.find(node => node.id === targetNodeId);
  const params = target ? readCanvasParams(target) : {};
  const explicitOperation = typeof params.operation === 'string' ? params.operation : '';
  const managed = managedPickerGroup(target, context, params);
  const variant = managed ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
  const qualified = Boolean(managed || target?.data.inputBindingVersion === 1);
  const catalog = narrowCatalogByRouting(context.catalog, params.model, params.routing, params);
  const model = typeof params.model === 'string' ? params.model : undefined;
  let operation = managed && !variant ? '' : explicitOperation;
  if (!qualified && !operation) {
    operation = resolveSlotOperation(catalog, model, undefined,
      String(target?.data.materialType ?? ''), buildCanvasUpstreamFingerprint(targetNodeId, nodes, edges)) ?? '';
  }
  const layout = target?.data.materialType === 'image'
    ? (deriveImageGenerationLayout(catalog, model, operation) ?? deriveSlotLayout(catalog, model, operation))
    : deriveSlotLayout(catalog, model, operation);
  return { target, layout, qualified, managed, variant };
}

function acceptsPickerSource(spec: SlotSpec, source: NodeInputSource): boolean {
  const media = source.output.mediaAssets?.[0];
  const mimeType = source.metadata?.mimeType ?? mimeFromFilename(media?.path ?? media?.relativePath ?? media?.url?.split(/[?#]/, 1)[0] ?? '');
  return source.availability === 'ready' && (!spec.allowedMimes?.length || Boolean(mimeType))
    && acceptsFeedAsset(spec, { ...source.metadata, type: source.materialType, mimeType });
}

export function acceptsPickerFile(spec: SlotSpec, file: ImportFileDraft): boolean {
  const mimeType = file.mime || mimeFromFilename(file.name);
  return (!spec.allowedMimes?.length || Boolean(mimeType))
    && acceptsFeedAsset(spec, { type: file.materialType, mimeType, sizeBytes: file.size ?? undefined, durationSec: file.durationSec ?? undefined });
}

function resourcePickerInputs(state: CanvasInputMutationState, targetNodeId: string, context: CanvasMutationRuntimeContext) {
  const { target, layout, qualified, managed, variant } = resourcePickerLayout(state, targetNodeId, context);
  if (!target) return undefined;
  const version = qualified ? 1 : undefined;
  const feed = feedFromFingerprint(buildCanvasUpstreamFingerprint(targetNodeId, state.nodes, state.edges), version);
  const bindings = managed ? projectVideoSlotBindings(layout, feed, readVideoOperationDraft(target.data, variant))
    : target.data.slotBindings as SlotBindings | undefined;
  const savedConflicts = managed ? [] : target.data.slotConflicts as SlotConflict[] | undefined;
  const display = effectiveInputDisplay(layout, feed, bindings, savedConflicts, state.edges.filter(edge => edge.target === targetNodeId),
    target.data.slotStandbyEdgeIds as string[] | undefined, version);
  return { target, layout, display, qualified, managed, variant };
}

function occupiesPickerSlot(record: SlotSelection): boolean {
  return record.state === 'ready' || record.state === 'pending' || record.reasonCode === 'input_unavailable';
}

export function resourcePickerSlot(state: CanvasInputMutationState, targetNodeId: string, context: CanvasMutationRuntimeContext,
  slot: string, replaceEdgeId?: string) {
  const inputs = resourcePickerInputs(state, targetNodeId, context);
  const spec = inputs?.layout.slots.find(candidate => candidate.slot === slot);
  if (!inputs || !spec) return undefined;
  const max = spec.type === 'text' && spec.composition ? Infinity : spec.max ?? Infinity;
  const occupants = inputs.display.bindings[slot] ?? [];
  const count = inputs.display.records.filter(record => record.slot.slot === slot && occupiesPickerSlot(record)).length;
  const remaining = replaceEdgeId ? Number(max > 0 && occupants.filter(item => item.edgeId === replaceEdgeId).length === 1)
    : Math.max(0, max - count);
  return { spec, remaining };
}

type NamedPickerState = SlotIntentState & {
  target: CanvasNode;
  graph: CanvasInputMutationState;
  supply: ReturnType<typeof buildCanvasUpstreamFingerprint>['assets'];
  currentRecords: SlotSelection[];
  saved: SlotBindings | undefined;
  conflicts: SlotConflict[] | undefined;
  standby: readonly string[];
  videoDraftKey?: string;
};

/** Resolve the saved line and actual operation before looking at a named well. */
export function namedPickerState(graph: CanvasInputMutationState, targetNodeId: string,
  { catalog: directory }: CanvasMutationRuntimeContext): NamedPickerState | undefined {
  const target = graph.nodes.find(node => node.id === targetNodeId);
  if (!target || target.type !== 'material' || resolveNodeKind(target.data) !== 'generate') return;
  const params = readCanvasParams(target);
  const { modelId, group: inlineGroup } = parseModelAndGroup(params.model);
  if (!modelId) return;
  const outputType = String(target.data.materialType ?? '');
  const catalog = narrowCatalogByRouting(directory, params.model, params.routing, params);
  const model = catalog?.models?.find(row => row.id === modelId || row.aliases?.includes(modelId));
  if (model?.visible === false || model?.selectable === false) return;
  const line = readVisualLineSelection(directory, params);
  if (line?.message) return;
  const managed = managedPickerGroup(target, { catalog: directory }, params);
  const variant = managed ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
  if (managed && !variant) return;
  const projected = projectCanvasInputSources(targetNodeId, target.data, graph.nodes, graph.edges, catalog,
    resolveModelView(buildContractView(catalog), modelId));
  const { fingerprint } = projected;
  const saved = variant ? readVideoOperationDraft(projected.data, variant) : projected.data.slotBindings as SlotBindings | undefined;
  const conflicts = variant ? undefined : projected.data.slotConflicts as SlotConflict[] | undefined;
  const standby = (projected.data.slotStandbyEdgeIds ?? []) as string[];
  const autoOperationId = projected.data.autoOperationId as string | null | undefined;
  const preferredOperationId = readPreferredOperationId(params, autoOperationId);
  const args = { catalog, modelId, outputType, fingerprint, params, preferredOperationId, autoOperationId, slotBindings: saved,
    slotConflicts: conflicts, ignoredEdgeIds: standby, inputBindingVersion: projected.data.inputBindingVersion as number | undefined };
  const assignment = resolveInputAssignment({ ...args, forceOperationId: variant?.id });
  if (!assignment.modelId || !assignment.operationId) return;
  // Image generation has a declared reference well and derives its mode from consumed reference images.
  const imageLayout = outputType === 'image' && !assignment.layout.slots.some(slot => slot.type === 'image')
    ? deriveImageGenerationLayout(catalog, assignment.modelId, assignment.operationId) : undefined;
  const referenceAssignment = imageLayout?.displayOnlyFromOperation
    ? resolveInputAssignment({ ...args, forceOperationId: imageLayout.displayOnlyFromOperation }) : assignment;
  const operation = variant ?? model?.operations?.find(row => row.id === assignment.operationId);
  return { target, graph, supply: fingerprint.assets, saved, conflicts, standby, videoDraftKey: videoSlotDraftKey(variant),
    context: {
      targetNodeId, modelId: assignment.modelId, operationId: assignment.operationId,
      routing: canonicalJson([params.routing, inlineGroup, line?.selected?.id, managed?.group?.id]),
      mode: canonicalJson([params.operation, operation?.modeKind, params.mode, params.generationType,
        params.referenceTaskType, params.resolution, params.quality, params.size, target.data.autoOperationId]),
      contractFingerprint: canonicalJson([assignment.contractFingerprint, referenceAssignment.contractFingerprint,
        managed?.group?.effectiveVersion, operation?.gatewayProtocol]),
    },
    layout: imageLayout ?? assignment.layout, records: referenceAssignment.records, currentRecords: assignment.records,
  };
}

export function openNamedPicker(state: NamedPickerState, request: SlotIntentTarget & { operationId?: string }): SlotIntent | undefined {
  if (request.operationId && request.operationId !== state.context.operationId) return;
  return captureSlotIntent(state, request);
}

type NamedPickerSelection = NonNullable<CanvasInputSelectionRequest['selections']>[number];
type NamedPickerChoice = { candidate: UpstreamAssetFingerprint; file?: LocalFileDraft };

function pickCanvasSource(state: NamedPickerState, intent: SlotIntent, selection: NamedPickerSelection): NamedPickerChoice | { reasonCode: string } {
  const node = state.graph.nodes.find(item => item.id === selection.sourceNodeId);
  if (!node) return { reasonCode: 'input_unavailable' };
  const source = readNodeInputSource(node);
  if (source.availability !== 'ready') return { reasonCode: source.availability === 'waiting' ? 'input_waiting' : 'input_unavailable' };
  if (!source.outputId || selection.outputId !== source.outputId) return { reasonCode: 'input_changed' };
  if (selection.targetSlot && selection.targetSlot !== intent.slot || selection.role && selection.role !== intent.role) {
    return { reasonCode: 'role_conflict' };
  }
  const edge = edgeDraft(node.id, state.target.id);
  const connected = state.supply.filter(asset => asset.sourceNodeId === node.id);
  const supportsSlot = (slot?: string, role?: string) => (!slot || slot === intent.slot) && (!role || role === intent.role);
  const saved = [...Object.entries(state.saved ?? {}).flatMap(([slot, values]) => values.map(occupant => ({ slot, occupant }))),
    ...(state.conflicts ?? [])].filter(({ occupant }) => occupant.sourceNodeId === node.id && (occupant.pinned || occupant.use === 'inactive'));
  const existing = connected.find(asset => supportsSlot(asset.targetSlot, asset.role)
    && saved.filter(({ occupant }) => occupant.edgeId === asset.edgeId).every(({ slot, occupant }) => supportsSlot(slot, occupant.role)));
  if (!existing && connected.length) return { reasonCode: 'role_conflict' };
  if (!existing) {
    const structure = validateCanvasConnectionStructure(edge, state.graph.nodes, state.graph.edges);
    if (!structure.valid) return { reasonCode: structure.reasonCode ?? 'type_contract' };
  }
  const media = source.output.mediaAssets?.[0];
  const declared = media?.path ?? media?.relativePath ?? media?.url.split(/[?#]/, 1)[0] ?? '';
  return { candidate: { ...existing, sourceNodeId: source.nodeId, outputId: source.outputId, type: source.materialType,
    availability: source.availability, ...source.metadata,
    declaredExtension: source.metadata?.declaredExtension ?? existing?.declaredExtension ?? extensionOf(declared),
    targetSlot: intent.slot, role: intent.role } };
}

export function checkNamedPickerSelection(state: NamedPickerState, intent: SlotIntent, selections: readonly NamedPickerSelection[],
  files: readonly LocalFileDraft[], partial = false): { choices: NamedPickerChoice[]; reasonCode?: never } | { reasonCode: string; choices?: never } {
  const choices: NamedPickerChoice[] = [];
  for (const selection of selections) {
    const choice = pickCanvasSource(state, intent, selection);
    if ('reasonCode' in choice) return choice;
    choices.push(choice);
  }
  for (const file of files) {
    if (!looksAbsolutePath(file.realPath) || !IMPORTABLE_TYPES.includes(file.materialType)
      || file.materialType === 'document' && !file.documentText) return { reasonCode: 'input_unavailable' };
    choices.push({ file, candidate: {
      sourceNodeId: `local:${file.fileRevision ?? file.realPath}`, outputId: 'current', type: file.materialType, availability: 'ready',
      mimeType: file.mime, declaredExtension: extensionOf(file.name), sizeBytes: file.size, durationSec: file.durationSec ?? undefined,
    } });
  }
  const verdict = validateSlotIntent(state, intent, choices.map(choice => choice.candidate), { partial });
  return verdict.accepted ? { choices } : { reasonCode: verdict.reasonCode };
}

/** Convert validated intent into one normal graph mutation and verify its real assignment. */
export function planNamedPickerMutation(state: NamedPickerState, intent: SlotIntent, selections: readonly NamedPickerSelection[],
  files: readonly LocalFileDraft[], runtime: CanvasMutationRuntimeContext): { mutation?: CanvasInputMutation; reasonCode?: string } {
  const checked = checkNamedPickerSelection(state, intent, selections, files);
  if (!checked.choices) return { reasonCode: checked.reasonCode };
  const slot = readSlotIntent(state, intent);
  if (!slot.accepted) return { reasonCode: slot.reasonCode };
  const { graph, target } = state;
  const addNodes: CanvasNode[] = [];
  const addEdges: Edge[] = [];
  const explicit: SlotBindings = { ...state.saved };
  const standby = new Set(state.standby);
  const records = state.records.filter(record => record.slot.slot === slot.spec.slot);
  const savedInSlot = explicit[slot.spec.slot] ?? [];
  const savedByEdge = new Map(savedInSlot.map(occupant => [occupant.edgeId, occupant]));
  const ranks = new Map(records.map(record => [record.occupant.edgeId, resolveSlotOccupantOrdinal(record.occupant, record.asset)]));
  let ordinal = Math.max(-1, ...ranks.values(), ...savedInSlot.map(occupant => occupant.ordinal ?? -1)) + 1;
  const newBindings: SlotOccupant[] = [];
  const replacedId = slot.replacement?.occupant.edgeId;
  for (const { candidate, file } of checked.choices) {
    const imported = file ? createPickerImportNode(target, addNodes.length, file) : undefined;
    if (imported) addNodes.push(imported);
    const newSource = imported ? readNodeInputSource(imported) : undefined;
    if (newSource && newSource.availability !== 'ready') return { reasonCode: 'input_unavailable' };
    const sourceNodeId = newSource?.nodeId ?? candidate.sourceNodeId;
    const outputId = newSource?.outputId ?? candidate.outputId;
    const newEdge = candidate.edgeId ? undefined : normalizeCanvasEdge(edgeDraft(sourceNodeId, target.id));
    if (newEdge) addEdges.push(newEdge);
    const edgeId = candidate.edgeId ?? newEdge!.id;
    standby.delete(edgeId);
    const previous = replacedId ?? edgeId;
    newBindings.push({ sourceNodeId, edgeId, outputId, role: slot.spec.role, pinned: true, use: 'active',
      ordinal: ranks.get(previous) ?? savedByEdge.get(previous)?.ordinal ?? ordinal++ });
  }
  const selectedEdges = new Set(newBindings.map(occupant => occupant.edgeId));
  explicit[slot.spec.slot] = [...savedInSlot.filter(occupant => occupant.edgeId !== replacedId && !selectedEdges.has(occupant.edgeId)), ...newBindings];
  const priorConflicts = state.videoDraftKey ? target.data.slotConflicts as SlotConflict[] | undefined : state.conflicts;
  const data = {
    slotBindings: explicit, slotStandbyEdgeIds: [...standby],
    slotConflicts: (priorConflicts ?? []).filter(({ slot, occupant }) => slot !== intent.slot
      || occupant.edgeId !== replacedId && !selectedEdges.has(occupant.edgeId)),
    ...(state.videoDraftKey ? { videoSlotDrafts: { ...readVideoSlotDrafts(target.data.videoSlotDrafts), [state.videoDraftKey]: explicit } } : {}),
  };
  const mutation: CanvasInputMutation = {
    addNodes, addEdges,
    ...(target.data.materialType !== 'image' ? { preserveOperation: { targetNodeId: target.id, operationId: intent.operationId } } : {}),
    nodePatches: [{ nodeId: target.id, data }],
  };
  let plan = planCanvasInputMutation(graph, mutation, runtime);
  if (plan.status !== 'allowed') return { reasonCode: plan.reasonCode };
  let updated = namedPickerState(plan, target.id, runtime);
  // Retain the replaced edge as ordinary supply unless filling would immediately consume it again.
  if (replacedId && updated?.currentRecords.some(record => record.occupant.edgeId === replacedId && record.state !== 'inactive')) {
    data.slotStandbyEdgeIds = [...standby, replacedId];
    plan = planCanvasInputMutation(graph, mutation, runtime);
    if (plan.status !== 'allowed') return { reasonCode: plan.reasonCode };
    updated = namedPickerState(plan, target.id, runtime);
  }
  if (!updated || updated.context.modelId !== intent.modelId || updated.context.routing !== intent.routing
    || (target.data.materialType !== 'image' && updated.context.operationId !== intent.operationId)
    || !newBindings.every(occupant => updated.currentRecords.some(record => record.state === 'ready'
      && record.slot.slot === slot.spec.slot && record.slot.role === intent.role && record.occupant.edgeId === occupant.edgeId
      && record.occupant.outputId === occupant.outputId))) return { reasonCode: 'input_changed' };
  return { mutation };
}

type ReferencePickerSlot = { spec: SlotSpec; remaining: number };
type PickerSelections = NonNullable<CanvasInputSelectionRequest['selections']>;

export function resourcePickerReferenceGroup(state: CanvasInputMutationState, targetNodeId: string,
  context: CanvasMutationRuntimeContext, referenceSlots: readonly string[]) {
  const inputs = resourcePickerInputs(state, targetNodeId, context);
  if (!inputs) return undefined;
  const eligible = inputs.layout.slots.filter(spec => spec.role === 'reference' && isMediaInputType(spec.type)
    && referenceSlots.includes(spec.slot));
  const active = inputs.display.records.filter(record => occupiesPickerSlot(record)
    && eligible.some(spec => spec.slot === record.slot.slot));
  const slots = eligible.map(spec => ({ spec, remaining: Math.max(0, (spec.max ?? Infinity)
    - active.filter(record => record.slot.slot === spec.slot).length) }));
  return { ...inputs, slots, inUse: new Set(active.map(record => record.occupant.sourceNodeId)) };
}

/** Resolve a mixed batch without changing existing bindings. Earlier choices keep their slot unless a later choice needs it. */
export function routePickerReferences(slots: ReferencePickerSlot[], nodes: CanvasNode[], inUse: ReadonlySet<string>,
  selections: PickerSelections, files: ImportFileDraft[]): { slotNames: string[]; reasonCode?: never } | { reasonCode: string; slotNames?: never } {
  const seen = new Set(inUse);
  const candidates: ReferencePickerSlot[][] = [];
  for (const selection of selections) {
    if (seen.has(selection.sourceNodeId)) return { reasonCode: 'input_already_bound' };
    const node = nodes.find(item => item.id === selection.sourceNodeId);
    if (!node) return { reasonCode: 'input_unavailable' };
    const source = readNodeInputSource(node);
    if (source.outputId !== selection.outputId) return { reasonCode: 'input_changed' };
    seen.add(selection.sourceNodeId);
    candidates.push(slots.filter(({ spec }) => acceptsPickerSource(spec, source)));
  }
  for (const file of files) candidates.push(slots.filter(({ spec }) => acceptsPickerFile(spec, file)));
  if (candidates.some(options => !options.length)) return { reasonCode: 'role_conflict' };

  const occupants = new Map(slots.map(slot => [slot, [] as number[]]));
  const slotNames: string[] = [];
  const assign = (index: number, visited: Set<ReferencePickerSlot>): boolean => {
    const options = candidates[index]!.filter(slot => !visited.has(slot));
    const direct = options.find(slot => occupants.get(slot)!.length < slot.remaining);
    if (direct) {
      occupants.get(direct)!.push(index);
      slotNames[index] = direct.spec.slot;
      return true;
    }
    for (const option of options) {
      if (visited.has(option)) continue;
      visited.add(option);
      const current = occupants.get(option)!;
      const position = current.findIndex(other => assign(other, visited));
      if (position < 0) continue;
      current[position] = index;
      slotNames[index] = option.spec.slot;
      return true;
    }
    return false;
  };
  for (const [index] of candidates.entries()) {
    if (!assign(index, new Set())) return { reasonCode: 'slot_capacity' };
  }
  return { slotNames };
}

export function validatesNamedPickerSelection(input: ResourcePickerCommitInput): boolean {
  if (!input.targetSlot) return true;
  const count = input.selectedCanvasNodeIds.length + input.localFiles.length;
  const slot = resourcePickerSlot(input, input.targetNodeId, { catalog: input.catalog }, input.targetSlot, input.replaceEdgeId);
  return Boolean(slot && count > 0 && count <= Math.min(slot.remaining, input.slotMax ?? Infinity)
    && input.localFiles.every(file => acceptsPickerFile(slot.spec, file))
    && input.selectedCanvasNodeIds.every(id => {
      const node = input.nodes.find(candidate => candidate.id === id);
      return node && acceptsPickerSource(slot.spec, readNodeInputSource(node));
    }));
}

function toCanvasResourceItem(node: CanvasNode, source: NodeInputSource, type: MaterialType, alreadyConnected: boolean,
  availability: Pick<CanvasResourceItem, 'inUse' | 'selectable' | 'reasonCode'> = {}): CanvasResourceItem {
  const data = nodeData(node);
  const size = dimensionPair(data);
  return {
    nodeId: node.id, outputId: source.outputId, textContent: source.output.text,
    materialType: type, ...canvasResourceDisplayName(node, source), ...availability, alreadyConnected,
    previewUrl: resolveMediaPreviewUrl(type, data.mediaAssets as MediaAssetLike[] | undefined,
      typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined),
    subtitle: type === 'text' ? source.output.text ?? '' : size.width && size.height ? `${size.width} × ${size.height}` : '',
    ...size,
  };
}

function listNamedPickerResources(state: NamedPickerState, intent: SlotIntent,
  selected: PickerSelections = [], files: LocalFileDraft[] = []): CanvasResourceItem[] {
  const slot = readSlotIntent(state, intent);
  if (!slot.accepted) return [];
  const items: CanvasResourceItem[] = [];
  for (const node of state.graph.nodes) {
    if (node.id === state.target.id || node.type !== 'material') continue;
    const source = readNodeInputSource(node);
    const type = asMaterialType(source.materialType);
    if (!source.outputId || !type) continue;
    const selection = { sourceNodeId: source.nodeId, outputId: source.outputId, targetSlot: intent.slot, role: intent.role };
    const next = intent.replacement ? [selection] : [...selected.filter(item => item.sourceNodeId !== source.nodeId), selection];
    const checked = checkNamedPickerSelection(state, intent, next, intent.replacement ? [] : files, true);
    if (!checked.choices) continue;
    items.push(toCanvasResourceItem(node, source, type, state.supply.some(asset => asset.sourceNodeId === source.nodeId)));
  }
  return items;
}

export function listCanvasResources(
  nodes: CanvasNode[],
  edges: Edge[],
  targetNodeId: string,
  context: CanvasMutationRuntimeContext = {},
  selectionTarget?: { targetSlot?: string; role?: string; replaceEdgeId?: string; replaceSlot?: string;
    referenceSlots?: string[]; selections?: PickerSelections; localFiles?: LocalFileDraft[];
    named?: { state: NamedPickerState | undefined; intent: SlotIntent } },
): CanvasResourceItem[] {
  const graph = { nodes, edges };
  if (selectionTarget?.named) {
    const { state, intent } = selectionTarget.named;
    return state ? listNamedPickerResources(state, intent, selectionTarget.selections, selectionTarget.localFiles) : [];
  }
  if (selectionTarget?.targetSlot && !selectionTarget.referenceSlots) {
    const state = namedPickerState(graph, targetNodeId, context);
    if (state) {
      const intent = openNamedPicker(state, { slot: selectionTarget.targetSlot, role: selectionTarget.role,
        replaceEdgeId: selectionTarget.replaceEdgeId });
      return intent ? listNamedPickerResources(state, intent, selectionTarget.selections, selectionTarget.localFiles) : [];
    }
  }
  const group = selectionTarget?.referenceSlots && resourcePickerReferenceGroup(graph, targetNodeId, context,
    selectionTarget.referenceSlots);
  const picker = selectionTarget?.referenceSlots ? group : resourcePickerInputs(graph, targetNodeId, context);
  if (!picker) return [];
  const { layout, target, display, managed } = picker;
  const bindings = managed ? display.bindings : (target.data.slotBindings ?? {}) as SlotBindings;
  const slots = group
    ? group.slots.map(item => item.spec)
    : layout.slots.filter(slot => !selectionTarget?.targetSlot || slot.slot === selectionTarget.targetSlot);
  const connected = incomingSourceIds(edges, targetNodeId);
  const items: CanvasResourceItem[] = [];
  for (const node of nodes) {
    if (node.id === targetNodeId) continue;
    if (node.type && node.type !== 'material') continue;
    const data = nodeData(node);
    const materialType = asMaterialType(data.materialType);
    if (!materialType) continue;
    const source = readNodeInputSource(node);
    if (source.availability !== 'ready' || !source.outputId) continue;
    const matchingSlots = slots.filter(slot => slot.type === materialType
      && (!(group || selectionTarget?.targetSlot) || acceptsPickerSource(slot, source)));
    if (!matchingSlots.length) continue;
    const inUse = group ? group.inUse.has(node.id) : matchingSlots.some(slot => bindings[slot.slot]?.some(item => item.use !== 'inactive'
      && item.sourceNodeId === source.nodeId && (item.role ?? slot.role) === slot.role
      && edges.some(edge => edge.id === item.edgeId && edge.source === source.nodeId && edge.target === targetNodeId)));
    const selected = selectionTarget?.selections ?? [];
    const candidateRequest = { targetNodeId, chosenOperationId: layout.operationId,
      selections: [...selected.filter(item => item.sourceNodeId !== source.nodeId), {
        sourceNodeId: source.nodeId, outputId: source.outputId,
        targetSlot: selectionTarget?.targetSlot, role: selectionTarget?.role,
      }], replaceEdgeId: selectionTarget?.replaceEdgeId, replaceSlot: selectionTarget?.replaceSlot };
    const referenceRoute = group && !inUse ? routePickerReferences(group.slots, nodes, group.inUse, candidateRequest.selections,
      selectionTarget?.localFiles ?? []) : undefined;
    const candidate = !group && picker.qualified
      ? (inUse ? { status: 'allowed', verdict: validateCanvasInputSelection(graph, candidateRequest, context) }
        : planPickerSelectionMutation(graph, candidateRequest, context)) : undefined;
    const selectable = group ? !referenceRoute?.reasonCode && canConnect(node, group.target)
      : candidate ? candidate.status === 'allowed' && candidate.verdict?.accepts === true : true;
    items.push(toCanvasResourceItem(node, source, materialType, connected.has(node.id), {
      inUse, selectable, reasonCode: referenceRoute?.reasonCode ?? candidate?.verdict?.reasonCode
        ?? (candidate && 'reasonCode' in candidate ? candidate.reasonCode : undefined),
    }));
  }
  return items;
}

export function resourcePickerContextKey(node: CanvasNode | undefined, context: CanvasMutationRuntimeContext): string {
  const params = node ? readCanvasParams(node) : {};
  const managed = managedPickerGroup(node, context, params);
  const variant = managed ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
  return JSON.stringify([node?.data.inputBindingVersion, params.model, params.operation, params.routing, context.catalog?.fingerprint,
    managed?.model.effectiveVideoVersion, managed?.group?.id, variant]);
}

function includesReferenceSelections(records: SlotSelection[], selections: PickerSelections): boolean {
  return selections.every(selection => records.some(record => record.state === 'ready'
    && record.occupant.sourceNodeId === selection.sourceNodeId && record.occupant.outputId === selection.outputId
    && record.slot.slot === selection.targetSlot));
}

function planLegacyReferencePickerMutation(current: CanvasInputMutationState,
  group: NonNullable<ReturnType<typeof resourcePickerReferenceGroup>>, selections: PickerSelections, addNodes: CanvasNode[],
  context: CanvasMutationRuntimeContext) {
  const { target, display } = group;
  const bindings: SlotBindings = Object.fromEntries(Object.entries(display.bindings).map(([name, values]) => [name, [...values]]));
  const standby = new Set((target.data.slotStandbyEdgeIds ?? []) as string[]);
  const newEdges: Edge[] = [];
  let ordinal = display.records.reduce((max, record) =>
    Math.max(max, resolveSlotOccupantOrdinal(record.occupant, record.asset)), -1) + 1;
  for (const selection of selections) {
    const existing = current.edges.find(edge => edge.source === selection.sourceNodeId && edge.target === target.id);
    const edge = existing ?? normalizeCanvasEdge(edgeDraft(selection.sourceNodeId, target.id));
    if (!existing) newEdges.push(edge);
    const slot = selection.targetSlot!;
    bindings[slot] = [...(bindings[slot] ?? []).filter(occupant => occupant.edgeId !== edge.id),
      { sourceNodeId: selection.sourceNodeId, edgeId: edge.id, outputId: selection.outputId, ordinal: ordinal++, pinned: true }];
    standby.delete(edge.id);
  }
  const mutation: CanvasInputMutation = {
    addNodes,
    addEdges: newEdges,
    nodePatches: [{ nodeId: target.id, data: {
      slotBindings: bindings, slotConflicts: display.conflicts, slotStandbyEdgeIds: [...standby],
    } }],
  };
  const plan = planCanvasInputMutation(current, mutation, context);
  if (plan.status !== 'allowed') return { status: plan.status, reasonCode: plan.reasonCode };
  const updated = resourcePickerInputs(plan, target.id, context);
  if (!updated || updated.layout.operationId !== group.layout.operationId
    || !includesReferenceSelections(updated.display.records, selections)) {
    return { status: 'rejected' as const, reasonCode: 'input_changed' };
  }
  return { status: plan.status, mutation };
}

/** Stage local files as upstream nodes and run the same strict selection as canvas assets. */
export function planPickerSelectionMutation(current: CanvasInputMutationState, request: CanvasInputSelectionRequest,
  context: CanvasMutationRuntimeContext, local?: { files: LocalFileDraft[]; targetSlot?: string; referenceSlots?: string[] }): {
  status: 'allowed' | 'rejected' | 'configuration_error'; reasonCode?: string;
  mutation?: CanvasInputMutation; verdict?: CanvasInputSelectionVerdict;
} {
  const group = local?.referenceSlots ? resourcePickerReferenceGroup(current, request.targetNodeId, context, local.referenceSlots) : undefined;
  if (local?.referenceSlots && (!group || request.chosenOperationId && request.chosenOperationId !== group.layout.operationId)) {
    return { status: 'rejected', reasonCode: 'input_changed' };
  }
  const files = local?.files.length ? usableMediaFiles(local.files, []) : [];
  if (files.length !== (local?.files.length ?? 0)) return { status: 'rejected', reasonCode: 'input_unavailable' };
  const selections = [...(request.selections ?? [])];
  const target = group?.target ?? current.nodes.find(node => node.id === request.targetNodeId);
  if (!target) return { status: 'rejected', reasonCode: 'missing_node' };
  if (files.length && !group && !local?.targetSlot) return { status: 'rejected', reasonCode: 'role_required' };
  const routed = group && routePickerReferences(group.slots, current.nodes, group.inUse, selections, files);
  if (routed?.reasonCode) return { status: 'rejected', reasonCode: routed.reasonCode };
  const slotNames = routed?.slotNames;
  const canvasCount = selections.length;
  if (slotNames) {
    for (const [index, selection] of selections.entries()) {
      selections[index] = { sourceNodeId: selection.sourceNodeId, outputId: selection.outputId, targetSlot: slotNames[index] };
    }
  }
  const addNodes = files.map((file, index) => createPickerImportNode(target, index, file));
  for (const [index, node] of addNodes.entries()) {
    const source = readNodeInputSource(node);
    if (!source.outputId) return { status: 'rejected', reasonCode: 'input_unavailable' };
    selections.push({ sourceNodeId: source.nodeId, outputId: source.outputId,
      targetSlot: slotNames ? slotNames[canvasCount + index] : local?.targetSlot });
  }
  if (group && !group.qualified) {
    return planLegacyReferencePickerMutation(current, group, selections, addNodes, context);
  }
  request = { ...request, selections };
  let stagedTarget = target;
  const draftKey = videoSlotDraftKey(group?.variant);
  if (group && draftKey && group.display.records.some(record => record.occupant.ordinal === undefined)) {
    // Historical drafts used feed order until a picker stored explicit positions.
    const order = new Map(group.display.records.map(record => [record.occupant.edgeId, resolveSlotOccupantOrdinal(record.occupant, record.asset)]));
    const existing = readVideoOperationDraft(target.data, group.variant);
    const ranked = Object.fromEntries(Object.entries(existing).map(([slot, occupants]) => [slot,
      occupants.map(occupant => ({ ...occupant, ordinal: occupant.ordinal ?? order.get(occupant.edgeId) }))]));
    stagedTarget = { ...target, data: { ...target.data,
      videoSlotDrafts: { ...readVideoSlotDrafts(target.data.videoSlotDrafts), [draftKey]: ranked },
    } };
  }
  const draft = addNodes.length || stagedTarget !== target
    ? { ...current, nodes: [...current.nodes.map(node => node === target ? stagedTarget : node), ...addNodes] } : current;
  const plan = planCanvasInputSelection(draft, request, context);
  if (plan.status !== 'allowed') return { status: plan.status, reasonCode: plan.reasonCode };
  // An image selection may switch the node's operation in the same atomic
  // mutation; validate against the planned operation, not the pre-selection one.
  const plannedParams = plan.nodes.find((node) => node.id === request.targetNodeId)?.data.params as Record<string, unknown> | undefined;
  const plannedOperationId = typeof plannedParams?.operation === 'string' && plannedParams.operation
    ? plannedParams.operation : request.chosenOperationId;
  const effectiveRequest = plannedOperationId !== request.chosenOperationId
    ? { ...request, chosenOperationId: plannedOperationId }
    : request;
  const verdict = validateCanvasInputSelection(plan, effectiveRequest, context, { strictAssignments: plan.strictAssignments });
  // The selection endpoint alone verifies the unique saved binding and reduction.
  // Apply only its binding result, without claiming the remaining graph is ready.
  if (request.setUse?.use === 'inactive' && !request.replaceEdgeId && !(request.selections?.length)) {
    const updated = plan.nodes.find(node => node.id === request.targetNodeId)!;
    const { slot, edgeId } = request.setUse;
    const conflicts = (target.data.slotConflicts ?? []) as SlotConflict[];
    const reduced = ((updated.data.slotConflicts ?? []) as SlotConflict[])
      .find(conflict => conflict.slot === slot && conflict.occupant.edgeId === edgeId);
    const keptConflicts = conflicts.filter(conflict => conflict.slot !== slot || conflict.occupant.edgeId !== edgeId);
    if (reduced) keptConflicts.push(reduced);
    return { status: 'allowed', verdict, mutation: {
      nodePatches: [{ nodeId: target.id, data: { slotBindings: updated.data.slotBindings,
        ...(keptConflicts.length ? { slotConflicts: keptConflicts } : {}),
        ...(updated.data.inputBindingVersion !== target.data.inputBindingVersion
          ? { inputBindingVersion: updated.data.inputBindingVersion } : {}),
      } }],
    } };
  }
  if (!verdict.accepts) return { status: 'rejected', reasonCode: verdict.reasonCode, verdict };
  if (slotNames && !includesReferenceSelections(verdict.records, selections)) {
    return { status: 'rejected', reasonCode: 'input_changed', verdict };
  }
  const nodePatches = plan.nodes.flatMap(node => {
    const previous = draft.nodes.find(item => item.id === node.id);
    return previous && previous.data !== node.data ? [{ nodeId: node.id, data: node.data }] : [];
  });
  // Derived edge mirrors are recomputed by the original gateway after these explicit bindings.
  const addEdges = plan.edges.filter(edge => !current.edges.some(item => item.id === edge.id));
  const removeEdgeIds = current.edges.filter(edge => !plan.edges.some(item => item.id === edge.id)).map(edge => edge.id);
  return { status: 'allowed', verdict, mutation: { nodePatches, addEdges, ...(addNodes.length ? { addNodes } : {}),
    removeEdgeIds: removeEdgeIds.length ? removeEdgeIds : undefined,
    ...(plan.strictAssignments ? { strictAssignments: plan.strictAssignments } : {}),
    strictConsumption: { targetNodeId: effectiveRequest.targetNodeId, chosenOperationId: effectiveRequest.chosenOperationId,
      ...(effectiveRequest.chosenRouteId !== undefined ? { chosenRouteId: effectiveRequest.chosenRouteId } : {}) } } };
}

export function pickerReasonKey(reasonCode?: string): string {
  switch (reasonCode) {
    case 'catalog_unavailable': case 'unknown_model': case 'not_listed': return 'input.reason.catalog';
    case 'input_waiting': return 'input.reason.waiting';
    case 'input_unavailable': case 'missing_node': case 'input_changed': return 'input.reason.unavailable';
    case 'slot_capacity': return 'input.reason.capacity';
    case 'mime_unsupported': return 'input.reason.format';
    case 'size_exceeded': return 'input.reason.size';
    case 'duration_exceeded': return 'input.reason.duration';
    case 'prompt_required': return 'input.reason.body';
    case 'min_unsatisfied': return 'input.reason.required';
    case 'mime_unknown': return 'input.reason.unknownFormat';
    case 'route_plan_required': case 'operation_confirmation_required': return 'input.reason.sameMethod';
    default: return 'input.reason.incompatible';
  }
}

export function filterCanvasResources(
  items: CanvasResourceItem[],
  query: string,
  typeFilter: ResourceTypeFilter,
): CanvasResourceItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (typeFilter !== 'all' && item.materialType !== typeFilter) return false;
    if (!needle) return true;
    return (
      item.title.toLowerCase().includes(needle)
      || item.nodeId.toLowerCase().includes(needle)
      || item.subtitle.toLowerCase().includes(needle)
    );
  });
}

function edgeDraft(source: string, target: string, targetSlot?: string) {
  return {
    source,
    sourceHandle: 'out',
    target,
    targetHandle: 'in',
    ...(targetSlot ? { data: { targetSlot } } : {}),
  };
}

function orderedSlotState(input: ResourcePickerCommitInput, target: CanvasNode, slot: string | undefined) {
  if (!slot) return undefined;
  const params = readCanvasParams(target);
  const catalog = narrowCatalogByRouting(input.catalog, params.model, params.routing, params);
  const layout = deriveSlotLayout(catalog, typeof params.model === 'string' ? params.model : undefined,
    typeof params.operation === 'string' ? params.operation : undefined);
  const spec = layout.slots.find(spec => spec.slot === slot && isOrderedImageReferenceSlot(spec));
  if (!spec || spec.max === null) return undefined;
  const feed = feedFromFingerprint(buildCanvasUpstreamFingerprint(target.id, input.nodes, input.edges));
  const data = nodeData(target);
  const resolved = effectiveInputDisplay(layout, feed, data.slotBindings as SlotBindings | undefined,
    data.slotConflicts as SlotConflict[] | undefined, input.edges, data.slotStandbyEdgeIds as string[] | undefined);
  return { max: spec.max, occupants: resolved.bindings[slot] ?? [], feed: new Map(feed.map(asset => [asset.edgeId, asset])) };
}

/** 装填 pinned 占用进 slotBindings：max 1 替换；上限内追加；超限替换末位。 */
function pinOccupantInto(
  bindings: SlotBindings | undefined,
  slot: string,
  occupant: SlotOccupant,
  slotMax: number | null | undefined,
): SlotBindings {
  const next: SlotBindings = Object.fromEntries(
    Object.entries(bindings ?? {}).map(([key, values]) => [key, values.map((value) => ({ ...value }))]),
  );
  const list = (next[slot] ?? []).filter((item) => item.edgeId !== occupant.edgeId);
  if (slotMax === 1) {
    next[slot] = [occupant];
  } else if (typeof slotMax === 'number' && list.length >= slotMax && list.length > 0) {
    list[list.length - 1] = occupant;
    next[slot] = list;
  } else {
    next[slot] = [...list, occupant];
  }
  return next;
}

function canConnect(source: CanvasNode, target: CanvasNode): boolean {
  return isNodeConnectionValid(source, target);
}

function mediaPatch(file: ImportFileDraft): Record<string, unknown> {
  if ('relativePath' in file) {
    const url = projectFileMediaUrl(file.workspaceId, file.relativePath);
    return {
      ...buildMediaMetadata({ mime: file.mime, size: file.size, durationSec: file.durationSec, name: file.name }),
      relativePath: file.relativePath,
      assetId: file.assetId,
      mediaUrl: url,
      status: 'ready',
      content: file.name,
      originalName: file.name,
      isMissing: false,
      mediaAssets: [{ type: file.materialType, url, relativePath: file.relativePath, assetId: file.assetId }],
    };
  }
  return {
    ...buildImportedMediaData({
      realPath: file.realPath,
      name: file.name,
      materialType: file.materialType,
      mime: file.mime,
      size: file.size,
      durationSec: file.durationSec,
    }),
    ...(file.documentText !== undefined ? { documentText: file.documentText } : {}),
  };
}

function placeUpstream(
  target: CanvasNode,
  index: number,
  materialType: MaterialType,
): { x: number; y: number } {
  const width = getDefaultNodeWidth(materialType);
  const height = getDefaultNodeHeight(materialType);
  return {
    x: target.position.x - width - UPSTREAM_GAP_X,
    y: target.position.y + index * (height + UPSTREAM_STACK_Y),
  };
}

function createPickerImportNode(target: CanvasNode, index: number, file: ImportFileDraft): CanvasNode {
  return createImportNode(file.materialType, placeUpstream(target, index, file.materialType), {
    ...mediaPatch(file),
    label: file.name.replace(/\.[^.]+$/, '') || file.name,
  });
}

/**
 * 置换 Mutation 计划生成器：
 * - 当在替换模式下确认选择某个素材时：
 *   - 如果该素材已在溢出池中，通过 slotEngine.promoteOverflowAsset 执行置换；
 *   - 如果来自其他节点或上传，生成建立连线并将原槽位退入溢出池的 Mutation Plan。
 */
export function planResourcePickerReplaceCommit(
  input: ResourcePickerReplaceCommitInput,
): ResourcePickerCommitPlan {
  const rejected: ResourcePickerRejection[] = [];
  const target = input.nodes.find((node) => node.id === input.targetNodeId);
  if (!target) {
    return { hasWork: false, rejected: [{ id: input.targetNodeId, reason: 'missing' }] };
  }

  const { targetNodeId, targetSlotIndex, slotState, selectedCanvasNodeId, localFile } = input;

  // 1. 如果选中了画布节点
  if (selectedCanvasNodeId) {
    if (selectedCanvasNodeId === targetNodeId) {
      return { hasWork: false, rejected: [{ id: selectedCanvasNodeId, reason: 'self' }] };
    }

    // 1.1 如果该素材已在溢出池中，通过 promoteOverflowAsset 直接执行置换
    if (slotState && slotState.overflowPool.some((o) => o.sourceNodeId === selectedCanvasNodeId)) {
      const nextSlotState = promoteOverflowAsset(slotState, selectedCanvasNodeId, targetSlotIndex);
      return {
        hasWork: true,
        rejected: [],
        nodePatches: [
          {
            nodeId: targetNodeId,
            data: {
              slotState: nextSlotState,
            },
          },
        ],
      };
    }

    // 1.2 来自其他画布节点（建立连线并将原槽位退入溢出池）
    const source = input.nodes.find((n) => n.id === selectedCanvasNodeId);
    if (!source) {
      return { hasWork: false, rejected: [{ id: selectedCanvasNodeId, reason: 'missing' }] };
    }
    if (!canConnect(source, target)) {
      return { hasWork: false, rejected: [{ id: selectedCanvasNodeId, reason: 'type_contract' }] };
    }

    const addEdges = [edgeDraft(selectedCanvasNodeId, targetNodeId)];
    const nodePatches: NonNullable<CanvasInputMutation['nodePatches']> = [];

    if (slotState) {
      const currentSlotItem = slotState.activeSlots.find((s) => s.slotIndex === targetSlotIndex);
      const nextOverflow = [...slotState.overflowPool];
      if (currentSlotItem) {
        nextOverflow.push({
          sourceNodeId: currentSlotItem.sourceNodeId,
          edgeId: currentSlotItem.edgeId,
          materialType: currentSlotItem.materialType,
          mediaUrl: currentSlotItem.mediaUrl,
          label: currentSlotItem.label,
          mimeType: currentSlotItem.mimeType,
          addedAt: Date.now(),
        });
      }
      const sData = nodeData(source);
      const nextActive = slotState.activeSlots.filter((s) => s.slotIndex !== targetSlotIndex);
      nextActive.push({
        slotId: `slot_${targetSlotIndex}`,
        slotIndex: targetSlotIndex,
        sourceNodeId: selectedCanvasNodeId,
        materialType: asMaterialType(sData.materialType) ?? 'image',
        mediaUrl: typeof sData.mediaUrl === 'string' ? sData.mediaUrl : undefined,
        label: resourceTitle(sData, selectedCanvasNodeId),
      });
      nextActive.sort((a, b) => a.slotIndex - b.slotIndex);
      const nextSlotState: NodeSlotEngineState = {
        ...slotState,
        activeSlots: nextActive,
        overflowPool: nextOverflow,
      };
      nodePatches.push({
        nodeId: targetNodeId,
        data: {
          slotState: nextSlotState,
        },
      });
    }

    return {
      hasWork: true,
      rejected: [],
      addEdges,
      nodePatches: nodePatches.length > 0 ? nodePatches : undefined,
    };
  }

  // 2. 如果是本地上传文件
  if (localFile) {
    const usable = usableMediaFiles([localFile], rejected);
    if (usable.length === 0) {
      return { hasWork: false, rejected };
    }
    const file = usable[0]!;
    const node = createPickerImportNode(target, 0, file);
    if (!canConnect(node, target)) {
      return { hasWork: false, rejected: [{ id: file.id, reason: 'type_contract' }] };
    }

    const addNodes = [node];
    const addEdges = [edgeDraft(node.id, targetNodeId)];
    const nodePatches: NonNullable<CanvasInputMutation['nodePatches']> = [];

    if (slotState) {
      const currentSlotItem = slotState.activeSlots.find((s) => s.slotIndex === targetSlotIndex);
      const nextOverflow = [...slotState.overflowPool];
      if (currentSlotItem) {
        nextOverflow.push({
          sourceNodeId: currentSlotItem.sourceNodeId,
          edgeId: currentSlotItem.edgeId,
          materialType: currentSlotItem.materialType,
          mediaUrl: currentSlotItem.mediaUrl,
          label: currentSlotItem.label,
          mimeType: currentSlotItem.mimeType,
          addedAt: Date.now(),
        });
      }
      const nextActive = slotState.activeSlots.filter((s) => s.slotIndex !== targetSlotIndex);
      nextActive.push({
        slotId: `slot_${targetSlotIndex}`,
        slotIndex: targetSlotIndex,
        sourceNodeId: node.id,
        materialType: file.materialType,
        mediaUrl: typeof (node.data as Record<string, unknown> | undefined)?.mediaUrl === 'string'
          ? ((node.data as Record<string, unknown>).mediaUrl as string)
          : undefined,
        label: file.name.replace(/\.[^.]+$/, '') || file.name,
      });
      nextActive.sort((a, b) => a.slotIndex - b.slotIndex);
      const nextSlotState: NodeSlotEngineState = {
        ...slotState,
        activeSlots: nextActive,
        overflowPool: nextOverflow,
      };
      nodePatches.push({
        nodeId: targetNodeId,
        data: {
          slotState: nextSlotState,
        },
      });
    }

    return {
      hasWork: true,
      rejected: [],
      addNodes,
      addEdges,
      nodePatches: nodePatches.length > 0 ? nodePatches : undefined,
    };
  }

  return { hasWork: false, rejected };
}

/**
 * 计算一次提交对应的 canvas mutation。
 *
 * 画布资源：为尚未连入的选中节点添加 source→target 边。
 * 本地上传：全部可用文件都在当前节点左侧创建导入型上游节点并连线，
 * 不把任何文件写入当前节点卡片（避免把所选素材 patch 进当前节点替换素材）。
 */
export function planResourcePickerCommit(input: ResourcePickerCommitInput): ResourcePickerCommitPlan {
  if (input.replaceEdgeId) return planNamedOccupantReplacement(input);
  // 如果是替换模式且提供了 targetSlotIndex，派发至置换 Mutation 计划生成器
  if (input.mode === 'replace' && typeof input.targetSlotIndex === 'number') {
    return planResourcePickerReplaceCommit({
      nodes: input.nodes,
      edges: input.edges,
      targetNodeId: input.targetNodeId,
      targetSlotIndex: input.targetSlotIndex,
      slotState: input.slotState,
      selectedCanvasNodeId: input.selectedCanvasNodeIds[0],
      localFile: input.localFiles[0],
    });
  }

  const rejected: ResourcePickerRejection[] = [];
  const addEdges: NonNullable<CanvasInputMutation['addEdges']> = [];
  const addNodes: CanvasNode[] = [];
  const targetSlot = input.targetSlot?.trim() || undefined;
  const acceptedTypes = input.acceptedTypes?.length ? new Set(input.acceptedTypes) : null;

  const target = input.nodes.find((node) => node.id === input.targetNodeId);
  if (!target) {
    return { hasWork: false, rejected: [{ id: input.targetNodeId, reason: 'missing' }] };
  }

  const existing = incomingSourceIds(input.edges, input.targetNodeId);
  const seenSources = new Set<string>(existing);
  const ordered = orderedSlotState(input, target, targetSlot);
  const savedBindings = nodeData(target).slotBindings as SlotBindings | undefined;
  const standby = Array.isArray(target.data.slotStandbyEdgeIds) ? target.data.slotStandbyEdgeIds : [];
  const reactivatedEdges = new Set<string>();
  let pinnedBindings: SlotBindings | undefined;
  function pinSupply(slot: string, occupant: SlotOccupant): boolean {
    if (!ordered) {
      pinnedBindings = pinOccupantInto(pinnedBindings ?? savedBindings, slot, occupant, input.slotMax);
      return true;
    }
    const occupants = pinnedBindings?.[slot] ?? ordered.occupants;
    const active = occupants.filter(item => item.use !== 'inactive');
    if (active.some(item => item.edgeId === occupant.edgeId)) {
      rejected.push({ id: occupant.sourceNodeId, reason: 'already_connected' });
      return false;
    }
    if (active.length >= ordered.max) {
      rejected.push({ id: occupant.sourceNodeId, reason: 'slot_capacity' });
      return false;
    }
    const existing = occupants.filter(item => item.edgeId !== occupant.edgeId).map(item => ({
      ...item, ordinal: resolveSlotOccupantOrdinal(item, ordered.feed.get(item.edgeId)),
    }));
    const ordinal = existing.reduce((max, item) => Math.max(max, item.ordinal), -1) + 1;
    pinnedBindings = { ...(pinnedBindings ?? savedBindings), [slot]: [...existing, { ...occupant, ordinal }] };
    reactivatedEdges.add(occupant.edgeId);
    return true;
  }
  function addSupply(sourceNodeId: string) {
    const draft = edgeDraft(sourceNodeId, input.targetNodeId, ordered ? undefined : targetSlot);
    if (ordered && targetSlot) {
      // Persist placement by edge ID; a legacy slot hint can only append by connection order.
      const edge = normalizeCanvasEdge(draft);
      if (!pinSupply(targetSlot, { sourceNodeId, edgeId: edge.id, pinned: true })) return false;
      addEdges.push(edge);
    } else {
      addEdges.push(draft);
    }
    return true;
  }

  for (const nodeId of input.selectedCanvasNodeIds) {
    if (nodeId === input.targetNodeId) {
      rejected.push({ id: nodeId, reason: 'self' });
      continue;
    }
    const source = input.nodes.find((node) => node.id === nodeId);
    if (!source) {
      rejected.push({ id: nodeId, reason: 'missing' });
      continue;
    }
    if (acceptedTypes && !acceptedTypes.has(asMaterialType(nodeData(source).materialType) ?? '')) {
      rejected.push({ id: nodeId, reason: 'unsupported' });
      continue;
    }
    if (existing.has(nodeId) || seenSources.has(nodeId)) {
      if (targetSlot && existing.has(nodeId)) {
        const edge = input.edges.find((item) => item.target === input.targetNodeId && item.source === nodeId);
        if (edge) {
          pinSupply(targetSlot, { sourceNodeId: nodeId, edgeId: edge.id, pinned: true });
          continue;
        }
      }
      rejected.push({ id: nodeId, reason: 'already_connected' });
      continue;
    }
    if (!canConnect(source, target)) {
      rejected.push({ id: nodeId, reason: 'type_contract' });
      continue;
    }
    if (addSupply(nodeId)) seenSources.add(nodeId);
  }

  // 本地上传：全部可用文件都在当前节点左侧创建导入型上游并连线。
  // 产品预期是新建上游节点并连到当前节点，而非把所选文件 patch 进当前卡片。
  const usableFiles = usableMediaFiles(input.localFiles, rejected)
    .filter((file) => {
      if (acceptedTypes && !acceptedTypes.has(file.materialType)) {
        rejected.push({ id: file.id, reason: 'unsupported' });
        return false;
      }
      return true;
    });

  let upstreamIndex = 0;
  for (const file of usableFiles) {
    const node = createPickerImportNode(target, upstreamIndex, file);
    if (!canConnect(node, target)) {
      rejected.push({ id: file.id, reason: 'type_contract' });
      continue;
    }
    if (!addSupply(node.id)) continue;
    addNodes.push(node);
    seenSources.add(node.id);
    upstreamIndex += 1;
  }

  const remainingStandby = standby.filter(edgeId => !reactivatedEdges.has(edgeId));
  const nodePatches: CanvasInputNodePatch[] | undefined = pinnedBindings
    ? [{ nodeId: input.targetNodeId, data: { slotBindings: pinnedBindings,
      ...(remainingStandby.length !== standby.length ? { slotStandbyEdgeIds: remainingStandby } : {}) } }]
    : undefined;
  const hasWork = addNodes.length > 0 || addEdges.length > 0 || Boolean(nodePatches);
  return {
    hasWork,
    rejected,
    ...(nodePatches ? { nodePatches } : {}),
    addNodes: addNodes.length > 0 ? addNodes : undefined,
    addEdges: addEdges.length > 0 ? addEdges : undefined,
  };
}

/** Replace one current occupant atomically while retaining every supply edge. */
function planNamedOccupantReplacement(input: ResourcePickerCommitInput): ResourcePickerCommitPlan {
  const target = input.nodes.find((node) => node.id === input.targetNodeId);
  const slot = input.targetSlot;
  const bindings = target ? nodeData(target).slotBindings as SlotBindings | undefined : undefined;
  const ordered = target && orderedSlotState(input, target, slot);
  const occupants = ordered?.occupants ?? (slot ? bindings?.[slot] : undefined);
  const index = occupants?.findIndex((item) => item.edgeId === input.replaceEdgeId) ?? -1;
  if (!target || !slot || !occupants || index < 0) {
    return { hasWork: false, rejected: [{ id: input.replaceEdgeId!, reason: 'missing' }] };
  }
  if (input.selectedCanvasNodeIds.length + input.localFiles.length !== 1) {
    return { hasWork: false, rejected: [{ id: target.id, reason: 'unsupported' }] };
  }
  const selectedId = input.selectedCanvasNodeIds[0];
  if (selectedId && occupants.some((item) => item.sourceNodeId === selectedId)) {
    return { hasWork: false, rejected: [{ id: selectedId, reason: 'already_connected' }] };
  }
  // Reuse source/file validation, but omit slot hints: the explicit patch owns placement.
  const plan = planResourcePickerCommit({ ...input, replaceEdgeId: undefined,
    targetSlot: undefined, targetSlotIndex: undefined, mode: 'add' });
  const existingEdge = selectedId ? input.edges.find((edge) => edge.target === target.id && edge.source === selectedId) : undefined;
  const source = selectedId ? input.nodes.find((node) => node.id === selectedId) : plan.addNodes?.[0];
  if (!source || (input.acceptedTypes?.length && !input.acceptedTypes.includes(String(nodeData(source).materialType)))) {
    return { hasWork: false, rejected: [{ id: selectedId ?? target.id, reason: 'unsupported' }] };
  }
  if (!existingEdge && (!plan.hasWork || plan.rejected.length)) return plan;
  const newEdges = plan.addEdges?.map(normalizeCanvasEdge);
  const edge = existingEdge ?? newEdges?.[0];
  if (!edge) return { hasWork: false, rejected: [{ id: source.id, reason: 'missing' }] };
  const next = occupants.map((item, position) => ({
    ...(position === index ? { sourceNodeId: source.id, edgeId: edge.id } : item),
    ordinal: ordered ? resolveSlotOccupantOrdinal(item, ordered.feed.get(item.edgeId)) : item.ordinal ?? position,
    pinned: true,
  }));
  return { hasWork: true, rejected: [], addNodes: plan.addNodes, addEdges: newEdges,
    nodePatches: [{ nodeId: target.id, data: { slotBindings: { ...bindings, [slot]: next },
      slotStandbyEdgeIds: [...new Set([
        ...(Array.isArray(target.data.slotStandbyEdgeIds) ? target.data.slotStandbyEdgeIds.filter((id): id is string => typeof id === 'string') : []),
        input.replaceEdgeId!,
      ])].filter((id) => id !== edge.id),
    } }] };
}

function usableMediaFiles(
  files: ImportFileDraft[],
  rejected: ResourcePickerRejection[],
): ImportFileDraft[] {
  return files.filter((file) => {
    const hasPath = 'relativePath' in file
      ? typeof file.workspaceId === 'string' && file.workspaceId.trim() !== '' && !forbiddenRelativePathCode(file.relativePath)
      : looksAbsolutePath(file.realPath);
    if (!hasPath || !IMPORTABLE_TYPES.includes(file.materialType)) {
      rejected.push({ id: file.id, reason: 'unsupported' });
      return false;
    }
    return true;
  });
}

function importNodeFromFile(
  file: ImportFileDraft,
  position: { x: number; y: number },
  selected = false,
): CanvasNode {
  const node = createImportNode(file.materialType, position, {
    ...mediaPatch(file),
    label: file.name.replace(/\.[^.]+$/, '') || file.name,
  });
  return selected ? ({ ...node, selected: true } as CanvasNode) : node;
}

/**
 * 画布「导入素材」入口：先选文件，再按文件落导入节点。
 * 取消选择 / 无可用文件时 hasWork=false，调用方不得创建空节点。
 */
export function planStandaloneImportNodes(input: {
  files: ImportFileDraft[];
  origin: { x: number; y: number };
}): ResourcePickerCommitPlan {
  const rejected: ResourcePickerRejection[] = [];
  const usable = usableMediaFiles(input.files, rejected);
  const addNodes: CanvasNode[] = [];
  let y = input.origin.y;

  usable.forEach((file, index) => {
    const height = getDefaultNodeHeight(file.materialType);
    addNodes.push(importNodeFromFile(
      file,
      { x: input.origin.x, y },
      index === usable.length - 1,
    ));
    y += height + IMPORT_STACK_Y;
  });

  return {
    hasWork: addNodes.length > 0,
    rejected,
    addNodes: addNodes.length > 0 ? addNodes : undefined,
  };
}

/**
 * 已有导入节点的填充 / 替换，或空状态生成节点的就地蜕变：
 * 首个文件写入当前节点（可改 materialType，转为 import 节点），
 * 其余文件在下方落成独立导入节点，不连线、不生成。
 * 导入素材节点不接受上游输入做模型生成，自动断开所有连入该节点的边（edge.target === targetNodeId），
 * 下游输出边（edge.source === targetNodeId）完整保留。
 */
export function planImportNodeFill(input: {
  nodes: CanvasNode[];
  targetNodeId: string;
  files: LocalFileDraft[];
  edges?: Edge[];
}): ResourcePickerCommitPlan {
  const rejected: ResourcePickerRejection[] = [];
  const target = input.nodes.find((node) => node.id === input.targetNodeId);
  if (!target) {
    return { hasWork: false, rejected: [{ id: input.targetNodeId, reason: 'missing' }] };
  }

  const usable = usableMediaFiles(input.files, rejected);
  const first = usable[0];
  if (!first) {
    return { hasWork: false, rejected };
  }

  const nodePatches: NonNullable<CanvasInputMutation['nodePatches']> = [{
    nodeId: input.targetNodeId,
    data: {
      ...mediaPatch(first),
      // The selected file becomes the source used by previews and execution.
      relativePath: undefined,
      assetId: undefined,
      filePath: undefined,
      previewUrl: undefined,
      documentText: undefined,
      documentError: undefined,
      generatedContent: undefined,
      taskId: undefined,
      executionStatus: undefined,
      executionError: undefined,
      errorMessage: undefined,
      materialType: first.materialType,
      nodeKind: 'import',
      selectedTool: 'import',
      outputCapabilityId: undefined,
      nodeWidth: getDefaultNodeWidth(first.materialType),
      nodeHeight: getDefaultNodeHeight(first.materialType),
      label: first.name.replace(/\.[^.]+$/, '') || first.name,
    },
  }];

  const addNodes: CanvasNode[] = [];
  let y = target.position.y + getDefaultNodeHeight(first.materialType) + IMPORT_STACK_Y;
  usable.slice(1).forEach((file, index, rest) => {
    const height = getDefaultNodeHeight(file.materialType);
    addNodes.push(importNodeFromFile(
      file,
      { x: target.position.x, y },
      index === rest.length - 1,
    ));
    y += height + IMPORT_STACK_Y;
  });

  const removeEdgeIds = (input.edges ?? [])
    .filter((edge) => edge.target === input.targetNodeId)
    .map((edge) => edge.id);

  return {
    hasWork: true,
    rejected,
    nodePatches,
    addNodes: addNodes.length > 0 ? addNodes : undefined,
    removeEdgeIds: removeEdgeIds.length > 0 ? removeEdgeIds : undefined,
  };
}
