/**
 * Comprehensive keyboard shortcuts for OmniMux modern workflow canvas.
 *
 * Supports:
 * - V / H: Pointer / Hand pan mode toggle
 * - N: Add node popover menu
 * - A / Shift+A: Open/toggle Assets Drawer
 * - 1~6: Quick switch asset category in drawer
 * - M: Toggle minimap popover
 * - ?: Toggle shortcuts guide modal
 * - Cmd+1: Fit View
 * - Cmd+0: Reset zoom to 100%
 * - Copy / Paste / Duplicate (⌘D) / Delete (Delete/Backspace) / Select All (⌘A) / Undo (⌘Z) / Redo (⇧⌘Z)
 *
 * Editing inside inputs (INPUT/TEXTAREA/contentEditable) never triggers canvas shortcuts.
 * Three-key or non-whitelisted modifier combinations (e.g. Ctrl+Cmd+A for WeChat/QQ screenshot)
 * are strictly ignored to avoid interfering with system global hotkeys.
 */

import { useEffect } from 'react';

export interface UseKeyboardShortcutsProps {
  onCopy?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onDeleteSelected?: () => void;
  onClearSelection?: () => void;
  onDuplicate?: () => void;
  hasSelection?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleAssets?: () => void;
  onToggleShortcuts?: () => void;
  onToggleMinimap?: () => void;
  onToggleAddMenu?: () => void;
  onSetPointerMode?: (mode: 'select' | 'pan') => void;
  onFitView?: () => void;
  onResetZoom?: () => void;
  onCategoryKey?: (catIndex: number) => void;
  onGroupSelected?: () => void;
  onUngroupSelected?: () => void;
  isAssetsOpen?: boolean;
  enabled?: boolean;
}

export type KeyboardShortcutAction =
  | 'toggleAssets'
  | 'pointerSelect'
  | 'pointerPan'
  | 'toggleAddMenu'
  | 'toggleMinimap'
  | 'toggleShortcuts'
  | 'fitView'
  | 'resetZoom'
  | 'deleteSelected'
  | 'escape'
  | 'ungroup'
  | 'group'
  | 'duplicate'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'undo'
  | 'redo'
  | { type: 'category'; index: number };

export function isPlatformMac(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

/**
 * 严格单主修饰键校验：
 * - macOS 下：仅当按下 Meta 且未按下 Control / Alt 时为 true
 * - Win/Linux 下：仅当按下 Control 且未按下 Meta / Alt 时为 true
 * 排除任何三键修饰组合（如 Control+Command+A 截图热键、Option+Command+A 等）。
 */
export function isStrictSingleMod(
  e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  isMac: boolean = isPlatformMac(),
): boolean {
  if (isMac) {
    return Boolean(e.metaKey && !e.ctrlKey && !e.altKey);
  }
  return Boolean(e.ctrlKey && !e.metaKey && !e.altKey);
}

export interface ShortcutContext {
  hasSelection?: boolean;
  isAssetsOpen?: boolean;
}

/**
 * 将原生键盘事件解析为画布动作（纯函数，易于 100% 单元测试覆盖）。
 */
export function resolveKeyboardShortcutAction(
  e: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    key: string;
    target?: unknown;
  },
  context: ShortcutContext = {},
  isMac: boolean = isPlatformMac(),
): KeyboardShortcutAction | null {
  const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return null;
  }

  const isMod = isStrictSingleMod(e, isMac);
  const isNoMod = !e.metaKey && !e.ctrlKey && !e.altKey;
  const keyLower = e.key.toLowerCase();
  const { hasSelection = false, isAssetsOpen = false } = context;

  // 1~6 数字快捷键切换抽屉分类
  if (isNoMod && !e.shiftKey && isAssetsOpen && /^[1-6]$/.test(e.key)) {
    return { type: 'category', index: parseInt(e.key, 10) };
  }

  // 'A' 或 'Shift + A' 打开/关闭资产抽屉
  if (isNoMod && keyLower === 'a') {
    return 'toggleAssets';
  }

  // 'V': 指针选择模式
  if (isNoMod && !e.shiftKey && keyLower === 'v') {
    return 'pointerSelect';
  }

  // 'H': 画布抓手平移模式
  if (isNoMod && !e.shiftKey && keyLower === 'h') {
    return 'pointerPan';
  }

  // 'N': 添加节点弹窗
  if (isNoMod && !e.shiftKey && keyLower === 'n') {
    return 'toggleAddMenu';
  }

  // 'M': 小地图开关
  if (isNoMod && !e.shiftKey && keyLower === 'm') {
    return 'toggleMinimap';
  }

  // '?' / Shift + '/': 快捷键指南浮窗
  if (isNoMod && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
    return 'toggleShortcuts';
  }

  // Cmd/Ctrl + 1: 适配画布视角
  if (isMod && !e.shiftKey && e.key === '1') {
    return 'fitView';
  }

  // Cmd/Ctrl + 0: 重置缩放 100%
  if (isMod && !e.shiftKey && e.key === '0') {
    return 'resetZoom';
  }

  // Delete / Backspace: 删除选中节点
  if (isNoMod && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
    return 'deleteSelected';
  }

  // Escape: 清空选择或关闭抽屉
  if (isNoMod && !e.shiftKey && e.key === 'Escape') {
    return 'escape';
  }

  // Cmd/Ctrl + Shift + G: 解组
  if (isMod && e.shiftKey && keyLower === 'g') {
    return 'ungroup';
  }

  // Cmd/Ctrl + G: 打组
  if (isMod && !e.shiftKey && keyLower === 'g') {
    return 'group';
  }

  // Cmd/Ctrl + D: 复制克隆
  if (isMod && !e.shiftKey && keyLower === 'd' && hasSelection) {
    return 'duplicate';
  }

  // Cmd/Ctrl + C: 拷贝
  if (isMod && !e.shiftKey && keyLower === 'c') {
    return 'copy';
  }

  // Cmd/Ctrl + V: 粘贴
  if (isMod && !e.shiftKey && keyLower === 'v') {
    return 'paste';
  }

  // Cmd/Ctrl + A: 全选 (严格排他，单修饰键生效)
  if (isMod && !e.shiftKey && keyLower === 'a') {
    return 'selectAll';
  }

  // Cmd/Ctrl + Z: 撤销
  if (isMod && !e.shiftKey && keyLower === 'z') {
    return 'undo';
  }

  // Cmd/Ctrl + Shift + Z: 重做
  if (isMod && e.shiftKey && keyLower === 'z') {
    return 'redo';
  }

  return null;
}

