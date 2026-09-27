/**
 * objectsearch:// 虚拟路径编码/解析（Object Panel 面板内搜索的地址栏形态）。
 *
 * 格式（与 search:// 同款**标准 URL query 参数 + 最小转义**，二轮验收
 * 定案：Unicode 原样、只转义 `%`/`?`/`#`/`&`/`=`——`objectsearch://process?q=喵`
 * 人可读写）：
 * - 根页（全局搜索）：`objectsearch://?q=<关键词>`；
 * - 类页（类内搜索）：`objectsearch://<类名>?q=<关键词>`；
 * - 实例页不可搜索（入口 toast 拒绝，不产生该路径）。
 * - **筛选条件编码（review 4 定案）**：`nc=<类id|类id>`（根页取消勾选的
 *   类）、`nk=<mounted|device|other>`（存储类页取消勾选的分类）——条件
 *   是 url 的唯一真相源（先改条件再输词、条件保持——经 url 承载而非
 *   本地状态）；空/缺省 = 全勾选。
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
  /**
   * 取消勾选的类 id（根页全类 Filter Chips；空 = 全勾选）——筛选条件
   * 编码在 url 里（唯一真相源，review 4 定案：先改条件再输词，条件
   * 保持——url 承载而非本地状态）
   */
  excludedClasses: string[];
  /**
   * 取消勾选的存储状态分类（存储类页 chips：mounted/device/other；
   * 空 = 全勾选）
   */
  excludedKinds: ('mounted' | 'device' | 'other')[];
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
  const excludedClasses: string[] = [];
  const excludedKinds: ('mounted' | 'device' | 'other')[] = [];
  const KINDS = new Set(['mounted', 'device', 'other']);
  if (qIdx >= 0) {
    for (const part of rest.slice(qIdx + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq);
      const val = safeDecode(part.slice(eq + 1));
      if (key === 'q') {
        query = val;
      } else if (key === 'nc') {
        // 取消勾选的类 id（| 分隔；未知/非法 id 忽略——渲染层按实际类表
        // 再过滤，容错）
        for (const seg of val.split('|')) {
          const s = seg.trim();
          if (s) excludedClasses.push(s);
        }
      } else if (key === 'nk') {
        // 取消勾选的存储状态分类（| 分隔；白名单）
        for (const seg of val.split('|')) {
          const s = seg.trim();
          if (KINDS.has(s)) excludedKinds.push(s as 'mounted' | 'device' | 'other');
        }
      }
      // 未知键忽略（容错）
    }
  }
  return { className, query, excludedClasses, excludedKinds };
}

/** 构造对象搜索虚拟路径（className 为空 = 根页全局搜索）。
 *  excludedClasses/excludedKinds = 取消勾选的筛选条件（空数组/缺省
 *  = 全勾选，不带 nc/nk 段——url 即筛选条件的唯一真相源，review 4） */
export function buildObjectSearchPath(
  className: string | null | undefined,
  query: string,
  opts?: { excludedClasses?: string[]; excludedKinds?: ('mounted' | 'device' | 'other')[] },
): string {
  const cls = className ? className : '';
  const params: string[] = [`q=${escapePart(query)}`];
  const nc = (opts?.excludedClasses ?? []).filter(Boolean);
  if (nc.length > 0) params.push(`nc=${escapePart(nc.join('|'))}`);
  const nk = (opts?.excludedKinds ?? []).filter(Boolean);
  if (nk.length > 0) params.push(`nk=${escapePart(nk.join('|'))}`);
  return `${OBJECTSEARCH_PREFIX}${cls}?${params.join('&')}`;
}

/** 对象搜索的基准对象页路径（退出搜索回落点：根页或类页） */
export function objectSearchBasePath(parsed: ParsedObjectSearchPath): string {
  return buildObjectsPath(parsed.className);
}
