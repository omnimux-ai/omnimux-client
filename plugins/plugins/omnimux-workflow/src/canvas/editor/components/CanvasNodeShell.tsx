/**
 * CanvasNodeShell — 通用工作流节点容器组件。
 *
 * 核心规范：
 * 1. 统一外层包裹 `wf-node-shell wf-material-node` 与选中态 `wf-material-node--selected`；
 * 2. 内置 `useViewport` 与 `inverseScaleForZoom`，计算全局统一反向缩放因子；
 * 3. 管理 4 个角标定位点（`wf-node-corner--tl/tr/bl/br`，在 selected 态显示）；
 * 4. 内置管理左/右连接桩（`CanvasNodeHandle`），Hover 驱动连接锚点高亮；
 * 5. 管理 DragOver 本地文件拖拽投喂，自动附着 `wf-material-node__card--dragover`；
 * 6. 提供标准插槽：
 *    - `renderFloatingPill`：顶部悬浮胶囊栏插槽
 *    - `renderHeader`：节点顶部外置标题栏插槽
 *    - `children`：主卡片内容区域
 *    - `renderConfigPanel`：底部折叠配置面板插槽
 */

import React, { memo, useCallback, useMemo, useState } from 'react';
import { useViewport } from '@xyflow/react';
import CanvasNodeHandle, {
  type CanvasNodeHandleSelectMeta,
} from './CanvasNodeHandle';
import type { CanvasNodeActionMenuOption } from './CanvasNodeActionMenu';
import { inverseScaleForZoom } from '../utils/nodeVisualMath';
import { useIsMultiSelected } from '../../store/canvasStore';

export interface CanvasNodeShellSlotMeta {
  inverseScale: number;
  hovered: boolean;
  selected: boolean;
  isMultiSelected?: boolean;
}

export interface CanvasNodeShellProps {
  /** 节点 ID（用于辅助定位/标识） */
  id?: string;
  /** React Flow 传入的选中状态 */
  selected?: boolean;
  /** 外层容器附加类名 */
  className?: string;
  /** 卡片主体附加类名 */
  cardClassName?: string;
  /** 外层容器自定义样式 */
  style?: React.CSSProperties;
  /** 卡片主体自定义样式 */
  cardStyle?: React.CSSProperties;
  /** 节点类型标识（挂载到 card 的 data-node-type） */
  dataNodeType?: string;
  /** 节点宽度 */
  nodeWidth?: number | string;
  /** 节点高度 */
  nodeHeight?: number | string;

  // ========== Handle 配置 ==========
  showLeftHandle?: boolean;
  showRightHandle?: boolean;
  leftHandleVariant?: 'plus' | 'plain';
  rightHandleVariant?: 'plus' | 'plain';
  rightHandleOptions?: CanvasNodeActionMenuOption[];
  onRightHandleSelect?: (key: string, meta?: CanvasNodeHandleSelectMeta) => void;
  leftHandleOptions?: CanvasNodeActionMenuOption[];
  onLeftHandleSelect?: (key: string, meta?: CanvasNodeHandleSelectMeta) => void;

  // ========== 文件拖拽投喂 ==========
  onFileDrop?: (file: File) => void;
  onFilesDrop?: (files: FileList | File[]) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;

  // ========== 交互事件 ==========
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCardClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCardDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;

  // ========== 插槽 ==========
  /** 顶部悬浮胶囊栏 */
  renderFloatingPill?:
    | React.ReactNode
    | ((meta: CanvasNodeShellSlotMeta) => React.ReactNode);
  /** 节点顶部外置标题栏 */
  renderHeader?:
    | React.ReactNode
    | ((meta: CanvasNodeShellSlotMeta) => React.ReactNode);
  /** 主卡片内容 */
  children?: React.ReactNode;
  /** 底部配置面板 */
  renderConfigPanel?:
    | React.ReactNode
    | ((meta: CanvasNodeShellSlotMeta) => React.ReactNode);
}

