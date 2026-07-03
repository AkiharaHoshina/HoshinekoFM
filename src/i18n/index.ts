/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import enUS from './en-US';
import zhCN from './zh-CN';

const langs = { 'en-US': enUS, 'zh-CN': zhCN } as const;
export type Locale = 'en-US' | 'zh-CN' | 'auto';
type ActualLocale = keyof typeof langs;
type TData = typeof enUS;

function resolveLocale(): ActualLocale {
  if (_locale === 'auto') {
    try {
      const navLang = (typeof navigator !== 'undefined' && navigator.language) || '';
      if (navLang.toLowerCase().startsWith('zh')) return 'zh-CN';
    } catch { /* navigator not available */ }
    return 'en-US';
  }
  return _locale;
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('settings.locale');
    if (stored === 'en-US' || stored === 'zh-CN' || stored === 'auto') return stored;
  } catch { /* localStorage not available */ }
  return 'auto';
}

let _locale: Locale = detectLocale();
const _subs = new Set<() => void>();

function notify() { _subs.forEach(fn => fn()); }

export function setLocale(locale: Locale) {
  if (_locale === locale) return;
  _locale = locale;
  try { localStorage.setItem('settings.locale', locale); } catch { /* localStorage not available */ }
  notify();
}

export function getLocale(): Locale { return _locale; }

export function useLocale() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump(n => n + 1);
    _subs.add(fn);
    return () => { _subs.delete(fn); };
  }, []);
  const setL = useCallback((loc: Locale) => setLocale(loc), []);
  return { locale: _locale, setLocale: setL };
}

export function t(key: keyof TData, ...args: any[]): string {
  const data = langs[resolveLocale()] as Record<string, any>;
  const entry = data[key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(...args) : entry;
}
