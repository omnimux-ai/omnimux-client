/**
 * ResourcePicker 弹窗状态 + 提交。
 * 画布资源走 applyCanvasInputMutation 加边；本地文件在左侧创建导入型上游并连线。
 */

import { useCallback, useState } from 'react';
import { useAsyncInstanceGuard } from './useAsyncInstanceGuard.ts';
import { useCanvasStore } from '../../store/canvasStore';
import { toast } from '../../ui';
import { useT } from '../../i18n';
import { pickLocalFiles } from '../../bridge/apiClient.ts';
import { reportLocalFilePickerFailure } from '../utils/reportLocalFilePickerFailure.ts';
import {
  namedPickerState,
  openNamedPicker,
  planNamedPickerMutation,
  planImportNodeFill,
  planResourcePickerCommit,
  planPickerSelectionMutation,
  pickerReasonKey,
  resourcePickerContextKey,
  usesQualifiedResourcePicker,
  type LocalFileDraft,
  type ResourcePickerTab,
  type ResourcePickerMode,
} from '../utils/resourcePickerPolicy.ts';
import { draftFromRealPath, draftsFromPickedPaths } from '../utils/localFileDraft.ts';
import { buildImportedMediaData, extensionOf, extensionsForMaterialType } from '../../../shared/localMedia.ts';
import { readNodeInputSource } from '../../../shared/graph/nodeInputSource.ts';
import { MATERIAL_TYPES, type MaterialType } from '../../../shared/graph/materialNode.ts';
import type { NodeSlotEngineState } from '../../../shared/graph/slotContractTypes.ts';
import { feedAssetMime } from '../../../shared/graph/feedSlot/autoFillSlots.ts';
import { readSlotIntent, slotIntentNeedsDuration, type SlotIntent } from '../../../shared/validation/slotIntent.ts';
import { probePickerDrafts } from '../utils/probePickerDrafts.ts';

export interface ResourcePickerSlotTarget {
  /** 目标 slot 名（内核 SlotSpec.slot）。 */
  slot?: string;
  /** Flexible slots sharing the add-material entry, in the current operation. */
  referenceSlots?: string[];
  /** 该 slot 接受的素材类型。 */
  acceptedTypes: string[];
  /** 槽位上限；null 表示官方未公布上限。 */
  max: number | null;
  replaceEdgeId?: string;
  /** Operation and role rendered by the opening well. The hook rechecks them against the live graph. */
  operationId?: string;
  slotRole?: string;
  intent?: SlotIntent;
  contextKey?: string;
  openerAnchor?: HTMLElement;
  onReturnFocus?: (anchor: HTMLElement) => void;
}

export interface ResourcePickerCommitPayload {
  selections?: Array<{ sourceNodeId: string; outputId: string; targetSlot?: string; role?: string }>;
  chosenOperationId?: string;
  chosenRouteId?: string;
  selectedCanvasNodeIds: string[];
  localFiles: LocalFileDraft[];
  mode?: ResourcePickerMode;
  targetSlotIndex?: number;
}

export interface UseResourcePickerResult {
  open: boolean;
  initialTab: ResourcePickerTab;
  sessionId: number;
  slotTarget: ResourcePickerSlotTarget | null;
  mode: ResourcePickerMode;
  targetSlotIndex?: number;
  openPicker: (
    tab?: ResourcePickerTab,
    target?: ResourcePickerSlotTarget | null | ResourcePickerMode,
    slotIdx?: number,
  ) => void;
  closePicker: () => void;
  importLocalFiles: () => Promise<boolean>;
  fillImportNode: () => Promise<boolean>;
  relinkLocalFile: (materialType: MaterialType) => Promise<boolean>;
  commit: (payload: ResourcePickerCommitPayload) => boolean | Promise<boolean>;
}