export const CanvasNodeShell: React.FC<CanvasNodeShellProps> = ({
  id,
  selected = false,
  className = '',
  cardClassName = '',
  style,
  cardStyle,
  dataNodeType,
  nodeWidth,
  nodeHeight,

  showLeftHandle = true,
  showRightHandle = true,
  leftHandleVariant = 'plain',
  rightHandleVariant = 'plus',
  rightHandleOptions,
  onRightHandleSelect,
  leftHandleOptions,
  onLeftHandleSelect,

  onFileDrop,
  onFilesDrop,
  onDragOver,
  onDragLeave,
  onDrop,

  onMouseEnter,
  onMouseLeave,
  onCardClick,
  onCardDoubleClick,

  renderFloatingPill,
  renderHeader,
  children,
  renderConfigPanel,
}) => {
  const [hovered, setHovered] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isMultiSelected = useIsMultiSelected();

  const { zoom } = useViewport();
  const inverseScale = useMemo(() => inverseScaleForZoom(zoom), [zoom]);

  const slotMeta: CanvasNodeShellSlotMeta = useMemo(
    () => ({
      inverseScale,
      hovered,
      selected: selected && !isMultiSelected,
      isMultiSelected,
    }),
    [inverseScale, hovered, selected, isMultiSelected],
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setHovered(true);
      onMouseEnter?.(e);
    },
    [onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setHovered(false);
      onMouseLeave?.(e);
    },
    [onMouseLeave],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(true);
      onDragOver?.(e);
    },
    [onDragOver],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      onDragLeave?.(e);
    },
    [onDragLeave],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        onFilesDrop?.(files);
        if (files[0]) {
          onFileDrop?.(files[0]);
        }
      }
      onDrop?.(e);
    },
    [onDrop, onFileDrop, onFilesDrop],
  );

  const floatingPillContent = !isMultiSelected
    ? (typeof renderFloatingPill === 'function'
        ? renderFloatingPill(slotMeta)
        : renderFloatingPill)
    : null;

  const headerContent = typeof renderHeader === 'function'
    ? renderHeader(slotMeta)
    : renderHeader;

  const configPanelContent = !isMultiSelected
    ? (typeof renderConfigPanel === 'function'
        ? renderConfigPanel(slotMeta)
        : renderConfigPanel)
    : null;

  return (
    <div
      className={`wf-node-shell wf-material-node ${selected ? 'wf-material-node--selected' : ''} ${className}`.trim()}
      style={{
        width: nodeWidth,
        ...style,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-node-id={id}
    >
      {/* 顶部悬浮胶囊栏 */}
      {floatingPillContent}

      {/* 左侧连接桩 */}
      {showLeftHandle && (
        <CanvasNodeHandle
          side="left"
          nodeHovered={hovered}
          variant={leftHandleVariant}
          options={leftHandleOptions}
          onSelect={onLeftHandleSelect}
        />
      )}

      {/* 顶部外置标题栏 */}
      {headerContent}

      {/* 主卡片 */}
      <div
        className={`wf-material-node__card ${
          isDraggingOver ? 'wf-material-node__card--dragover' : ''
        } ${cardClassName}`.trim()}
        style={{
          width: nodeWidth,
          height: nodeHeight,
          ...cardStyle,
        }}
        data-node-type={dataNodeType}
        onClick={onCardClick}
        onDoubleClick={onCardDoubleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 四角缩放定位点（选中态） */}
        {selected && (
          <>
            <span className="wf-node-corner wf-node-corner--tl" />
            <span className="wf-node-corner wf-node-corner--tr" />
            <span className="wf-node-corner wf-node-corner--bl" />
            <span className="wf-node-corner wf-node-corner--br" />
          </>
        )}

        {/* 卡片主体内容 */}
        {children}
      </div>

      {/* 底部配置面板 */}
      {configPanelContent}

      {/* 右侧连接桩 */}
      {showRightHandle && (
        <CanvasNodeHandle
          side="right"
          nodeHovered={hovered}
          variant={rightHandleVariant}
          options={rightHandleOptions}
          onSelect={onRightHandleSelect}
        />
      )}
    </div>
  );
};

export default memo(CanvasNodeShell);
