/**
 * Modernized Floating Dock Toolbar (aligned with modern AI video/workflow canvases):
 *
 * 1. Centered bottom floating capsule dock (.wf-canvas-toolbar nodrag nopan).
 * 2. Primary (+) button (Hotkey N) opening AddNodeMenu (scope="dock").
 * 3. Pointer mode selector: Select (V) / Pan (H).
 * 4. Project Assets drawer trigger (Hotkey A).
 * 5. Hotkey help (?) modal.
 *
 * Maintains .nodrag .nopan and pointer event guards to prevent xyflow mouse capture.
 */

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Plus,
  MousePointer,
  Hand,
  FolderOpen,
  HelpCircle,
  FileCode,
  ChevronUp,
  Check,
} from 'lucide-react';
import { useT } from '../../i18n';
import { useClickOutside } from '../hooks/useClickOutside';
import { COMFY_PAGE_TEMPLATE_EVENT } from '../../nodes/definitions/comfyPage';
import {
  preventToolbarAddContextMenu,
  stopToolbarNativeEvent,
} from './toolbarPointerGuard';
import AddNodeMenu from './AddNodeMenu';
import WorkflowTemplatePanel from './WorkflowTemplatePanel';
import type { CanvasAddNodeType } from './addNodePalette';

export type CanvasPointerMode = 'select' | 'pan';

export type { CanvasAddNodeType };

