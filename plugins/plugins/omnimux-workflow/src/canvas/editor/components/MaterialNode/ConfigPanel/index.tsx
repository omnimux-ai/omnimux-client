/**
 * ConfigPanel — 统一材质创作底栏（Issue 467 / W2；Feed-Slot 阶段二 T03/T04/T05）。
 *
 * Contract-driven:
 *   - model picker follows catalog eligibility; the selected model reassigns inputs
 *   - text adapts its operation automatically; other outputs show genuine model modes
 *   - writes canonical params.operation only
 *   - zero candidates → empty state + block generate with typed reason
 *   - Whisper / unlisted ASR never enter the DOM
 *
 * Feed-Slot:
 *   - 媒体卡槽由 deriveSlotLayout 的 preset 驱动（SlotWells），slotBindings 是消费真源；
 *   - 不再有节点内常驻静态错误条：禁用原因走 GenerateButton title/disabledReason，
 *     瞬时反馈走画板级通知（canvasNoticeService）。
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  FileText,
  FileJson,
  X,
  AlertTriangle,
  AudioLines,
} from 'lucide-react';
import { ModelCascadeMenu } from './ModelCascadeMenu';
import {
  directoryChannelGroups,
  findDefaultChannelGroup,
  findSelectedChannelGroup,
  resolveModelChannelGroups,
  resolveShortModelName,
  resolveLineConstraints,
  isByokGroup,
  isRuntimeByokChannelSettings,
  type RuntimeByokChannelSettings,
} from './channelGroups';
import {
  buildChannelContract,
  reconcileParamsWithContract,
  resolveFallbackRouting,
  type ChannelFallbackState,
} from './channelContractReconciler';
import type { MaterialNodeData, MaterialType } from '../../../../types/materialNode';
import { resolveNodeKind } from '../../../../types/materialNode';
import type { CapabilityCatalog, CapabilityModelItem } from '../../../../../shared/api';
import { useT } from '../../../../i18n';

import { CustomSelect, toast } from '../../../../ui';
import { rememberGenerationModel } from '../../../../store/generationPreferencesStore';
import { generationReasonText } from '../../../../i18n/generationReason';
import { resolveGenerationPrompt, retainAssignedPromptReferences, selectGenerationTextSources } from '../../../../../shared/graph/generationPrompt';
import { parseJsonDocumentText } from '../../../../../shared/jsonDocument.ts';
import { useCanvasStore } from '../../../../store/canvasStore';
import { useUpstreamMedia, toUpstreamSnapshots, type UpstreamMediaItem } from '../../../hooks/useUpstreamMedia';
import { useModelParameterSchema, getCachedCatalog } from '../../../hooks/useModelParameterSchema';
import { resolveNodeLifecycle } from '../../../utils/nodeMaterialLifecycle';
import { canvasNoticeService } from '../../../notices/canvasNoticeService.ts';
import GenerateButton from './GenerateButton';
import SlotWells from './SlotWells/SlotWells';
import type { SlotPickRequest } from './SlotWells/types.ts';
import { VideoTriggerBar } from './videoParams/VideoTriggerBar';
import { buildVideoParameterSelection, type VideoParameterSelections, type VideoParameterSelectionResult } from './videoParams/videoParameterSelection.ts';
import { VideoParamPopover } from './videoParams/VideoParamPopover';
import SlotHoverPreview from './SlotWells/SlotHoverPreview.tsx';
import { planPickerSelectionMutation, pickerReasonKey } from '../../../utils/resourcePickerPolicy.ts';
import { filterWrite } from './videoParams/paramSchemaFilter.ts';
import { ImageTriggerBar } from './imageParams/ImageTriggerBar';
import { ImageParamPopover } from './imageParams/ImageParamPopover';
import { resolveEffectiveImageParams } from './imageParams/imageParamAdapter';
import { resolveEffectiveAudioParams, resolveAudioPromptGate, AUDIO_PROMPT_MAX_CHARS } from './audioParams/audioParamAdapter';
import { resolveVoiceLabel } from './audioParams/voicePickerModel.ts';
import { VoicePickerDialog } from './audioParams/VoicePickerDialog';
import {
  resolveEffectiveVideoParams,
  validateVideoParamsForUi,
  buildVideoParamTransition,
} from './videoParams/videoParamAdapter';
import {
  deriveImageGenerationLayout,
  swapNamedSlots,
  type SlotBindings,
  type SlotConflict,
  type SlotSpec,
} from '../../../../../shared/graph/feedSlot/index.ts';
import { buildContractView, isPromptInput, isVisualGeneration, resolveModelView } from '../../../../../shared/validation/compatKernel.ts';
import { groupMatchesEffectiveVideoVersion, narrowCatalogByRouting, narrowModelByLineConstraints, resolveEffectiveVideoGroup, transitionEffectiveVideoParams } from '../../../../../shared/validation/lineConstraints.ts';
import { managedVideoLinePricingFingerprint } from '../../../../../shared/validation/managedVideoExecution.ts';
import { readVideoSlotDrafts, videoSlotDraftKey } from '../../../../../shared/graph/feedSlot/videoSlotDrafts.ts';
import { visualLineSelectionMessage } from '../../../../../shared/validation/executionReadiness.ts';
import { resolveUnsupportedModelUi } from '../../../../../shared/validation/modelExecutionUi.ts';
import {
  buildEffectiveOpsUiState,
  buildFilteredModelOptions,
  buildUiUpstreamFingerprint,
  setParamsOperation,
  readPreferredOperationId,
  shouldRenderModeUi,
} from '../../../../../shared/validation/operationUi.ts';
import { OperationSegment } from './videoParams/SegmentControls';
import PromptTokenEditor, { type PromptTokenEditorRef } from '../../PromptTokenEditor';
import { currentReferenceCandidates } from '../../PromptTokenEditor/referenceCandidates.ts';
import { resolveInputAssignment } from '../../../../../shared/validation/inputAssignment.ts';
import { projectCanvasInputSources } from '../../../../../shared/graph/feedSlot/legacyH3Slots.ts';
import { isCatalogGeneration, type RunSnapshotProof } from '../../../../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';

export interface ConfigPanelProps {
  nodeId: string;
  nodeData: MaterialNodeData;
  catalog: CapabilityCatalog | null;
  onUpdateNodeData: (updates: Partial<MaterialNodeData>) => void;
  onGenerate: (expectedInput?: RunSnapshotProof) => void;
  /** 全图/其他节点执行中（禁用执行入口） */
  execBusy: boolean;
  /** 本地点击提交 guard：只覆盖 create RPC，不渲染 spinner */
  isSubmitting?: boolean;
  /** 可选运行时配置（用于自备渠道 BYOK 与契约自适应） */
  runtimeSettings?: RuntimeByokChannelSettings | null;
  /** 唤起 ResourcePicker；带 SlotPickRequest 时进入卡槽装填会话，或传入 mode/targetSlotIndex。 */
  onOpenResourcePicker?: (requestOrMode?: SlotPickRequest | 'add' | 'replace', targetSlotIndex?: number) => void;
}

import { getModelVisuals } from './modelVisuals';
import { ImportConfigPanelImpl, type ImportConfigPanelProps } from './ImportConfigPanel';

const ImportConfigPanel: React.FC<ImportConfigPanelProps> = (props) => <ImportConfigPanelImpl {...props} />;

