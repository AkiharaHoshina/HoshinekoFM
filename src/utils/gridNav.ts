/**
 * 网格方向键导航（review 20）。
 *
 * 仪表盘固定区与对象根页类卡片都是 `auto-fill` 网格（列数随容器宽度
 * 变化），方向键必须按**网格**语义移动——此前按列表线性 `idx±1`，
 * ↓ 在网格里视觉上是向右（按键与视觉不符）。
 *
 * 语义（用户定案）：
 * - ↑/↓ 按列移动，边缘**钳制**（clamp，到底停住）；
 * - ←/→ 行内移动，行内**循环**（行尾 → 行首）；
 * - 末行不满列时按列位钳制到该行末项；
 * - 单行/单列退化：单行 ←/→ 循环（↑/↓ 不动）、单列 ↑/↓ 钳制（←/→ 不动）。
 *
 * 列数由条目 `offsetTop` 几何实时推导（最小 offsetTop 的条目数 = 首行
 * 列数）——不缓存：窗口缩放/拖拽换序后每次按键重算，天然正确；条目
 * 数小（固定区/类卡片均为全量渲染），O(n) 无压力。
 */

/** 方向键（网格导航支持的四个） */
export type GridNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * 推导网格列数：与首行条目（最小 offsetTop）同顶的条目数。
 * 条目全无几何（未挂载/隐藏）时回落 1。
 *
 * @param items - 参与网格导航的条目 DOM（容器内 DOM 序）
 * @returns 列数（≥1）
 */
export function computeGridColumns(items: HTMLElement[]): number {
  if (items.length === 0) return 1;
  const tops = items.map((el) => el.offsetTop);
  const minTop = Math.min(...tops);
  const cols = tops.filter((t) => t === minTop).length;
  return cols >= 1 ? cols : 1;
}

/**
 * 按网格语义计算方向键移动后的目标下标。
 *
 * @param currentIdx - 当前条目下标（不在条目内时调用方自行回落，如 0）
 * @param items - 条目 DOM 列表（容器内 DOM 序，与网格渲染序一致）
 * @param key - 方向键
 * @returns 目标下标；条目数 ≤1 时返回 -1（无处可移）
 */
export function gridNavIndex(currentIdx: number, items: HTMLElement[], key: GridNavKey): number {
  const n = items.length;
  if (n <= 1) return -1;
  const cols = computeGridColumns(items);
  const rowCount = Math.ceil(n / cols);
  const row = Math.floor(currentIdx / cols);
  const col = currentIdx % cols;
  // 当前行实际长度（末行可能不满列）
  const rowLength = Math.min(cols, n - row * cols);
  switch (key) {
  case 'ArrowRight':
    // 行内循环（按本行实际长度回绕：末行不满列时行尾 → 本行行首）
    return row * cols + ((col + 1) % rowLength);
  case 'ArrowLeft':
    return row * cols + ((col - 1 + rowLength) % rowLength);
  case 'ArrowDown': {
    // 上下钳制：边缘停住；末行不满列时按列位钳制到该行末项
    const nextRow = Math.min(row + 1, rowCount - 1);
    return Math.min(nextRow * cols + col, n - 1);
  }
  case 'ArrowUp': {
    const nextRow = Math.max(row - 1, 0);
    return Math.min(nextRow * cols + col, n - 1);
  }
  }
}

/**
 * 判断按下方向键后当前焦点是否在网格内，并计算目标元素。
 * 便捷封装：焦点不在条目内时从 0 号条目起步（与既有 roving 惯例一致）。
 *
 * @param container - 网格容器
 * @param itemSelector - 条目选择器（容器内）
 * @param key - 方向键
 * @param activeElement - 当前焦点元素
 * @returns 目标条目元素；无条目/无法移动时 null
 */
export function gridNavTarget(
  container: HTMLElement,
  itemSelector: string,
  key: GridNavKey,
  activeElement: Element | null,
): HTMLElement | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (items.length === 0) return null;
  const idx = activeElement ? items.indexOf(activeElement as HTMLElement) : -1;
  const next = gridNavIndex(idx < 0 ? 0 : idx, items, key);
  if (next < 0) return null;
  return items[next];
}
