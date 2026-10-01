/**
 * 搜索上限/超时的原始输入解析（review 29 #6/7：设置页改为页内输入框、
 * 原文保存字符串——空/无效输入视为无限制）。
 */

/** 有效上限/超时的钳制值（旧二级对话框的上限 100000——防误输巨型值） */
export const SEARCH_LIMIT_MAX = 100000;

/**
 * 原始输入 → 生效值：
 * - 正整数 → min(n, SEARCH_LIMIT_MAX)；
 * - 空串/非数字/≤0 → null（无限制）。
 *
 * @param raw - settings.searchLimit/searchTimeout 的原始字符串（可 null）
 * @returns 生效上限（秒数/条数）；null = 无限制
 */
export function parseSearchLimitStr(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, SEARCH_LIMIT_MAX);
}
