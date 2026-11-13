/**
 * CustomDropdown — Native Dark-Glass Menu Popover.
 * Replaces antd `Dropdown` with a lightweight, dark-glass component.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface CustomDropdownProps {
  items: DropdownMenuItem[];
  selectedKeys?: string[];
  placement?: 'topCenter' | 'bottomCenter' | 'bottomRight' | 'topLeft';
  trigger?: Array<'click' | 'hover'>;
  children: React.ReactElement;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
  items,
  selectedKeys = [],
  placement = 'bottomCenter',
  trigger = ['click'],
  children,
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number }>({
    left: 0,
  });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isTop = placement.startsWith('top');
    const isRight = placement.endsWith('Right');

    const top = isTop ? undefined : rect.bottom + 6;
    const bottom = isTop ? window.innerHeight - rect.top + 6 : undefined;
    const left = isRight ? rect.right - 140 : Math.max(10, rect.left + rect.width / 2 - 70);

    setCoords({ top, bottom, left });
  }, [placement]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  return (
    <>
      <div
        ref={triggerRef}
        style={{ display: 'inline-flex' }}
        onClick={trigger.includes('click') ? handleClickTrigger : undefined}
      >
        {children}
      </div>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className="wf-custom-dropdown-menu"
              style={{
                position: 'fixed',
                top: coords.top,
                bottom: coords.bottom,
                left: coords.left,
                minWidth: 140,
                zIndex: 9999,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wf-custom-dropdown-list">
                {items.map((item) => {
                  const isSelected = selectedKeys.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={item.disabled}
                      className={`wf-custom-dropdown-item ${
                        isSelected ? 'wf-custom-dropdown-item--selected' : ''
                      } ${item.disabled ? 'wf-custom-dropdown-item--disabled' : ''}`}
                      onClick={() => {
                        if (item.disabled) return;
                        item.onClick?.();
                        setOpen(false);
                      }}
                    >
                      {item.icon ? (
                        <span className="wf-custom-dropdown-item-icon">{item.icon}</span>
                      ) : null}
                      <span className="wf-custom-dropdown-item-text">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default CustomDropdown;
