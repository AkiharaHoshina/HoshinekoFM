/**
 * search:// 虚拟路径编码/解析（决策 D1/D2 定案：**标准 URL query 参数**；
 * 2026-09-27 二轮验收：**最小转义**——只转义破坏结构/百分号语义的字符，
 * Unicode/斜杠/冒号/空格/竖线原样，内部串天然人可读写）。
 *
 * 格式：`search://<目录>?q=<关键词>[&type=f|d][&min=1M][&max=10M][&ext=doc|txt]`
 * - 目录原样（`/` 保留；仅 `%`/`?`/`#` 转义）；值仅转义 `%`（→%25）与
 *   `?`/`#`/`&`/`=`——中文等 Unicode 字符不转义（URL 规范允许原样出现）：
 *   `search:///home/hoshina/文档?q=啊啊啊` 可读可写；
 * - **含 `%` 的关键词**：build 转义为 `%25`（如 `q=100%25`），parse
 *   decode 回 `100%`；用户手输未转义的 `q=100%` 经 safeDecode 容错
 *   原样保留——两种写法都工作；含 `&` 的关键词手输须写 `%26`（`&` 是
 *   参数分隔符，标准 query 固有语义）；
 * - 解析容错：按首个 `?` 切目录/参数、`&` 分段、首个 `=` 分键值，
 *   未知键/decodeURIComponent 失败忽略（不整体失败）；
 * - 显示层：地址栏直接显示内部串（最小转义下即人可读形态），面包屑/
 *   标签标题经 parse 解码渲染关键词；
 * - **e2e 必须覆盖 UTF-8/特殊字符往返**（用户点名：中文/日文关键词、
 *   含空格与 `&%` 的关键词、含 `:` 的目录名——build → 地址栏 → parse →
 *   搜索命中三步一致；e2e 63e）。
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
  /** 发起搜索的目录（真实路径，已解码） */
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

/** 最小转义：只转义 `%` 与 query 结构字符（及控制字符）；其余（Unicode/
 *  斜杠/冒号/空格/竖线等）原样——内部串即人可读形态（二轮验收定案）。 */
function escapePart(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .split('').map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? encodeURIComponent(c) : c)).join('');
}

export function isSearchPath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(SEARCH_PREFIX);
}

/** 是否有生效的筛选（任一筛选字段有值） */
export function hasActiveFilter(f: SearchPathFilter | undefined): boolean {
  return !!(f && (f.type || f.minSize || f.maxSize || (f.extensions && f.extensions.length > 0)));
}

/**
 * 构造 search:// 虚拟路径（URL query 参数 + 最小转义）。
 * 无关键词且无筛选时不带 `?`（仍为合法可解析形态）；无筛选时只有 q 段
 * （「无筛选」时文件类型选框的值仍计入——type 属于筛选段的一部分）。
 */
export function buildSearchPath(dir: string, query: string, filter?: SearchPathFilter): string {
  const params: string[] = [];
  if (query) params.push(`q=${escapePart(query)}`);
  if (filter?.type) params.push(`type=${filter.type}`);
  if (filter?.minSize) params.push(`min=${escapePart(filter.minSize)}`);
  if (filter?.maxSize) params.push(`max=${escapePart(filter.maxSize)}`);
  if (filter?.extensions && filter.extensions.length > 0) {
    params.push(`ext=${escapePart(filter.extensions.map((e) => e.replace(/^\./, '')).join('|'))}`);
  }
  const qs = params.join('&');
  return `${SEARCH_PREFIX}${escapePart(dir)}${qs ? `?${qs}` : ''}`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 解析 search:// 虚拟路径。
 * - 目录段与参数段按**首个 `?`** 切分（目录中字面 `?` 已转义 %3F）；
 * - 参数按 `&` 分段、首个 `=` 分键值，值 decodeURIComponent（容错）；
 * - 非法形态（非 search://、目录段为空）返回 null，调用方回落普通加载；
 *   未知键/解码失败忽略该段。
 */
export function parseSearchPath(p: string): ParsedSearchPath | null {
  if (!isSearchPath(p)) return null;
  const rest = p.slice(SEARCH_PREFIX.length);
  const qIdx = rest.indexOf('?');
  const dirRaw = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
  if (!dirRaw) return null;
  const dir = safeDecode(dirRaw);
  if (!dir) return null;

  const filter: SearchPathFilter = {};
  let query = '';
  if (qIdx >= 0) {
    for (const part of rest.slice(qIdx + 1).split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = eq > 0 ? part.slice(0, eq) : part;
      const val = eq > 0 ? safeDecode(part.slice(eq + 1)) : '';
      if (key === 'q') {
        query = val;
      } else if (key === 'type' && (val === 'f' || val === 'd')) {
        filter.type = val;
      } else if (key === 'min' && val) {
        filter.minSize = val;
      } else if (key === 'max' && val) {
        filter.maxSize = val;
      } else if (key === 'ext' && val) {
        const exts = val.split('|').map((e) => e.trim()).filter(Boolean);
        if (exts.length > 0) filter.extensions = exts;
      }
      // 未知键忽略（容错）
    }
  }
  return { dir, query, filter };
}
