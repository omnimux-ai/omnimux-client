import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes, KeyboardEvent } from "react";
import { IconCloseFill14, IconSearchOutline16 } from "../icons/compat-icons.tsx";

import { cx } from "../internal/cx.ts";
import { resolveKitLocale } from "../internal/locale.ts";
import "../motion/tokens.ts";
import css from "./SearchField.module.css";

export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "value" | "defaultValue" | "onChange"
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onClear?: () => void;
  debounceMs?: number;
  shortcut?: string;
  stretch?: boolean;
  clearLabel?: string;
}

export interface SearchFieldHandle {
  focus: () => void;
  clear: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function matchesShortcut(event: globalThis.KeyboardEvent, shortcut: string): boolean {
  const raw = shortcut.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const hasExplicitMeta = /\b(cmd|meta)\b/.test(lower);
  const hasCmdGlyph = /⌘/.test(lower);
  const hasExplicitCtrl = /\bctrl\b|⌃/.test(lower);
  const wantsMod = /\bmod\b/.test(lower) || (hasCmdGlyph && !hasExplicitMeta && !hasExplicitCtrl);
  const wantsMeta = wantsMod ? isApplePlatform() : hasExplicitMeta || hasCmdGlyph;
  const wantsCtrl = wantsMod ? !isApplePlatform() : hasExplicitCtrl;
  const wantsAlt = /\balt\b|⌥/.test(lower);
  const wantsShift = /\bshift\b|⇧/.test(lower);
  const key = raw.replace(/⌘|⌃|⌥|⇧|mod|cmd|meta|ctrl|alt|shift|\+/gi, "").trim().toLowerCase();
  if (!key) return false;
  if (Boolean(event.metaKey) !== wantsMeta) return false;
  if (Boolean(event.ctrlKey) !== wantsCtrl) return false;
  if (Boolean(event.altKey) !== wantsAlt) return false;
  if (Boolean(event.shiftKey) !== wantsShift) return false;
  return event.key.toLowerCase() === key;
}

/**
 * Search field: leading search icon, optional shortcut kbd, and a clear control.
 * Uncontrolled `debounceMs` defaults to 200ms; controlled `value` defaults to 0ms
 * (immediate) unless an explicit `debounceMs` > 0 is passed.
 */
export const SearchField = forwardRef<SearchFieldHandle, SearchFieldProps>(function SearchField(
  {
    value,
    defaultValue = "",
    onValueChange,
    onClear,
    debounceMs: debounceMsProp,
    shortcut,
    stretch = false,
    clearLabel,
    className,
    disabled,
    id,
    placeholder,
    ...rest
  },
  ref,
) {
  const isEn = resolveKitLocale() === "en";
  const resolvedClearLabel = clearLabel ?? (isEn ? "Clear search" : "清空搜索");
  const resolvedPlaceholder = placeholder ?? (isEn ? "Search" : "搜索");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlled = value !== undefined;
  const resolvedDebounceMs = debounceMsProp ?? (controlled ? 0 : 200);
  const [inner, setInner] = useState(defaultValue);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    if (controlled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDraft(value ?? "");
    }
  }, [controlled, value]);

  const immediate = resolvedDebounceMs <= 0 || !onValueChange;
  const current = controlled ? (immediate ? value : draft) : inner;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!shortcut || disabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isTypingTarget(event.target)) return;
      if (!matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [shortcut, disabled]);

  function emit(next: string): void {
    if (immediate) {
      onValueChange?.(next);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onValueChange?.(next);
    }, resolvedDebounceMs);
  }

  function apply(next: string): void {
    if (!controlled) setInner(next);
    else if (!immediate) setDraft(next);
    emit(next);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    apply(event.target.value);
  }

  function handleClear(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!controlled) setInner("");
    else setDraft("");
    onValueChange?.("");
    onClear?.();
    inputRef.current?.focus();
  }

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus(); },
    clear: handleClear,
  }));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    rest.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && current) {
      event.preventDefault();
      event.stopPropagation();
      handleClear();
    }
  }

  return (
    <span className={cx(css.root, stretch && css.stretch, disabled && css.disabled, className)}>
      <span className={css.icon} aria-hidden="true">
        <IconSearchOutline16 size={16} />
      </span>
      <input
        {...rest}
        ref={inputRef}
        id={inputId}
        type="search"
        className={css.input}
        value={current}
        disabled={disabled}
        placeholder={resolvedPlaceholder}
        autoComplete="off"
        spellCheck={false}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      {current
        ? (
          <button
            type="button"
            className={css.clear}
            aria-label={resolvedClearLabel}
            title={resolvedClearLabel}
            disabled={disabled}
            onClick={handleClear}
          >
            <IconCloseFill14 size={14} />
          </button>
        )
        : shortcut
          ? <kbd className={css.shortcut}>{shortcut}</kbd>
          : null}
    </span>
  );
});
