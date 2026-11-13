import React from 'react';
import { useTableStore } from '../../../../store/tableStore';
import type { HTableRowHeight } from '../../../../../shared/types/htable';

const ROW_HEIGHT_OPTIONS: { id: HTableRowHeight; label: string }[] = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中等' },
  { id: 'tall', label: '高' },
  { id: 'extraTall', label: '超高' },
];

export const PopoverRowHeight: React.FC = () => {
  const { document, setRowHeight, setActivePopover } = useTableStore();
  const currentHeight = document.rowHeight || 'low';

  return (
    <div
      className="wf-popover-card wf-popover-row-height"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wf-popover-title">行高</div>

      <div style={{ padding: '6px' }}>
        {ROW_HEIGHT_OPTIONS.map((opt) => {
          const isSelected = currentHeight === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`wf-row-height-item ${isSelected ? 'wf-row-height-item--selected' : ''}`}
              style={isSelected ? { color: 'var(--wb-accent)' } : {}}
              onClick={() => {
                setRowHeight(opt.id);
                setActivePopover(null);
              }}
            >
              <span>{opt.label}</span>
              {isSelected && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wb-accent)' }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
