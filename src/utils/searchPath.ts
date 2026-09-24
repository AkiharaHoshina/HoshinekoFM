/**
 * search:// 虚拟路径编码/解析。
 *
 * 格式：`search://<发起搜索的目录>:<encodeURIComponent(关键词)>[(t=f,size=1M-10M,ext=doc|txt)]`
 * - 关键词整体 URL 编码（目录名与关键词在 Linux 都可含 ':'，编码后
 *   关键词中不再出现字面 ':' 与括号，整串无歧义）；目录保持原样；
 * - 筛选段为可读形式（决策 D2）：`t=f|d`（文件类型）、
 *   `size=min-max`（'1M-10M'；'1M-' 仅最小、'-10M' 仅最大）、
 *   `ext=doc|txt`（扩展名白名单，不带点）；各值经 encodeURIComponent，
 *   分隔符 `=`/`,`/`|`/`-` 为字面量；
 * - 筛选段整体包裹在 ( ) 中，位于末尾——编码后的关键词不可能出现
 *   字面括号，可无损切分。
 */

/** 搜索筛选条件（与后端 system:search 参数一一对应；limit 为临时值不入路径） */
export interface SearchPathFilter {
  /** 文件类型（f/d；undefined = 所有文件） */
  type?: 'f' | 'd';
  /** 最小大小（find -size 风格，如 '1M'、'500k'） */
  minSize?: string;
  /** 最大大小 */
  maxSize?: string;
  /** 扩展名白名单（不带点，小写，如 ['doc','txt']） */
  extensions?: string[];
}

export interface ParsedSearchPath {
  /** 发起搜索的目录（真实路径） */
  dir: string;
  /** 搜索关键词（已解码） */
  query: string;
  /** 筛选条件（无筛选时为空对象） */
  filter: SearchPathFilter;
}

/** 默认搜索结果上限（后端 system:search 同值，见 system.ts） */
export const SEARCH_DEFAULT_LIMIT = 200;

/** 默认搜索超时时长（秒；后端同值，见 system.ts；设置页可改，上限 180） */
export const SEARCH_DEFAULT_TIMEOUT = 30;

const SEARCH_PREFIX = 'search://';

export function isSearchPath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(SEARCH_PREFIX);
}

/** 是否有生效的筛选（任一筛选字段有值） */
export function hasActiveFilter(f: SearchPathFilter | undefined): boolean {
  return !!(f && (f.type || f.minSize || f.maxSize || (f.extensions && f.extensions.length > 0)));
}

/** 关键词编码：URL 编码后补上括号转义（encodeURIComponent 不转义括号） */
function encodeQuery(q: string): string {
  return encodeURIComponent(q).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function encodeFilter(f: SearchPathFilter): string {
  const parts: string[] = [];
  if (f.type) parts.push(`t=${f.type}`);
  if (f.minSize || f.maxSize) {
    parts.push(`size=${encodeURIComponent(f.minSize ?? '')}-${encodeURIComponent(f.maxSize ?? '')}`);
  }
  if (f.extensions && f.extensions.length > 0) {
    parts.push(`ext=${encodeURIComponent(f.extensions.map((e) => e.replace(/^\./, '')).join('|'))}`);
  }
  return parts.join(',');
}

/**
 * 构造 search:// 虚拟路径。无筛选时不带筛选段（「无筛选」时文件类型
 * 选框的值仍计入——t=f/d 属于筛选段的一部分）。
 */
export function buildSearchPath(dir: string, query: string, filter?: SearchPathFilter): string {
  const base = `${SEARCH_PREFIX}${dir}:${encodeQuery(query)}`;
  if (!hasActiveFilter(filter)) return base;
  return `${base}(${encodeFilter(filter!)})`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseFilterSegment(seg: string): SearchPathFilter {
  const filter: SearchPathFilter = {};
  for (const part of seg.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 't' && (val === 'f' || val === 'd')) {
      filter.type = val;
    } else if (key === 'size' && val) {
      const idx = val.indexOf('-');
      if (idx >= 0) {
        const min = val.slice(0, idx);
        const max = val.slice(idx + 1);
        if (min) filter.minSize = safeDecode(min);
        if (max) filter.maxSize = safeDecode(max);
      } else {
        filter.minSize = safeDecode(val);
      }
    } else if (key === 'ext' && val) {
      const exts = safeDecode(val).split('|').map((e) => e.trim()).filter(Boolean);
      if (exts.length > 0) filter.extensions = exts;
    }
  }
  return filter;
}

/**
 * 解析 search:// 虚拟路径。
 * - 分隔冒号取**最后一个**：编码后的关键词/筛选段不含字面 ':'，目录
 *   名中的 ':' 都落在最后一个冒号之前；
 * - 末尾 `(…)` 为筛选段（编码后关键词无字面括号，`indexOf('(')` 即
 *   筛选段起点）；
 * - 非法形态（非 search://、无目录段）返回 null，调用方回落普通加载。
 */
export function parseSearchPath(p: string): ParsedSearchPath | null {
  if (!isSearchPath(p)) return null;
  const rest = p.slice(SEARCH_PREFIX.length);
  const colon = rest.lastIndexOf(':');
  if (colon < 0) return null;
  const dir = rest.slice(0, colon);
  if (!dir) return null;
  const tail = rest.slice(colon + 1);
  let encodedQuery = tail;
  let filter: SearchPathFilter = {};
  const open = tail.indexOf('(');
  if (open >= 0 && tail.endsWith(')') && open < tail.length - 1) {
    encodedQuery = tail.slice(0, open);
    filter = parseFilterSegment(tail.slice(open + 1, -1));
  }
  return { dir, query: safeDecode(encodedQuery), filter };
}
