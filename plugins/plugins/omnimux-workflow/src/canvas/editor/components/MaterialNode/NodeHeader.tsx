/**
 * NodeHeader — 节点外置标题栏组件。
 *
 * 节点标题显示在卡片外部顶端，双击编辑；useViewport 反向缩放使标题在
 * 画布缩放时保持固定视觉尺寸（scale(1/zoom)，计划 §9 坑#5）。
 *
 * 增强能力：
 * 1. 扩展支持 `customIcon`（React 组件或 ReactNode 自定义图标）；
 * 2. 扩展支持 `video_composition` 及通用 string 材质类型；
 * 3. 保持 100% 兼容现有 TableNode / MaterialNode 调用；
 * 4. 内置双击编辑、StatusBadge 挂载插槽与非破坏性降级/警示徽标。
 */

import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import { FileText, ImagePlus, Video, Music, Table, Film, UploadCloud } from 'lucide-react';
import type { MaterialType } from '../../../types/materialNode';
import { useT } from '../../../i18n';
import { inverseScaleForZoom } from '../../utils/nodeVisualMath';

/** 标题行高度（用于计算反向缩放后的位置） */
const HEADER_HEIGHT = 24;

/** 节点名称最大长度（字符数） */
const MAX_LABEL_LENGTH = 30;

/** 素材类型 → lucide 图标映射 */
const MATERIAL_TYPE_ICON_COMPONENTS: Record<
  MaterialType | 'table' | 'video_composition' | 'import_asset',
  React.ComponentType<{ size?: number; className?: string }>
> = {
  text: FileText,
  image: ImagePlus,
  video: Video,
  audio: Music,
  table: Table,
  video_composition: Film,
  import_asset: UploadCloud,
};

export type NodeHeaderMaterialType =
  | MaterialType
  | 'table'
  | 'video_composition'
  | 'import_asset'
  | (string & {});

export interface NodeHeaderProps {
  /** 节点标签（用户可编辑） */
  label?: string;
  /** 素材类型（当未提供 customIcon 时用于自动匹配图标和默认文案） */
  materialType?: NodeHeaderMaterialType;
  /** 自定义图标（组件或 ReactNode，优先级高于 materialType 默认图标） */
  customIcon?:
    | React.ComponentType<{ size?: number; className?: string }>
    | React.ReactNode;
  /** 标签变化回调（接 updateNodeData） */
  onLabelChange?: (newLabel: string) => void;
  /** 头部右侧附加内容（执行状态徽标等） */
  trailing?: React.ReactNode;
  /** 是否处于非破坏性降级/超限警示态 */
  isDegraded?: boolean;
  /** 降级警告提示语 */
  degradedWarning?: string;
}

const NodeHeader: React.FC<NodeHeaderProps> = ({
  label,
  materialType = 'text',
  customIcon,
  onLabelChange,
  trailing,
  isDegraded,
  degradedWarning,
}) => {
  const t = useT();
  const fallbackLabel = materialType ? t(`node.type.${materialType}`) : '节点';
  const displayLabel = label || fallbackLabel;
  const { zoom } = useViewport();

  // 编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  // 反向缩放：zoom=1 → scale=1, zoom=0.5 → scale=2
  const inverseScale = useMemo(() => inverseScaleForZoom(zoom), [zoom]);

  // 进入编辑模式时自动聚焦并选中文本
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 同步外部 label 变化
  useEffect(() => {
    if (!isEditing) {
      setEditValue(displayLabel);
    }
  }, [displayLabel, isEditing]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsEditing(true);
      setEditValue(displayLabel);
    },
    [displayLabel],
  );

  const handleSubmit = useCallback(() => {
    const trimmedValue = editValue.trim();
    const finalValue = trimmedValue || fallbackLabel;
    setIsEditing(false);
    if (finalValue !== label && onLabelChange) {
      onLabelChange(finalValue);
    }
  }, [editValue, fallbackLabel, label, onLabelChange]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(displayLabel);
  }, [displayLabel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSubmit, handleCancel],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_LABEL_LENGTH) {
      setEditValue(value);
    }
  }, []);

  const renderIcon = () => {
    if (customIcon) {
      if (React.isValidElement(customIcon)) {
        return customIcon;
      }
      const CustomIconComp = customIcon as React.ComponentType<{
        size?: number;
        className?: string;
      }>;
      return <CustomIconComp size={14} />;
    }

    const IconComponent =
      (materialType in MATERIAL_TYPE_ICON_COMPONENTS
        ? MATERIAL_TYPE_ICON_COMPONENTS[
            materialType as keyof typeof MATERIAL_TYPE_ICON_COMPONENTS
          ]
        : null) || FileText;

    return <IconComponent size={14} />;
  };

  // 视觉间距（屏幕像素），标题底部与卡片顶部的距离
  const visualGap = 4;

  return (
    <div
      className="wf-node-header"
      style={{
        // 标题高度是布局值（不随缩放变化），间距需转换到画布坐标系
        top: -(HEADER_HEIGHT + visualGap * inverseScale),
        height: HEADER_HEIGHT,
        transform: `scale(${inverseScale})`,
        transformOrigin: 'bottom left',
        // transform 缩放后仍能正确接收点击事件
        pointerEvents: 'auto',
      }}
    >
      <span className="wf-node-header__icon">{renderIcon()}</span>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={handleInputChange}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="wf-node-header__input nodrag"
          style={{ width: `${Math.max(60, editValue.length * 8 + 10)}px` }}
          maxLength={MAX_LABEL_LENGTH}
        />
      ) : (
        <span
          onDoubleClick={handleDoubleClick}
          className="wf-node-header__label"
          title={displayLabel.length > 20 ? displayLabel : t('node.renameHint')}
        >
          {displayLabel}
        </span>
      )}
      {isDegraded && !trailing && (
        <span
          className="wf-node-header__degraded-badge wf-material-node__badge wf-material-node__badge--degraded"
          title={degradedWarning || t('model.compatibility.degradedWarning')}
        />
      )}
      {trailing}
    </div>
  );
};

export default memo(NodeHeader);
