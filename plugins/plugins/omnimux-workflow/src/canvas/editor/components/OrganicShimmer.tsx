/**
 * OrganicShimmerOverlay — Transitions.dev Pro 级别有机流体微光折射动效组件
 *
 * 结构与 components.css:570-761 严格对齐：
 * 1. .wf-organic-shimmer: 宿主容器（含阶段背景与裁切）
 * 2. .wf-organic-shimmer__canvas: -20px 扩展画布
 *    - .wf-organic-shimmer__field: 多色环状光谱背景场（多彩弥散底光）
 *    - .wf-organic-shimmer__distortion: SVG 湍流折射液体波浪层（核心有机流动效果）
 *    - .wf-organic-shimmer__glow-layer: 外圈边缘发光系统（deep / mid / border）
 *    - .wf-organic-shimmer__mask: 动态同步线性过渡遮罩层
 * 3. .wf-organic-shimmer__content: 内容插槽
 */

import React, { type FC, type ReactNode } from 'react';

export interface OrganicShimmerOverlayProps {
  children?: ReactNode;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
  playing?: boolean;
}

export const OrganicShimmerOverlay: FC<OrganicShimmerOverlayProps> = ({
  children,
  borderRadius = 'inherit',
  className = '',
  style = {},
  playing = true,
}) => {
  return (
    <div
      className={`wf-organic-shimmer ${className}`}
      style={{
        borderRadius,
        ...style,
      }}
      data-playing={playing ? 'true' : 'false'}
    >
      <div className="wf-organic-shimmer__canvas" aria-hidden="true">
        {/* 1. 多色环状光谱背景场（多彩弥散底光） */}
        <div className="wf-organic-shimmer__field" />

        {/* 2. SVG 湍流折射液体波浪层（核心有机流动效果） */}
        <div className="wf-organic-shimmer__distortion" />

        {/* 3. 外圈边缘发光多层系统 */}
        <div className="wf-organic-shimmer__glow-layer">
          <div className="wf-organic-shimmer__glow-wrap">
            <div className="wf-organic-shimmer__glow-deep" />
            <div className="wf-organic-shimmer__glow-mid" />
            <div className="wf-organic-shimmer__glow-border" />
          </div>
        </div>

        {/* 4. 动态同步线性过渡遮罩层（与背景色融合） */}
        <div className="wf-organic-shimmer__mask" />
      </div>

      {/* 5. 内部内容槽位 */}
      {children ? (
        <div className="wf-organic-shimmer__content">
          {children}
        </div>
      ) : null}
    </div>
  );
};

export default OrganicShimmerOverlay;
