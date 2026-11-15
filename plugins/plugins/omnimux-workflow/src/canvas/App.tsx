/**
 * omnimux-workflow canvas island application root.
 *
 * Boot flow: ensure a workspace exists (create on first open) -> hydrate
 * the canvas store -> render the editor.
 *
 * M2: saving is automatic — useWorkspacePersistence debounces store
 * changes (1s), PUTs with the optimistic-lock version, resolves 409s by
 * pulling + retrying once. 顶栏「我的工作流 / 关闭 / 保存态」已去掉；
 * 冲突条仍保留，日常保存态不再占 chrome。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import CanvasEditor from './editor/CanvasEditor';
import { CanvasErrorBoundary } from './ui/CanvasErrorBoundary';
import { useExecutionController } from './hooks/useExecutionController';
import { useCanvasStore } from './store/canvasStore';
import { childIdsOfGroup } from './editor/utils/nodeVisualMath';
import { resolveNodeOutputType } from '../shared/graph/materialNode';
import { useCanvasBoot } from './hooks/useCanvasBoot';
import { setLocale, useT, type Locale } from './i18n';
import { useWorkspacePersistence } from './bridge/useWorkspacePersistence';
import { useComfyFrameSlots } from './store/comfyFrameSlots';
import { useTablePersistence } from './bridge/useTablePersistence';
import { prepareDirectorClose } from './bridge/directorLifecycle';
import { DirectorPanel } from './components/director-panel/DirectorPanel.tsx';
import type { CanvasWorkspaceSnapshot } from '../shared/canvasTypes';

export interface CanvasAppProps {
  /** 宿主可传；岛内顶栏已撤，关闭走宿主 tab / overlay。 */
  onClose?: () => void;
  /** 宿主语言（island 边界纯数据 prop），变化时下发到 i18n 模块。 */
  locale?: Locale;
  /** 专属工作区/画布 ID（实现各个项目与创作页之间 100% 独立的物理隔离） */
  workspaceId?: string;
  /** 「项目」页「AI应用」卡片「编辑」的目标工作流组 id（纯数据 prop）。 */
  focusGroupId?: string;
  /** 画布内切页/新建页后的通知，由宿主刷新工作区上下文。 */
  onActivePageChange?: (workspaceId: string) => void;
}

