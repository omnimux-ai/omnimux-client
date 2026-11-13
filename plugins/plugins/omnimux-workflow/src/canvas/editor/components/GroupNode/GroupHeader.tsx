import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '../../../i18n';
import { stopToolbarNativeEvent } from '../toolbarPointerGuard';
import {
  inverseScaleForZoom,
  resolveGroupAccentStyle,
  resolveGroupHeaderLayout,
} from '../../utils/nodeVisualMath';

export interface GroupHeaderProps {
  groupId: string;
  title: string;
  isCollapsed: boolean;
  selected: boolean;
  color?: string;
  onToggleCollapse: () => void;
  onRename: (newTitle: string) => void;
  onSelect: () => void;
}

export const GroupHeader: React.FC<GroupHeaderProps> = memo(({
  groupId: _groupId,
  title,
  isCollapsed,
  selected,
  color,
  onToggleCollapse,
  onRename,
  onSelect,
}) => {
  const t = useT();
  const { zoom } = useViewport();
  const inverseScale = useMemo(() => inverseScaleForZoom(zoom), [zoom]);
  const layout = useMemo(
    () => resolveGroupHeaderLayout({ isCollapsed, inverseScale }),
    [isCollapsed, inverseScale],
  );
  const accentStyle = useMemo(() => resolveGroupAccentStyle(color), [color]);
  const placementClass = isCollapsed
    ? 'wf-group-header-pill--internal'
    : 'wf-group-header-pill--external';

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(title);
  }, [title]);

  const handleSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    const finalTitle = trimmed || title || t('group.defaultTitle');
    setIsEditing(false);
    if (finalTitle !== title) {
      onRename(finalTitle);
    }
  }, [editValue, title, onRename, t]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(title);
  }, [title]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSubmit, handleCancel]);

  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse();
  }, [onToggleCollapse]);

  return (
    <div
      className={`wf-group-header-pill nodrag nopan ${placementClass} ${selected ? 'wf-group-header-pill--selected' : ''}`}
      onClick={handleHeaderClick}
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
      style={{
        ...accentStyle,
        top: layout.top,
        left: layout.left,
        transform: layout.transform,
        transformOrigin: layout.transformOrigin,
      }}
      title={isCollapsed ? t('group.expand') : t('group.collapse')}
    >
      <button
        type="button"
        className="wf-group-header-pill__toggle"
        onClick={handleChevronClick}
        title={isCollapsed ? t('group.expand') : t('group.collapse')}
      >
        {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="wf-group-header-pill__input nodrag nopan"
          style={{ width: `${Math.max(60, editValue.length * 8 + 16)}px` }}
          maxLength={40}
        />
      ) : (
        <span
          className="wf-group-header-pill__title"
          onDoubleClick={handleDoubleClick}
          title={t('group.renameHint')}
        >
          {title}
        </span>
      )}
    </div>
  );
});

GroupHeader.displayName = 'GroupHeader';
