/**
 * GenerateButton — 极简深色一体化生成发送按钮 (Issue #737 对齐图 2).
 *
 * 视觉规格：
 *   - 方圆角发送按钮（尺寸约 32px × 32px，圆角 8px），内居中纯白粗向上箭头 ↑（ArrowUp）；
 *   - 不展示笨重的“生成”汉字长药丸文本；
 *   - 保持禁用态点击 onDisabledClick 上浮（画板通知 submit_blocked_click）与无障碍标准。
 */

import React, { memo } from 'react';
import { ArrowUp } from 'lucide-react';
import { useT } from '../../../../i18n';

export interface GenerateButtonProps {
  onClick: () => void;
  /** execBusy：全图/其他节点执行中（禁用语义不变） */
  disabled?: boolean;
  disabledReason?: string;
  /** 禁用态被点击（发布画板通知）；不传则禁用点击静默 */
  onDisabledClick?: () => void;
  /** 本节点生成/排队中 → 静止 ArrowUp（禁用态），绝不旋转 */
  isGenerating?: boolean;
  /** 点击提交后的极短 create RPC 窗口 → 静态 …，不是 spinner */
  isSubmitting?: boolean;
  /** 兼容可选属性，不再渲染 */
  creditCost?: number;
}

const GenerateButton: React.FC<GenerateButtonProps> = ({
  onClick,
  disabled,
  disabledReason,
  onDisabledClick,
  isGenerating,
  isSubmitting,
}) => {
  const t = useT();
  const unavailable = Boolean(disabled || isGenerating || isSubmitting);
  const submissionState = isSubmitting ? 'creating' : isGenerating ? 'running' : 'idle';

  const handleAction = () => {
    if (disabled) {
      onDisabledClick?.();
      return;
    }
    if (!isGenerating && !isSubmitting) {
      onClick();
    }
  };

  return (
    <div
      className={`wf-generate-btn ${unavailable ? 'wf-generate-btn--disabled' : ''}`}
      data-submission-state={submissionState}
      onClick={handleAction}
      style={{ cursor: unavailable ? 'default' : 'pointer' }}
      role="button"
      tabIndex={0}
      aria-disabled={unavailable}
      title={disabled ? disabledReason : undefined}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleAction();
      }}
    >
      {/* 方圆角发送按钮（约 32px × 32px，圆角 8px），内居中白色粗向上箭头 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleAction();
        }}
        aria-disabled={unavailable}
        className="wf-generate-btn__send"
        aria-label={t('panel.generate')}
        title={disabled && disabledReason ? disabledReason : t('panel.generate')}
      >
        {isSubmitting ? (
          <span className="wf-generate-btn__ellipsis" aria-hidden="true">…</span>
        ) : (
          <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>
    </div>
  );
};

export default memo(GenerateButton);
