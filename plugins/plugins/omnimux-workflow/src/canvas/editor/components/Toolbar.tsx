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

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  MousePointer,
  Hand,
  FolderOpen,
  HelpCircle,
  FileCode,
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
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  const isAddOpen = externalIsAddMenuOpen !== undefined ? externalIsAddMenuOpen : internalIsAddMenuOpen;
  const closeAdd = useCallback(() => {
    if (onToggleAddMenu) {
      if (isAddOpen) onToggleAddMenu();
    } else {
      setInternalIsAddMenuOpen(false);
    }
  }, [isAddOpen, onToggleAddMenu]);
  const toggleAdd = onToggleAddMenu || (() => setInternalIsAddMenuOpen((v) => !v));

  const handleSelectNodeType = useCallback(
    (type: CanvasAddNodeType) => {
      onAddNode(type);
      closeAdd();
    },
    [onAddNode, closeAdd],
  );

  /** ComfyUI 工作流卡片底部的「使用模板」（Issue #3751）：打开画布已有的模板面板。 */
  useEffect(() => {
    const listener = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: unknown }>).detail?.nodeId;
      if (typeof nodeId !== 'string') return;
      setIsTemplateMenuOpen(true);
    };
    window.addEventListener(COMFY_PAGE_TEMPLATE_EVENT, listener);
    return () => window.removeEventListener(COMFY_PAGE_TEMPLATE_EVENT, listener);
  }, []);

  useClickOutside({
    refs: addMenuRef,
    onClose: closeAdd,
    enabled: isAddOpen,
  });

  useClickOutside({
    refs: templateMenuRef,
    onClose: () => setIsTemplateMenuOpen(false),
    enabled: isTemplateMenuOpen,
  });

  return (
    <div
      className="wf-canvas-toolbar nodrag nopan"
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
    >
      {/* 核心添加节点按钮与浮层菜单 */}
      <div ref={addMenuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className={`wf-canvas-toolbar__item wf-canvas-toolbar__item--primary-add ${isAddOpen ? 'wf-canvas-toolbar__item--primary-add-open' : ''}`}
          onClick={toggleAdd}
          onContextMenu={preventToolbarAddContextMenu}
          title={t('toolbar.addNode')}
          aria-expanded={isAddOpen}
          aria-haspopup="menu"
        >
          <span className="wf-canvas-toolbar__icon">
            <Plus size={18} />
          </span>
          <span className="wf-canvas-toolbar__add-text">{t('menu.addNode')}</span>
        </button>

        {isAddOpen ? (
          <AddNodeMenu scope="dock" onSelect={handleSelectNodeType} />
        ) : null}
      </div>

      <div className="wf-canvas-toolbar__divider" />

      {onInsertTemplate && (
        <div ref={templateMenuRef} className="wf-canvas-toolbar__anchor">
          <button
            type="button"
            className="wf-canvas-toolbar__item wf-canvas-toolbar__item--icon-only"
            onClick={() => setIsTemplateMenuOpen((open) => !open)}
            title={t('toolbar.insertTemplate')}
          >
            <span className="wf-canvas-toolbar__icon">
              <FileCode size={20} />
            </span>
            <span className="wf-canvas-toolbar__label">{t('toolbar.insertTemplateLabel')}</span>
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

      {/* 指针模式直点切换：选择 (V) / 抓手 (H) */}
      <div
        className="wf-canvas-toolbar__mode-group"
        role="group"
        aria-label={t('toolbar.pointerModeGroup')}
      >
        <button
          type="button"
          className={`wf-canvas-toolbar__item wf-canvas-toolbar__mode-btn ${pointerMode === 'select' ? 'wf-canvas-toolbar__item--active' : ''}`}
          data-mode="select"
          title={t('toolbar.selectMode')}
          aria-label={t('toolbar.selectMode')}
          aria-keyshortcuts="V"
          aria-pressed={pointerMode === 'select'}
          onClick={() => onPointerModeChange?.('select')}
        >
          <span className="wf-canvas-toolbar__icon">
            <MousePointer size={18} />
          </span>
          <span className="wf-canvas-toolbar__mode-label">{t('toolbar.selectShort')}</span>
        </button>
        <button
          type="button"
          className={`wf-canvas-toolbar__item wf-canvas-toolbar__mode-btn ${pointerMode === 'pan' ? 'wf-canvas-toolbar__item--active' : ''}`}
          data-mode="pan"
          title={t('toolbar.panMode')}
          aria-label={t('toolbar.panMode')}
          aria-keyshortcuts="H"
          aria-pressed={pointerMode === 'pan'}
          onClick={() => onPointerModeChange?.('pan')}
        >
          <span className="wf-canvas-toolbar__icon">
            <Hand size={18} />
          </span>
          <span className="wf-canvas-toolbar__mode-label">{t('toolbar.panShort')}</span>
        </button>
      </div>

      {/* 项目资产库入口 */}
      <button
        type="button"
        className={`wf-canvas-toolbar__item wf-canvas-toolbar__item--icon-only ${isAssetsOpen ? 'wf-canvas-toolbar__item--active' : ''}`}
        onClick={onOpenAssets}
        title={t('toolbar.assets')}
      >
        <span className="wf-canvas-toolbar__icon">
          <FolderOpen size={20} />
        </span>
        <span className="wf-canvas-toolbar__label">{t('toolbar.assets')}</span>
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
          >
            <span className="wf-canvas-toolbar__icon">
              <HelpCircle size={20} />
            </span>
            <span className="wf-canvas-toolbar__label">{t('toolbar.help')}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default memo(Toolbar);
