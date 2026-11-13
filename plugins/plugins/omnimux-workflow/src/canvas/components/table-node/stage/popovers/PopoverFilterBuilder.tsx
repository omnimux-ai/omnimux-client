import React from 'react';
import { Plus, X } from 'lucide-react';
import { useTableStore } from '../../../../store/tableStore.ts';
import { CustomSelect, type SelectOption } from '../../../../ui';
import type { FilterOperator, HTableFilterCondition } from '../../../../../shared/types/htable.ts';

const OP_OPTIONS: SelectOption<FilterOperator>[] = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'empty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
];

export const PopoverFilterBuilder: React.FC = () => {
  const { document, setFilterConditions } = useTableStore();
  const defaultColId = document.columns[0]?.id || 'col_text';
  const conditions: HTableFilterCondition[] =
    document.filter?.conditions && document.filter.conditions.length > 0
      ? document.filter.conditions
      : [{ columnId: defaultColId, op: 'equals', value: '' }];

  const columnOptions: SelectOption<string>[] = document.columns.map((col) => ({
    value: col.id,
    label: col.title || 'Untitled',
  }));

  const handleUpdateCondition = (
    index: number,
    patch: Partial<HTableFilterCondition>,
  ) => {
    const next = conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setFilterConditions(next);
  };

  const handleAddCondition = () => {
    const next: HTableFilterCondition[] = [
      ...conditions,
      { columnId: defaultColId, op: 'equals', value: '' },
    ];
    setFilterConditions(next);
  };

  const handleDeleteCondition = (index: number) => {
    const next = conditions.filter((_, i) => i !== index);
    setFilterConditions(
      next.length === 0
        ? [{ columnId: defaultColId, op: 'equals', value: '' }]
        : next,
    );
  };

  return (
    <div
      className="wf-popover-card wf-popover-filter"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wf-popover-title">设置筛选条件</div>

      <div className="wf-filter-body">
        {conditions.map((cond, idx) => {
          const isUnary = cond.op === 'empty' || cond.op === 'notEmpty';

          return (
            <div key={idx} className="wf-filter-row">
              {/* 字段选择胶囊 */}
              <div style={{ width: 130, flexShrink: 0 }}>
                <CustomSelect<string>
                  value={cond.columnId || defaultColId}
                  options={columnOptions}
                  onChange={(val) => handleUpdateCondition(idx, { columnId: val })}
                  variant="standard"
                  className="wf-filter-capsule-select"
                />
              </div>

              {/* 运算符选择胶囊 */}
              <div style={{ width: 110, flexShrink: 0 }}>
                <CustomSelect<FilterOperator>
                  value={cond.op}
                  options={OP_OPTIONS}
                  onChange={(val) => handleUpdateCondition(idx, { op: val })}
                  variant="standard"
                  className="wf-filter-capsule-select"
                />
              </div>

              {/* 目标值输入框 (一元运算符禁用) */}
              <div style={{ flex: 1, minWidth: 120 }}>
                <input
                  type="text"
                  className="wf-filter-val-input"
                  placeholder={isUnary ? '无需输入' : '输入匹配值...'}
                  disabled={isUnary}
                  value={cond.value !== undefined ? String(cond.value) : ''}
                  onChange={(e) => handleUpdateCondition(idx, { value: e.target.value })}
                />
              </div>

              {/* 删除条件按钮 */}
              <button
                type="button"
                className="wf-filter-del-btn"
                onClick={() => handleDeleteCondition(idx)}
                title="删除条件"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 底部新增条件按钮 */}
      <div className="wf-filter-footer">
        <button
          type="button"
          className="wf-filter-add-btn"
          onClick={handleAddCondition}
        >
          <Plus size={14} />
          <span>添加条件</span>
        </button>
      </div>
    </div>
  );
};
