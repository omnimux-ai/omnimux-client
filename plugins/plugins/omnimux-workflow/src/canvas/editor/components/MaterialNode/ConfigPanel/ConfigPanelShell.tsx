/**
 * ConfigPanelShell — 单层一体化浮层外壳。
 *
 * 直接挂载在所属节点 DOM 内，跟随节点正下方 12px 居中展开，
 * 通过 scale(1/zoom) 抵消画布缩放，保持面板屏幕尺寸恒定且不切分画布。
 */

import React, { memo, useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { inverseScaleForZoom } from '../../../utils/nodeVisualMath';

export interface ConfigPanelShellProps {
  children: React.ReactNode;
  /** 面板宽度（屏幕像素，反缩放后恒定） */
  width?: number;
}

const DEFAULT_WIDTH = 480;

const ConfigPanelShell: React.FC<ConfigPanelShellProps> = ({
  children,
  width = DEFAULT_WIDTH,
}) => {
  const { zoom } = useViewport();

  // 反向缩放：抵消画布缩放，面板屏幕尺寸恒定
  const counterScale = useMemo(() => inverseScaleForZoom(zoom), [zoom]);

  return (
    <div
      className="wf-panel-shell nodrag nowheel nopan"
      style={{
        width,
        top: 'calc(100% + 12px)',
        left: '50%',
        marginLeft: -width / 2,
        transform: `scale(${counterScale})`,
        transformOrigin: 'top center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wf-panel-shell__card">{children}</div>
    </div>
  );
};

export default memo(ConfigPanelShell);
