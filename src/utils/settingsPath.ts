/**
 * settings:// 虚拟路径（review 26 设置重构）：设置页从对话框改为页面。
 *
 * 路径模型：
 * - `settings://` —— 根页：分类卡片（对象面板同款卡片样式）
 * - `settings://<cat>` —— 分类页（cat ∈ SETTINGS_CATEGORIES）
 * - `settings://display/theme` —— 唯一二级页（主题）
 *
 * 分类 id 与 i18n 键、图标在此表驱动登记——新增分类在此加一行，
 * 卡片渲染/面包屑/返回上级/标签页标题自动跟随。
 */

import { t } from '../i18n';

export interface SettingsCategory {
  /** 路径段 id（url 与卡片导航共用） */
  id: string;
  /** 卡片标题 i18n 键 */
  labelKey: string;
  /** 卡片图标（Material Symbols ligature） */
  icon: string;
}

/** 设置分类表（根页卡片序 = 数组序） */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'dashboard', labelKey: 'settings.cat_dashboard', icon: 'dashboard' },
  { id: 'files', labelKey: 'settings.cat_files', icon: 'folder' },
  { id: 'display', labelKey: 'settings.cat_display', icon: 'palette' },
  { id: 'search', labelKey: 'settings.cat_search', icon: 'search' },
  { id: 'objects', labelKey: 'settings.cat_objects', icon: 'widgets' },
  { id: 'portal', labelKey: 'settings.cat_portal', icon: 'integration_instructions' },
  { id: 'shortcut', labelKey: 'settings.cat_shortcut', icon: 'bolt' },
  { id: 'i18n', labelKey: 'settings.cat_i18n', icon: 'translate' },
  { id: 'defaultrecovery', labelKey: 'settings.cat_defaults', icon: 'restart_alt' },
  { id: 'about', labelKey: 'settings.cat_about', icon: 'info' },
];

/** 二级子页（cat → 子页 id → 标题 i18n 键）——目前仅 display/theme */
export const SETTINGS_SUBPAGES: Record<string, { id: string; labelKey: string }[]> = {
  display: [{ id: 'theme', labelKey: 'settings.cat_theme' }],
};

/** 是否为设置虚拟路径（`settings://` 或任意子页形态） */
export function isSettingsPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith('settings://');
}

export interface ParsedSettingsPath {
  /** 分类 id；根页（settings://）为 null */
  cat: string | null;
  /** 二级子页 id；无子页为 null */
  sub: string | null;
}

/** 解析设置路径：非法段（未登记的 cat/sub）静默归一为根页 */
export function parseSettingsPath(p: string): ParsedSettingsPath | null {
  if (!isSettingsPath(p)) return null;
  const segs = p.slice('settings://'.length).split('/').filter(Boolean);
  if (segs.length === 0) return { cat: null, sub: null };
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === segs[0]);
  if (!cat) return { cat: null, sub: null };
  if (segs.length === 1) return { cat: cat.id, sub: null };
  const subs = SETTINGS_SUBPAGES[cat.id] ?? [];
  const sub = subs.find((s) => s.id === segs[1]);
  return { cat: cat.id, sub: sub ? sub.id : null };
}

/** 归一化：未登记段整体回落根页（防坏 url 停留） */
export function normalizeSettingsPath(p: string): string {
  const parsed = parseSettingsPath(p);
  if (!parsed) return 'settings://';
  if (parsed.cat === null) return 'settings://';
  if (parsed.sub !== null) return `settings://${parsed.cat}/${parsed.sub}`;
  return `settings://${parsed.cat}`;
}

/** 上级路径：子页 → 分类页 → 根 → null（根无上级） */
export function settingsParentPath(p: string): string | null {
  const parsed = parseSettingsPath(p);
  if (!parsed || parsed.cat === null) return null;
  if (parsed.sub !== null) return `settings://${parsed.cat}`;
  return 'settings://';
}

/** 分类卡片导航路径 */
export function settingsCategoryPath(cat: string): string {
  return `settings://${cat}`;
}

/** 二级子页导航路径 */
export function settingsSubpagePath(cat: string, sub: string): string {
  return `settings://${cat}/${sub}`;
}

/**
 * 设置路径 → 显示标题（窗口标题/标签页标题同源）：
 * 根 = 「设置」；二级页 = 「设置 · 子页名」；分类页 = 「设置 · 类名」。
 */
export function settingsPathTitle(p: string): string {
  const parsed = parseSettingsPath(p);
  if (!parsed || parsed.cat === null) return t('settings.title');
  if (parsed.sub === 'theme' && parsed.cat === 'display') {
    return `${t('settings.title')} · ${t('settings.cat_theme')}`;
  }
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === parsed.cat);
  return cat ? `${t('settings.title')} · ${t(cat.labelKey)}` : t('settings.title');
}