const GenerationConfigPanel: React.FC<ConfigPanelProps> = ({
  nodeId,
  nodeData,
  catalog,
  onUpdateNodeData,
  onGenerate,
  execBusy,
  isSubmitting,
  runtimeSettings,
  onOpenResourcePicker,
}) => {
  const t = useT();
  const { materialType, selectedTool, prompt } = nodeData;
  const params = (nodeData.params && typeof nodeData.params === 'object') ? nodeData.params : {};

  const [isExpanded, setIsExpanded] = useState(false);
  const [videoPopoverOpen, setVideoPopoverOpen] = useState(false);
  const videoTriggerRef = useRef<HTMLDivElement | null>(null);
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const imageTriggerRef = useRef<HTMLDivElement | null>(null);
  // T04：音色选择弹窗（schema 提供音色选项时由底栏 VoiceTrigger 唤起）
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  /** Issue #3058 FE-02：关闭弹窗后焦点恢复的真实 trigger 元素 */
  const voiceTriggerRef = useRef<HTMLButtonElement>(null);
  const promptEditorRef = useRef<PromptTokenEditorRef | null>(null);

  const [envSettings, setEnvSettings] = useState<RuntimeByokChannelSettings | undefined>(() => {
    if (typeof window !== 'undefined') {
      const raw = (window as any).__OMNIMUX_RUNTIME_SETTINGS__;
      return isRuntimeByokChannelSettings(raw) ? raw : undefined;
    }
    return undefined;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncEnvSettings = () => {
      const raw = (window as any).__OMNIMUX_RUNTIME_SETTINGS__;
      setEnvSettings(isRuntimeByokChannelSettings(raw) ? raw : undefined);
    };

    syncEnvSettings();
    window.addEventListener('omnimux:runtime-settings-changed', syncEnvSettings);
    return () => {
      window.removeEventListener('omnimux:runtime-settings-changed', syncEnvSettings);
    };
  }, []);

  const effectiveRuntimeSettings: RuntimeByokChannelSettings | undefined = useMemo(() => {
    if (isRuntimeByokChannelSettings(runtimeSettings)) {
      return runtimeSettings;
    }
    return envSettings;
  }, [runtimeSettings, envSettings]);

  const routing = (params.routing && typeof params.routing === 'object')
    ? (params.routing as { strategy?: 'auto' | 'stability_first' | 'cost_first'; allowedGroups?: string[]; channelGroupId?: string; group?: string; sourceType?: 'official' | 'byok' })
    : undefined;

  const handleInsertToken = useCallback((slotItem: {
    sourceNodeId: string;
    slotIndex: number;
    label: string;
    materialType: MaterialType;
    mediaUrl?: string;
  }) => {
    promptEditorRef.current?.insertToken({
      raw: `@ref[${slotItem.sourceNodeId}:${slotItem.slotIndex}:${slotItem.label}]`,
      nodeId: slotItem.sourceNodeId,
      slotIndex: slotItem.slotIndex,
      label: slotItem.label,
      materialType: slotItem.materialType,
      mediaUrl: slotItem.mediaUrl,
    });
  }, []);

  const handleHistoryStep = useCallback((redo: boolean) => {
    const store = useCanvasStore.getState();
    store.pushHistory();
    if (redo) store.redo(); else store.undo();
  }, []);

  const [textPreview, setTextPreview] = useState<{ anchor: HTMLElement; sourceId: string } | null>(null);
  const closeTextPreview = useCallback(() => setTextPreview(null), []);
  const upstreams = useUpstreamMedia(nodeId);
  const upstreamSnapshots = useMemo(() => toUpstreamSnapshots(upstreams), [upstreams]);
  const activeCatalog = catalog ?? getCachedCatalog();

  const isAsrTool = selectedTool === 'audio-transcription';

  const localPrompt = resolveGenerationPrompt(nodeData);

  // The fingerprint composes source content once, using the same resolver as execution.
  const fingerprint = useMemo(
    () => buildUiUpstreamFingerprint({ materialType, prompt: nodeData.prompt, content: nodeData.content, nodeFields: params, upstreams: upstreamSnapshots }),
    [params, materialType, nodeData.prompt, nodeData.content, upstreamSnapshots],
  );

  // ASR (speech_to_text) uses outputType 'text' even on a text node with audio upstream.
  const outputTypeForCompat = isAsrTool ? 'text' : materialType;

  const modelValue = typeof params?.model === 'string' ? params.model.trim() : '';
  const lineSelectionReason = isVisualGeneration(materialType) ? visualLineSelectionMessage(activeCatalog, params) : undefined;
  const visualParametersUnavailable = isVisualGeneration(materialType) && Boolean(lineSelectionReason || !activeCatalog?.models?.length);
  const managedVideo = useMemo(() => materialType === 'video'
    ? resolveEffectiveVideoGroup(activeCatalog, modelValue, params.routing) : null,
  [materialType, activeCatalog, modelValue, params.routing]);

  // 渠道组 operations 约束（如 comfyui 仅 video_multi_ref）：收窄目录后
  // 页签、选中态与提交路径天然一致，不再出现不可用的生成模式。
  const lineConstraints = useMemo(
    () => managedVideo ? null : resolveLineConstraints(
      modelValue,
      params.routing,
      directoryChannelGroups(activeCatalog, modelValue),
      effectiveRuntimeSettings,
    ),
    [modelValue, activeCatalog, params.routing, effectiveRuntimeSettings, managedVideo],
  );
  const opsCatalog = useMemo(() => {
    if (managedVideo) return narrowCatalogByRouting(activeCatalog, modelValue, params.routing, params);
    if (!activeCatalog || !lineConstraints) return activeCatalog;
    const models = activeCatalog.models?.map((model) =>
      model.id === modelValue
        ? narrowModelByLineConstraints(model, modelValue, lineConstraints)
        : model,
    );
    return models ? { ...activeCatalog, models } : activeCatalog;
  }, [activeCatalog, modelValue, lineConstraints, managedVideo, params]);

  const preferredOperationId = readPreferredOperationId(params as Record<string, unknown>, nodeData.autoOperationId);
  const currentInputs = Boolean(managedVideo) || nodeData.inputBindingVersion === 1;
  const canvasEdges = useCanvasStore((state) => state.edges);
  const assignment = useMemo(() => {
    const nodes = useCanvasStore.getState().nodes;
    const model = resolveModelView(buildContractView(opsCatalog), modelValue);
    const projected = projectCanvasInputSources(nodeId, nodeData, nodes, canvasEdges, opsCatalog, model);
    const operation = typeof params.operation === 'string' ? params.operation : undefined;
    const videoOperation = managedVideo && opsCatalog?.models?.find(row => row.id === model?.id)
      ?.operations?.find(row => row.id === operation);
    const key = videoSlotDraftKey(videoOperation || undefined);
    const drafts = readVideoSlotDrafts(nodeData.videoSlotDrafts);
    const slotBindings = key && Object.hasOwn(drafts, key) ? drafts[key] : projected.data.slotBindings as SlotBindings | undefined;
    return resolveInputAssignment({
      catalog: opsCatalog, modelId: modelValue, outputType: outputTypeForCompat,
      fingerprint: nodes.some(node => node.id === nodeId) ? projected.fingerprint : fingerprint,
      params, preferredOperationId, autoOperationId: nodeData.autoOperationId,
      forceOperationId: managedVideo ? operation : undefined,
      ignoredEdgeIds: (nodeData.slotStandbyEdgeIds ?? []) as string[],
      slotBindings, slotConflicts: (managedVideo ? [] : projected.data.slotConflicts ?? []) as SlotConflict[],
      inputBindingVersion: nodeData.inputBindingVersion,
    });
  }, [canvasEdges, fingerprint, managedVideo, modelValue, nodeData, nodeId, opsCatalog, outputTypeForCompat, params, preferredOperationId]);
  const effectiveOperationId = assignment.operationId;
  const displayedSlotLayout = useMemo(() => {
    if (materialType === 'image' && !assignment.layout.slots.some(slot => slot.type === 'image')) {
      return deriveImageGenerationLayout(opsCatalog, modelValue, effectiveOperationId) ?? assignment.layout;
    }
    return assignment.layout;
  }, [assignment.layout, effectiveOperationId, materialType, modelValue, opsCatalog]);

  const fallbackState = useMemo<ChannelFallbackState>(() => {
    const family = (activeCatalog?.[materialType] as CapabilityModelItem[] | undefined)?.find((m) => m.id === modelValue)?.family;
    const displayName = resolveShortModelName(modelValue, family);
    return resolveFallbackRouting(
      modelValue,
      displayName,
      params.routing as Record<string, unknown> | undefined,
      directoryChannelGroups(activeCatalog, modelValue),
      effectiveRuntimeSettings,
    );
  }, [modelValue, activeCatalog, materialType, params.routing, effectiveRuntimeSettings]);

  const allChannelGroups = useMemo(
    () => resolveModelChannelGroups(modelValue, directoryChannelGroups(activeCatalog, modelValue), effectiveRuntimeSettings),
    [modelValue, activeCatalog, effectiveRuntimeSettings],
  );

  const officialDefaultGroup = findDefaultChannelGroup(allChannelGroups.filter(group =>
    managedVideo?.model.effectiveVideoVersion === undefined
    || groupMatchesEffectiveVideoVersion(group, managedVideo.model.effectiveVideoVersion)));
  const slotBindings = assignment.bindings;
  const slotConflicts = (nodeData.slotConflicts ?? []) as SlotConflict[];
  const consumedFingerprint = assignment.effectiveFingerprint;
  const assignedEdgeIds = useMemo(() => new Set(assignment.assigned.map(asset => asset.edgeId)), [assignment]);
  const assignedUpstreams = useMemo(() => upstreams.filter(item => item.edgeId && assignedEdgeIds.has(item.edgeId)), [upstreams, assignedEdgeIds]);
  const textSources = useMemo(() => selectGenerationTextSources(assignment.assigned), [assignment]);
  const isPromptReferenceSlot = (spec: SlotSpec) => isPromptInput(spec) || Boolean(spec.composition);
  const promptSlots = displayedSlotLayout.slots.filter(isPromptReferenceSlot);
  const promptRecords = assignment.records.filter(({ slot }) => promptSlots.some(spec => spec.slot === slot.slot));
  const mediaLayout = { ...displayedSlotLayout, slots: displayedSlotLayout.slots.filter(spec => !isPromptReferenceSlot(spec)) };
  const textSlotEdgeIds = useMemo(() => new Set(assignment.records
    .filter(record => record.slot.type === 'text').map(record => record.occupant.edgeId)), [assignment]);
  const textOnlySources = useMemo(() => textSources.filter(source => source.type !== 'document'
    && !textSlotEdgeIds.has(source.edgeId)), [textSources, textSlotEdgeIds]);
  const documentSources = useMemo(() => {
    const edges = new Set(consumedFingerprint.assets.filter(asset => asset.type === 'document' && !asset.targetSlot)
      .map(asset => asset.edgeId));
    return upstreams.filter(source => edges.has(source.edgeId))
      .map(source => ({ source, parsed: parseJsonDocumentText(source.documentText) }));
  }, [consumedFingerprint, upstreams]);
  const documentValidationErrors = useMemo(() => {
    const errors: string[] = [];
    for (const { source, parsed } of documentSources) {
      if (source.availability === 'waiting') {
        errors.push(source.availabilityMessage ?? `正在读取“${source.label}”的 JSON 文件…`);
      } else if (source.availability === 'unavailable') {
        errors.push(source.availabilityMessage ?? parsed.error ?? 'JSON 文件无法读取');
      } else if (!parsed.ok) {
        errors.push(parsed.error ?? 'JSON 文件无法读取');
      }
    }
    return [...new Set(errors)];
  }, [documentSources]);
  const documentDurationTarget = useMemo(() => documentSources.find(({ source, parsed }) =>
    source.availability === 'ready' && parsed.ok && parsed.duration !== undefined), [documentSources]);
  const appliedDocumentDurationRef = useRef('');

  const consumedUpstreams = useMemo(() => consumedFingerprint.assets.map((asset) => ({
    ...asset, nodeId: asset.sourceNodeId, materialType: asset.type,
    label: asset.sourceLabel,
  })), [consumedFingerprint]);
  // Model eligibility comes from the directory. The selected model reassigns supply.
  const filteredModels = useMemo(
    () => {
      const candidates = buildFilteredModelOptions({
      catalog: activeCatalog,
      outputType: outputTypeForCompat,
      // Capability tools (audio transcription) get their seam's contract models; every other
      // tool keeps the curated generative whitelist.
      tool: selectedTool,
      allowUnassignedInputs: true,
      });
      if (materialType !== 'video') return candidates;
      const options = candidates.options.filter(row => row.executable !== false && row.inputIncompatible !== true
        && !(managedVideo?.model.id === row.id && row.effectiveVideoVersion === undefined)
        && (row.effectiveVideoVersion === undefined || row.channelGroups?.some(group => groupMatchesEffectiveVideoVersion(group, row.effectiveVideoVersion!))));
      return { ...candidates, options, zeroCandidates: options.length === 0 };
    },
    [activeCatalog, outputTypeForCompat, selectedTool, materialType, managedVideo],
  );

  // ---- 不可执行型号（Issue #4103 / AC7）----
  // gateway-only 行（本地无 adapter，如 wan-3.0）仍进目录但置灰；已有节点若保存了这类
  // 型号，生成必须禁用并给出「一键切换」到同族可执行型号，而不是让用户配完再失败。
  const executorUi = useMemo(() => {
    // A saved unsupported model may no longer be in the public bucket (the
    // gateway still sells it, but there is no adapter). Reuse the directory
    // row so old nodes get the same disabled-generation message and switch
    // target as live rows; never feed it into the picker itself.
    const directoryRow = activeCatalog?.models?.find((row) => row.id === modelValue);
    const currentCandidate = directoryRow && !filteredModels.options.some((row) => row.id === modelValue)
      ? {
          id: directoryRow.id,
          label: directoryRow.label,
          family: directoryRow.family,
          executionStatus: directoryRow.executionStatus,
          executable: directoryRow.selectable !== false && directoryRow.executionStatus === 'ready',
        }
      : undefined;
    return resolveUnsupportedModelUi(
      modelValue,
      currentCandidate ? [...filteredModels.options, currentCandidate] : filteredModels.options,
    );
  }, [activeCatalog, filteredModels.options, modelValue]);
  const selectedModelUnsupported = executorUi.unsupported;

  const modelOptions = useMemo(() => {
    return filteredModels.options.map((row) => {
      const visuals = getModelVisuals(row.id, {
        family: row.family,
        kind: outputTypeForCompat,
        brandId: row.brandId,
        brandName: row.brandName,
        brandIconPath: row.brandIconPath,
        label: row.label,
        brands: activeCatalog?.brands,
      });
      const icon = visuals.icon;
      const badge = row.badge ?? visuals.badge;
      const subtitle = row.subtitle ?? visuals.subtitle;
      return {
        value: row.id,
        label: row.id,
        triggerLabel: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {icon ? <span style={{ display: 'inline-flex', opacity: 0.8 }}>{icon}</span> : null}
            <span>{row.id}</span>
          </span>
        ),
        icon,
        badge,
        subtitle,
        disabled: row.executable === false,
      };
    });
  }, [filteredModels.options, outputTypeForCompat, activeCatalog?.brands]);


  const {
    schema,
    modelItem,
  } = useModelParameterSchema(materialType, modelValue, catalog);

  const parameterSelections = nodeData.parameterSelections as VideoParameterSelections | undefined;
  const commitVideoSelection = useCallback((transition: VideoParameterSelectionResult, userPickedMode = false) => {
    onUpdateNodeData({ params: transition.params, parameterSelections: transition.parameterSelections,
      ...(userPickedMode ? { autoOperationId: null } : {}) });
  }, [onUpdateNodeData]);
  const commitManagedVideoSelection = useCallback((next: Record<string, unknown>, undoStep: boolean) =>
    useCanvasStore.getState().applyCanvasInputMutation(
      { nodePatches: [{ nodeId, data: { params: next, autoOperationId: null } }] },
      { undoStep },
    ), [nodeId]);
  const videoSelection = useMemo(() => materialType === 'video' && !managedVideo && !lineSelectionReason
    && activeCatalog?.models?.length ? buildVideoParameterSelection({
      params, parameterSelections, currentModelItem: modelItem, targetModelItem: modelItem,
      catalog: activeCatalog, upstreams: upstreamSnapshots, prompt: localPrompt,
      autoOperationId: nodeData.autoOperationId,
      ignoredEdgeIds: (nodeData.slotStandbyEdgeIds ?? []) as string[],
    }) : null, [materialType, params, parameterSelections, modelItem, activeCatalog, upstreamSnapshots, localPrompt, nodeData.slotStandbyEdgeIds, nodeData.autoOperationId, managedVideo, lineSelectionReason]);
  const migrationCatalogRef = useRef(new Map<string, CapabilityCatalog>());
  const migrationKey = `${String(nodeData.__workspaceId ?? '')}:${nodeId}`;
  useEffect(() => {
    if (!videoSelection?.parameterSelections || !activeCatalog || migrationCatalogRef.current.get(migrationKey) === activeCatalog) return;
    const liveState = useCanvasStore.getState();
    // Undo is authoritative, including after this panel unmounts and remounts.
    if (liveState.future.length > 0) return;
    const liveNode = liveState.nodes.find(node => node.id === nodeId);
    if (liveNode && liveNode.data.params !== params) return;
    migrationCatalogRef.current.set(migrationKey, activeCatalog);
    if (JSON.stringify(videoSelection.params) === JSON.stringify(params)
      && JSON.stringify(videoSelection.parameterSelections) === JSON.stringify(parameterSelections)) return;
    commitVideoSelection(videoSelection);
  }, [videoSelection, params, parameterSelections, commitVideoSelection, activeCatalog, nodeId, migrationKey]);

  const updateParam = useCallback(
    (key: string, value: unknown) => {
      if (visualParametersUnavailable) return;
      if (managedVideo && activeCatalog) {
        const change = key === 'operation' && typeof value === 'string'
          ? { operationId: value } : { parameter: { key, value } };
        const next = transitionEffectiveVideoParams(activeCatalog, managedVideo, params, params.routing, change);
        if (next) commitManagedVideoSelection(next, key === 'operation');
        return;
      }
      if (key === 'operation') {
        const nextOpId = typeof value === 'string' ? value : undefined;
        if (materialType === 'video' && modelItem) {
          const transition = buildVideoParameterSelection({
            params, parameterSelections, currentModelItem: modelItem, targetModelItem: modelItem,
            catalog: activeCatalog, upstreams: upstreamSnapshots, prompt: localPrompt,
            nextOperationId: nextOpId,
            autoOperationId: null,
            runtimeSettings: effectiveRuntimeSettings,
            ignoredEdgeIds: (nodeData.slotStandbyEdgeIds ?? []) as string[],
          });
          commitVideoSelection(transition, true);
          return;
        }
        const next = setParamsOperation(
          params as Record<string, unknown>,
          nextOpId,
        );
        // 用户拍板过的生成方式写 null 标记：此后上游素材不再改写它。
        onUpdateNodeData({ params: next, autoOperationId: null });
        return;
      }
      // T04：视频参数写入经声明式白名单过滤（hidden / 非白名单键被剥离）。
      const patch = materialType === 'video'
        ? filterWrite({ [key]: value }, typeof params.operation === 'string' ? params.operation : undefined)
        : { [key]: value };
      if (Object.keys(patch).length === 0) return;
      if (materialType === 'video') {
        commitVideoSelection(buildVideoParameterSelection({
          params: { ...params, ...patch }, parameterSelections, currentModelItem: modelItem, targetModelItem: modelItem,
          catalog: activeCatalog, upstreams: upstreamSnapshots, prompt: localPrompt, runtimeSettings: effectiveRuntimeSettings,
          autoOperationId: nodeData.autoOperationId,
          ignoredEdgeIds: (nodeData.slotStandbyEdgeIds ?? []) as string[],
        }));
      } else onUpdateNodeData({ params: { ...params, ...patch } });
    },
    [activeCatalog, materialType, modelItem, onUpdateNodeData, params, localPrompt, upstreamSnapshots, parameterSelections, commitVideoSelection, effectiveRuntimeSettings, managedVideo, commitManagedVideoSelection, visualParametersUnavailable],
  );

  /**
   * Issue #3058 FE-02：统一关闭路径。微任务聚焦 trigger——React 提交后
   * 弹窗已卸载、原生事件已结算，Element.focus 对已断开的节点是 no-op。
   * Escape 已由弹窗组件在 capture 阶段隔离，宿主节点不再被顺带失选，
   * trigger 仍挂在 DOM 上可聚焦。
   */
  const closeVoicePicker = useCallback(() => {
    setVoicePickerOpen(false);
    queueMicrotask(() => {
      voiceTriggerRef.current?.focus();
    });
  }, []);

  const handleSelectVoice = useCallback(
    (voiceType: string) => {
      updateParam('voice', voiceType);
      closeVoicePicker();
    },
    [updateParam, closeVoicePicker],
  );

  const opsState = useMemo(() => buildEffectiveOpsUiState({
    catalog: opsCatalog, modelId: modelValue, fingerprint: consumedFingerprint,
    assignment, outputType: outputTypeForCompat,
  }), [assignment, consumedFingerprint, modelValue, opsCatalog, outputTypeForCompat]);
  const showModeUi = materialType !== 'image' && shouldRenderModeUi(opsState);

  // 视频节点的有效参数（contract-driven operation + schema scrubbing）
  const videoEffectiveParams = useMemo(
    () =>
      materialType === 'video'
        ? resolveEffectiveVideoParams({
            params,
            schema,
            modelItem,
            catalog: managedVideo ? opsCatalog : activeCatalog,
            lineConstraints,
            effectiveVideoGroup: managedVideo ? managedVideo.group ?? null : undefined,
            opsState,
            assignment,
            prompt: consumedFingerprint.prompt,
            autoOperationId: nodeData.autoOperationId,
          })
        : null,
    [materialType, params, schema, modelItem, activeCatalog, lineConstraints, opsState, assignment, consumedFingerprint.prompt, nodeData.autoOperationId, managedVideo, opsCatalog],
  );

  // Issue #27: a JSON document's duration becomes the effective video duration
  // when the selected model declares that parameter. The ref prevents a user's
  // later edit from being overwritten by the same document on every render.
  useEffect(() => {
    if (lineSelectionReason || materialType !== 'video' || !documentDurationTarget || !videoEffectiveParams) return;
    const durationSchema = videoEffectiveParams.schema?.duration;
    if (!durationSchema) return;
    const value = documentDurationTarget.parsed.duration;
    if (value === undefined) return;
    if (durationSchema.range) {
      if (value < durationSchema.range.min || value > durationSchema.range.max) return;
    } else {
      const options = durationSchema.options?.map((option) => Number(option.value)) ?? [];
      if (options.length > 0 && !options.includes(value)) return;
    }
    const key = `${documentDurationTarget.source.nodeId}:${value}`;
    if (appliedDocumentDurationRef.current === key) return;
    appliedDocumentDurationRef.current = key;
    updateParam('duration', value);
  }, [lineSelectionReason, materialType, documentDurationTarget, videoEffectiveParams, updateParam]);

  // 图像节点的有效参数（读侧清洗回退，不回写 nodeData）
  const imageEffectiveParams = useMemo(
    () =>
      materialType === 'image'
        ? resolveEffectiveImageParams({
            params,
            schema,
            modelItem,
            catalog: activeCatalog,
            opsState,
          })
        : null,
    [materialType, params, schema, modelItem, activeCatalog, opsState],
  );

  // 音频（非 ASR）节点的有效参数（读侧清洗回退，不回写 nodeData）
  const audioEffectiveParams = useMemo(
    () =>
      materialType === 'audio' && !isAsrTool
        ? resolveEffectiveAudioParams({
            params,
            schema,
            modelItem,
            catalog: activeCatalog,
            opsState,
          })
        : null,
    [materialType, isAsrTool, params, schema, modelItem, activeCatalog, opsState],
  );

  // T04：音色目录（schema.voice.options 为真源，含 VoiceOptionMeta）
  const voiceCatalogOptions = useMemo(
    () => (materialType === 'audio' && !isAsrTool
      ? audioEffectiveParams?.schema.voice?.options ?? []
      : []),
    [materialType, isAsrTool, audioEffectiveParams],
  );

  const hasUpstreamAudio = assignment.assigned.some(input => input.type === 'audio');
  // Issue #763：时长由文本长度决定，底栏不再有音频参数浮层；
  // 只要 schema 提供音色选项，底栏即常驻 VoiceTrigger + VoicePickerDialog。
  const showVoicePicker = voiceCatalogOptions.length > 0;
  const selectedVoiceOption = useMemo(
    () => voiceCatalogOptions.find((option) => option.value === audioEffectiveParams?.voice),
    [voiceCatalogOptions, audioEffectiveParams],
  );

  // T03：朗读正文字数闸门（Unicode code point 计，10000 上限）
  const audioPromptGate = useMemo(
    () => (materialType === 'audio' && !isAsrTool ? resolveAudioPromptGate(prompt) : null),
    [materialType, isAsrTool, prompt],
  );

  const patchSlotBindings = useCallback(
    (next: SlotBindings) => {
      useCanvasStore.getState().applyCanvasInputMutation({
        nodePatches: [{ nodeId, data: { slotBindings: next } }],
      });
    },
    [nodeId],
  );

  const handleModelChange = useCallback(
    (newModelId: string, channelSelection?: { strategy: string; allowedGroups?: string[]; channelGroupId?: string; sourceType?: 'official' | 'byok' }) => {
      const candidate = filteredModels.options.find((row) => row.id === newModelId);
      if (!candidate || candidate.executable === false || candidate.inputIncompatible === true) return;
      let nextParams: Record<string, unknown>;
      const scopedSelections = typeof parameterSelections !== 'undefined' ? parameterSelections : undefined;
      const scopedModelItem = typeof modelItem !== 'undefined' ? modelItem : undefined;
      let nextSelections = scopedSelections;
      const modelList = (activeCatalog?.[materialType] ?? []) as CapabilityModelItem[];
      const newModelItem = modelList.find((m) => m.id === newModelId);
      let nextOperation: string | undefined;
      const directoryGroups = directoryChannelGroups(activeCatalog, newModelId);
      const availableGroups = resolveModelChannelGroups(newModelId, directoryGroups, effectiveRuntimeSettings);
      const matchedGroup = channelSelection?.allowedGroups?.length || channelSelection?.channelGroupId
        ? findSelectedChannelGroup(availableGroups, channelSelection, null, true)
        : channelSelection ? findDefaultChannelGroup(availableGroups) : undefined;
      if (channelSelection && !matchedGroup && (channelSelection.allowedGroups?.length || channelSelection.channelGroupId || availableGroups.length)) return;
      const nextRouting = matchedGroup ? {
        strategy: channelSelection?.strategy ?? 'auto',
        allowedGroups: [matchedGroup.id],
        ...(isByokGroup(matchedGroup) ? { channelGroupId: matchedGroup.id, sourceType: 'byok' } : {}),
      } : (channelSelection ? null : undefined);
      const target = materialType === 'video' ? resolveEffectiveVideoGroup(activeCatalog, newModelId, nextRouting) : null;
      if (target && activeCatalog) {
        if (!target.group) return;
        const quotedRouting = {
          ...nextRouting, channelGroupId: target.group.id, sourceType: 'official',
          videoLineQuote: managedVideoLinePricingFingerprint(target.group),
        };
        const next = transitionEffectiveVideoParams(activeCatalog, target, params, quotedRouting);
        if (!next) return;
        if (commitManagedVideoSelection(next, true).status !== 'allowed') return;
        void rememberGenerationModel(materialType, newModelId).catch((error: unknown) => {
          console.warn('Unable to save the generation model preference', error);
        });
        return;
      }
      if (materialType === 'video' && newModelItem) {
        const transition = typeof buildVideoParameterSelection !== 'undefined'
          ? buildVideoParameterSelection({
              params, parameterSelections: scopedSelections, currentModelItem: scopedModelItem, targetModelItem: newModelItem,
              catalog: activeCatalog, upstreams: upstreamSnapshots, prompt: localPrompt, routing: nextRouting, explicitModelSelection: true,
              runtimeSettings: effectiveRuntimeSettings,
              autoOperationId: nodeData.autoOperationId,
              ignoredEdgeIds: (nodeData.slotStandbyEdgeIds ?? []) as string[],
            })
          : (buildVideoParamTransition as any)(params, newModelItem, {
              catalog: activeCatalog, upstreams: upstreamSnapshots, prompt: localPrompt,
            });
        nextParams = transition.params;
        if (transition.parameterSelections) nextSelections = transition.parameterSelections;
        nextOperation = readPreferredOperationId(nextParams);
      } else if (channelSelection && newModelId === params.model) {
        nextParams = { ...params };
        nextOperation = readPreferredOperationId(nextParams);
      } else {
        nextOperation = resolveInputAssignment({
          catalog: activeCatalog, modelId: newModelId, fingerprint, outputType: outputTypeForCompat,
          preferredOperationId, slotBindings: nodeData.slotBindings, ignoredEdgeIds: nodeData.slotStandbyEdgeIds,
        }).operationId;
        nextParams = setParamsOperation({ ...params, model: newModelId }, nextOperation);
      }
      if (nextRouting) nextParams.routing = nextRouting;
      else if (nextRouting === null) delete nextParams.routing;

      if (matchedGroup && materialType !== 'video') {
        const contract = buildChannelContract(newModelId, matchedGroup);
        nextParams = reconcileParamsWithContract(nextParams, contract).nextParams;
      }

      onUpdateNodeData({
        params: nextParams,
        ...(materialType === 'video' && nextSelections ? { parameterSelections: nextSelections } : {}),
      });
      void rememberGenerationModel(materialType, newModelId).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t('panel.preferenceSaveFailed'));
      });
    },
    [filteredModels.options, activeCatalog, materialType, onUpdateNodeData, params, upstreamSnapshots, localPrompt, fingerprint, outputTypeForCompat, preferredOperationId, t, parameterSelections, modelItem, effectiveRuntimeSettings, nodeData.slotBindings, nodeData.slotStandbyEdgeIds, commitManagedVideoSelection],
  );

  const isMusicOperation = opsState.selectedOperationId === 'text_to_music';

  const handleSwapSlots = useCallback(
    (firstSlot: SlotSpec, lastSlot: SlotSpec) => {
      patchSlotBindings(swapNamedSlots(slotBindings, firstSlot, lastSlot));
    },
    [patchSlotBindings, slotBindings],
  );

  const handleSwapOrderedSlot = useCallback((slot: string, firstEdgeId: string, secondEdgeId: string) => {
    const store = useCanvasStore.getState();
    store.pushHistory(true);
    const result = store.applyCanvasInputMutation({ orderedSlotSwap: { targetNodeId: nodeId, slot, firstEdgeId, secondEdgeId } });
    if (result.status !== 'allowed') { toast.error(t(pickerReasonKey(result.reasonCode))); return; }
    store.pushHistory(true);
  }, [nodeId, t]);

  const handleSetUse = useCallback((slot: string, edgeId: string, use: 'active' | 'inactive') => {
    const store = useCanvasStore.getState();
    const live = store.nodes.find(node => node.id === nodeId);
    const liveParams = live?.data.params as Record<string, unknown> | undefined;
    const prepared = planPickerSelectionMutation({ nodes: store.nodes, edges: store.edges }, {
      targetNodeId: nodeId, chosenOperationId: String(liveParams?.operation ?? ''), setUse: { slot, edgeId, use },
    }, { catalog: store.catalogRuntime });
    if (!prepared.mutation || prepared.status !== 'allowed') { toast.error(t(pickerReasonKey(prepared.reasonCode))); return; }
    store.pushHistory();
    const result = store.applyCanvasInputMutation(prepared.mutation);
    if (result.status !== 'allowed') { toast.error(t(pickerReasonKey(result.reasonCode))); return; }
    store.pushHistory(true);
  }, [nodeId, t]);

  // Legacy unversioned supply unloading remains separate from explicit current use.
  // 卸装填：只摘除槽位占用，供给边保留，素材回到 Feed。
  const handleClearOccupant = useCallback(
    (slot: string, edgeId: string) => {
      const standby = Array.isArray(nodeData.slotStandbyEdgeIds) ? nodeData.slotStandbyEdgeIds : [];
      useCanvasStore.getState().applyCanvasInputMutation({
        nodePatches: [{ nodeId, data: {
          slotBindings: { ...nodeData.slotBindings, [slot]: (slotBindings[slot] ?? []).filter((occupant) => occupant.edgeId !== edgeId) },
          slotStandbyEdgeIds: [...new Set([...standby, edgeId])],
          slotConflicts: slotConflicts.filter((conflict) => conflict.occupant.edgeId !== edgeId),
        } }],
      });
    },
    [nodeId, nodeData.slotBindings, nodeData.slotStandbyEdgeIds, slotBindings, slotConflicts],
  );

  const handleClearTextSource = useCallback((sourceNodeId: string) => {
    const edge = canvasEdges.find((e) => e.source === sourceNodeId && e.target === nodeId);
    if (edge) {
      const standby = Array.isArray(nodeData.slotStandbyEdgeIds) ? nodeData.slotStandbyEdgeIds : [];
      useCanvasStore.getState().applyCanvasInputMutation({
        nodePatches: [{ nodeId, data: {
          slotStandbyEdgeIds: [...new Set([...standby, edge.id])],
        } }],
      });
    }
  }, [canvasEdges, nodeId, nodeData.slotStandbyEdgeIds]);

  const handlePickSlot = useCallback((request: SlotPickRequest) => onOpenResourcePicker?.(request), [onOpenResourcePicker]);


  // 必需槽位缺口：空卡槽自解释，提交按钮 disabledReason 同步提示。
  const slotLabelOf = useCallback(
    (spec: SlotSpec) => {
      const label = t(spec.labelKey);
      return label === spec.labelKey ? spec.slot : label;
    },
    [t],
  );
  const hasSlots = mediaLayout.slots.length > 0;

  const placeholder = useMemo(() => {
    if (currentInputs) {
      const composition = displayedSlotLayout.slots.find(spec => spec.composition)?.composition;
      if (composition?.kind === 'single_body' || composition?.localRole === 'body') return t('input.body');
      if (composition?.localRole === 'lyrics') return t('input.lyrics');
      if (composition?.localRole === 'style') return t('input.music');
      if (composition?.kind === 'separate_roles' && composition.localRole === 'instruction') return t('input.instructions');
      return t(textSources.length > 0 ? 'input.supplement' : 'input.prompt');
    }
    if (isAsrTool) return t('panel.promptPlaceholder');
    if (materialType !== 'audio' && textSources.some((item) => item.availability === 'ready' && item.textContent?.trim()))
      return t('panel.supplementOptional');
    if (materialType === 'image') return t('panel.imagePromptPlaceholder');
    if (materialType === 'video') return t('panel.videoPromptPlaceholder');
    switch (materialType) {
      case 'text':
        return t('panel.textPromptPlaceholder');
      case 'audio':
        return isMusicOperation
          ? t('panel.musicPromptPlaceholder')
          : t('panel.audioPromptPlaceholder');
      default:
        return t('panel.promptPlaceholder');
    }
  }, [materialType, isMusicOperation, isAsrTool, textSources, t, currentInputs, displayedSlotLayout]);

  const videoValidationErrors = useMemo(
    () => [...new Set([
      ...documentValidationErrors,
      ...(materialType === 'video' && videoEffectiveParams
        ? [...(videoSelection?.errors ?? []),
            ...videoEffectiveParams.blocked.map((item) => item.message),
            ...validateVideoParamsForUi({
              prompt: consumedFingerprint.prompt,
              rawParams: params as Record<string, unknown>,
              params: { ...videoEffectiveParams, effectiveOperations: opsState.effectiveOps },
              upstreams: consumedUpstreams.filter((source) => ['image', 'video', 'audio'].includes(source.materialType)),
            })]
        : []),
    ])],
    [documentValidationErrors, materialType, consumedFingerprint.prompt, params, consumedUpstreams, videoEffectiveParams, opsState.effectiveOps, videoSelection],
  );

  const reasonCode = opsState.reasonCode ?? filteredModels.reasonCode;
  const failure = assignment.blocked[0];
  const failedSlot = failure?.slot && displayedSlotLayout.slots.find(slot => slot.slot === failure.slot);
  const operationReason = !assignment.ready || filteredModels.zeroCandidates
    ? failedSlot && failure?.code === 'min_unsatisfied' ? t('panel.slotMissing').replace('{slots}', slotLabelOf(failedSlot))
      : failure?.code === 'prompt_required' && currentInputs ? t('input.reason.body')
      : failure?.code === 'parameter_unsupported' ? failure.message
      : generationReasonText(t, reasonCode, failure ?? filteredModels.reason) || t('notice.submitBlocked')
    : videoValidationErrors[0];
  const readinessReason = lineSelectionReason
    || (fallbackState?.isFallback ? fallbackState.runBlockedReason || t('notice.submitBlocked') : undefined)
    || (audioPromptGate?.exceeded ? `朗读正文不能超过 ${AUDIO_PROMPT_MAX_CHARS} 字符` : undefined)
    || operationReason;
  const blockGenerate = execBusy || Boolean(readinessReason) || selectedModelUnsupported;
  const blockReason = readinessReason || (selectedModelUnsupported ? t('panel.modelUnsupported') : undefined);

  const showEmptyModels = modelOptions.length === 0;
  const showLineRecovery = !showEmptyModels && Boolean(lineSelectionReason || fallbackState?.isFallback);
  const pickerGroupRef = useRef<HTMLDivElement>(null);
  const openLinePicker = useCallback(() => {
    const trigger = pickerGroupRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    if (!trigger || trigger.disabled) return;
    trigger.focus();
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  }, []);

  // T05：禁用态点击 → 画板 Toast（4s 自动淡出），不再渲染常驻静态错误条。
  const handleDisabledGenerateClick = useCallback(() => {
    if (lineSelectionReason && showLineRecovery) {
      openLinePicker();
      return;
    }
    if (fallbackState?.isFallback) {
      toast.error(fallbackState.runBlockedReason || '请配置自备 Key 或切换可用渠道');
      return;
    }
    canvasNoticeService.publish({
      kind: 'submit_blocked_click',
      message: blockReason || t('notice.submitBlocked'),
    });
  }, [fallbackState, blockReason, lineSelectionReason, openLinePicker, showLineRecovery, t]);

  return (
    <div className="wf-config-panel" data-effective-ops={opsState.count}>
      {showLineRecovery ? (
        <div
          className="wf-config-panel__fallback-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--dsw-alias-bg-layer-2)',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1)',
            marginBottom: 8,
            gap: 12,
          }}
          role="alert"
          data-testid="wf-channel-fallback-banner"
        >
          <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
            {lineSelectionReason ?? '自备渠道已不可用，请重选线路'}
          </span>
          <button
            type="button"
            disabled={execBusy}
            onClick={() => {
              if (!fallbackState?.isFallback || !officialDefaultGroup) {
                openLinePicker();
                return;
              }
              handleModelChange(modelValue, {
                strategy: 'auto',
                allowedGroups: [officialDefaultGroup.id],
                sourceType: 'official',
              });
            }}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'var(--dsw-alias-interactive-bg-hover)',
              color: 'var(--dsw-alias-text-primary)',
              border: '1px solid var(--dsw-alias-border-l2)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            data-testid="wf-channel-fallback-action"
          >
            {fallbackState?.isFallback && officialDefaultGroup ? '切换为官方默认线路' : '重选线路'}
          </button>
        </div>
      ) : null}

      {videoValidationErrors.length > 0 && !opsState.blockGenerate && !showEmptyModels ? (
        <div className="wf-config-panel__validation-list" role="alert" data-testid="wf-video-validation-errors">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{videoValidationErrors.join('；')}</span>
        </div>
      ) : null}

      {textPreview && <SlotHoverPreview anchor={textPreview.anchor}
        upstream={upstreams.find((source) => source.nodeId === textPreview.sourceId)} onClose={closeTextPreview} />}
      {/* 2. Prompt 输入区容器 */}
      <div className="wf-config-panel__prompt-container">
        <div className={`wf-config-panel__prompt-header${!hasSlots && !textSources.length ? ' wf-config-panel__prompt-header--empty-slots' : ''}`}>
          {documentSources.length > 0 && (
            <div className="wf-slot-wells wf-slot-wells--strip" data-testid="wf-document-inputs">
              {documentSources.map(({ source, parsed }) => {
                const invalid = source.availability !== 'ready' || !parsed.ok;
                const status = source.availability === 'waiting'
                  ? t('panel.documentInput.reading')
                  : invalid
                    ? (source.availabilityMessage ?? parsed.error ?? t('panel.documentInput.invalid'))
                    : t('panel.documentInput.readFields').replace('{fields}', [
                        parsed.prompt !== undefined ? 'prompt' : '',
                        parsed.duration !== undefined ? 'duration' : '',
                      ].filter(Boolean).join('、'));
                return (
                  <div
                    key={source.nodeId}
                    className={`wf-document-input${invalid ? ' wf-document-input--invalid' : ''}`}
                    data-testid="wf-document-input"
                    data-document-node-id={source.nodeId}
                    data-document-state={invalid ? 'invalid' : 'ready'}
                    title={source.label}
                  >
                    <span className="wf-document-input__icon"><FileJson size={18} aria-hidden="true" /></span>
                    <span className="wf-document-input__copy">
                      <strong className="wf-document-input__name">{source.label}</strong>
                      <span className="wf-document-input__meta">
                        <span className="wf-document-input__type">{t('panel.documentInput.typeJson')}</span>
                        <span>{t('panel.documentInput.source').replace('{source}', source.label)}</span>
                        {parsed.ignoredFields.length > 0 && !invalid ? (
                          <span className="wf-document-input__ignored">{t('panel.documentInput.ignored').replace('{fields}', parsed.ignoredFields.join('、'))}</span>
                        ) : null}
                      </span>
                      <span className="wf-document-input__status">{status}</span>
                    </span>
                    <button
                      type="button"
                      className="wf-document-input__remove nodrag"
                      title={t('panel.documentInput.remove')}
                      aria-label={t('panel.documentInput.remove')}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleClearTextSource(source.nodeId);
                      }}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {textOnlySources.length > 0 && (
            <div className="wf-slot-wells wf-slot-wells--strip" data-testid="wf-text-inputs">
              {textOnlySources.map((source) => (
                <div key={source.sourceNodeId} className="wf-effective-text wf-effective-text--slot" data-source-node-id={source.sourceNodeId}
                  data-input-state={source.availability} title={source.sourceLabel} role="button" tabIndex={0}
                  onClick={(event) => setTextPreview({ anchor: event.currentTarget, sourceId: source.sourceNodeId })}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTextPreview({ anchor: event.currentTarget, sourceId: source.sourceNodeId }); } }}>
                  <FileText size={18} aria-hidden="true" />
                  <span><strong>{source.sourceLabel || source.sourceNodeId}</strong>
                    <span>{source.availability === 'ready' && source.textContent?.trim()
                      ? source.textContent : t(source.availability === 'unavailable' ? 'mention.unavailable' : 'mention.waiting')}</span>
                  </span>
                  <button
                    type="button"
                    className="wf-effective-text__remove nodrag"
                    title={t('mention.unbind')}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearTextSource(source.sourceNodeId);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {hasSlots && (
            <SlotWells
              layout={mediaLayout}
              bindings={slotBindings}
              records={assignment.records}
              onSetUse={currentInputs ? handleSetUse : undefined}
              conflicts={slotConflicts}
              upstreams={upstreams}
              onPickSlot={handlePickSlot}
              onSwapSlots={handleSwapSlots}
              onSwapOrderedSlot={handleSwapOrderedSlot}
              onClearOccupant={handleClearOccupant}
              onInsertToken={handleInsertToken}
            />
          )}

          <div className="wf-config-panel__prompt-header-actions">
            <button
              type="button"
              className="wf-config-panel__expand-btn"
              onClick={() => setIsExpanded((prev) => !prev)}
              title={isExpanded ? t('panel.collapse') : t('panel.expand')}
            >
              {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>

        <PromptTokenEditor
          ref={promptEditorRef}
          className={`wf-config-panel__prompt-input nowheel nodrag${
            isExpanded ? ' wf-config-panel__prompt-input--expanded' : ''
          }`}
          value={retainAssignedPromptReferences(prompt ?? '', assignment.assigned)}
          placeholder={placeholder}
          rows={isExpanded ? 8 : 2}
          isExpanded={isExpanded}
          currentReferences={currentReferenceCandidates(assignedUpstreams, slotBindings)}
          onHistoryStep={handleHistoryStep}
          materialType={materialType}
          maxLength={audioPromptGate ? AUDIO_PROMPT_MAX_CHARS : undefined}
          countOverride={audioPromptGate ? audioPromptGate.count : undefined}
          onChange={(newPrompt) => onUpdateNodeData({ prompt: newPrompt })}
        >
          <textarea
            className="wf-config-panel__prompt-textarea-hidden"
            style={{ display: 'none' }}
            rows={isExpanded ? 8 : 2}
            value={retainAssignedPromptReferences(prompt ?? '', assignment.assigned)}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
        </PromptTokenEditor>
        {promptRecords.length > 0 && (
          <SlotWells
            presentation="prompt"
            layout={{ ...displayedSlotLayout, slots: promptSlots }}
            bindings={slotBindings}
            records={promptRecords}
            conflicts={slotConflicts}
            upstreams={upstreams}
            onPickSlot={handlePickSlot}
            onSetUse={currentInputs ? handleSetUse : undefined}
            onClearOccupant={handleClearOccupant}
          />
        )}
      </div>

      {/* 3. 底部参数与操作底栏 */}
      <div className="wf-config-panel__bottom-bar">
        <div ref={pickerGroupRef} className="wf-config-panel__params-group">
          {/* 模型下拉：仅兼容模型；零候选显示空态 */}
          {showEmptyModels ? (
            <div
              className="wf-param-pill wf-param-pill--empty-models"
              data-testid="wf-model-empty"
              role="status"
              aria-live="polite"
            >
              {t(reasonCode === 'catalog_unavailable' ? 'panel.reason.catalog_unavailable' : isAsrTool ? 'panel.noTranscriptionModel' : 'panel.noCompatibleModel')}
            </div>
          ) : isAsrTool ? (
            <CustomSelect
              className="wf-param-bar__select wf-param-bar__select--model"
              value={modelValue}
              options={modelOptions}
              popupMatchSelectWidth={false}
              onChange={(value) => handleModelChange(String(value))}
            />
          ) : (
            <ModelCascadeMenu
              modelValue={modelValue}
              routing={routing}
              options={filteredModels.options}
              brands={activeCatalog?.brands}
              execBusy={execBusy}
              runtimeSettings={effectiveRuntimeSettings}
              fallbackState={fallbackState}
              lineSelectionRequired={Boolean(lineSelectionReason)}
              onSelect={({ modelId, strategy, allowedGroups, channelGroupId, sourceType }) => {
                handleModelChange(modelId, { strategy, allowedGroups, channelGroupId, sourceType });
              }}
            />
          )}

          {/* T04：音色触发入口（模型下拉右侧），唤起 VoicePickerDialog */}
          {showVoicePicker ? (
            <button
              ref={voiceTriggerRef}
              type="button"
              className={`wf-voice-trigger ${hasUpstreamAudio ? 'is-locked-by-upstream' : ''}`}
              data-testid="wf-voice-trigger"
              disabled={execBusy || hasUpstreamAudio}
              title={
                hasUpstreamAudio
                  ? '已关联上游参考音频（音色复刻模式）；如需挑选内置音色库，请先移除上游输入连线'
                  : (selectedVoiceOption ? `音色：${resolveVoiceLabel(selectedVoiceOption)}` : '选择音色')
              }
              onClick={() => {
                if (!hasUpstreamAudio) setVoicePickerOpen(true);
              }}
            >
              <AudioLines size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="wf-voice-trigger__label">
                {hasUpstreamAudio
                  ? '参考音频模式'
                  : (selectedVoiceOption ? resolveVoiceLabel(selectedVoiceOption) : '选择音色')}
              </span>
            </button>
          ) : null}

          {/* 文本 / ASR 保持内联生成方式入口；图像的生成方式进自身浮层（Issue #763：音频时长由文本长度决定，无参数浮层）。 */}
          {showModeUi && (materialType === 'text' || isAsrTool) ? (
            <>
              <span className="wf-param-pill__divider" aria-hidden="true" />
              <div data-testid="wf-operation-mode-inline">
                <OperationSegment
                  value={opsState.selectedOperationId || ''}
                  operations={opsState.effectiveOps}
                  onChange={(operationId) => updateParam('operation', operationId)}
                />
              </div>
            </>
          ) : null}

          {/* 图像专属参数：单行摘要 TriggerBar + Portal 浮层（废除幽灵 Select 与前置 `|`） */}
          {materialType === 'image' && imageEffectiveParams && (
            <div ref={imageTriggerRef} className="wf-cfg-summary-bar__wrap">
              <ImageTriggerBar
                params={imageEffectiveParams}
                isOpen={imagePopoverOpen}
                disabled={execBusy || visualParametersUnavailable}
                onToggle={() => setImagePopoverOpen((p) => !p)}
              />
            </div>
          )}

          {/* 视频专属参数胶囊：四段式摘要 TriggerBar + Portal 浮层 */}
          {materialType === 'video' && videoEffectiveParams && (
            <div ref={videoTriggerRef} className="wf-video-trigger-bar__wrap">
              <VideoTriggerBar
                params={videoEffectiveParams}
                isOpen={videoPopoverOpen}
                disabled={execBusy || visualParametersUnavailable}
                onToggle={() => setVideoPopoverOpen((p) => !p)}
              />
            </div>
          )}
        </div>

        {/* 右侧生成按钮 */}
        <div className="wf-config-panel__action-group">
          <GenerateButton
            onClick={() => onGenerate(assignment.fingerprint && isCatalogGeneration({ id: nodeId, type: 'material', data: nodeData })
              ? { fingerprint: assignment.fingerprint, contractFingerprint: assignment.contractFingerprint }
              : undefined)}
            disabled={blockGenerate}
            disabledReason={blockReason}
            onDisabledClick={handleDisabledGenerateClick}
            isSubmitting={isSubmitting}
            isGenerating={
              nodeData.executionStatus === 'running'
              || nodeData.executionStatus === 'pending'
              || resolveNodeLifecycle({ type: nodeData.materialType, data: nodeData as any }) === 'loading'
            }
          />
        </div>
      </div>

      {/* 视频参数浮层（Portal 挂载，随面板根部渲染） */}
      {materialType === 'video' && videoEffectiveParams && (
        <VideoParamPopover
          triggerRef={videoTriggerRef as React.RefObject<HTMLElement>}
          params={videoEffectiveParams}
          schema={videoEffectiveParams.choiceSchema ?? videoEffectiveParams.schema}
          modelItem={modelItem}
          isOpen={videoPopoverOpen}
          onClose={() => setVideoPopoverOpen(false)}
          onParamChange={(key, value) => updateParam(key as string, value)}
        />
      )}

      {/* 图像参数浮层（Portal 挂载，随面板根部渲染） */}
      {materialType === 'image' && imageEffectiveParams && (
        <ImageParamPopover
          triggerRef={imageTriggerRef}
          params={imageEffectiveParams}
          isOpen={imagePopoverOpen}
          onClose={() => setImagePopoverOpen(false)}
          onParamChange={(key, value) => updateParam(key, value)}
        />
      )}

      {/* T04：音色选择弹窗（选中即写回 params.voice 并关闭） */}
      {showVoicePicker ? (
        <VoicePickerDialog
          open={voicePickerOpen}
          options={voiceCatalogOptions}
          {...(audioEffectiveParams?.voice ? { value: audioEffectiveParams.voice } : {})}
          onClose={closeVoicePicker}
          onSelect={handleSelectVoice}
        />
      ) : null}
    </div>
  );
};

export interface ConfigPanelErrorBoundaryProps {
  children: React.ReactNode;
  nodeId: string;
}

interface ConfigPanelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ConfigPanelErrorBoundary extends React.Component<
  ConfigPanelErrorBoundaryProps,
  ConfigPanelErrorBoundaryState
> {
  constructor(props: ConfigPanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ConfigPanelErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[ConfigPanel ErrorBoundary] 节点 ${this.props.nodeId} 配置面板渲染异常:`, error, errorInfo);
  }

  private handleResetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="wf-config-panel wf-config-panel--error"
          style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--dsw-alias-state-danger)',
          }}
        >
          <span>配置面板局部加载异常</span>
          <button
            type="button"
            className="wf-param-pill wf-param-pill--btn"
            style={{ padding: '2px 8px', height: '24px' }}
            onClick={this.handleResetError}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ConfigPanel: React.FC<ConfigPanelProps> = (props) => {
  const kind = resolveNodeKind(props.nodeData);
  return (
    <ConfigPanelErrorBoundary nodeId={props.nodeId}>
      {kind === 'import' ? (
        <ImportConfigPanel
          nodeData={props.nodeData}
          execBusy={props.execBusy}
          onOpenResourcePicker={props.onOpenResourcePicker}
        />
      ) : (
        <GenerationConfigPanel {...props} />
      )}
    </ConfigPanelErrorBoundary>
  );
};

export default memo(ConfigPanel);
