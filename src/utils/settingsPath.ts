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
  /** 该分类页的设置项数（卡片第三行「N 个项目」；新增设置项时同步更新） */
  count: number;
}

/** 设置分类表（根页卡片序 = 数组序） */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'dashboard', labelKey: 'settings.cat_dashboard', icon: 'dashboard', count: 2 },
  { id: 'files', labelKey: 'settings.cat_files', icon: 'folder', count: 9 },
  { id: 'display', labelKey: 'settings.cat_display', icon: 'palette', count: 3 },
  { id: 'search', labelKey: 'settings.cat_search', icon: 'search', count: 4 },
  { id: 'objects', labelKey: 'settings.cat_objects', icon: 'widgets', count: 4 },
  { id: 'portal', labelKey: 'settings.cat_portal', icon: 'integration_instructions', count: 3 },
  { id: 'shortcut', labelKey: 'settings.cat_shortcut', icon: 'bolt', count: 2 },
  { id: 'built-in-terminal', labelKey: 'settings.cat_terminal', icon: 'terminal', count: 1 },
  { id: 'i18n', labelKey: 'settings.cat_i18n', icon: 'translate', count: 1 },
  { id: 'defaultrecovery', labelKey: 'settings.cat_defaults', icon: 'restart_alt', count: 1 },
  { id: 'about', labelKey: 'settings.cat_about', icon: 'info', count: 2 },
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
  /**
   * 搜索深链接目标行 id（`?focus=<rowId>`，设置搜索命中点击后导航到
   * 分类页并滚动高亮目标行——rowId 与 settingsSearchIndex 的登记同值，
   * 行挂 `data-settings-row`）；无 focus 段为 null。
   */
  focus: string | null;
}

/**
 * 设置分类固定载荷（设置根页卡片右键菜单「固定到侧边栏/固定到仪表盘」）：
 * 条目 path = settings://<cat> 分类页路径（固定条目点击 = 导航到此，
 * 与对象投影/搜索 schema 固定项同款导航别名）。
 */
export interface SettingsPinPayload {
  /** 分类页路径（settings://<cat>） */
  path: string;
  /** 显示名（分类标题，本地化后的文案） */
  name: string;
  /** 图标名（Material Symbols，取分类卡片图标） */
  icon: string;
}

/** 解析设置路径：非法段（未登记的 cat/sub）静默归一为根页。
 *  `?focus=<rowId>` 搜索深链接段（设置搜索命中点击携带）解析进
 *  focus——query 不参与 cat/sub 归一（focus 值自由透传） */
export function parseSettingsPath(p: string): ParsedSettingsPath | null {
  if (!isSettingsPath(p)) return null;
  const qIdx = p.indexOf('?');
  const pathPart = qIdx >= 0 ? p.slice('settings://'.length, qIdx) : p.slice('settings://'.length);
  const segs = pathPart.split('/').filter(Boolean);
  let focus: string | null = null;
  if (qIdx >= 0) {
    for (const part of p.slice(qIdx + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      if (part.slice(0, eq) === 'focus') {
        try {
          focus = decodeURIComponent(part.slice(eq + 1));
        } catch {
          focus = null;
        }
        break;
      }
      // 未知键忽略（容错）
    }
  }
  if (segs.length === 0) return { cat: null, sub: null, focus };
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === segs[0]);
  if (!cat) return { cat: null, sub: null, focus };
  if (segs.length === 1) return { cat: cat.id, sub: null, focus };
  const subs = SETTINGS_SUBPAGES[cat.id] ?? [];
  const sub = subs.find((s) => s.id === segs[1]);
  return { cat: cat.id, sub: sub ? sub.id : null, focus };
}

/** 归一化：未登记段整体回落根页（防坏 url 停留）。focus 段（搜索
 *  深链接）随 cat/sub 归一结果保留——分类合法即保留深链接目标 */
export function normalizeSettingsPath(p: string): string {
  const parsed = parseSettingsPath(p);
  if (!parsed) return 'settings://';
  const focusSuffix = parsed.focus ? `?focus=${parsed.focus}` : '';
  if (parsed.cat === null) return `settings://${focusSuffix}`;
  if (parsed.sub !== null) return `settings://${parsed.cat}/${parsed.sub}${focusSuffix}`;
  return `settings://${parsed.cat}${focusSuffix}`;
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
