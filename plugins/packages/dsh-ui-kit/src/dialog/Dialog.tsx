import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";

import { Button, IconButton } from "../button/Button.tsx";
import type { ButtonVariant } from "../button/Button.tsx";
import { IconCloseOutline16 } from "../icons/compat-icons.tsx";
import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import { resolveKitLocale } from "../internal/locale.ts";
import css from "./Dialog.module.css";

export type DialogSize = "sm" | "md" | "lg";

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional decorative icon beside the visible heading. */
  titleIcon?: ReactNode;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  closeLabel?: string;
  className?: string;
  contentClassName?: string;
}

const SIZE_CLASS: Record<DialogSize, string | undefined> = {
  sm: cssClass(css.sm, "sm"),
  md: undefined,
  lg: cssClass(css.lg, "lg"),
};

/**
 * Official Modal with kit geometry: 16px radius, scrollable body, right-aligned
 * action footer. Icon headings use the primitive's headless surface.
 */
export function ModalDialog({
  open,
  onClose,
  title,
  titleIcon,
  description,
  children,
  footer,
  size = "md",
  closeLabel,
  className,
  contentClassName,
}: ModalDialogProps) {
  const resolvedCloseLabel = closeLabel ?? (resolveKitLocale() === "en" ? "Close" : "关闭");
  const modalProps = { open, onClose, title, className: cx(css.dialog, SIZE_CLASS[size], className) };

  if (titleIcon != null && titleIcon !== false) {
    return (
      <Modal {...modalProps} headless>
        <div className={css.iconContent}>
          <div className={css.header}>
            <h2 className={css.title}>
              <span className={css.titleIcon} aria-hidden="true">{titleIcon}</span>
              {title}
            </h2>
            <IconButton variant="ghost" size="sm" aria-label={resolvedCloseLabel} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </IconButton>
          </div>
          {description ? <p className={css.description}>{description}</p> : null}
          {children !== undefined
            ? <div className={cx(css.body, css.iconBody, contentClassName)}>{children}</div>
            : null}
        </div>
        {footer !== undefined ? <div className={cx(css.footer, css.iconFooter)}>{footer}</div> : null}
      </Modal>
    );
  }

  return (
    <Modal
      {...modalProps}
      closeLabel={resolvedCloseLabel}
      contentClassName={cx(css.body, contentClassName)}
      {...(description !== undefined ? { description } : {})}
      {...(footer !== undefined ? { footer } : {})}
    >
      {children}
    </Modal>
  );
}

export interface ConfirmModalProps extends Omit<ModalDialogProps, "footer" | "children"> {
  message?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  confirmLoading?: boolean;
  onConfirm: () => void;
}

/** Two-button confirm dialog. Destructive flows should pass `confirmVariant="danger"`. */
export function ConfirmModal({
  message,
  children,
  confirmLabel,
  cancelLabel,
  confirmVariant = "primary",
  confirmLoading = false,
  onConfirm,
  onClose,
  size = "sm",
  ...rest
}: ConfirmModalProps) {
  const isEn = resolveKitLocale() === "en";
  const resolvedConfirmLabel = confirmLabel ?? (isEn ? "Confirm" : "确认");
  const resolvedCancelLabel = cancelLabel ?? (isEn ? "Cancel" : "取消");
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!rest.open || confirmVariant !== "danger") return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => cancelRef.current?.focus())
      : 0;
    if (!raf) cancelRef.current?.focus();
    return () => {
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    };
  }, [rest.open, confirmVariant]);

  const guardedOnClose = () => {
    if (!confirmLoading) onClose();
  };

  return (
    <ModalDialog
      {...rest}
      size={size}
      onClose={guardedOnClose}
      footer={(
        <div className={css.footer}>
          <Button ref={cancelRef} variant="outline" onClick={guardedOnClose} disabled={confirmLoading}>
            {resolvedCancelLabel}
          </Button>
          <Button variant={confirmVariant} loading={confirmLoading} onClick={onConfirm}>
            {resolvedConfirmLabel}
          </Button>
        </div>
      )}
    >
      {message != null ? <p className={css.message}>{message}</p> : children}
    </ModalDialog>
  );
}
