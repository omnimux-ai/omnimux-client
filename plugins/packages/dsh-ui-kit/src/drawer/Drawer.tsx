import { useEffect, useId, useRef } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { IconCloseOutline16 } from "../icons/compat-icons.tsx";

import { IconButton } from "../button/Button.tsx";
import { focusFirstDescendant, trapFocus } from "../internal/a11y.ts";
import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import { resolveKitLocale } from "../internal/locale.ts";
import type { PortalContainer } from "../internal/portal.ts";
import { resolvePortalContainer } from "../internal/portal.ts";
import { usePresence } from "../motion/usePresence.ts";
import "../motion/tokens.ts";
import { DrawerPortal } from "./DrawerPortal.tsx";
import css from "./Drawer.module.css";

export type DrawerPlacement = "right" | "left" | "top" | "bottom";

export interface DrawerProps {
  /** Whether the drawer is visible. */
  open: boolean;
  /** Close event callback. */
  onClose: () => void;
  /** Drawer header title. */
  title?: ReactNode;
  /** Subtitle or secondary description under title. */
  description?: ReactNode;
  /** Main drawer body content. */
  children: ReactNode;
  /** Bottom action footer slot. */
  footer?: ReactNode;
  /** Drawer slide-in placement, defaults to 'right'. */
  placement?: DrawerPlacement;
  /** Drawer width for 'left' | 'right' placements, defaults to 400. */
  width?: number | string;
  /** Drawer height for 'top' | 'bottom' placements, defaults to 320. */
  height?: number | string;
  /** Whether to show top-right close icon button, defaults to true. */
  closable?: boolean;
  /** Whether clicking the backdrop overlay triggers onClose, defaults to true. */
  closeOnOverlayClick?: boolean;
  /** Whether pressing the Escape key triggers onClose, defaults to true. */
  closeOnEsc?: boolean;
  /** Target portal mount container, defaults to document.body. */
  container?: PortalContainer;
  /** Accessible label for the close button. */
  closeLabel?: string;
  /** Custom class name for the drawer panel. */
  className?: string;
}

const PLACEMENT_CLASS: Record<DrawerPlacement, string> = {
  right: cssClass(css.placementRight, "placementRight"),
  left: cssClass(css.placementLeft, "placementLeft"),
  top: cssClass(css.placementTop, "placementTop"),
  bottom: cssClass(css.placementBottom, "placementBottom"),
};

/**
 * Accessible slide-in drawer panel with multi-directional animation,
 * FocusTrap, Escape key handling, and scroll lock prevention.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = "right",
  width = 400,
  height = 320,
  closable = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  container,
  closeLabel,
  className,
}: DrawerProps): JSX.Element | null {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const { mounted, phase } = usePresence(open, 190);
  const resolvedCloseLabel = closeLabel ?? (resolveKitLocale() === "en" ? "Close drawer" : "关闭抽屉");

  const titleId = useId();
  const descriptionId = useId();

  // Scroll lock on container — strictly keyed on `open` so exit releases immediately
  useEffect(() => {
    if (!open) return;
    const target = resolvePortalContainer(container);
    if (!target) return;

    const previousOverflow = target.style.overflow;
    target.style.overflow = "hidden";

    return () => {
      target.style.overflow = previousOverflow;
    };
  }, [open, container]);

  // Focus trap & previous focus restoration — strictly keyed on `open`
  useEffect(() => {
    if (!open) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Small delay to ensure DOM is attached
    const timer = setTimeout(() => {
      if (drawerRef.current) {
        focusFirstDescendant(drawerRef.current);
      }
    }, 16);

    return () => {
      clearTimeout(timer);
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open]);

  // Global Escape fallback when focus is outside or hasn't entered the drawer yet;
  // skips events handled by children (e.g. SearchField) or owned by an open menu / nested top modal.
  useEffect(() => {
    if (!open || !closeOnEsc || typeof document === "undefined") return;
    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key !== "Escape" || !closeOnEsc) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (modals.length > 0 && modals[modals.length - 1] !== drawerRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open, closeOnEsc, onClose]);

  // Keyboard navigation (Escape & Tab trap)
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open || e.defaultPrevented) return;
    if (e.key === "Escape" && closeOnEsc) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === "Tab" && drawerRef.current) {
      trapFocus(drawerRef.current, e.nativeEvent);
    }
  };

  const handleMaskClick = (e: MouseEvent<HTMLDivElement>) => {
    if (open && e.target === e.currentTarget && closeOnOverlayClick) {
      onClose();
    }
  };

  if (!mounted) return null;

  const isVertical = placement === "top" || placement === "bottom";
  const sizeStyle: CSSProperties = isVertical
    ? { height: typeof height === "number" ? `${height}px` : height }
    : { width: typeof width === "number" ? `${width}px` : width };

  return (
    <DrawerPortal container={container}>
      <div
        className={cssClass(css.root, "root")}
        data-phase={phase}
        aria-hidden={!open || undefined}
        onKeyDown={handleKeyDown}
      >
        <div
          className={cssClass(css.mask, "mask")}
          data-phase={phase}
          onClick={handleMaskClick}
          aria-hidden="true"
        />

        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          data-phase={phase}
          style={sizeStyle}
          className={cx(
            cssClass(css.drawer, "drawer"),
            PLACEMENT_CLASS[placement],
            className,
          )}
        >
          {title || description || closable ? (
            <div className={cssClass(css.header, "header")}>
              <div className={cssClass(css.headerText, "headerText")}>
                {title ? (
                  <h3 id={titleId} className={cssClass(css.title, "title")}>
                    {title}
                  </h3>
                ) : null}
                {description ? (
                  <p
                    id={descriptionId}
                    className={cssClass(css.description, "description")}
                  >
                    {description}
                  </p>
                ) : null}
              </div>

              {closable ? (
                <IconButton
                  aria-label={resolvedCloseLabel}
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                >
                  <IconCloseOutline16 size={16} />
                </IconButton>
              ) : null}
            </div>
          ) : null}

          <div className={cssClass(css.body, "body")}>{children}</div>

          {footer ? (
            <div className={cssClass(css.footer, "footer")}>{footer}</div>
          ) : null}
        </div>
      </div>
    </DrawerPortal>
  );
}
