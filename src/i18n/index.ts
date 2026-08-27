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

/**
 * 解析 localStorage 中的语言值，兼容两种历史格式：
 * - 新格式：JSON 字符串（如 `"zh-CN"`，与 useLocalStorage 统一）
 * - 旧格式：裸字符串（如 `zh-CN`，早期 i18n.setLocale 的写入方式）
 *
 * @param stored - localStorage 原始值；null 表示未存储
 * @returns 合法的 Locale；无效或未存储时返回 null
 */
function parseStoredLocale(stored: string | null): Locale | null {
  if (!stored) return null;
  // 新格式：JSON 字符串
  try {
    const parsed = JSON.parse(stored) as string;
    if (parsed === 'auto' || (parsed && langs[parsed])) return parsed as Locale;
  } catch { /* 继续尝试旧格式裸字符串 */ }
  // 旧格式：裸字符串
  if (stored === 'auto' || langs[stored]) return stored as Locale;
  return null;
}

function detectLocale(): Locale {
  try {
    const stored = parseStoredLocale(localStorage.getItem('settings.locale'));
    if (stored) return stored;
  } catch { /* localStorage not available */ }
  return 'auto';
}

let _locale: Locale = detectLocale();
const _subs = new Set<() => void>();

function notify() { _subs.forEach(fn => fn()); }

export function setLocale(locale: Locale) {
  if (_locale === locale) return;
  _locale = locale;
  // 统一用 JSON 格式写入（与 useLocalStorage 一致），
  // 避免裸字符串让其他窗口的 JSON.parse 失败而无法跨窗口同步
  try { localStorage.setItem('settings.locale', JSON.stringify(locale)); } catch { /* localStorage not available */ }
  notify();
}

/**
 * 跨窗口同步：其他窗口修改语言时（浏览器 storage 事件，Electron 多窗口
 * 共享同一分区）直接更新本窗口的模块状态并通知订阅者，所有 t() 即时生效。
 * 相同值写入不会重复派发事件，setLocale 的同值早退保证无循环。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== 'settings.locale') return;
    try {
      const next = parseStoredLocale(e.newValue);
      if (!next || _locale === next) return;
      _locale = next;
      notify();
    } catch { /* 解析失败时保持当前语言 */ }
  });
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
