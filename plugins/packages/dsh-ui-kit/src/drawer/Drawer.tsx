import { useCallback, useEffect, useId, useRef } from "react";
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

type DrawerStackEntry = {
  node: HTMLElement | null;
};

const openDrawerStack: DrawerStackEntry[] = [];
const scrollLockMap = new WeakMap<HTMLElement, { count: number; previousOverflow: string }>();

function acquireScrollLock(target: HTMLElement): void {
  const existing = scrollLockMap.get(target);
  if (existing) {
    existing.count += 1;
    return;
  }
  const previousOverflow = target.style.overflow;
  scrollLockMap.set(target, { count: 1, previousOverflow });
  target.style.overflow = "hidden";
}

function releaseScrollLock(target: HTMLElement): void {
  const existing = scrollLockMap.get(target);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count <= 0) {
    const previousOverflow = existing.previousOverflow;
    scrollLockMap.delete(target);
    target.style.overflow = previousOverflow;
  }
}

function isActiveModalElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.getAttribute("data-phase") === "exiting") return false;
  if (el.closest('[aria-hidden="true"], [hidden]')) return false;
  return true;
}

function isRegisteredDrawerElement(el: Element): boolean {
  return openDrawerStack.some((entry) => entry.node === el);
}

function indexOfDrawerElement(el: Element | null): number {
  if (!el) return -1;
  return openDrawerStack.findIndex((entry) => entry.node === el);
}

function hasExternalNonDrawerModal(drawerEl: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const dialogs = document.querySelectorAll(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  );
  for (const el of Array.from(dialogs)) {
    if (drawerEl && (el === drawerEl || drawerEl.contains(el))) continue;
    if (!isActiveModalElement(el)) continue;
    if (!isRegisteredDrawerElement(el)) return true;
  }
  return false;
}

function hasBlockingModalAbove(drawerEl: HTMLElement | null): boolean {
  if (typeof document === "undefined" || !drawerEl) return false;
  const topEntry = openDrawerStack.length > 0 ? openDrawerStack[openDrawerStack.length - 1] : null;
  if (topEntry && topEntry.node !== drawerEl) {
    return true;
  }
  return hasExternalNonDrawerModal(drawerEl);
}

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
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const stackEntryRef = useRef<DrawerStackEntry | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOpenRef = useRef(open);
  latestOpenRef.current = open;
  const { mounted, phase } = usePresence(open, 190);
  const resolvedContainer = mounted || open ? resolvePortalContainer(container) : null;
  const resolvedCloseLabel = closeLabel ?? (resolveKitLocale() === "en" ? "Close drawer" : "关闭抽屉");

  const titleId = useId();
  const descriptionId = useId();

  const clearFocusTimer = useCallback(() => {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  const scheduleFocusIntoNode = useCallback((el: HTMLElement) => {
    clearFocusTimer();
    // Small delay to ensure DOM is attached; never steal focus if another active modal is above
    focusTimerRef.current = setTimeout(() => {
      focusTimerRef.current = null;
      const current = drawerRef.current;
      if (!current || current !== el || !latestOpenRef.current || hasBlockingModalAbove(current)) return;
      const rawActiveDialog = document.activeElement instanceof Element
        ? document.activeElement.closest('[role="dialog"], [role="alertdialog"]')
        : null;
      const activeDialog = rawActiveDialog && isActiveModalElement(rawActiveDialog) ? rawActiveDialog : null;
      if (activeDialog && activeDialog !== current && !isRegisteredDrawerElement(activeDialog)) {
        return;
      }
      focusFirstDescendant(current);
    }, 16);
  }, [clearFocusTimer]);

  const setDrawerNode = useCallback((el: HTMLDivElement | null) => {
    drawerRef.current = el;
    if (stackEntryRef.current) {
      stackEntryRef.current.node = el;
    }
    if (!el) {
      clearFocusTimer();
      return;
    }
    if (latestOpenRef.current && stackEntryRef.current) {
      scheduleFocusIntoNode(el);
    }
  }, [clearFocusTimer, scheduleFocusIntoNode]);

  // Ref-counted scroll lock on resolved container — tracks shared hosts & getter switches, releases immediately on exit
  useEffect(() => {
    if (!open) return;
    const target = resolvedContainer;
    if (!target) return;

    acquireScrollLock(target);

    return () => {
      releaseScrollLock(target);
    };
  }, [open, resolvedContainer]);

  // Open-session lifecycle: preserves chronological stack order & trigger focus even across portal container moves
  useEffect(() => {
    if (!open) return;
    if (typeof document !== "undefined") {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    }
    const entry: DrawerStackEntry = { node: drawerRef.current };
    stackEntryRef.current = entry;
    openDrawerStack.push(entry);

    if (entry.node) {
      scheduleFocusIntoNode(entry.node);
    }

    return () => {
      clearFocusTimer();
      const idx = openDrawerStack.indexOf(entry);
      const wasTopDrawer = idx >= 0 && idx === openDrawerStack.length - 1;
      if (idx >= 0) openDrawerStack.splice(idx, 1);
      if (stackEntryRef.current === entry) stackEntryRef.current = null;
      if (wasTopDrawer && !hasExternalNonDrawerModal(entry.node)) {
        if (
          previousActiveElementRef.current
          && typeof previousActiveElementRef.current.focus === "function"
          && (typeof document === "undefined" || (document.contains(previousActiveElementRef.current) && isActiveModalElement(previousActiveElementRef.current)))
        ) {
          previousActiveElementRef.current.focus();
        } else if (openDrawerStack.length > 0) {
          const nextTop = openDrawerStack[openDrawerStack.length - 1]?.node;
          if (nextTop) focusFirstDescendant(nextTop);
        }
      }
    };
  }, [open, clearFocusTimer, scheduleFocusIntoNode]);

  const isEscapeBlockedByNestedSurface = (target: EventTarget | null): boolean => {
    if (target instanceof Element) {
      const targetMenu = target.closest('[role="menu"]');
      if (targetMenu && isActiveModalElement(targetMenu)) return true;
      const targetDialog = target.closest('[role="dialog"], [role="alertdialog"]');
      if (targetDialog && targetDialog !== drawerRef.current && isActiveModalElement(targetDialog)) {
        const selfIdx = indexOfDrawerElement(drawerRef.current);
        const targetIdx = indexOfDrawerElement(targetDialog);
        const isLowerDrawer = selfIdx >= 0 && targetIdx >= 0 && targetIdx < selfIdx;
        if (!isLowerDrawer) return true;
      }
    }
    if (typeof document !== "undefined") {
      const menus = document.querySelectorAll('[role="menu"]');
      for (const menu of Array.from(menus)) {
        if (isActiveModalElement(menu)) return true;
      }
    }
    return hasBlockingModalAbove(drawerRef.current);
  };

  // Global Escape fallback when focus is outside or hasn't entered the drawer yet;
  // skips events handled by children (e.g. SearchField) or owned by an open menu / nested top modal.
  useEffect(() => {
    if (!open || !closeOnEsc || typeof document === "undefined") return;
    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key !== "Escape" || !closeOnEsc) return;
      if (isEscapeBlockedByNestedSurface(e.target)) return;
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
      // Portaled child modals bubble through React's synthetic event tree even though
      // their DOM lives outside drawerRef; never close the Drawer behind an open modal.
      if (e.target instanceof Node && drawerRef.current && !drawerRef.current.contains(e.target)) return;
      if (isEscapeBlockedByNestedSurface(e.target)) return;
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
    <DrawerPortal container={resolvedContainer}>
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
          ref={setDrawerNode}
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
