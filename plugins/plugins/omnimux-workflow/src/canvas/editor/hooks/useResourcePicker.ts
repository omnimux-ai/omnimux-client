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
  planImportNodeFill,
  planResourcePickerCommit,
  planPickerSelectionMutation,
  pickerReasonKey,
  resourcePickerContextKey,
  validatesNamedPickerSelection,
  type LocalFileDraft,
  type ResourcePickerTab,
  type ResourcePickerMode,
} from '../utils/resourcePickerPolicy.ts';
import { draftFromRealPath, draftsFromPickedPaths } from '../utils/localFileDraft.ts';
import { buildImportedMediaData, extensionOf, extensionsForMaterialType } from '../../../shared/localMedia.ts';
import { readNodeInputSource } from '../../../shared/graph/nodeInputSource.ts';
import { MATERIAL_TYPES, type MaterialType } from '../../../shared/graph/materialNode.ts';
import type { NodeSlotEngineState } from '../../../shared/graph/slotContractTypes.ts';

export interface ResourcePickerSlotTarget {
  /** 目标 slot 名（内核 SlotSpec.slot）。 */
  slot?: string;
  /** 该 slot 接受的素材类型。 */
  acceptedTypes: string[];
  /** 槽位上限；null 表示官方未公布上限。 */
  max: number | null;
  replaceEdgeId?: string;
  contextKey?: string;
  openerAnchor?: HTMLElement;
  onReturnFocus?: (anchor: HTMLElement) => void;
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
  commit: (payload: {
    selections?: Array<{ sourceNodeId: string; outputId: string; targetSlot?: string; role?: string }>;
    chosenOperationId?: string;
    chosenRouteId?: string;
    selectedCanvasNodeIds: string[];
    localFiles: LocalFileDraft[];
    mode?: ResourcePickerMode;
    targetSlotIndex?: number;
  }) => boolean;
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
      guard.deactivate();
      setSessionId((id) => id + 1);
      setInitialTab(tab);
      if (typeof target === 'string') {
        setMode(target as ResourcePickerMode);
        setSlotTarget(null);
        setTargetSlotIndex(slotIdx);
      } else {
        const state = useCanvasStore.getState();
        setMode(target?.replaceEdgeId ? 'replace' : 'add');
        setSlotTarget(target ? {
          ...target,
          contextKey: resourcePickerContextKey(state.nodes.find(node => node.id === nodeId), { catalog: state.catalogRuntime }),
        } : null);
        setTargetSlotIndex(slotIdx);
      }
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

  const commit = useCallback(
    (payload: {
      selections?: Array<{ sourceNodeId: string; outputId: string; targetSlot?: string; role?: string }>;
    chosenOperationId?: string;
    chosenRouteId?: string;
    selectedCanvasNodeIds: string[];
      localFiles: LocalFileDraft[];
      mode?: ResourcePickerMode;
      targetSlotIndex?: number;
    }) => {
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
      if (!validatesNamedPickerSelection(pickerInput) || (slotTarget?.slot && payload.selections?.some(selection => {
        const source = state.nodes.find(node => node.id === selection.sourceNodeId);
        return !source || readNodeInputSource(source).outputId !== selection.outputId;
      }))) {
        toast.error(t(pickerReasonKey('input_changed')));
        return false;
      }
      if (targetNode?.data.inputBindingVersion === 1) {
        const params = targetNode.data.params as Record<string, unknown> | undefined;
        if (!payload.localFiles.length && !payload.selections?.length) return false;
        const prepared = planPickerSelectionMutation({ nodes: state.nodes, edges: state.edges }, {
          targetNodeId: nodeId,
          chosenOperationId: payload.chosenOperationId ?? String(params?.operation ?? ''),
          chosenRouteId: payload.chosenRouteId,
          selections: payload.selections,
          replaceEdgeId: slotTarget?.replaceEdgeId,
          replaceSlot: slotTarget?.replaceEdgeId ? slotTarget.slot : undefined,
        }, context, { files: payload.localFiles, targetSlot: slotTarget?.slot });
        if (prepared.status !== 'allowed' || !prepared.mutation) {
          toast.error(t(pickerReasonKey(prepared.reasonCode)));
          return false;
        }
        state.pushHistory();
        const applied = state.applyCanvasInputMutation(prepared.mutation);
        if (applied.status !== 'allowed') {
          toast.error(t(pickerReasonKey(applied.reasonCode)));
          return false;
        }
        state.pushHistory(true);
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
    [closePicker, guard, mode, nodeId, slotTarget, t, targetSlotIndex],
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