export function useResourcePicker(nodeId: string, workspaceId?: string | null): UseResourcePickerResult {
  const [sessionId, setSessionId] = useState(0);
  const guard = useAsyncInstanceGuard(JSON.stringify([workspaceId, nodeId, sessionId]));
  const t = useT();
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<ResourcePickerTab>('canvas');
  const [slotTarget, setSlotTarget] = useState<ResourcePickerSlotTarget | null>(null);
  const [mode, setMode] = useState<ResourcePickerMode>('add');
  const [targetSlotIndex, setTargetSlotIndex] = useState<number | undefined>(undefined);

  const openPicker = useCallback(
    (
      tab: ResourcePickerTab = 'canvas',
      target: ResourcePickerSlotTarget | null | ResourcePickerMode = null,
      slotIdx?: number,
    ) => {
      let namedTarget: ResourcePickerSlotTarget | null = null;
      if (target && typeof target !== 'string') {
        const state = useCanvasStore.getState();
        const runtime = { catalog: state.catalogRuntime };
        if (target.slot) {
          const picker = namedPickerState(state, nodeId, runtime);
          const intent = picker && openNamedPicker(picker, { slot: target.slot, role: target.slotRole,
            operationId: target.operationId, replaceEdgeId: target.replaceEdgeId });
          if (!intent) return;
          namedTarget = { ...target, intent };
        } else {
          namedTarget = { ...target, contextKey: resourcePickerContextKey(state.nodes.find(node => node.id === nodeId), runtime) };
        }
      }
      guard.deactivate();
      setSessionId(id => id + 1);
      setInitialTab(tab);
      setMode(typeof target === 'string' ? target : target?.replaceEdgeId ? 'replace' : 'add');
      setSlotTarget(namedTarget);
      setTargetSlotIndex(slotIdx);
      setOpen(true);
    },
    [guard, nodeId],
  );

  const closePicker = useCallback(() => {
    guard.deactivate();
    setSessionId((id) => id + 1);
    setSlotTarget(null);
    setOpen(false);
    setMode('add');
    setTargetSlotIndex(undefined);
  }, [guard]);

  const commitNamed = useCallback(async (intent: SlotIntent, payload: ResourcePickerCommitPayload) => {
    const ticket = guard.capture();
    if (!guard.isCurrent(ticket)) return false;
    const before = useCanvasStore.getState();
    const picker = namedPickerState(before, nodeId, { catalog: before.catalogRuntime });
    const slot = picker && readSlotIntent(picker, intent);
    if (!slot?.accepted) return false;
    const selections = payload.selections ?? [];
    if (selections.length !== payload.selectedCanvasNodeIds.length || payload.chosenRouteId !== undefined
      || payload.chosenOperationId !== undefined && payload.chosenOperationId !== intent.operationId) return false;
    const readDuration = slotIntentNeedsDuration(slot.spec);
    const nativeSources = selections.flatMap(selection => {
      const node = before.nodes.find(item => item.id === selection.sourceNodeId);
      const source = node && readNodeInputSource(node);
      const path = source?.output.mediaAssets?.[0]?.path;
      const draft = path && draftFromRealPath(path);
      return source && draft ? [{ source, draft }] : [];
    });
    const verification = await Promise.all([
      probePickerDrafts(payload.localFiles, readDuration),
      probePickerDrafts(nativeSources.map(({ draft }) => draft), readDuration),
    ]).catch(() => undefined);
    if (!guard.isCurrent(ticket)) return false;
    const [files, refreshed] = verification ?? [[], []];
    const unchanged = verification && files.length === payload.localFiles.length
      && refreshed.length === nativeSources.length && nativeSources.every(({ source }, index) => {
        const file = refreshed[index]!;
        const metadata = source.metadata;
        const mime = feedAssetMime({ mimeType: metadata?.mimeType, declaredExtension: extensionOf(file.name) });
        return file.materialType === source.materialType && (!mime || feedAssetMime({ mimeType: file.mime }) === mime)
          && (metadata?.sizeBytes === undefined || metadata.sizeBytes === file.size)
          && (!readDuration || metadata?.durationSec === file.durationSec)
          && (source.materialType !== 'document' || source.output.documentText === file.documentText);
      });
    if (!unchanged) {
      toast.error(t(pickerReasonKey('input_unavailable')));
      return false;
    }
    const live = useCanvasStore.getState();
    const runtime = { catalog: live.catalogRuntime };
    const current = namedPickerState(live, nodeId, runtime);
    const plan = current ? planNamedPickerMutation(current, intent, selections, files, runtime) : undefined;
    if (!plan?.mutation) {
      toast.error(t(pickerReasonKey(plan?.reasonCode ?? 'input_changed')));
      return false;
    }
    const applied = live.applyCanvasInputMutation(plan.mutation, { undoStep: true });
    if (applied.status !== 'allowed') {
      toast.error(t(pickerReasonKey(applied.reasonCode)));
      return false;
    }
    closePicker();
    return true;
  }, [closePicker, guard, nodeId, t]);

  const commit = useCallback(
    (payload: ResourcePickerCommitPayload) => {
      if (slotTarget?.intent) return commitNamed(slotTarget.intent, payload);
      if (!guard.isCurrent(guard.capture())) return false;
      const state = useCanvasStore.getState();
      const commitMode = payload.mode ?? mode;
      const commitSlotIndex = payload.targetSlotIndex ?? targetSlotIndex;
      const targetNode = state.nodes.find((n) => n.id === nodeId);
      const context = { catalog: state.catalogRuntime };
      if (slotTarget?.contextKey && slotTarget.contextKey !== resourcePickerContextKey(targetNode, context)) {
        toast.error(t(pickerReasonKey('input_changed')));
        return false;
      }
      const slotState = targetNode?.data?.slotState as NodeSlotEngineState | undefined;
      const pickerInput = {
        nodes: state.nodes, edges: state.edges, catalog: context.catalog, targetNodeId: nodeId,
        selectedCanvasNodeIds: payload.selectedCanvasNodeIds, localFiles: payload.localFiles,
        targetSlot: slotTarget?.slot, acceptedTypes: slotTarget?.acceptedTypes, slotMax: slotTarget?.max,
        replaceEdgeId: slotTarget?.replaceEdgeId, mode: commitMode, targetSlotIndex: commitSlotIndex, slotState,
      };
      if (usesQualifiedResourcePicker(targetNode, context) || slotTarget?.referenceSlots) {
        const params = targetNode?.data.params as Record<string, unknown> | undefined;
        if (!payload.localFiles.length && !payload.selections?.length) return false;
        const prepared = planPickerSelectionMutation({ nodes: state.nodes, edges: state.edges }, {
          targetNodeId: nodeId,
          chosenOperationId: payload.chosenOperationId
            ?? ((typeof params?.operation === 'string' && params.operation) ? params.operation : (slotTarget?.operationId ?? '')),
          chosenRouteId: payload.chosenRouteId,
          selections: payload.selections,
          replaceEdgeId: slotTarget?.replaceEdgeId,
          replaceSlot: slotTarget?.replaceEdgeId ? slotTarget.slot : undefined,
        }, context, { files: payload.localFiles, targetSlot: slotTarget?.slot, referenceSlots: slotTarget?.referenceSlots });
        if (prepared.status !== 'allowed' || !prepared.mutation) {
          toast.error(t(pickerReasonKey(prepared.reasonCode)));
          return false;
        }
        const applied = state.applyCanvasInputMutation(prepared.mutation, { undoStep: true });
        if (applied.status !== 'allowed') {
          toast.error(t(pickerReasonKey(applied.reasonCode)));
          return false;
        }
        closePicker();
        return true;
      }

      const plan = planResourcePickerCommit(pickerInput);

      if (!plan.hasWork || (slotTarget?.slot && plan.rejected.length > 0)) {
        toast.warning(t(plan.rejected.some(item => item.reason === 'slot_capacity')
          ? pickerReasonKey('slot_capacity') : 'picker.commitEmpty'));
        return false;
      }

      if (slotTarget?.slot) state.pushHistory();
      const result = state.applyCanvasInputMutation({
        addNodes: plan.addNodes,
        addEdges: plan.addEdges,
        nodePatches: plan.nodePatches,
      });

      if (result.status !== 'allowed') {
        toast.error(t('picker.commitFailed'));
        return false;
      }

      if (slotTarget?.slot) state.pushHistory(true);
      if (plan.rejected.length > 0) {
        toast.warning(t('picker.commitPartial'));
      }
      closePicker();
      return true;
    },
    [closePicker, commitNamed, guard, mode, nodeId, slotTarget, t, targetSlotIndex],
  );

  const fillImportNode = useCallback(async () => {
    const ticket = guard.capture();
    if (!guard.isCurrent(ticket)) return false;
    const node = useCanvasStore.getState().nodes.find(node => node.id === nodeId);
    const materialType = node?.data.materialType as MaterialType | undefined;
    if (node?.type !== 'material' || !materialType || !MATERIAL_TYPES.includes(materialType)) return false;
    const extensions = extensionsForMaterialType(materialType);
    const result = await pickLocalFiles({ extensions, multiple: false }).catch(() => null);
    if (!guard.isCurrent(ticket)) return false;
    if (!result || !result.ok) {
      reportLocalFilePickerFailure(result, t);
      return false;
    }
    const paths = result.body.paths ?? [];
    if (paths.length === 0) return false;
    const [path] = paths;
    if (paths.length !== 1 || !path) {
      toast.error(t('picker.pickFailed'));
      return false;
    }
    const draft = draftFromRealPath(path);
    if (draft?.materialType !== materialType || !extensions.includes(extensionOf(path))) {
      toast.warning(t('picker.unsupported'));
      return false;
    }
    const state = useCanvasStore.getState();
    const current = state.nodes.find(node => node.id === nodeId);
    if (current?.type !== 'material' || current.data.materialType !== materialType
      || current.data.status === 'generating' || current.data.executionStatus === 'pending'
      || current.data.executionStatus === 'running') return false;
    const plan = planImportNodeFill({
      nodes: state.nodes,
      targetNodeId: nodeId,
      files: [draft],
      edges: state.edges,
    });
    if (!plan.hasWork) {
      toast.warning(t('picker.unsupported'));
      return false;
    }
    const applied = state.applyCanvasInputMutation({
      nodePatches: plan.nodePatches,
      removeEdgeIds: plan.removeEdgeIds,
    });
    if (applied.status !== 'allowed') {
      toast.error(t('picker.commitFailed'));
      return false;
    }
    return true;
  }, [guard, nodeId, t]);

  const importLocalFiles = useCallback(async () => {
    const ticket = guard.capture();
    if (!guard.isCurrent(ticket)) return false;
    const result = await pickLocalFiles().catch(() => null);
    if (!guard.isCurrent(ticket)) return false;
    if (!result || !result.ok) {
      reportLocalFilePickerFailure(result, t);
      return false;
    }
    const paths = result.body.paths ?? [];
    if (paths.length === 0) return false;
    const drafts = draftsFromPickedPaths(paths);
    if (drafts.length === 0) {
      toast.warning(t('picker.unsupported'));
      return false;
    }
    return commit({ selectedCanvasNodeIds: [], localFiles: drafts });
  }, [commit, guard, t]);

  const relinkLocalFile = useCallback(async (materialType: MaterialType) => {
    const ticket = guard.capture();
    if (!guard.isCurrent(ticket)) return false;
    const result = await pickLocalFiles({ multiple: false }).catch(() => null);
    if (!guard.isCurrent(ticket)) return false;
    if (!result || !result.ok) {
      reportLocalFilePickerFailure(result, t);
      return false;
    }
    const path = result.body.path;
    if (!path) return false;
    const drafts = draftsFromPickedPaths([path]);
    const draft = drafts[0];
    if (!draft || draft.materialType !== materialType) {
      toast.warning(t('picker.unsupported'));
      return false;
    }
    const patch = buildImportedMediaData({
      realPath: draft.realPath,
      name: draft.name,
      materialType: draft.materialType,
      mime: draft.mime,
      size: draft.size,
    });
    const applied = useCanvasStore.getState().applyCanvasInputMutation({
      nodePatches: [{ nodeId, data: patch }],
    });
    if (applied.status !== 'allowed') {
      toast.error(t('picker.commitFailed'));
      return false;
    }
    return true;
  }, [guard, nodeId, t]);

  return {
    open,
    initialTab,
    sessionId,
    slotTarget,
    mode,
    targetSlotIndex,
    openPicker,
    closePicker,
    importLocalFiles,
    fillImportNode,
    relinkLocalFile,
    commit,
  };
}
