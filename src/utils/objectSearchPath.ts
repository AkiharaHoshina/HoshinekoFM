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
 * - **进程类筛选（review 6/7 定案）**：`fm=<cmd|ne|ni>`（组 1 单选：
 *   cmdline 包含/进程名等于/进程名包含；缺省 = cmdline 包含）、
 *   `pc=<gt|lt|eq>`（组 2 多选：PID 比较的 OR 组合，如 `pc=gt|eq` 即
 *   `pid>q || pid==q`；缺省 = 不按 PID 筛选）——两组**互斥**（pc 非空时
 *   fm 忽略，筛选按 PID 比较；pc 为空时按 fm 模式匹配）。**排序不进 url**
 *   （review 7 #4：排序是展示偏好，适用于所有搜索）。
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

/** 进程类筛选组 1 模式（review 6/7）：cmdline 包含 / 进程名等于 / 进程名包含 */
export type ProcessFilterMode = 'cmd' | 'ne' | 'ni';

/** 进程类筛选组 2 PID 比较条件（可多选，OR 组合） */
export type PidCond = 'gt' | 'lt' | 'eq';

/** 组 1 模式白名单（解析容错：未知值忽略回落默认） */
const FILTER_MODES = new Set<ProcessFilterMode>(['cmd', 'ne', 'ni']);
/** 组 2 PID 条件白名单 */
const PID_CONDS = new Set<PidCond>(['gt', 'lt', 'eq']);

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
  /**
   * 进程类筛选组 1 模式（review 6/7；null = 默认 cmdline 包含）——
   * pc 非空时本字段忽略（两组互斥，按 PID 比较筛选）
   */
  filterMode: ProcessFilterMode | null;
  /** 进程类筛选组 2 PID 比较条件（可多选 OR 组合；空 = 不按 PID 筛选） */
  pidConds: PidCond[];
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
  let filterMode: ProcessFilterMode | null = null;
  const pidConds: PidCond[] = [];
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
      } else if (key === 'fm') {
        // 组 1 筛选模式（白名单；'cmd' 与缺省同为默认 cmdline 包含）
        if (FILTER_MODES.has(val as ProcessFilterMode)) filterMode = val as ProcessFilterMode;
      } else if (key === 'pc') {
        // 组 2 PID 比较条件（| 分隔；白名单；重复忽略）
        for (const seg of val.split('|')) {
          const s = seg.trim();
          if (PID_CONDS.has(s as PidCond) && !pidConds.includes(s as PidCond)) pidConds.push(s as PidCond);
        }
      }
      // 未知键忽略（容错）
    }
  }
  return { className, query, excludedClasses, excludedKinds, filterMode, pidConds };
}

/** 构造对象搜索虚拟路径（className 为空 = 根页全局搜索）。
 *  excludedClasses/excludedKinds = 取消勾选的筛选条件（空数组/缺省
 *  = 全勾选，不带 nc/nk 段——url 即筛选条件的唯一真相源，review 4）；
 *  filterMode/pidConds = 进程类筛选（缺省不写段——排序不进 url） */
export function buildObjectSearchPath(
  className: string | null | undefined,
  query: string,
  opts?: {
    excludedClasses?: string[];
    excludedKinds?: ('mounted' | 'device' | 'other')[];
    filterMode?: ProcessFilterMode | null;
    pidConds?: PidCond[];
  },
): string {
  const cls = className ? className : '';
  const params: string[] = [`q=${escapePart(query)}`];
  const nc = (opts?.excludedClasses ?? []).filter(Boolean);
  if (nc.length > 0) params.push(`nc=${escapePart(nc.join('|'))}`);
  const nk = (opts?.excludedKinds ?? []).filter(Boolean);
  if (nk.length > 0) params.push(`nk=${escapePart(nk.join('|'))}`);
  const fm = opts?.filterMode ?? null;
  if (fm !== null) params.push(`fm=${escapePart(fm)}`);
  const pc = (opts?.pidConds ?? []).filter(Boolean);
  if (pc.length > 0) params.push(`pc=${escapePart(pc.join('|'))}`);
  return `${OBJECTSEARCH_PREFIX}${cls}?${params.join('&')}`;
}

/** 对象搜索的基准对象页路径（退出搜索回落点：根页或类页） */
export function objectSearchBasePath(parsed: ParsedObjectSearchPath): string {
  return buildObjectsPath(parsed.className);
}
