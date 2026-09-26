/**
 * objectsearch:// 虚拟路径编码/解析（Object Panel 面板内搜索的地址栏形态）。
 *
 * 格式（与 search:// 同款**标准 URL query 参数 + 最小转义**，二轮验收
 * 定案：Unicode 原样、只转义 `%`/`?`/`#`/`&`/`=`——`objectsearch://process?q=喵`
 * 人可读写）：
 * - 根页（全局搜索）：`objectsearch://?q=<关键词>`；
 * - 类页（类内搜索）：`objectsearch://<类名>?q=<关键词>`；
 * - 实例页不可搜索（入口 toast 拒绝，不产生该路径）。
 * 类名走路径段（固定 id 集合，无需转义）；关键词走 q 参数（最小转义）；
 * 解析容错：未知键/解码失败忽略，无 q 段时关键词为空串。
 */
import { buildObjectsPath } from './objectsPath';

const OBJECTSEARCH_PREFIX = 'objectsearch://';

/** 最小转义（与 searchPath.escapePart 同源）：只转义 `%` 与 query 结构字符 */
function escapePart(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .split('').map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? encodeURIComponent(c) : c)).join('');
}

/** 是否为对象搜索虚拟路径 */
export function isObjectSearchPath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(OBJECTSEARCH_PREFIX);
}

/** 对象搜索虚拟路径解析结果 */
export interface ParsedObjectSearchPath {
  /** 搜索发起页的类 id（null = 根页全局搜索） */
  className: string | null;
  /** 搜索关键词（已解码；无 q 段时为空串） */
  query: string;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 解析对象搜索虚拟路径（非 objectsearch:// 前缀回 null） */
export function parseObjectSearchPath(p: string | null | undefined): ParsedObjectSearchPath | null {
  if (!isObjectSearchPath(p)) return null;
  const rest = p!.slice(OBJECTSEARCH_PREFIX.length);
  const qIdx = rest.indexOf('?');
  const classRaw = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
  const className = classRaw ? safeDecode(classRaw) : null;
  let query = '';
  if (qIdx >= 0) {
    for (const part of rest.slice(qIdx + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq) === 'q') {
        query = safeDecode(part.slice(eq + 1));
      }
      // 未知键忽略（容错）
    }
  }
  return { className, query };
}

/** 构造对象搜索虚拟路径（className 为空 = 根页全局搜索） */
export function buildObjectSearchPath(className: string | null | undefined, query: string): string {
  const cls = className ? className : '';
  return `${OBJECTSEARCH_PREFIX}${cls}?q=${escapePart(query)}`;
}

/** 对象搜索的基准对象页路径（退出搜索回落点：根页或类页） */
export function objectSearchBasePath(parsed: ParsedObjectSearchPath): string {
  return buildObjectsPath(parsed.className);
}
