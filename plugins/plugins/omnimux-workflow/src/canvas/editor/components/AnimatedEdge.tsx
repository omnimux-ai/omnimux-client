/**
 * OmniMux 物理级流光连线组件 (AnimatedEdge)
 *
 * 核心交互与设计准则：
 * 1. 原生底轨完全保真（Base Edge Fidelity）：
 *    静态连线颜色、线宽与样式 100% 保持深浅色模式原本的基准设计，不篡改底线颜色；
 * 2. 节点关联触发（Node Selection Trigger）：
 *    当用户在画布中选中某个节点时，与该节点直接相连（流入/流出）的所有连线在原底轨之上点亮 MiniMax 彗星拖尾流光；
 * 3. 连线直接选中（Edge Selection）：
 *    当鼠标点击选中单条连线时，同样激活彗星流光；
 * 4. 运行态流光（Execution Flowing）：
 *    当下游节点处于 running 状态时，入边激活流光反馈；
 * 5. 拖尾数学模型（Comet Physics）：
 *    6 段微元非线性指数衰减（progress ** 1.35），104px/s 恒定流速，双主题非蓝配色。
 */

import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useCanvasStore } from '../../store/canvasStore';
import { useExecutionStore } from '../../store/executionStore';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import AnimatedBeam from './AnimatedBeam';
import EdgeDisconnectControl from './EdgeDisconnectControl';

const AnimatedEdge = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  animated,
  data,
  style,
}: EdgeProps) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // 1. 响应式订阅：当上游源节点或下游目标节点被选中时，激活流光
  const isConnectedNodeSelected = useCanvasStore((state) => {
    const activeSelectedId = state.selectedElement.id;
    if (activeSelectedId && (activeSelectedId === source || activeSelectedId === target)) {
      return true;
    }
    return state.nodes.some((node) => node.selected && (node.id === source || node.id === target));
  });

  // 2. 下游节点 running 状态激活流光
  const isTargetRunning = useExecutionStore((state) => state.nodeStatuses[target] === 'running');

  // 3. 边本身被选中或显式声明 flowing
  const isEdgeSelected = selected === true;
  const isExplicitFlowing = animated === true || (data && typeof data === 'object' && (data as Record<string, unknown>).flowing === true);

  // 综合激活判定：仅在选中相关节点、选中本边、或执行时激活流光
  const isBeamActive = isConnectedNodeSelected || isEdgeSelected || isTargetRunning || isExplicitFlowing;

  const reducedMotion = usePrefersReducedMotion();

  return (
    <g className="wf-edge-with-disconnect">
      {/* 1. 底层原版连线：100% 保持深浅色原本的连线颜色与样式 */}
      <BaseEdge
        id={id}
        path={path}
        style={style}
      />

      {/* 2. 顶层流光：仅在激活时叠加 MiniMax 6 段彗星拖尾流光（无障碍模式下静止不渲染） */}
      {isBeamActive && !reducedMotion && (
        <AnimatedBeam
          pathD={path}
          startPoint={{ x: sourceX, y: sourceY }}
          endPoint={{ x: targetX, y: targetY }}
          duration={isTargetRunning ? 0.8 : undefined}
        />
      )}

      {/* 3. 悬停断开微控制器 */}
      <EdgeDisconnectControl edgeId={id} x={labelX} y={labelY} />
    </g>
  );
};

export default memo(AnimatedEdge);
