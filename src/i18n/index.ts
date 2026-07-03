/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';

interface LocaleModule {
  default: Record<string, any>;
  match?: (lang: string) => boolean;
}

const localeModules = import.meta.glob<true, string, LocaleModule>(
  './*-*.ts',
  { eager: true },
);

const langs: Record<string, Record<string, any>> = {};
const matchers: [string, (lang: string) => boolean][] = [];
let _defaultCode = '';

for (const [path, mod] of Object.entries(localeModules)) {
  const code = path.match(/\/([^/]+)\.ts$/)?.[1];
  if (!code || !mod.default) continue;
  langs[code] = mod.default;
  if (!_defaultCode) _defaultCode = code;
  if (mod.match) matchers.push([code, mod.match]);
}

export type Locale = keyof typeof langs | 'auto';

function resolveLocale(): keyof typeof langs {
  if (_locale === 'auto') {
    try {
      const navLang = (typeof navigator !== 'undefined' && navigator.language) || '';
      for (const [code, matcher] of matchers) {
        if (matcher(navLang)) return code;
      }
    } catch { /* navigator not available */ }
    return _defaultCode;
  }
  return _locale as keyof typeof langs;
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('settings.locale');
    if (stored === 'auto' || (stored && langs[stored])) return stored as Locale;
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

export function t(key: string, ...args: any[]): string {
  const data = langs[resolveLocale()];
  const entry = data?.[key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(...args) : entry;
}

export function getLanguageOptions(): { value: Locale; name: string }[] {
  return [
    { value: 'auto', name: t('language_auto') },
    ...Object.entries(langs).map(([code, data]) => ({
      value: code as Locale,
      name: data.language_name as string,
    })),
  ];
}