const App: React.FC<CanvasAppProps> = ({ locale, workspaceId: propWorkspaceId, focusGroupId, onActivePageChange }) => {
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(propWorkspaceId);

  useEffect(() => {
    setCurrentWorkspaceId(propWorkspaceId);
  }, [propWorkspaceId]);

  const t = useT();
  // 有卡片整屏时给画布根节点加类：`.react-flow` 自带层叠上下文，只有抬它才能盖住页头。
  const fullscreenComfyNode = useComfyFrameSlots((state) => state.fullscreenNodeId);
  // persist 第一轮尚未挂上时 no-op；cleanup 时 flushRef 已指向同步 capture
  const flushRef = useRef(() => {});
  const { boot, setBoot, catalog } = useCanvasBoot({
    workspaceId: currentWorkspaceId,
    beforeReset: () => {
      flushRef.current();
    },
  });

  const handleSwitchWorkspace = useCallback(async (newWorkspaceId: string) => {
    if (!await prepareDirectorClose()) return;
    flushRef.current();
    setCurrentWorkspaceId(newWorkspaceId);
    onActivePageChange?.(newWorkspaceId);
  }, [onActivePageChange]);

  // 宿主 → island 语言通道：locale prop 变化时下发（live 切换走
  // updateCanvas 重 render，W4 接入宿主 subscribe）。
  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  const workspace = boot.phase === 'ready' ? boot.workspace : null;

  const handleSaved = useCallback((snapshot: CanvasWorkspaceSnapshot) => {
    setBoot((prev) => (prev.phase === 'ready' && prev.workspace.id === snapshot.id
      ? { phase: 'ready', workspace: snapshot } : prev));
  }, [setBoot]);

  // hydrate 完成、boot.phase === 'ready' 之前禁止订阅 / flush，避免空图 autosave
  const persistence = useWorkspacePersistence(workspace, {
    onSaved: handleSaved,
    enabled: boot.phase === 'ready',
  });

  const tablePersistence = useTablePersistence({
    workspaceId: workspace ? workspace.id : null,
    enabled: boot.phase === 'ready',
  });

  flushRef.current = () => {
    persistence.flushPendingSave();
    tablePersistence.flushDirtyTables({ force: true });
  };

  // M3 execution controller: full/subset runs, SSE subscription, node-state
  // sync, and island-reload restore (re-subscribes a still-live execution).
  const execution = useExecutionController(workspace ? workspace.id : null, {
    onBeforeStart: async () => {
      await tablePersistence.saveNow();
      return persistence.saveNow();
    },
    onRunTerminal: async ({ executionId, groupId, graphHash, status }) => {
      if (!groupId) return;
      const activeWorkspaceId = workspace?.id;
      if (!activeWorkspaceId) return;
      const response = await fetch(`/omnimux-workflow/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/executions/${encodeURIComponent(executionId)}`).catch(() => null);
      if (!response || !response.ok) return;
      const payload = await response.json().catch(() => null);
      const executionSnapshot = payload?.execution ?? payload;
      if (!executionSnapshot) return;
      const canvas = useCanvasStore.getState();
      const groupNode = canvas.nodes.find((node) => node.id === groupId && node.type === 'group');
      if (!groupNode) return;
      const childIds = childIdsOfGroup(canvas.nodes, groupId);
      const childIdSet = new Set(childIds);
      const terminalIds = childIds.filter((nodeId) => !canvas.edges.some(
        (edge) => edge.source === nodeId && childIdSet.has(edge.target),
      ));
      const allCompleted = childIds.length > 0 && childIds.every(
        (nodeId) => executionSnapshot.nodeStates?.[nodeId]?.status === 'completed',
      );
      const outputs = terminalIds.flatMap((nodeId) => {
        const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
        const output = executionSnapshot.nodeOutputs?.[nodeId] as Record<string, unknown> | undefined;
        if (!node || !output) return [];
        const firstAsset = Array.isArray(output.mediaAssets)
          ? output.mediaAssets[0] as Record<string, unknown> | undefined
          : undefined;
        const text = typeof output.text === 'string' ? output.text : undefined;
        const url = typeof firstAsset?.url === 'string' ? firstAsset.url : undefined;
        if (!text && !url) return [];
        return [{
          nodeId,
          type: node.type === 'table' ? 'table' : resolveNodeOutputType(node.data),
          ...(url ? { url } : {}),
          ...(text ? { text } : {}),
        }];
      });
      const simulated = outputs.some((output) => {
        const raw = executionSnapshot.nodeOutputs?.[output.nodeId] as Record<string, unknown> | undefined;
        return raw?.simulated === true;
      });
      const verification = status === 'completed' && allCompleted && outputs.length > 0 && !simulated
        ? {
            executionId,
            graphHash: graphHash ?? '',
            completedAt: new Date().toISOString(),
            nodeStatuses: Object.fromEntries(childIds.map((nodeId) => [nodeId, 'completed' as const])),
            outputs,
            simulated: false as const,
          }
        : undefined;
      canvas.setNodes((nodes) => nodes.map((node) => (
        node.id === groupId
          ? { ...node, data: { ...(node.data ?? {}), publishVerification: verification } }
          : node
      )));
    },
  });

  if (boot.phase === 'loading') {
    // 与宿主 CanvasBridge 加载态同构：一道 1.6px 细弧 + 一行说明，单一动效。
    // 两棵 React 树只共享视觉契约（DOM 结构 + CSS），不共享组件。
    return (
      <div className="wf-canvas-root">
        <div className="wf-canvas-boot-status" role="status" aria-live="polite">
          <svg
            className="wf-canvas-boot-spinner"
            viewBox="0 0 32 32"
            width="32"
            height="32"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              className="wf-canvas-boot-spinner__arc"
              cx="16"
              cy="16"
              r="14"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray="24 64"
            />
          </svg>
          <span className="wf-canvas-boot-status__label">{t('app.loading')}</span>
        </div>
      </div>
    );
  }

  if (boot.phase === 'error') {
    return (
      <div className="wf-canvas-root">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 13, color: 'var(--wb-text-muted)' }}>
          <span>{boot.message}</span>
          <button type="button" className="wf-canvas-header__button" onClick={() => window.location.reload()}>
            {t('app.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`wf-canvas-root${fullscreenComfyNode ? ' wf-canvas-root--comfy-fullscreen' : ''}`}>
      {persistence.status === 'conflict' ? (
        <div className="wf-canvas-conflict-banner" role="alert">
          <span>
            {t('app.conflictBanner')}
          </span>
          <button type="button" className="wf-canvas-header__button" onClick={() => void persistence.resolveConflict()}>
            {t('app.conflictOverwrite')}
          </button>
          <button
            type="button"
            className="wf-canvas-header__button wf-canvas-header__button--ghost"
            onClick={() => void persistence.reloadFromServer()}
          >
            {t('app.conflictReload')}
          </button>
        </div>
      ) : null}
      <main className="wf-canvas-main">
        <CanvasErrorBoundary>
          <CanvasEditor
            catalog={catalog}
            workspaceId={workspace?.id ?? null}
            focusGroupId={focusGroupId}
            onExecuteNodeIds={(nodeIds, meta) => {
              // M4 组/子集执行入口（右键菜单）：subset 模式自动补传递上游闭包。
              void execution.startExecution({
                mode: 'subset',
                nodeIds,
                ...(meta?.groupId ? { groupId: meta.groupId } : {}),
                ...(meta?.graphHash ? { graphHash: meta.graphHash } : {}),
              });
            }}
            onPauseExecution={() => void execution.pause()}
            onResumeExecution={() => void execution.resume()}
            onCancelExecution={() => void execution.cancel()}
            onResetExecution={execution.reset}
            onSwitchWorkspaceId={handleSwitchWorkspace}
          />
          <DirectorPanel workspaceId={workspace?.id ?? null} saveGraph={persistence.saveNow} />
        </CanvasErrorBoundary>
      </main>
    </div>
  );
};

export default App;
