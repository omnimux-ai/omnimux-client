import React, { useState, useEffect, useRef } from 'react';
import { useTableStore } from '../../../../store/tableStore';
import type { HTableFieldType } from '../../../../../shared/types/htable';
import { CustomModal, CustomSelect, type SelectOption } from '../../../../ui';

const FIELD_OPTIONS: SelectOption<HTableFieldType>[] = [
  { value: 'text', label: '文本 (Text)' },
  { value: 'number', label: '数字 (Number)' },
  { value: 'attachment', label: '附件 (Attachment)' },
];

export const ModalColumnEditor: React.FC = () => {
  const { modalState, closeColumnModal, addColumn, updateColumn } = useTableStore();
  const [title, setTitle] = useState(modalState.initialTitle);
  const [selectedType, setSelectedType] = useState<HTableFieldType>(modalState.initialType);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modalState.isOpen) {
      setTitle(modalState.initialTitle);
      setSelectedType(modalState.initialType);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [modalState.isOpen, modalState.initialTitle, modalState.initialType]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      alert('请输入字段名');
      return;
    }

    if (modalState.mode === 'add') {
      addColumn(trimmed, selectedType);
    } else if (modalState.mode === 'edit' && modalState.targetColumnIndex !== null) {
      updateColumn(modalState.targetColumnIndex, trimmed, selectedType);
    }
    closeColumnModal();
  };

  return (
    <CustomModal
      open={modalState.isOpen}
      onCancel={closeColumnModal}
      title={modalState.mode === 'add' ? '添加列' : '编辑列'}
      width={420}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="wf-modal-btn-cancel"
            onClick={closeColumnModal}
          >
            取消
          </button>
          <button
            type="button"
            className="wf-modal-btn-primary"
            onClick={() => handleSubmit()}
          >
            确定
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#a1a1aa' }}>字段名</label>
          <input
            ref={inputRef}
            type="text"
            className="wf-modal-input"
            placeholder="请输入字段名..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#a1a1aa' }}>字段类型</label>
          <div className="wf-modal-select-wrapper">
            <CustomSelect<HTableFieldType>
              value={selectedType}
              options={FIELD_OPTIONS}
              onChange={(val) => setSelectedType(val)}
              variant="standard"
              className="wf-modal-custom-select"
            />
          </div>
        </div>
      </form>
    </CustomModal>
  );
};
