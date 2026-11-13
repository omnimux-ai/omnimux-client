import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  GripVertical,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  Trash2,
  Edit3,
  Type,
  Hash,
  Paperclip,
} from 'lucide-react';
import { useTableStore } from '../../../../store/tableStore';
import type { HTableFieldType } from '../../../../../shared/types/htable';

export const renderFieldTypeIcon = (type: HTableFieldType) => {
  if (type === 'text') {
    return <Type size={15} style={{ color: 'var(--wb-text-secondary, #a1a1aa)', flexShrink: 0 }} />;
  } else if (type === 'number') {
    return <Hash size={15} style={{ color: 'var(--wb-text-secondary, #a1a1aa)', flexShrink: 0 }} />;
  } else if (type === 'attachment') {
    return <Paperclip size={15} style={{ color: 'var(--wb-text-secondary, #a1a1aa)', flexShrink: 0 }} />;
  }
  return <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--wb-text-muted, #71717a)' }} />;
};

export const PopoverFieldConfig: React.FC = () => {
  const {
    document: tableDoc,
    toggleColumnVisibility,
    openColumnModal,
    activeContextMenuColIdx,
    setContextMenuColIdx,
    deleteColumn,
  } = useTableStore();

  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (activeContextMenuColIdx === null) {
      setMenuCoords(null);
      return;
    }

    const handlePointerDown = () => {
      setContextMenuColIdx(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenuColIdx(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeContextMenuColIdx, setContextMenuColIdx]);

  const activeCol = activeContextMenuColIdx !== null ? tableDoc.columns[activeContextMenuColIdx] : null;

  return (
    <div
      className="wf-popover-card wf-popover-field-config"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wf-popover-title">字段配置</div>

      <div className="wf-field-config-list">
        {tableDoc.columns.map((col, idx) => {
          return (
            <div key={col.id} className="wf-field-config-item relative">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {/* 6 触点拖拽把手 */}
                <div style={{ cursor: 'grab', color: 'var(--wb-text-muted, #71717a)', display: 'flex', alignItems: 'center' }}>
                  <GripVertical size={14} />
                </div>

                {renderFieldTypeIcon(col.type)}

                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--wb-text-primary, #f4f4f5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {col.title}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {/* 眼睛显隐 */}
                <button
                  type="button"
                  className="wf-field-config-subtle-btn"
                  title={col.visible ? '隐藏字段' : '显示字段'}
                  onClick={() => toggleColumnVisibility(idx)}
                >
                  {col.visible ? (
                    <Eye size={15} />
                  ) : (
                    <EyeOff size={15} style={{ color: 'var(--wb-text-muted, #71717a)' }} />
                  )}
                </button>

                {/* ··· 更多操作 */}
                <button
                  type="button"
                  className={`wf-field-config-subtle-btn ${activeContextMenuColIdx === idx ? 'wf-field-config-subtle-btn--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeContextMenuColIdx === idx) {
                      setContextMenuColIdx(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const bubbleWidth = 100;
                      const bubbleHeight = 72;
                      const spaceBelow = window.innerHeight - rect.bottom;
                      const placeTop = spaceBelow < bubbleHeight + 10;
                      const top = placeTop ? rect.top - bubbleHeight - 4 : rect.bottom + 4;
                      const left = Math.max(8, rect.right - bubbleWidth);

                      setMenuCoords({ top, left });
                      setContextMenuColIdx(idx);
                    }
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--wb-border, rgba(255, 255, 255, 0.08))' }}>
        <button
          type="button"
          className="wf-context-menu-item"
          style={{ width: '100%', color: 'var(--wb-accent, #4176E6)', justifyContent: 'center', gap: 6 }}
          onClick={() => openColumnModal('add')}
        >
          <Plus size={14} />
          <span>新增字段</span>
        </button>
      </div>

      {/* 顶层 Portal 渲染 ··· 气泡菜单，绝对免疫任何容器 overflow 裁剪 */}
      {activeContextMenuColIdx !== null && activeCol && menuCoords && typeof document !== 'undefined' && createPortal(
        <div
          className="wf-popover-context-bubble"
          style={{
            position: 'fixed',
            top: menuCoords.top,
            left: menuCoords.left,
            zIndex: 10010,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wf-context-menu-item"
            onClick={() => {
              const targetIdx = activeContextMenuColIdx;
              setContextMenuColIdx(null);
              openColumnModal('edit', targetIdx);
            }}
          >
            <Edit3 size={13} />
            <span>编辑</span>
          </button>
          <button
            type="button"
            className="wf-context-menu-item wf-context-menu-item--danger"
            onClick={() => {
              const targetIdx = activeContextMenuColIdx;
              const targetCol = activeCol;
              setContextMenuColIdx(null);
              if (confirm(`确定删除字段 "${targetCol.title}" 吗？`)) {
                deleteColumn(targetIdx);
              }
            }}
          >
            <Trash2 size={13} />
            <span>删除</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};
