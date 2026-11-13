/**
 * FloatingSelectionToolbar:
 * Multi-selection floating capsule toolbar displayed when >= 2 nodes are selected.
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import {
  FolderPlus,
  PackagePlus,
  LayoutGrid,
  ChevronDown,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Grid,
} from 'lucide-react';
import { useT } from '../../i18n';
import { stopToolbarNativeEvent } from './toolbarPointerGuard';

export interface FloatingSelectionToolbarProps {
  visible: boolean;
  selectedCount: number;
  position: { x: number; y: number };
  onGroup: () => void;
  onCreateAsset: () => void;
  onLayout: (type: 'horizontal' | 'vertical' | 'grid') => void;
}

export const FloatingSelectionToolbar: React.FC<FloatingSelectionToolbarProps> = memo(({
  visible,
  selectedCount,
  position,
  onGroup,
  onCreateAsset,
  onLayout,
}) => {
  const t = useT();
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const layoutDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (layoutDropdownRef.current && !layoutDropdownRef.current.contains(e.target as Node)) {
        setIsLayoutMenuOpen(false);
      }
    }
    if (isLayoutMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isLayoutMenuOpen]);

  if (!visible || selectedCount < 2) return null;

  return (
    <div
      className="wf-floating-selection-bar nodrag nopan"
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <button
        type="button"
        className="wf-floating-selection-bar__btn"
        onClick={onCreateAsset}
        title={t('group.float.createAssetTitle')}
      >
        <PackagePlus size={15} />
        <span>{t('group.float.createAsset')}</span>
      </button>

      <button
        type="button"
        className="wf-floating-selection-bar__btn"
        onClick={onGroup}
        title={t('group.float.groupTitle')}
      >
        <FolderPlus size={15} />
        <span>{t('group.float.group')}</span>
      </button>

      <div style={{ position: 'relative' }} ref={layoutDropdownRef}>
        <button
          type="button"
          className="wf-floating-selection-bar__btn"
          onClick={() => setIsLayoutMenuOpen((prev) => !prev)}
          title={t('group.float.layoutTitle')}
        >
          <LayoutGrid size={15} />
          <span>{t('group.layout')}</span>
          <ChevronDown size={13} />
        </button>

        {isLayoutMenuOpen && (
          <div className="wf-floating-selection-bar__menu">
            <button
              type="button"
              className="wf-floating-selection-bar__menu-item"
              onClick={() => {
                onLayout('horizontal');
                setIsLayoutMenuOpen(false);
              }}
            >
              <AlignHorizontalDistributeCenter size={14} />
              <span>{t('group.layoutHorizontal')}</span>
            </button>
            <button
              type="button"
              className="wf-floating-selection-bar__menu-item"
              onClick={() => {
                onLayout('vertical');
                setIsLayoutMenuOpen(false);
              }}
            >
              <AlignVerticalDistributeCenter size={14} />
              <span>{t('group.layoutVertical')}</span>
            </button>
            <button
              type="button"
              className="wf-floating-selection-bar__menu-item"
              onClick={() => {
                onLayout('grid');
                setIsLayoutMenuOpen(false);
              }}
            >
              <Grid size={14} />
              <span>{t('group.layoutGridCompact')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

FloatingSelectionToolbar.displayName = 'FloatingSelectionToolbar';
