import React from 'react';
import {
  Table,
  Settings2,
  Filter,
  AlignJustify,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import { useTableStore } from '../../../store/tableStore';
import { PopoverFieldConfig } from './popovers/PopoverFieldConfig';
import { PopoverFilterBuilder } from './popovers/PopoverFilterBuilder';
import { PopoverRowHeight } from './popovers/PopoverRowHeight';

export const StageTopbar: React.FC = () => {
  const {
    document,
    setTitle,
    activePopover,
    setActivePopover,
    undo,
    redo,
    canUndo,
    canRedo,
    closeStage,
  } = useTableStore();

  const isFieldConfigOpen = activePopover === 'field-config';
  const isFilterOpen = activePopover === 'filter';
  const isRowHeightOpen = activePopover === 'row-height';

  const hasActiveFilter = Boolean(
    document.filter?.conditions &&
      document.filter.conditions.length > 0 &&
      document.filter.conditions.some((c) => c.value !== undefined && c.value !== '')
  );

  return (
    <header
      className="wf-stage-topbar"
      onClick={(e) => {
        e.stopPropagation();
        setActivePopover(null);
      }}
    >
      {/* 左侧：表格标识与可编辑表名（精炼清晰，无冗余返回按键） */}
      <div className="wf-stage-topbar__left">
        <div className="wf-stage-title-group">
          <Table size={16} className="wf-stage-title-icon" />
          <input
            type="text"
            className="wf-stage-title-input"
            value={document.title || '表格'}
            placeholder="输入表格名称..."
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      {/* 右侧：纯业务配置按钮与操作群 + 顶层关闭按钮 */}
      <div className="wf-stage-topbar__right">
        {/* 1. 【字段配置】按钮 + 锚定面板 */}
        <div className="wf-stage-btn-wrapper">
          <button
            type="button"
            className={`wf-stage-pill-btn ${isFieldConfigOpen ? 'wf-stage-pill-btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopover(isFieldConfigOpen ? null : 'field-config');
            }}
          >
            <Settings2 size={15} />
            <span>字段配置</span>
          </button>

          {isFieldConfigOpen && <PopoverFieldConfig />}
        </div>

        {/* 2. 【筛选】按钮 + 锚定面板 */}
        <div className="wf-stage-btn-wrapper">
          <button
            type="button"
            className={`wf-stage-pill-btn ${isFilterOpen ? 'wf-stage-pill-btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopover(isFilterOpen ? null : 'filter');
            }}
          >
            <Filter size={15} />
            <span>筛选</span>

            {/* 蓝色小圆点徽标 */}
            {hasActiveFilter && <span className="wf-stage-dot-badge" />}
          </button>

          {isFilterOpen && <PopoverFilterBuilder />}
        </div>

        {/* 3. 【行高】按钮 + 锚定面板 */}
        <div className="wf-stage-btn-wrapper">
          <button
            type="button"
            className={`wf-stage-pill-btn ${isRowHeightOpen ? 'wf-stage-pill-btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopover(isRowHeightOpen ? null : 'row-height');
            }}
          >
            <AlignJustify size={15} />
            <span>行高</span>
          </button>

          {isRowHeightOpen && <PopoverRowHeight />}
        </div>

        <div className="wf-stage-divider" />

        {/* 4. 撤销 (Cmd+Z) */}
        <button
          type="button"
          disabled={!canUndo()}
          className="wf-stage-icon-btn"
          title="撤销 (Cmd+Z)"
          onClick={undo}
        >
          <Undo2 size={16} />
        </button>

        {/* 5. 重做 (Cmd+Shift+Z) */}
        <button
          type="button"
          disabled={!canRedo()}
          className="wf-stage-icon-btn"
          title="重做 (Cmd+Shift+Z)"
          onClick={redo}
        >
          <Redo2 size={16} />
        </button>

        <div className="wf-stage-divider" />

        {/* 6. 右上角关闭按钮 (Esc) */}
        <button
          type="button"
          className="wf-stage-icon-btn wf-stage-close-btn"
          title="关闭全屏编辑 (Esc)"
          onClick={(e) => {
            e.stopPropagation();
            closeStage();
          }}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
};
