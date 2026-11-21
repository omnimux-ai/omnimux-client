/**
 * video_composition — canvas Launcher Card for omnimux-clip.
 *
 * The card and workbench navigation share the launcher, and the canvas root owns Clip replies.
 * Canvas MUST NOT import omnimux-clip source (spec §2).
 *
 * 表现层（T4 拉齐 MaterialNode 规范）：
 * - 外置 NodeHeader + StatusBadge（mapVideoCompositionToBadge）；
 * - 主卡片三分支：launcher / rendering / error
 *   （成片预览由下游素材节点承载；本节点导出后仍保持 launcher）；
 * 节点保留原有 ports、executorKey 和尺寸。
 */

import { memo, useCallback, useContext, useEffect } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Download, Film, Layers, Pencil, MessageSquarePlus } from 'lucide-react';
import CanvasNodeShell from '../../editor/components/CanvasNodeShell';
import FloatingTopPill, { type FloatingPillAction } from '../../editor/components/FloatingTopPill';
import { useAddToConversation } from '../../hooks/useAddToConversation';
import {
  buildConversationPayloadFromNode,
  hasNodeMaterial,
  pillMaxWidthForNode,
  shouldShowNodeToolbar,
} from '../../editor/utils/nodeToolbarLogic';
import NodeHeader from '../../editor/components/MaterialNode/NodeHeader';
import StatusBadge from '../../editor/components/MaterialNode/StatusBadge';
import GenerationStateContainer from '../../editor/components/GenerationStateContainer';
import NodeLauncherState from '../../editor/components/NodeEmptyState/NodeLauncherState';
import { VIDEO_COMPOSITION_NODE_WIDTH, planClipExportDownstream } from './videoCompositionDownstream';
import { openCanvasClipNode } from '../../bridge/canvasClipActions';
import { CanvasClipLauncher, updateClipNodeData } from '../../bridge/clipLauncher';
import {
  mapVideoCompositionToBadge,
  mapVideoCompositionToView,
  projectFileName,
} from './videoCompositionStatus';
import { useCanvasStore } from '../../store/canvasStore';
import { useT } from '../../i18n';
import type { NodeDefinition } from '../registry';
import { newCanvasClipProjectId, type VideoCompositionNodeData, type VideoCompositionStatus } from '../../bridge/clipEvents';

export { VIDEO_COMPOSITION_NODE_WIDTH } from './videoCompositionDownstream';
export const VIDEO_COMPOSITION_NODE_HEIGHT = 440;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function createDefaultVideoCompositionData(): VideoCompositionNodeData {
  return {
    title: '视频合成',
    label: '视频合成',
    status: 'idle',
    schemaVersion: '1.0',
    projectId: newCanvasClipProjectId(),
  };
}

const VideoCompositionNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as VideoCompositionNodeData;
  const workspaceId = asString(nodeData.__workspaceId);
  const launchClip = useContext(CanvasClipLauncher);
  const applyCanvasInputMutation = useCanvasStore((state) => state.applyCanvasInputMutation);
  const t = useT();

  const status: VideoCompositionStatus = nodeData.status ?? 'idle';
  const hasOutput = Boolean(nodeData.outputVideoUrl);
  const title = nodeData.title || nodeData.label || t('node.type.video_composition');

  const view = mapVideoCompositionToView(status, hasOutput);

  const updateNodeData = useCallback((updates: Partial<VideoCompositionNodeData>) => {
    updateClipNodeData(id, updates);
  }, [id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!nodeData.outputVideoUrl) return;
    const store = useCanvasStore.getState();
    const currentNode = store.nodes.find((n) => n.id === id);
    const plan = planClipExportDownstream({
      sourceNodeId: id,
      sourcePosition: currentNode?.position || { x: 0, y: 0 },
      sourceLabel: nodeData.title || nodeData.label || t('node.type.video_composition'),
      output: {
        videoPath: nodeData.outputVideoUrl,
        thumbnailPath: nodeData.thumbnailUrl || nodeData.outputThumbnailUrl,
        durationMs: nodeData.outputDurationMs,
        width: nodeData.outputWidth,
        height: nodeData.outputHeight,
        revision: nodeData.outputRevision,
      },
      currentNodes: store.nodes,
      currentEdges: store.edges,
      nodeWidth: VIDEO_COMPOSITION_NODE_WIDTH,
      createIfMissing: false,
    });
    if (!plan) return;
    applyCanvasInputMutation({
      addEdges: plan.addEdges,
      nodePatches: plan.nodePatches,
      removeEdgeIds: plan.removeEdgeIds,
    });
  }, [
    applyCanvasInputMutation,
    id,
    nodeData.label,
    nodeData.outputDurationMs,
    nodeData.outputHeight,
    nodeData.outputRevision,
    nodeData.outputThumbnailUrl,
    nodeData.outputVideoUrl,
    nodeData.outputWidth,
    nodeData.thumbnailUrl,
    nodeData.title,
    t,
  ]);

  const openEditor = useCallback(() => {
    if (launchClip) return launchClip(id);
    // The standalone canvas harness renders CanvasEditor without App.
    if (workspaceId && typeof window !== 'undefined') void openCanvasClipNode({
      workspaceId, nodeId: id, defaultTitle: title, target: window,
      readGraph: useCanvasStore.getState, updateNode: updateClipNodeData, stillCurrent: () => true,
    });
  }, [id, title, workspaceId, launchClip]);

  const { addToConversation } = useAddToConversation();

  const handleAddToConversation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = buildConversationPayloadFromNode({
      nodeType: 'video_composition',
      nodeId: id,
      label: projectFileName(title),
      outputVideoUrl: nodeData.outputVideoUrl,
      duration: (nodeData as { durationText?: string }).durationText || '0:31',
    });
    if (payload) addToConversation(payload);
  }, [addToConversation, id, nodeData.outputVideoUrl, title]);

  const handleDownload = useCallback(() => {
    const url = nodeData.outputVideoUrl;
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectFileName(title)}.mp4`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [nodeData.outputVideoUrl, title]);

  return (
    <CanvasNodeShell
      id={id}
      selected={selected}
      nodeWidth={VIDEO_COMPOSITION_NODE_WIDTH}
      nodeHeight={VIDEO_COMPOSITION_NODE_HEIGHT}
      dataNodeType="video_composition"
      showLeftHandle={true}
      showRightHandle={true}
      leftHandleVariant="plain"
      rightHandleVariant="plain"
      onCardDoubleClick={(event) => {
        event.stopPropagation();
        openEditor();
      }}
      renderFloatingPill={({ hovered, selected: isSelected, isMultiSelected }) => {
        const hasMaterial = hasNodeMaterial({
          nodeType: 'video_composition',
          outputVideoUrl: nodeData.outputVideoUrl,
        });
        if (!shouldShowNodeToolbar({
          hasMaterial,
          hovered,
          selected: isSelected,
          isMultiSelected,
        })) return null;
        const pillActions: FloatingPillAction[] = [
          {
            key: 'download_video',
            label: t('pill.download'),
            icon: Download,
            section: 'primary',
            onClick: handleDownload,
            title: t('clip.downloadTitle'),
          },
          {
            key: 'add-to-conversation',
            icon: MessageSquarePlus,
            section: 'secondary',
            onClick: handleAddToConversation,
            title: t('pill.addToConversation'),
          },
        ];
        return (
          <FloatingTopPill
            actions={pillActions}
            maxWidth={pillMaxWidthForNode(VIDEO_COMPOSITION_NODE_WIDTH)}
          />
        );
      }}
      renderHeader={() => (
        <NodeHeader
          label={title}
          materialType="video_composition"
          customIcon={<Film size={14} />}
          onLabelChange={(newLabel) => updateNodeData({ label: newLabel, title: newLabel })}
          trailing={<StatusBadge status={mapVideoCompositionToBadge(status)} />}
        />
      )}
    >
      {view === 'rendering' && (
        <div className="wf-material-node__media">
          <GenerationStateContainer status="generating" loadingAspectRatio="video">
            {null}
          </GenerationStateContainer>
        </div>
      )}

      {view === 'error' && (
        <div className="wf-material-node__media">
          <GenerationStateContainer
            status="failed"
            loadingAspectRatio="video"
            errorMessage={nodeData.errorMessage}
            onRetry={openEditor}
          >
            {null}
          </GenerationStateContainer>
        </div>
      )}

      {view === 'launcher' && (
        <NodeLauncherState
          mainIcon={<Film size={36} strokeWidth={1.5} />}
          secondaryIcon={<Layers size={14} />}
          title={t('clip.launcherTitle')}
          blurb={t('clip.launcherBlurb')}
          actions={[
            {
              key: 'open_clip',
              label: t('clip.openClip'),
              icon: Pencil,
              onClick: () => openEditor(),
            },
          ]}
        />
      )}
    </CanvasNodeShell>
  );
};

export const videoCompositionNodeDefinition: NodeDefinition = {
  type: 'video_composition',
  component: memo(VideoCompositionNode) as unknown as NodeDefinition['component'],
  ports: [
    { side: 'in', acceptedTypes: ['text', 'image', 'video', 'audio'] },
    { side: 'out', acceptedTypes: ['video'] },
  ],
  defaultData: () => createDefaultVideoCompositionData() as unknown as Record<string, unknown>,
  configSpec: {
    promptEnabled: false,
    modelCategory: 'video',
  },
  executorKey: 'video_composition',
  palette: {
    group: 'palette.group.composition',
    label: 'palette.node.video_composition',
    icon: 'film',
    keywords: ['palette.keyword.videoComposition'],
  },
};

export default VideoCompositionNode;