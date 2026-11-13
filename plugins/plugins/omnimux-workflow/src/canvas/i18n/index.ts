/**
 * Canvas island i18n skeleton (W1, 计划 §7)。
 *
 * 模块级 locale + useT() hook —— island 是 IIFE 全局 API，不经过宿主
 * ctx.locale；宿主语言经 mountCanvas/updateCanvas 的 locale prop 传入，
 * App 调 setLocale() 下发。组件用 useT()（useSyncExternalStore 订阅
 * 模块 locale）取 t()。
 *
 * fallback 顺序：active → zh → en → key。未知 locale 回退 zh。
 */

import { useSyncExternalStore } from 'react';
// 显式 .ts 扩展名：node --test 的 type-stripping 不做 TS 扩展名解析
// （tsconfig 已开 allowImportingTsExtensions，esbuild 同样兼容）。
import zh, { type DictKey } from './dict.zh.ts';
import en from './dict.en.ts';

export type Locale = 'zh' | 'en';
export type { DictKey };

const DICTS: Record<Locale, Record<DictKey, string>> = { zh, en };

let currentLocale: Locale = 'zh';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: string | undefined): void {
  const next: Locale = locale === 'en' ? 'en' : 'zh';
  if (next === currentLocale) return;
  currentLocale = next;
  for (const listener of listeners) listener();
}

export function t(key: DictKey | (string & {})): string {
  const dict = DICTS[currentLocale] as Record<string, string>;
  return dict[key] ?? (DICTS.zh as Record<string, string>)[key] ?? (DICTS.en as Record<string, string>)[key] ?? key;
}

/** React hook：订阅模块 locale，语言切换时触发重渲染。 */
export function useT(): (key: DictKey | (string & {})) => string {
  useSyncExternalStore(subscribe, getLocale);
  return t;
}
