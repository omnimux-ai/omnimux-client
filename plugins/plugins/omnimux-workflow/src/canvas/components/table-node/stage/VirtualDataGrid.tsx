import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, GripVertical, X } from 'lucide-react';
import { useTableStore } from '../../../store/tableStore.ts';
import { useCanvasStore } from '../../../store/canvasStore.ts';
import { renderFieldTypeIcon } from './popovers/PopoverFieldConfig.tsx';
import ResourcePickerModal from '../../../editor/components/ResourcePickerModal/ResourcePickerModal.tsx';
import type { LocalFileDraft } from '../../../editor/utils/resourcePickerPolicy.ts';
import type {
  HTableCellValue,
  HTableAttachment,
  HTableColumn,
} from '../../../../shared/types/htable.ts';
import { defaultColumnWidth, MIN_TABLE_COLUMN_WIDTH } from '../../../../shared/types/htable.ts';
import {
  columnWidthForDisplay,
  computeAutoFitWidth,
  computeEditorHeightMetrics,
  computeGridScale,
  computeResizeWidth,
} from './tableGridMetrics.ts';

interface GridCellRef {
  rowIdx: number;
  colId: string;
}

interface ResizeSession {
  colId: string;
  startClientX: number;
  startWidth: number;
  scale: number;
  currentWidth: number;
}

function cellKey(cell: GridCellRef): string {
  return `${cell.rowIdx}:${cell.colId}`;
}

function sameCell(a: GridCellRef | null, b: GridCellRef | null): boolean {
  return Boolean(a && b && a.rowIdx === b.rowIdx && a.colId === b.colId);
}

