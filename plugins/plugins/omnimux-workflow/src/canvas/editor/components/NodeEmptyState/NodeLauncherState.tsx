/**
 * NodeLauncherState — 通用节点启动器/代理空态引导组件。
 *
 * 统一标准范式：
 * 1. 居中主图标 + 次级图标徽章（mainIcon / secondaryIcon）；
 * 2. 标题与说明引导文案（title / blurb）；
 * 3. 操作建议提示词（suggestionsTitle / "试试:"）；
 * 4. 药丸操作按钮组（`wf-node-empty__pill-btn`），支持 Primary / Default 变体；
 * 5. 阻止画布底层拖拽手势捕获（`nodrag` 与 `stopPropagation`）。
 */

import React, { memo } from 'react';
import { useT } from '../../../i18n';

export interface NodeLauncherAction {
  key: string;
  label: React.ReactNode;
  icon?:
    | React.ComponentType<{ size?: number; className?: string }>
    | React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'default' | 'primary';
  disabled?: boolean;
  title?: string;
  className?: string;
}

export interface NodeLauncherStateProps {
  /** 居中主图标 */
  mainIcon?:
    | React.ComponentType<{ size?: number; className?: string }>
    | React.ReactNode;
  /** 叠加次级图标 */
  secondaryIcon?:
    | React.ComponentType<{ size?: number; className?: string }>
    | React.ReactNode;
  /** 标题 */
  title?: React.ReactNode;
  /** 引导说明文案 */
  blurb?: React.ReactNode;
  /** 建议栏标题（如 "试试:"） */
  suggestionsTitle?: React.ReactNode;
  /** 药丸操作按钮列表 */
  actions?: NodeLauncherAction[];
  /** 自定义附加内容 */
  children?: React.ReactNode;
  /** 附加容器类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

export const NodeLauncherState: React.FC<NodeLauncherStateProps> = ({
  mainIcon,
  secondaryIcon,
  title,
  blurb,
  suggestionsTitle,
  actions,
  children,
  className = '',
  style,
}) => {
  const t = useT();

  const renderIconNode = (
    icon:
      | React.ComponentType<{ size?: number; className?: string }>
      | React.ReactNode,
    defaultSize: number,
    className?: string,
  ) => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return icon;
    }
    const IconComp = icon as React.ComponentType<{
      size?: number;
      className?: string;
    }>;
    return <IconComp size={defaultSize} className={className} />;
  };

  return (
    <div
      className={`wf-node-empty wf-node-launcher-state ${className}`.trim()}
      style={style}
    >
      {/* 图标展示区 */}
      {(mainIcon || secondaryIcon) && (
        <div className="wf-node-empty__icon-box wf-node-launcher-state__icon-box">
          {renderIconNode(mainIcon, 36, 'wf-node-empty__icon')}
          {secondaryIcon && (
            <span className="wf-node-launcher-state__sub-icon">
              {renderIconNode(secondaryIcon, 14)}
            </span>
          )}
        </div>
      )}

      {/* 标题 */}
      {title && (
        <h4 className="wf-node-launcher-state__title">{title}</h4>
      )}

      {/* 引导文案 */}
      {blurb && (
        <p className="wf-node-launcher-state__blurb">{blurb}</p>
      )}

      {/* 建议提示 */}
      {suggestionsTitle !== undefined ? (
        suggestionsTitle ? (
          <div className="wf-node-empty__try-label">{suggestionsTitle}</div>
        ) : null
      ) : actions && actions.length > 0 ? (
        <div className="wf-node-empty__try-label">{t('pills.tryLabel')}</div>
      ) : null}

      {/* 药丸操作按钮组 */}
      {actions && actions.length > 0 && (
        <div
          className="wf-node-empty__actions wf-node-launcher-state__actions nodrag"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {actions.map((action) => {
            const isPrimary = action.variant === 'primary';
            const btnClass = [
              'wf-node-empty__pill-btn',
              'wf-node-launcher-state__pill-btn',
              isPrimary ? 'wf-node-empty__pill-btn--primary wf-node-launcher-state__pill-btn--primary' : '',
              action.className || '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={action.key}
                type="button"
                className={btnClass}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick?.(e);
                }}
                disabled={action.disabled}
                title={action.title}
              >
                {action.icon && (
                  <span className="wf-node-empty__pill-icon">
                    {renderIconNode(action.icon, 14)}
                  </span>
                )}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 自定义插槽内容 */}
      {children}
    </div>
  );
};

export default memo(NodeLauncherState);
