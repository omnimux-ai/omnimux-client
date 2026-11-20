/**
 * Image Param Popover — 图像参数浮层门面（2026-09-07 全模态收敛 / T04）。
 *
 * CfgPopoverShell（Portal 契约）+ 图像区块信息架构：
 *   Section 1 比例（CfgAspectGrid 4 列，末行诚实空列；auto 走虚线几何卡）
 *   Section 2 清晰度（resolution.options → Segment；无 resolution 时 quality 补位）
 *   Section 3 高级（schema.seed）
 * 模式选择由参考图槽派生，浮层不再提供可切换控件。
 * schema 驱动显隐；写路径先 assertImageParamWriteKey 再透传宿主 updateParam。
 */

import type { ReactElement } from 'react';
import { CfgAspectGrid } from '../cfg/CfgAspectGrid.tsx';
import { CfgPopoverShell } from '../cfg/CfgPopoverShell.tsx';
import { CfgSegment } from '../cfg/CfgSegment.tsx';
import { assertImageParamWriteKey } from './imageParamAdapter.ts';
import type { ImageParamPopoverProps } from './types.ts';

/** 图像参数浮层：schema 驱动显隐，无幽灵控件。 */
export function ImageParamPopover({
  triggerRef,
  params,
  isOpen,
  onClose,
  onParamChange,
}: ImageParamPopoverProps): ReactElement | null {
  const schema = params.schema;
  const ratioOptions = schema.aspectRatio?.options ?? [];
  const resolutionOptions = schema.resolution?.options ?? [];
  const qualityOptions = schema.quality?.options ?? [];

  const writeParam = (key: string, value: unknown): void => {
    assertImageParamWriteKey(key);
    onParamChange(key, value);
  };

  return (
    <CfgPopoverShell
      triggerRef={triggerRef}
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="图像参数配置"
    >
      <div className="wf-cfg-popover__scrollable" data-show-mode="false">
        {ratioOptions.length > 0 ? (
          <section className="wf-cfg-popover__section">
            <h4 className="wf-cfg-popover__section-title">比例</h4>
            <CfgAspectGrid
              value={params.aspectRatio}
              options={ratioOptions}
              onChange={(v) => writeParam('aspectRatio', v)}
            />
          </section>
        ) : null}

        {resolutionOptions.length > 0 ? (
          <section className="wf-cfg-popover__section" data-testid="wf-image-clarity-section">
            <h4 className="wf-cfg-popover__section-title">清晰度</h4>
            <CfgSegment
              options={resolutionOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
              value={params.resolution}
              onChange={(v) => writeParam('resolution', v)}
              ariaLabel="清晰度"
            />
          </section>
        ) : null}

        {qualityOptions.length > 0 ? (
          <section className="wf-cfg-popover__section" data-testid="wf-image-quality-section">
            <h4 className="wf-cfg-popover__section-title">质量</h4>
            <CfgSegment
              options={qualityOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
              value={params.quality}
              onChange={(v) => writeParam('quality', v)}
              ariaLabel="质量"
            />
          </section>
        ) : null}
      </div>
    </CfgPopoverShell>
  );
}

export default ImageParamPopover;
