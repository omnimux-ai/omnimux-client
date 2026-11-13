/**
 * Ported from Gxgen
 * `apps/web/src/pages/CanvasEditor/components/CanvasNodeActionMenu.tsx`
 * (205 lines) — createPortal floating action menu.
 *
 * Differences: AppIcon/inline SVGs → lucide-react named imports
 * (tree-shaken, spike pit #8); Tailwind utilities → wf-action-menu* BEM
 * classes in workbench-theme.css; label/description are resolved through
 * the island i18n dictionary by the caller (options arrive ready-made).
 *
 * The menu portals to document.body, so its styles cannot rely on the
 * .wf-canvas-root ancestor — the .wf-action-menu root re-declares the
 * tokens it needs (same pattern as .wf-context-menu / --wcm-*).
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioLines,
  ImagePlus,
  Mic,
  PersonStanding,
  Sparkles,
  Type,
  Video,
} from 'lucide-react';

export interface CanvasNodeActionMenuOption {
  key: string;
  label: string;
  icon?: string;
  description?: string;
}

interface CanvasNodeActionMenuProps {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  options: CanvasNodeActionMenuOption[];
  onSelect: (key: string) => void;
  onClose: () => void;
  align?: 'start' | 'end';
}

const MENU_WIDTH = 278;
const VIEWPORT_PADDING = 12;
const MENU_VERTICAL_OFFSET = 8;
const MENU_MIN_HEIGHT = 160;

const ICON_SIZE = 18;
const ICON_MAP: Record<string, ReactNode> = {
  AudioLines: <AudioLines size={ICON_SIZE} />,
  ImageGen: <ImagePlus size={ICON_SIZE} />,
  Mic: <Mic size={ICON_SIZE} />,
  PersonStanding: <PersonStanding size={ICON_SIZE} />,
  TextGen: <Type size={ICON_SIZE} />,
  VideoGen: <Video size={ICON_SIZE} />,
};

const ICON_STYLE_MAP: Record<string, { color: string; bg: string }> = {
  TextGen: { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.16)' },
  ImageGen: { color: '#c084fc', bg: 'rgba(168, 85, 247, 0.16)' },
  VideoGen: { color: '#fb923c', bg: 'rgba(249, 115, 22, 0.16)' },
  AudioLines: { color: '#34d399', bg: 'rgba(16, 185, 129, 0.16)' },
  Mic: { color: '#34d399', bg: 'rgba(16, 185, 129, 0.16)' },
  PersonStanding: { color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.16)' },
};

function getIconTheme(icon?: string): { color: string; bg: string } {
  if (!icon) return { color: '#e4e4e7', bg: 'rgba(255, 255, 255, 0.06)' };
  return ICON_STYLE_MAP[icon] ?? { color: '#e4e4e7', bg: 'rgba(255, 255, 255, 0.06)' };
}

function clampHorizontalPosition(x: number, align: 'start' | 'end') {
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const proposedLeft = align === 'end' ? x - MENU_WIDTH : x;
  return Math.min(
    Math.max(VIEWPORT_PADDING, proposedLeft),
    Math.max(VIEWPORT_PADDING, viewportWidth - MENU_WIDTH - VIEWPORT_PADDING),
  );
}

const CanvasNodeActionMenu: React.FC<CanvasNodeActionMenuProps> = ({
  visible,
  x,
  y,
  title,
  options,
  onSelect,
  onClose,
  align = 'start',
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>({
    left: x,
    top: y,
    maxHeight: MENU_MIN_HEIGHT,
  });

  useLayoutEffect(() => {
    if (!visible) return;

    const viewportHeight = typeof window === 'undefined' ? MENU_MIN_HEIGHT : window.innerHeight;
    const nextLeft = clampHorizontalPosition(x, align);
    const proposedTop = y + MENU_VERTICAL_OFFSET;
    const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING - MENU_MIN_HEIGHT);
    const nextTop = Math.min(Math.max(VIEWPORT_PADDING, proposedTop), maxTop);
    setPosition({
      left: nextLeft,
      top: nextTop,
      maxHeight: Math.max(0, viewportHeight - nextTop - VIEWPORT_PADDING),
    });
  }, [align, visible, x, y]);

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, visible]);

  const renderedOptions = useMemo(
    () =>
      options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-testid={`menu-item-${option.key}`}
          className="wf-action-menu__item"
          onClick={() => onSelect(option.key)}
        >
          <div className="wf-action-menu__item-inner">
            {option.icon ? (
              <span
                className="wf-action-menu__item-icon"
                style={{
                  background: getIconTheme(option.icon).bg,
                  color: getIconTheme(option.icon).color,
                }}
              >
                {ICON_MAP[option.icon] ?? <Sparkles size={ICON_SIZE} />}
              </span>
            ) : null}
            <div className="wf-action-menu__item-text">
              <span className="wf-action-menu__item-label">{option.label}</span>
              {option.description ? (
                <span className="wf-action-menu__item-desc">{option.description}</span>
              ) : null}
            </div>
          </div>
        </button>
      )),
    [onSelect, options],
  );

  if (!visible || options.length === 0) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      data-testid="canvas-node-action-menu"
      className="wf-action-menu"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight,
      }}
    >
      <div className="wf-action-menu__title">{title}</div>
      <div className="wf-action-menu__list">{renderedOptions}</div>
    </div>,
    document.body,
  );
};

export default memo(CanvasNodeActionMenu);
