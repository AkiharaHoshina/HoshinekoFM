/**
 * 键盘焦点分区（键盘导航框架）。
 *
 * 应用内 Tab 键在「导航栏（nav）→ 侧边栏（sidebar）→ 文件区（files）」
 * 三个分区间循环切换焦点（Shift+Tab 反向）；分区内部由各自组件用
 * 方向键移动焦点（roving tabindex 或等价机制）、Enter/Space 激活。
 * 输入框/终端（TEXTAREA/INPUT）与打开的对话框保持浏览器默认 Tab
 * 行为——拦截判定在 App 的全局 keydown 中完成，本模块只负责注册与
 * 循环。分区容器需带 `data-kb-zone` 属性（focusin 据此跟踪当前分区）。
 */

export type KeyboardZoneId =
  | 'nav'
  | 'sidebar'
  | 'tabbar'
  | 'topbar-up'
  | 'topbar-omnibar'
  | 'topbar-sort'
  | 'dashboard-storage'
  | 'dashboard-pinned'
  | 'dashboard-recent'
  | 'files';

export interface KeyboardZone {
  /** 分区标识（须与容器 data-kb-zone 属性一致） */
  id: KeyboardZoneId;
  /** 把焦点移入本分区（落在当前活动项/容器上） */
  focus: () => void;
}

/**
 * Tab 循环顺序（用户约定）：
 * - 文件页：功能栏 → places → 标签页 → 返回上级键 → 地址栏内 →
 *   分类开关和排序方式 → 文件区；
 * - 仪表盘：功能栏 → places → 标签页 → 存储子区 → 固定项子区 →
 *   最近访问子区（文件页专属分区未注册自动跳过）。
 */
const ZONE_ORDER: KeyboardZoneId[] = [
  'nav',
  'sidebar',
  'tabbar',
  'topbar-up',
  'topbar-omnibar',
  'topbar-sort',
  'dashboard-storage',
  'dashboard-pinned',
  'dashboard-recent',
  'files',
];

const zones: KeyboardZone[] = [];

/** 当前焦点所在分区（focusin 跟踪；初始为文件区） */
let currentZoneId: KeyboardZoneId = 'files';

/**
 * 注册一个键盘分区。组件挂载时注册、卸载时注销（返回注销函数）。
 *
 * @param zone - 分区描述（id + focus 回调）
 * @returns 注销函数
 */
export function registerKeyboardZone(zone: KeyboardZone): () => void {
  zones.push(zone);
  return () => {
    const i = zones.indexOf(zone);
    if (i !== -1) zones.splice(i, 1);
  };
}

/**
 * focusin 跟踪：焦点落在分区容器内时更新当前分区。
 * 由 App 的 document focusin 监听器调用。
 *
 * @param el - 焦点事件目标（可能为 null）
 */
export function trackKeyboardZoneFocus(el: Element | null): void {
  if (!el || typeof el.closest !== 'function') return;
  const zoneEl = el.closest('[data-kb-zone]');
  const id = (zoneEl?.getAttribute('data-kb-zone') ?? '') as KeyboardZoneId;
  if (ZONE_ORDER.includes(id)) {
    currentZoneId = id;
  }
}

/**
 * 把焦点移到下一个分区（Tab 循环）。
 * 焦点尚不在当前分区内时（例如刚启动/点击空白处），第一次 Tab 先把
 * 焦点落到当前分区（默认 files），之后的 Tab 才在分区间循环。
 *
 * @param dir - 1 = 下一个分区（Tab）；-1 = 上一个分区（Shift+Tab）
 * @returns 是否成功切换（有可用分区）
 */
export function focusNextKeyboardZone(dir: 1 | -1): boolean {
  if (zones.length === 0) return false;
  const ordered = ZONE_ORDER.filter((id) => zones.some((z) => z.id === id));
  if (ordered.length === 0) return false;
  const cur = zones.find((z) => z.id === currentZoneId);
  const activeEl = document.activeElement as Element | null;
  const focusedZone = activeEl?.closest?.('[data-kb-zone]')?.getAttribute('data-kb-zone');
  // 焦点不在当前分区内（首次 Tab）：先落到当前分区（默认 files）
  if (focusedZone !== currentZoneId) {
    const target = cur ?? zones[0];
    target.focus();
    currentZoneId = target.id;
    return true;
  }
  const idx = ordered.indexOf(currentZoneId);
  const nextId = ordered[(((idx + dir) % ordered.length) + ordered.length) % ordered.length];
  const target = zones.find((z) => z.id === nextId) ?? zones[0];
  target.focus();
  currentZoneId = target.id;
  return true;
}

/** 当前分区 id（调试/测试用） */
export function getCurrentKeyboardZone(): KeyboardZoneId {
  return currentZoneId;
}
