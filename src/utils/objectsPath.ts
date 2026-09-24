/**
 * objects:// 虚拟路径编码/解析（Object Panel，v1）。
 *
 * 格式：
 * - `objects://`                        根（类列表）
 * - `objects://<类id>`                   类页（实例列表）；类 id = storage | processor | tty
 * - `objects://<类id>/<实例id>`          实例页（详情 + 读数）；实例 id 经 encodeURIComponent
 *   （存储类实例 id 是设备路径如 /dev/sda1 或挂载点，须编码）
 *
 * 与 search:///trash:// 同为虚拟根：载入走 loadPath 分支、地址栏/面包屑/
 * 标签页身份同款特判（见 ExplorerTab/Breadcrumbs/TabBar）。
 */

const OBJECTS_PREFIX = 'objects://';

/** Object Panel 类 id → i18n 键（ObjectPanel/Breadcrumbs/搜索结果条同源） */
export const OBJECTS_CLASS_LABEL: Record<string, string> = {
  storage: 'objects.storage',
  processor: 'objects.processor',
  tty: 'objects.tty',
};

export interface ParsedObjectsPath {
  /** 类 id（storage/processor/tty）；null = 根 */
  className: string | null;
  /** 实例 id；null = 类页或根 */
  instanceId: string | null;
}

export function isObjectsPath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(OBJECTS_PREFIX);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildObjectsPath(className?: string | null, instanceId?: string | null): string {
  if (!className) return OBJECTS_PREFIX;
  const cls = encodeURIComponent(className);
  if (!instanceId) return `${OBJECTS_PREFIX}${cls}`;
  return `${OBJECTS_PREFIX}${cls}/${encodeURIComponent(instanceId)}`;
}

export function parseObjectsPath(p: string): ParsedObjectsPath | null {
  if (!isObjectsPath(p)) return null;
  const rest = p.slice(OBJECTS_PREFIX.length);
  if (!rest) return { className: null, instanceId: null };
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return { className: safeDecode(rest) || null, instanceId: null };
  }
  const className = safeDecode(rest.slice(0, slash)) || null;
  const instanceId = rest.slice(slash + 1);
  return { className, instanceId: instanceId ? safeDecode(instanceId) : null };
}

/** objects:// 根的上限：根无上级（与 trash:// 语义一致，不再往上） */
export function objectsParentPath(p: string): string | null {
  const parsed = parseObjectsPath(p);
  if (!parsed) return null;
  if (parsed.className === null) return null; // 根：无上级
  if (parsed.instanceId === null) return OBJECTS_PREFIX; // 类页 → 根
  return buildObjectsPath(parsed.className); // 实例页 → 类页
}
