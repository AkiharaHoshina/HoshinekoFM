/**
 * objectsearch:// 虚拟路径编码/解析（Object Panel 面板内搜索的地址栏形态）。
 *
 * 格式：`objectsearch://<类名>:<encodeURIComponent(关键词)>`
 * - 根页（全局搜索）类名为空：`objectsearch://:<关键词>`；
 * - 类页（类内搜索）：`objectsearch://<类名>:<关键词>`；
 * - 实例页不可搜索（入口 toast 拒绝，不产生该路径）。
 * 类名无 ':' 且关键词整体 URL 编码——首个 ':' 之后全部为关键词，无歧义。
 * （筛选描述段预留：将来扩展时按 searchPath 同款括号转义方案追加。）
 */
import { buildObjectsPath } from './objectsPath';

const OBJECTSEARCH_PREFIX = 'objectsearch://';

/** 是否为对象搜索虚拟路径 */
export function isObjectSearchPath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(OBJECTSEARCH_PREFIX);
}

/** 对象搜索虚拟路径解析结果 */
export interface ParsedObjectSearchPath {
  /** 搜索发起页的类 id（null = 根页全局搜索） */
  className: string | null;
  /** 搜索关键词（已解码） */
  query: string;
}

/** 解析对象搜索虚拟路径（非法形态回 null） */
export function parseObjectSearchPath(p: string | null | undefined): ParsedObjectSearchPath | null {
  if (!isObjectSearchPath(p)) return null;
  const rest = p!.slice(OBJECTSEARCH_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx < 0) return null;
  const className = rest.slice(0, idx) || null;
  try {
    return { className, query: decodeURIComponent(rest.slice(idx + 1)) };
  } catch {
    return null;
  }
}

/** 构造对象搜索虚拟路径（className 为空 = 根页全局搜索） */
export function buildObjectSearchPath(className: string | null | undefined, query: string): string {
  return `${OBJECTSEARCH_PREFIX}${className ?? ''}:${encodeURIComponent(query)}`;
}

/** 对象搜索的基准对象页路径（退出搜索回落点：根页或类页） */
export function objectSearchBasePath(parsed: ParsedObjectSearchPath): string {
  return buildObjectsPath(parsed.className);
}
