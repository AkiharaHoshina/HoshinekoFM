/**
 * Ctrl+滚轮图标大小缩放的公共逻辑（主窗口与选择器/保存器共用）：
 * 范围与步进和设置对话框里的「图标大小」滑条完全一致
 * （16–128px，步进 8），保证快捷键与设置入口行为对齐。
 */

/** 图标大小下限（px） */
export const ICON_SIZE_MIN = 16;
/** 图标大小上限（px） */
export const ICON_SIZE_MAX = 128;
/** 图标大小步进（px） */
export const ICON_SIZE_STEP = 8;

/**
 * 按滚轮方向计算新的图标大小：向上滚（deltaY < 0）放大一档，
 * 向下滚缩小一档，结果夹紧到 [ICON_SIZE_MIN, ICON_SIZE_MAX]。
 * @param current 当前图标大小（px）
 * @param deltaY 滚轮增量（WheelEvent.deltaY）
 * @returns 新图标大小；已在边界时返回原值
 */
export function zoomIconSize(current: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1;
  return Math.min(
    ICON_SIZE_MAX,
    Math.max(ICON_SIZE_MIN, current + direction * ICON_SIZE_STEP),
  );
}
