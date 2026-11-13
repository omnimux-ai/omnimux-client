import React from 'react';
import { X, Command, Keyboard } from 'lucide-react';
import { stopToolbarNativeEvent } from './toolbarPointerGuard';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUT_GROUPS: Array<{ title: string; items: ShortcutItem[] }> = [
  {
    title: '模式与工具',
    items: [
      { keys: ['V'], description: '切换为指针选择模式', category: 'tools' },
      { keys: ['H'], description: '切换为抓手平移模式', category: 'tools' },
      { keys: ['Space + 拖拽'], description: '临时平移画布', category: 'tools' },
      { keys: ['N'], description: '打开新建节点菜单', category: 'tools' },
      { keys: ['A', 'Shift + A'], description: '打开 / 切换项目资产库抽屉', category: 'tools' },
      { keys: ['1 ~ 6'], description: '在资产库中快速切换分类', category: 'tools' },
      { keys: ['M'], description: '展开 / 收起小地图浮窗', category: 'tools' },
      { keys: ['?'], description: '查看快捷键指南', category: 'tools' },
    ],
  },
  {
    title: '节点操作',
    items: [
      { keys: ['⌘', 'C'], description: '复制选中节点', category: 'node' },
      { keys: ['⌘', 'V'], description: '粘贴节点', category: 'node' },
      { keys: ['⌘', 'D'], description: '快速制作副本 (Duplicate)', category: 'node' },
      { keys: ['Delete / Backspace'], description: '删除选中节点', category: 'node' },
      { keys: ['⌘', 'A'], description: '全选所有节点', category: 'node' },
      { keys: ['Esc'], description: '取消选择 / 关闭浮层', category: 'node' },
    ],
  },
  {
    title: '视图与布局',
    items: [
      { keys: ['⌘', '1'], description: '自适应全图 (Fit View)', category: 'view' },
      { keys: ['⌘', '0'], description: '重置为 100% 缩放', category: 'view' },
      { keys: ['⌘', '\\'], description: '切换分屏模式 (对话+画布 / 仅画布)', category: 'view' },
      { keys: ['⌘', 'Z'], description: '撤销上一步操作', category: 'view' },
      { keys: ['⇧', '⌘', 'Z'], description: '重做操作', category: 'view' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="wf-shortcuts-overlay nodrag nopan"
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
      onClick={onClose}
    >
      <div
        className="wf-shortcuts-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wf-shortcuts-modal__header">
          <div className="wf-shortcuts-modal__title">
            <Keyboard size={18} />
            <span>画布快捷键指南</span>
          </div>
          <button
            type="button"
            className="wf-shortcuts-modal__close-btn"
            onClick={onClose}
            title="关闭 (Esc / ?)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="wf-shortcuts-modal__body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="wf-shortcuts-group">
              <div className="wf-shortcuts-group__title">{group.title}</div>
              <div className="wf-shortcuts-group__list">
                {group.items.map((item, idx) => (
                  <div key={idx} className="wf-shortcuts-row">
                    <span className="wf-shortcuts-row__desc">{item.description}</span>
                    <div className="wf-shortcuts-row__keys">
                      {item.keys.map((k, kIdx) => (
                        <kbd key={kIdx} className="wf-kbd">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShortcutsModal;
