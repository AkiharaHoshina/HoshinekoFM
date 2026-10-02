/**
 * settingssearch:// 虚拟路径编码/解析（设置搜索的地址栏形态，与
 * objectsearch:// 完全同款语义——标准 URL query 参数 + 最小转义）。
 *
 * 格式：
 * - 根页（全局搜索，跨全部分类）：`settingssearch://?q=<关键词>`；
 * - 分类页/子页（类内搜索，限定该分类）：`settingssearch://<cat>?q=<关键词>`；
 * - 无搜索入口拒绝形态（设置搜索全页可搜，无实例页语义）。
 *
 * 关键词走 q 参数（最小转义：只转义 `%`/`?`/`#`/`&`/`=` 与控制字符，
 * Unicode 原样——`settingssearch://files?q=隐藏` 人可读写）；分类 id 走
 * 路径段（固定 id 集合，解析时校验未知 id 回落根页全局搜索）；解析
 * 容错：未知键/解码失败忽略，无 q 段时关键词为空串（空词 = 显示全部，
 * 与对象搜索 review 11 #2 同语义）。
 */
import { SETTINGS_CATEGORIES } from './settingsPath';

const SETTINGSSEARCH_PREFIX = 'settingssearch://';

/** 最小转义（与 searchPath/objectSearchPath 的 escapePart 同源）：只转义
 *  `%` 与 query 结构字符 */
function escapePart(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .split('').map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? encodeURIComponent(c) : c)).join('');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 设置搜索虚拟路径解析结果 */
export interface ParsedSettingsSearchPath {
  /** 搜索发起页的分类 id（null = 根页全局搜索；未知 id 归一为 null） */
  cat: string | null;
  /** 搜索关键词（已解码；无 q 段时为空串——空词 = 显示全部设置项） */
  query: string;
}

/** 是否为设置搜索虚拟路径 */
export function isSettingsSearchPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith(SETTINGSSEARCH_PREFIX);
}

/** 解析设置搜索虚拟路径（非 settingssearch:// 前缀回 null） */
export function parseSettingsSearchPath(p: string | null | undefined): ParsedSettingsSearchPath | null {
  if (!isSettingsSearchPath(p)) return null;
  const rest = p!.slice(SETTINGSSEARCH_PREFIX.length);
  const qIdx = rest.indexOf('?');
  const catRaw = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
  const cat = catRaw
    ? (SETTINGS_CATEGORIES.some((c) => c.id === catRaw) ? catRaw : null)
    : null;
  let query = '';
  if (qIdx >= 0) {
    for (const part of rest.slice(qIdx + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      if (part.slice(0, eq) === 'q') {
        query = safeDecode(part.slice(eq + 1));
        break;
      }
      // 未知键忽略（容错）
    }
  }
  return { cat, query };
}

/** 构造设置搜索虚拟路径（cat 为空 = 根页全局搜索；空词照常携带 q= 段——
 *  空词搜索视图语义，与对象搜索同款） */
export function buildSettingsSearchPath(cat: string | null | undefined, query: string): string {
  const cls = cat ? cat : '';
  return `${SETTINGSSEARCH_PREFIX}${cls}?q=${escapePart(query)}`;
}

/** 设置搜索的基准设置页路径（退出搜索回落点：根页或分类页） */
export function settingsSearchBasePath(parsed: ParsedSettingsSearchPath): string {
  return parsed.cat ? `settings://${parsed.cat}` : 'settings://';
}