export interface ToolbarProps {
  onAddNode: (type: CanvasAddNodeType) => void;
  pointerMode?: CanvasPointerMode;
  onPointerModeChange?: (mode: CanvasPointerMode) => void;
  onOpenAssets?: () => void;
  onOpenHelp?: () => void;
  isAddMenuOpen?: boolean;
  onToggleAddMenu?: () => void;
  isAssetsOpen?: boolean;
  templates?: Array<{
    id: string;
    name: string;
    nodeCount: number;
    description?: string;
    tags?: string[];
    coverUrl?: string;
  }>;
  onInsertTemplate?: (id: string) => void;
  /** 新建模板入口；缺省时不渲染入口卡（不伪造入口）。 */
  onCreateWorkflow?: () => void;
  /** 模板列表真实加载态（透传模板面板）。 */
  isTemplateLoading?: boolean;
  /** 模板列表真实错误文案（透传模板面板，可读、不静默）。 */
  templateError?: string;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onAddNode,
  pointerMode = 'select',
  onPointerModeChange,
  onOpenAssets,
  onOpenHelp,
  isAddMenuOpen: externalIsAddMenuOpen,
  onToggleAddMenu,
  isAssetsOpen = false,
  templates = [],
  onInsertTemplate,
  onCreateWorkflow,
  isTemplateLoading = false,
  templateError,
}) => {
  const t = useT();
  const [internalIsAddMenuOpen, setInternalIsAddMenuOpen] = useState(false);
  const [isPointerMenuOpen, setIsPointerMenuOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const pointerMenuRef = useRef<HTMLDivElement>(null);
  const pointerTriggerRef = useRef<HTMLButtonElement>(null);
  const pointerMenuListRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  const isAddOpen = externalIsAddMenuOpen !== undefined ? externalIsAddMenuOpen : internalIsAddMenuOpen;
  const closeAdd = useCallback(() => {
    if (onToggleAddMenu) {
      if (isAddOpen) onToggleAddMenu();
    } else {
      setInternalIsAddMenuOpen(false);
    }
  }, [isAddOpen, onToggleAddMenu]);
  const closePointerMenu = useCallback(() => {
    setIsPointerMenuOpen(false);
  }, []);
  const toggleAdd = useCallback(() => {
    if (!isAddOpen) {
      setIsPointerMenuOpen(false);
      setIsTemplateMenuOpen(false);
    }
    if (onToggleAddMenu) {
      onToggleAddMenu();
    } else {
      setInternalIsAddMenuOpen((v) => !v);
    }
  }, [isAddOpen, onToggleAddMenu]);

  const togglePointerMenu = useCallback(() => {
    setIsPointerMenuOpen((open) => {
      const next = !open;
      if (next) {
        closeAdd();
        setIsTemplateMenuOpen(false);
      }
      return next;
    });
  }, [closeAdd]);

  const toggleTemplateMenu = useCallback(() => {
    setIsTemplateMenuOpen((open) => {
      const next = !open;
      if (next) {
        closeAdd();
        setIsPointerMenuOpen(false);
      }
      return next;
    });
  }, [closeAdd]);

  const handleSelectPointerMode = useCallback(
    (mode: CanvasPointerMode) => {
      onPointerModeChange?.(mode);
      setIsPointerMenuOpen(false);
    },
    [onPointerModeChange],
  );

  const handlePointerMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsPointerMenuOpen(false);
        pointerTriggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const options = Array.from(
        pointerMenuListRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
      );
      if (options.length === 0) return;
      const activeIdx = options.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = activeIdx < 0 ? 0 : (activeIdx + delta + options.length) % options.length;
      options[nextIdx]?.focus();
    },
    [],
  );

  const handleSelectNodeType = useCallback(
    (type: CanvasAddNodeType) => {
      onAddNode(type);
      closeAdd();
    },
    [onAddNode, closeAdd],
  );

  /** 外部快捷键（V/H）切换模式时收起指针模式菜单。 */
  useEffect(() => {
    setIsPointerMenuOpen(false);
  }, [pointerMode]);

  /** ComfyUI 工作流卡片底部的「使用模板」（Issue #3751）：打开画布已有的模板面板。 */
  useEffect(() => {
    const listener = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: unknown }>).detail?.nodeId;
      if (typeof nodeId !== 'string') return;
      closeAdd();
      setIsPointerMenuOpen(false);
      setIsTemplateMenuOpen(true);
    };
    window.addEventListener(COMFY_PAGE_TEMPLATE_EVENT, listener);
    return () => window.removeEventListener(COMFY_PAGE_TEMPLATE_EVENT, listener);
  }, [closeAdd]);

  useClickOutside({
    refs: addMenuRef,
    onClose: closeAdd,
    enabled: isAddOpen,
  });

  useClickOutside({
    refs: pointerMenuRef,
    onClose: closePointerMenu,
    enabled: isPointerMenuOpen,
  });

  useClickOutside({
    refs: templateMenuRef,
    onClose: () => setIsTemplateMenuOpen(false),
    enabled: isTemplateMenuOpen,
  });

  const currentModeLabel = pointerMode === 'select' ? t('toolbar.selectMode') : t('toolbar.panMode');

  return (
    <div
      className="wf-canvas-toolbar nodrag nopan"
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
    >
      {/* 核心添加节点按钮与浮层菜单（纯图标同心圆，保持可访问名称） */}
      <div ref={addMenuRef} className="wf-canvas-toolbar__anchor">
        <button
          type="button"
          className={`wf-canvas-toolbar__item wf-canvas-toolbar__item--primary-add ${isAddOpen ? 'wf-canvas-toolbar__item--primary-add-open' : ''}`}
          onClick={toggleAdd}
          onContextMenu={preventToolbarAddContextMenu}
          title={t('toolbar.addNode')}
          aria-label={t('toolbar.addNode')}
          aria-expanded={isAddOpen}
          aria-haspopup="menu"
        >
          <span className="wf-canvas-toolbar__icon">
            <Plus size={20} strokeWidth={2.2} />
          </span>
        </button>

        {isAddOpen ? (
          <AddNodeMenu scope="dock" onSelect={handleSelectNodeType} />
        ) : null}
      </div>

      <div className="wf-canvas-toolbar__divider" />

      {/* 指针模式聚合触发器 + 悬浮切换菜单：选择 (V) / 抓手 (H)（底栏纯图标） */}
      <div ref={pointerMenuRef} className="wf-canvas-toolbar__anchor">
        <button
          ref={pointerTriggerRef}
          type="button"
          className={`wf-canvas-toolbar__item wf-canvas-toolbar__mode-trigger ${isPointerMenuOpen ? 'wf-canvas-toolbar__mode-trigger--open' : ''}`}
          data-pointer-mode={pointerMode}
          title={currentModeLabel}
          aria-label={currentModeLabel}
          aria-haspopup="menu"
          aria-expanded={isPointerMenuOpen}
          onClick={togglePointerMenu}
        >
          <span className="wf-canvas-toolbar__icon wf-canvas-toolbar__mode-icon">
            {pointerMode === 'select' ? <MousePointer size={18} /> : <Hand size={18} />}
          </span>
          <span className="wf-canvas-toolbar__mode-caret" aria-hidden="true">
            <ChevronUp size={13} />
          </span>
        </button>

        {isPointerMenuOpen ? (
          <div
            ref={pointerMenuListRef}
            className="wf-canvas-toolbar__mode-menu"
            role="menu"
            aria-label={t('toolbar.pointerModeGroup')}
            onKeyDown={handlePointerMenuKeyDown}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={pointerMode === 'select'}
              aria-keyshortcuts="V"
              data-mode="select"
              className={`wf-canvas-toolbar__mode-option ${pointerMode === 'select' ? 'wf-canvas-toolbar__mode-option--active' : ''}`}
              onClick={() => handleSelectPointerMode('select')}
            >
              <span className="wf-canvas-toolbar__mode-check" aria-hidden="true">
                {pointerMode === 'select' ? <Check size={15} /> : null}
              </span>
              <span className="wf-canvas-toolbar__icon">
                <MousePointer size={16} />
              </span>
              <span className="wf-canvas-toolbar__mode-option-label">{t('toolbar.selectShort')}</span>
              <kbd className="wf-canvas-toolbar__mode-kbd">V</kbd>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={pointerMode === 'pan'}
              aria-keyshortcuts="H"
              data-mode="pan"
              className={`wf-canvas-toolbar__mode-option ${pointerMode === 'pan' ? 'wf-canvas-toolbar__mode-option--active' : ''}`}
              onClick={() => handleSelectPointerMode('pan')}
            >
              <span className="wf-canvas-toolbar__mode-check" aria-hidden="true">
                {pointerMode === 'pan' ? <Check size={15} /> : null}
              </span>
              <span className="wf-canvas-toolbar__icon">
                <Hand size={16} />
              </span>
              <span className="wf-canvas-toolbar__mode-option-label">{t('toolbar.panShort')}</span>
              <kbd className="wf-canvas-toolbar__mode-kbd">H</kbd>
            </button>
          </div>
        ) : null}
      </div>

      {onInsertTemplate && (
        <div ref={templateMenuRef} className="wf-canvas-toolbar__anchor">
          <button
            type="button"
            className={`wf-canvas-toolbar__item wf-canvas-toolbar__item--icon-only ${isTemplateMenuOpen ? 'wf-canvas-toolbar__item--active' : ''}`}
            onClick={toggleTemplateMenu}
            title={t('toolbar.insertTemplate')}
            aria-label={t('toolbar.insertTemplate')}
            aria-expanded={isTemplateMenuOpen}
            aria-haspopup="dialog"
          >
            <span className="wf-canvas-toolbar__icon">
              <FileCode size={19} />
            </span>
          </button>
          {isTemplateMenuOpen && (
            <WorkflowTemplatePanel
              templates={templates}
              onInsertTemplate={(id) => {
                onInsertTemplate(id);
                setIsTemplateMenuOpen(false);
              }}
              onCreateWorkflow={onCreateWorkflow}
              isLoading={isTemplateLoading}
              errorMessage={templateError}
              onClose={() => setIsTemplateMenuOpen(false)}
            />
          )}
        </div>
      )}

      {/* 项目资产库入口 */}
      <button
        type="button"
        className={`wf-canvas-toolbar__item wf-canvas-toolbar__item--icon-only ${isAssetsOpen ? 'wf-canvas-toolbar__item--active' : ''}`}
        onClick={onOpenAssets}
        title={t('toolbar.assets')}
        aria-label={t('toolbar.assets')}
        aria-pressed={isAssetsOpen}
      >
        <span className="wf-canvas-toolbar__icon">
          <FolderOpen size={19} />
        </span>
      </button>

      {/* 帮助 */}
      {onOpenHelp && (
        <>
          <div className="wf-canvas-toolbar__divider" />
          <button
            type="button"
            className="wf-canvas-toolbar__item wf-canvas-toolbar__item--icon-only"
            onClick={onOpenHelp}
            title={t('toolbar.help')}
            aria-label={t('toolbar.help')}
          >
            <span className="wf-canvas-toolbar__icon">
              <HelpCircle size={19} />
            </span>
          </button>
        </>
      )}
    </div>
  );
};

export default memo(Toolbar);