function cellValueToDraft(value: HTableCellValue | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/** 编辑 textarea 高度：先 auto 量 scrollHeight，再按 1–8 行三态封顶。 */
function resizeEditorToContent(el: HTMLTextAreaElement): void {
  const cs = getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || 20;
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const paddingBottom = parseFloat(cs.paddingBottom) || 0;
  const borderTop = parseFloat(cs.borderTopWidth) || 0;
  const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
  el.style.height = 'auto';
  el.style.overflowY = 'hidden';
  const metrics = computeEditorHeightMetrics({
    contentHeight: el.scrollHeight,
    lineHeight,
    paddingTop,
    paddingBottom,
  });
  el.style.height = `${metrics.height + borderTop + borderBottom}px`;
  el.style.overflowY = metrics.overflowY;
}

export const VirtualDataGrid: React.FC = () => {
  const {
    document: tableDoc,
    selectedRowIndices,
    activeTableId,
    isStageOpen,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    reorderRows,
    renameColumn,
    updateCell,
    resizeColumn,
    addRow,
    openColumnModal,
  } = useTableStore();

  const visibleColumns = tableDoc.columns.filter((c) => c.visible);
  const rowHeightMode = tableDoc.rowHeight || 'low';
  const rowHeightClass = `wf-grid-row--${rowHeightMode}`;

  // 表头全选/半选 Checkbox 状态管理
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const totalRows = tableDoc.rows.length;
  const selectedCount = selectedRowIndices.length;
  const isAllSelected = totalRows > 0 && selectedCount === totalRows;
  const isIndeterminate = selectedCount > 0 && selectedCount < totalRows;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = () => {
    if (isAllSelected || isIndeterminate) {
      clearRowSelection();
    } else {
      selectAllRows();
    }
  };

  // 双击列名就地重命名状态管理
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startEditingColumn = (colId: string, currentTitle: string) => {
    setEditingColId(colId);
    setEditingTitle(currentTitle);
  };

  const commitColumnRename = (colIdx: number) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      renameColumn(colIdx, trimmed);
    }
    setEditingColId(null);
    setEditingTitle('');
  };

  const cancelColumnRename = () => {
    setEditingColId(null);
    setEditingTitle('');
  };

  // 行原生 HTML5 拖拽重排状态管理
  const [draggedRowIdx, setDraggedRowIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);

  const handleDragStart = (e: React.DragEvent, rowIdx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowIdx));
    setDraggedRowIdx(rowIdx);
  };

  const handleDragOver = (e: React.DragEvent, rowIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const tr = (e.target as HTMLElement).closest('tr');
    if (!tr) return;
    const rect = tr.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const pos = relY < rect.height / 2 ? 'top' : 'bottom';

    if (dropTargetIdx !== rowIdx || dropPosition !== pos) {
      setDropTargetIdx(rowIdx);
      setDropPosition(pos);
    }
  };

  const handleDragEnd = () => {
    setDraggedRowIdx(null);
    setDropTargetIdx(null);
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent, targetRowIdx: number) => {
    e.preventDefault();
    if (draggedRowIdx === null) {
      handleDragEnd();
      return;
    }

    if (draggedRowIdx !== targetRowIdx) {
      let insertIdx = dropPosition === 'bottom' ? targetRowIdx + 1 : targetRowIdx;
      if (draggedRowIdx < insertIdx) {
        insertIdx -= 1;
      }
      if (draggedRowIdx !== insertIdx) {
        reorderRows(draggedRowIdx, insertIdx);
      }
    }

    handleDragEnd();
  };

  // 列宽拖拽 / 单元格状态机
  const gridPaneRef = useRef<HTMLDivElement>(null);
  const colElRefs = useRef<Map<string, HTMLTableColElement>>(new Map());
  const cellElRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [resizingColId, setResizingColId] = useState<string | null>(null);

  const [selectedCell, setSelectedCell] = useState<GridCellRef | null>(null);
  const selectedCellRef = useRef<GridCellRef | null>(null);
  const [editingCell, setEditingCell] = useState<GridCellRef | null>(null);
  const editingRef = useRef<GridCellRef | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const composingRef = useRef(false);

  const editorOverlayRef = useRef<HTMLDivElement>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [editorBox, setEditorBox] = useState({ left: 0, top: 0, width: 200 });

  const setSelectedCellSafe = useCallback((cell: GridCellRef | null) => {
    selectedCellRef.current = cell;
    setSelectedCell(cell);
  }, []);

  const positionEditorOverlay = useCallback((cell: GridCellRef) => {
    const pane = gridPaneRef.current;
    const cellEl = cellElRefs.current.get(cellKey(cell));
    if (!pane || !cellEl) return;
    const paneRect = pane.getBoundingClientRect();
    const cellRect = cellEl.getBoundingClientRect();
    const scale = computeGridScale(paneRect.width, pane.offsetWidth);
    setEditorBox({
      left: (cellRect.left - paneRect.left) / scale + pane.scrollLeft,
      top: (cellRect.top - paneRect.top) / scale + pane.scrollTop,
      width: Math.max(MIN_TABLE_COLUMN_WIDTH, cellRect.width / scale),
    });
  }, []);

  const beginEdit = useCallback(
    (rowIdx: number, colId: string) => {
      const col = tableDoc.columns.find((c) => c.id === colId);
      if (!col || col.type === 'attachment') return;
      const row = tableDoc.rows[rowIdx];
      const initial = cellValueToDraft(row?.cells?.[colId]);
      const cell = { rowIdx, colId };
      editingRef.current = cell;
      draftRef.current = initial;
      setEditingCell(cell);
      setSelectedCellSafe(cell);
      setDraft(initial);
    },
    [tableDoc, setSelectedCellSafe],
  );

  const commitEditing = useCallback(() => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    const nextValue = draftRef.current;
    const state = useTableStore.getState();
    const previous = cellValueToDraft(state.document.rows[current.rowIdx]?.cells?.[current.colId]);
    if (nextValue !== previous) {
      state.updateCell(current.rowIdx, current.colId, nextValue);
    }
    draftRef.current = '';
    setEditingCell(null);
    setDraft('');
  }, []);

  const cancelEditing = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = null;
    draftRef.current = '';
    setEditingCell(null);
    setDraft('');
  }, []);

  const handleCellClick = useCallback(
    (rowIdx: number, colId: string, colType: HTableColumn['type']) => {
      if (editingRef.current) {
        if (!sameCell(editingRef.current, { rowIdx, colId })) {
          commitEditing();
        } else {
          return;
        }
      }
      if (colType !== 'attachment' && sameCell(selectedCellRef.current, { rowIdx, colId })) {
        beginEdit(rowIdx, colId);
        return;
      }
      setSelectedCellSafe({ rowIdx, colId });
    },
    [beginEdit, commitEditing, setSelectedCellSafe],
  );

  const handleCellDoubleClick = useCallback(
    (rowIdx: number, colId: string, colType: HTableColumn['type']) => {
      if (colType === 'attachment') return;
      beginEdit(rowIdx, colId);
    },
    [beginEdit],
  );

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = composingRef.current || (e.nativeEvent as KeyboardEvent).isComposing;
    if (composing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      commitEditing();
      return;
    }
    if (e.key === 'Enter') {
      // textarea 内换行；阻止冒泡避免宿主画布快捷键拦截。
      e.stopPropagation();
    }
  };

  // 编辑态：定位浮层 + 聚焦全选
  useLayoutEffect(() => {
    if (!editingCell) return;
    positionEditorOverlay(editingCell);
    if (editorTextareaRef.current) resizeEditorToContent(editorTextareaRef.current);
  }, [editingCell, positionEditorOverlay]);

  useEffect(() => {
    if (!editingCell) return;
    const frame = requestAnimationFrame(() => {
      const el = editorTextareaRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingCell]);

  // 编辑态：高度按内容行数自适应（1 / 3–4 / 8+ 行）
  useEffect(() => {
    if (!editingCell) return;
    if (editorTextareaRef.current) resizeEditorToContent(editorTextareaRef.current);
  }, [editingCell, draft]);

  useEffect(() => {
    const handleWindowResize = () => {
      if (editingRef.current) positionEditorOverlay(editingRef.current);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [positionEditorOverlay]);

  // 舞台关闭：清理编辑/选中态，防止 body 外残留浮层
  useEffect(() => {
    if (isStageOpen) return;
    editingRef.current = null;
    draftRef.current = '';
    setEditingCell(null);
    setDraft('');
    setSelectedCellSafe(null);
  }, [isStageOpen, setSelectedCellSafe]);

  // 选中态键盘：Enter/F2 进入编辑，Esc 清除选中
  useEffect(() => {
    if (!isStageOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const selected = selectedCellRef.current;
      if (!selected) return;
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        beginEdit(selected.rowIdx, selected.colId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCellSafe(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [beginEdit, isStageOpen, setSelectedCellSafe]);

  // 点击表格外：先保存编辑，再清除选中
  useEffect(() => {
    if (!isStageOpen) return;
    const handlePointerDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editorOverlayRef.current?.contains(target)) return;
      if (target.closest?.('[data-grid-cell-key]')) return;
      if (editingRef.current) commitEditing();
      if (selectedCellRef.current) setSelectedCellSafe(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [commitEditing, isStageOpen, setSelectedCellSafe]);

  // 列宽拖拽：只更新 <col> 本地预览，pointerup 一次写 store
  const startColumnResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, col: HTableColumn) => {
      if (e.button !== 0 || resizeSessionRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const pane = gridPaneRef.current;
      const rect = pane?.getBoundingClientRect();
      const scale = computeGridScale(rect?.width ?? 0, pane?.offsetWidth ?? 0);
      const startWidth = columnWidthForDisplay(col.width, col.type);
      const session: ResizeSession = {
        colId: col.id,
        startClientX: e.clientX,
        startWidth,
        scale,
        currentWidth: startWidth,
      };
      resizeSessionRef.current = session;
      setResizingColId(col.id);
      document.body.classList.add('wf-grid-resizing');
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom / 老浏览器不支持 pointer capture */
      }

      const restorePreview = () => {
        const colEl = colElRefs.current.get(session.colId);
        if (colEl) colEl.style.width = `${session.startWidth}px`;
      };

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        resizeCleanupRef.current = null;
        document.body.classList.remove('wf-grid-resizing');
      };

      const onMove = (ev: Event) => {
        const pointer = ev as PointerEvent;
        const current = resizeSessionRef.current;
        if (!current) return;
        const nextWidth = computeResizeWidth({
          startWidth: current.startWidth,
          startClientX: current.startClientX,
          clientX: pointer.clientX,
          scale: current.scale,
        });
        current.currentWidth = nextWidth;
        const colEl = colElRefs.current.get(current.colId);
        if (colEl) colEl.style.width = `${nextWidth}px`;
      };

      const onUp = () => {
        const current = resizeSessionRef.current;
        cleanup();
        if (!current) return;
        resizeSessionRef.current = null;
        setResizingColId(null);
        if (current.currentWidth !== current.startWidth) {
          resizeColumn(current.colId, current.currentWidth);
        }
      };

      const onCancel = () => {
        const current = resizeSessionRef.current;
        cleanup();
        if (!current) return;
        resizeSessionRef.current = null;
        setResizingColId(null);
        restorePreview();
      };

      resizeCleanupRef.current = () => {
        cleanup();
        resizeSessionRef.current = null;
        setResizingColId(null);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    [resizeColumn],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const autoFitColumn = useCallback(
    (col: HTableColumn) => {
      let measured: number[] = [];
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = '13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
          measured = tableDoc.rows.map((row) => {
            const value = row.cells[col.id];
            const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
            return ctx.measureText(text).width;
          });
        }
      } catch {
        measured = [];
      }
      resizeColumn(col.id, computeAutoFitWidth(measured, defaultColumnWidth(col.type)));
    },
    [resizeColumn, tableDoc.rows],
  );

  // 附件“添加资源”窗口目标行与列
  const [pickerTarget, setPickerTarget] = useState<{ rowIdx: number; colId: string } | null>(null);

  // 附件悬停大图预览浮层状态（跟随鼠标坐标）
  const [hoveredAttachment, setHoveredAttachment] = useState<{
    name: string;
    previewUrl: string;
    top: number;
    left: number;
  } | null>(null);

  // 提取附件有效预览 URL / 路径
  const getAttachmentPreviewUrl = (att: HTableAttachment): string => {
    return att.thumbnailUrl || att.url || att.path || '';
  };

  // 鼠标悬停/移动实时计算居中对齐鼠标光标位置并展示预览大图
  const computePreviewPosition = (clientX: number, clientY: number) => {
    const cardWidth = 320;
    const cardHeight = 340;
    const margin = 12;

    // 水平方向：以鼠标所在水平点居中对齐，并限制在视口边界内
    let left = clientX - cardWidth / 2;
    if (left < margin) {
      left = margin;
    } else if (left + cardWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - cardWidth - margin);
    }

    // 垂直方向：默认展示在鼠标光标下方 14px 处；若视口下方空间不足则翻转展示在鼠标上方
    let top = clientY + 14;
    if (top + cardHeight > window.innerHeight - margin) {
      top = Math.max(margin, clientY - cardHeight - 14);
    }

    return { top, left };
  };

  const handleThumbMouseEnter = (att: HTableAttachment, e: React.MouseEvent) => {
    const previewUrl = getAttachmentPreviewUrl(att);
    const { top, left } = computePreviewPosition(e.clientX, e.clientY);
    setHoveredAttachment({
      name: att.name || '附件预览',
      previewUrl,
      top,
      left,
    });
  };

  const handleThumbMouseMove = (e: React.MouseEvent) => {
    if (!hoveredAttachment) return;
    const { top, left } = computePreviewPosition(e.clientX, e.clientY);
    setHoveredAttachment((prev) => (prev ? { ...prev, top, left } : null));
  };

  const handleThumbMouseLeave = () => {
    setHoveredAttachment(null);
  };

  // 移除附件
  const handleRemoveAttachment = (rowIdx: number, colId: string, attIdx: number) => {
    const row = tableDoc.rows[rowIdx];
    if (!row) return;
    const currentVal = row.cells[colId];
    if (!Array.isArray(currentVal)) return;
    const nextList = (currentVal as HTableAttachment[]).filter((_, idx) => idx !== attIdx);
    updateCell(rowIdx, colId, nextList);
    setHoveredAttachment(null);
  };

  // 提交选中的资源入单元格
  const handleCommitResource = useCallback(
    (payload: {
      selectedCanvasNodeIds: string[];
      localFiles: LocalFileDraft[];
    }) => {
      if (!pickerTarget) return false;

      const nodes = useCanvasStore.getState().nodes;
      const canvasAttachments: HTableAttachment[] = payload.selectedCanvasNodeIds
        .map((nodeId) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          const nodeData = (node.data || {}) as Record<string, any>;
          const materialType = (nodeData.materialType as string) || '';
          const kind = materialType === 'video' ? 'video' : materialType === 'audio' ? 'audio' : 'image';
          const previewUrl =
            nodeData.previewUrl ||
            nodeData.imageUrl ||
            nodeData.thumbnailUrl ||
            nodeData.outputUrl ||
            nodeData.coverUrl ||
            nodeData.mediaUrl ||
            '';
          const name = nodeData.label || nodeData.title || nodeData.name || '创作画布资源';
          return {
            assetId: node.id,
            name: String(name),
            kind,
            thumbnailUrl: previewUrl ? String(previewUrl) : undefined,
            url: previewUrl ? String(previewUrl) : undefined,
            path: typeof nodeData.realPath === 'string' ? nodeData.realPath : typeof nodeData.mediaUrl === 'string' ? nodeData.mediaUrl : undefined,
          } as HTableAttachment;
        })
        .filter((x): x is HTableAttachment => Boolean(x));

      const localAttachments: HTableAttachment[] = (payload.localFiles || []).map((file) => ({
        assetId: file.id,
        name: file.name,
        kind: file.materialType === 'video' ? 'video' : file.materialType === 'audio' ? 'audio' : 'image',
        thumbnailUrl: file.previewUrl,
        url: file.previewUrl,
        path: file.realPath,
        size: file.size,
        mimeType: file.mime,
      }));

      const allNew = [...canvasAttachments, ...localAttachments];
      if (allNew.length === 0) {
        return false;
      }

      const row = tableDoc.rows[pickerTarget.rowIdx];
      if (row) {
        const currentVal = row.cells[pickerTarget.colId];
        const currentList = Array.isArray(currentVal) ? (currentVal as HTableAttachment[]) : [];
        const nextList = [...currentList, ...allNew];
        updateCell(pickerTarget.rowIdx, pickerTarget.colId, nextList);
      }

      setPickerTarget(null);
      return true;
    },
    [tableDoc.rows, pickerTarget, updateCell],
  );

  return (
    <div className="wf-grid-container">
      <div
        ref={gridPaneRef}
        className="wf-grid-scroll-pane"
        onScroll={() => {
          if (hoveredAttachment) setHoveredAttachment(null);
          if (editingRef.current) positionEditorOverlay(editingRef.current);
        }}
      >
        <table className="wf-grid-table">
          <colgroup>
            {/* 首列：行号与多选 */}
            <col style={{ width: 56, minWidth: 56, maxWidth: 56 }} />

            {/* 动态字段列 */}
            {visibleColumns.map((col) => (
              <col
                key={col.id}
                ref={(el) => {
                  if (el) colElRefs.current.set(col.id, el);
                  else colElRefs.current.delete(col.id);
                }}
                style={{
                  width: columnWidthForDisplay(col.width, col.type),
                  minWidth: MIN_TABLE_COLUMN_WIDTH,
                  maxWidth: 2000,
                }}
              />
            ))}

            {/* 快捷加列列 */}
            <col style={{ width: 44, minWidth: 44, maxWidth: 44 }} />

            {/* 右侧空占位缓冲 */}
            <col style={{ width: 'auto' }} />
          </colgroup>

          <thead>
            <tr>
              {/* 首列：多选框 */}
              <th className="wf-grid-th wf-grid-th--select">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  className="wf-grid-checkbox"
                  checked={isAllSelected}
                  onChange={handleHeaderCheckboxChange}
                  title={isAllSelected ? '取消全选' : '全选'}
                />
              </th>

              {/* 动态字段列 */}
              {visibleColumns.map((col) => {
                const colIdx = tableDoc.columns.findIndex((c) => c.id === col.id);
                const isEditing = editingColId === col.id;

                return (
                  <th
                    key={col.id}
                    className="wf-grid-th"
                  >
                    <div className="wf-grid-th-content">
                      <span className="wf-grid-th-icon">{renderFieldTypeIcon(col.type)}</span>
                      {isEditing ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          className="wf-grid-th-rename-input"
                          value={editingTitle}
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => commitColumnRename(colIdx)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              commitColumnRename(colIdx);
                            } else if (e.key === 'Escape') {
                              cancelColumnRename();
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="wf-grid-th-title"
                          title="双击就地重命名"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startEditingColumn(col.id, col.title);
                          }}
                        >
                          {col.title}
                        </span>
                      )}
                    </div>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整「${col.title}」列宽`}
                      className={`wf-grid-col-resizer${resizingColId === col.id ? ' wf-grid-col-resizer--active' : ''}`}
                      title="拖拽调整列宽，双击按内容自适应"
                      onPointerDown={(e) => startColumnResize(e, col)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        autoFitColumn(col);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}

              {/* 快捷加列列 */}
              <th
                className="wf-grid-th wf-grid-th--plus"
                title="添加列"
                onClick={() => openColumnModal('add')}
              >
                <div className="wf-grid-th-plus-btn">
                  <Plus size={15} />
                </div>
              </th>

              {/* 右侧空占位缓冲 */}
              <th className="wf-grid-th wf-grid-th--filler" />
            </tr>
          </thead>

          <tbody>
            {tableDoc.rows.map((row, rowIdx) => {
              const isSelectedRow = selectedRowIndices.includes(rowIdx);
              const isDragging = draggedRowIdx === rowIdx;
              const isDropTarget = dropTargetIdx === rowIdx && draggedRowIdx !== rowIdx;
              const dropClass = isDropTarget && dropPosition ? `wf-grid-row--drop-${dropPosition}` : '';
              const rowClass = [
                rowHeightClass,
                isSelectedRow ? 'wf-grid-row--selected' : '',
                isDragging ? 'wf-grid-row--dragging' : '',
                dropClass,
              ].filter(Boolean).join(' ');

              return (
                <tr
                  key={row.id || rowIdx}
                  className={rowClass}
                  onDragOver={(e) => handleDragOver(e, rowIdx)}
                  onDrop={(e) => handleDrop(e, rowIdx)}
                >
                  {/* 首列：复合单元格（等宽序号 + 拖拽手柄 + 勾选框） */}
                  <td className="wf-grid-td wf-grid-td--select">
                    <div className="wf-grid-row-head-cell">
                      <span className="wf-grid-row-index">{rowIdx + 1}</span>
                      <div className="wf-grid-row-controls">
                        <div
                          className="wf-grid-row-drag-handle"
                          draggable
                          title="拖拽重排行"
                          onDragStart={(e) => handleDragStart(e, rowIdx)}
                          onDragEnd={handleDragEnd}
                        >
                          <GripVertical size={14} />
                        </div>
                        <input
                          type="checkbox"
                          className="wf-grid-checkbox"
                          checked={isSelectedRow}
                          onChange={() => toggleRowSelection(rowIdx)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  </td>

                  {/* 各字段单元格：通过 col.id 从 row.cells 字典读取与更新 */}
                  {visibleColumns.map((col) => {
                    const cellVal = row.cells[col.id];
                    const cell = { rowIdx, colId: col.id };
                    const isSelectedCell = sameCell(selectedCell, cell);
                    const isEditingCell = sameCell(editingCell, cell);
                    const cellRefKey = cellKey(cell);

                    const renderCellContent = () => {
                      if (col.type === 'attachment') {
                        const attachments: HTableAttachment[] = Array.isArray(cellVal)
                          ? (cellVal as HTableAttachment[])
                          : [];

                        return (
                          <div className="wf-grid-cell-attachment">
                            {attachments.map((att, attIdx) => {
                              const previewUrl = getAttachmentPreviewUrl(att);
                              const hasPreview = Boolean(previewUrl);

                              return (
                                <div
                                  key={att.assetId ? `${att.assetId}_${attIdx}` : attIdx}
                                  className="wf-grid-attachment-thumb-wrapper"
                                  onMouseEnter={(e) => handleThumbMouseEnter(att, e)}
                                  onMouseMove={handleThumbMouseMove}
                                  onMouseLeave={handleThumbMouseLeave}
                                >
                                  {hasPreview ? (
                                    <img
                                      src={previewUrl}
                                      alt={att.name || '缩略图'}
                                      className="wf-grid-attachment-thumb-img"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLElement).style.display = 'none';
                                        const fb = e.currentTarget.parentElement?.querySelector(
                                          '.wf-grid-attachment-thumb-fallback',
                                        ) as HTMLElement | null;
                                        if (fb) fb.style.display = 'flex';
                                      }}
                                    />
                                  ) : null}

                                  <div
                                    className="wf-grid-attachment-thumb-fallback"
                                    style={{ display: hasPreview ? 'none' : 'flex' }}
                                  >
                                    {att.kind === 'video' ? '视' : att.kind === 'audio' ? '音' : '📎'}
                                  </div>

                                  {/* 删除按钮 (对齐图二右上角 x) */}
                                  <button
                                    type="button"
                                    className="wf-grid-attachment-remove-btn"
                                    title="删除附件"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveAttachment(rowIdx, col.id, attIdx);
                                    }}
                                  >
                                    <X size={10} strokeWidth={2.5} />
                                  </button>
                                </div>
                              );
                            })}

                            {/* 手动扩充加号按钮 (对齐图一与图二的右侧 + 按钮) */}
                            <button
                              type="button"
                              className="wf-grid-attachment-append-btn"
                              title="添加资源"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPickerTarget({ rowIdx, colId: col.id });
                              }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        );
                      }

                      const strVal = typeof cellVal === 'string' || typeof cellVal === 'number' ? String(cellVal) : '';
                      return (
                        <div
                          className={[
                            'wf-grid-cell-preview',
                            isSelectedCell ? 'wf-grid-cell-preview--selected' : '',
                            isEditingCell ? 'wf-grid-cell-preview--editing' : '',
                          ].filter(Boolean).join(' ')}
                          title={strVal}
                        >
                          {strVal || <span className="wf-grid-cell-placeholder">点击输入...</span>}
                        </div>
                      );
                    };

                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          if (el) cellElRefs.current.set(cellRefKey, el);
                          else cellElRefs.current.delete(cellRefKey);
                        }}
                        data-grid-cell-key={cellRefKey}
                        className={`wf-grid-td${isSelectedCell ? ' wf-grid-td--cell-selected' : ''}`}
                        onClick={() => handleCellClick(rowIdx, col.id, col.type)}
                        onDoubleClick={() => handleCellDoubleClick(rowIdx, col.id, col.type)}
                      >
                        {renderCellContent()}
                      </td>
                    );
                  })}

                  {/* 快捷列与右侧占位 */}
                  <td className="wf-grid-td wf-grid-td--plus-col" />
                  <td className="wf-grid-td wf-grid-td--filler" />
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 单元格编辑浮层：absolute 覆盖，不参与表格布局 */}
        {editingCell && (
          <div
            ref={editorOverlayRef}
            className="wf-grid-cell-editor-overlay"
            style={{ left: editorBox.left, top: editorBox.top, width: editorBox.width }}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              ref={editorTextareaRef}
              className="wf-grid-cell-editor"
              aria-label="编辑单元格"
              rows={1}
              value={draft}
              spellCheck={false}
              onInput={(e) => {
                const el = e.currentTarget;
                draftRef.current = el.value;
                setDraft(el.value);
                resizeEditorToContent(el);
                // paste/输入法插入文本后布局可能晚一帧，再量一次。
                window.setTimeout(() => {
                  if (el.isConnected) resizeEditorToContent(el);
                }, 0);
              }}
              onChange={(e) => {
                draftRef.current = e.target.value;
                setDraft(e.target.value);
                resizeEditorToContent(e.currentTarget);
              }}
              onBlur={commitEditing}
              onKeyDown={handleEditorKeyDown}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
            />
          </div>
        )}

        {/* 底部添加行操作条 */}
        <div className="wf-grid-add-row-bar">
          <button
            type="button"
            className="wf-grid-row-append-btn"
            onClick={() => addRow()}
          >
            <Plus size={14} />
            <span>添加行</span>
          </button>
        </div>
      </div>

      {/* 附件放大预览悬浮卡片 (经 createPortal 传送至 globalThis.document.body，彻底杜绝父容器 transform/containing block 错位) */}
      {hoveredAttachment &&
        typeof globalThis.document !== 'undefined' &&
        globalThis.document.body &&
        createPortal(
          <div
            className="wf-attachment-preview-card"
            style={{
              position: 'fixed',
              top: hoveredAttachment.top,
              left: hoveredAttachment.left,
              zIndex: 99999,
              pointerEvents: 'none',
            }}
          >
            <div className="wf-attachment-preview-header" title={hoveredAttachment.name}>
              {hoveredAttachment.name}
            </div>
            <div className="wf-attachment-preview-body">
              {hoveredAttachment.previewUrl ? (
                <img
                  src={hoveredAttachment.previewUrl}
                  alt={hoveredAttachment.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                    const fb = e.currentTarget.parentElement?.querySelector(
                      '.wf-attachment-preview-error',
                    ) as HTMLElement | null;
                    if (fb) fb.style.display = 'flex';
                  }}
                />
              ) : (
                <div style={{ color: 'var(--wb-text-muted)', fontSize: 12 }}>暂无图片预览</div>
              )}
              <div
                className="wf-attachment-preview-error"
                style={{
                  display: 'none',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  color: 'var(--wb-text-muted)',
                  fontSize: 12,
                  padding: '32px 16px',
                }}
              >
                <span>图片加载失败</span>
              </div>
            </div>
          </div>,
          globalThis.document.body,
        )}

      {/* 调出“添加资源”窗口，可以在里面附加附件 */}
      {pickerTarget && (
        <ResourcePickerModal
          open={Boolean(pickerTarget)}
          nodeId={activeTableId || 'table-node'}
          title="添加资源"
          slotTarget={{
            slot: 'attachment',
            acceptedTypes: ['image', 'video', 'audio'],
            max: null,
          }}
          onCancel={() => setPickerTarget(null)}
          onCommit={handleCommitResource}
        />
      )}
    </div>
  );
};