export const useKeyboardShortcuts = ({
  onCopy,
  onPaste,
  onSelectAll,
  onDeleteSelected,
  onClearSelection,
  onDuplicate,
  hasSelection = false,
  onUndo,
  onRedo,
  onToggleAssets,
  onToggleShortcuts,
  onToggleMinimap,
  onToggleAddMenu,
  onSetPointerMode,
  onFitView,
  onResetZoom,
  onCategoryKey,
  onGroupSelected,
  onUngroupSelected,
  isAssetsOpen = false,
  enabled = true,
}: UseKeyboardShortcutsProps) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = resolveKeyboardShortcutAction(
        e,
        { hasSelection, isAssetsOpen },
      );

      if (!action) return;

      e.preventDefault();

      if (typeof action === 'object' && action.type === 'category') {
        onCategoryKey?.(action.index);
        return;
      }

      switch (action) {
        case 'toggleAssets':
          onToggleAssets?.();
          break;
        case 'pointerSelect':
          onSetPointerMode?.('select');
          break;
        case 'pointerPan':
          onSetPointerMode?.('pan');
          break;
        case 'toggleAddMenu':
          onToggleAddMenu?.();
          break;
        case 'toggleMinimap':
          onToggleMinimap?.();
          break;
        case 'toggleShortcuts':
          onToggleShortcuts?.();
          break;
        case 'fitView':
          onFitView?.();
          break;
        case 'resetZoom':
          onResetZoom?.();
          break;
        case 'deleteSelected':
          onDeleteSelected?.();
          break;
        case 'escape':
          if (isAssetsOpen) {
            onToggleAssets?.();
          } else if (hasSelection) {
            onClearSelection?.();
          }
          break;
        case 'ungroup':
          onUngroupSelected?.();
          break;
        case 'group':
          onGroupSelected?.();
          break;
        case 'duplicate':
          onDuplicate?.();
          break;
        case 'copy':
          onCopy?.();
          break;
        case 'paste':
          onPaste?.();
          break;
        case 'selectAll':
          onSelectAll?.();
          break;
        case 'undo':
          onUndo?.();
          break;
        case 'redo':
          onRedo?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    onCopy,
    onPaste,
    onSelectAll,
    onDeleteSelected,
    onClearSelection,
    onDuplicate,
    hasSelection,
    onUndo,
    onRedo,
    onToggleAssets,
    onToggleShortcuts,
    onToggleMinimap,
    onToggleAddMenu,
    onSetPointerMode,
    onFitView,
    onResetZoom,
    onCategoryKey,
    onGroupSelected,
    onUngroupSelected,
    isAssetsOpen,
  ]);
};
