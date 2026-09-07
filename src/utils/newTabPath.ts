import { TRASH_VIRTUAL_PREFIX, isValidTrashSubPath } from './trashPath';

/**
 * 自定义新标签页目录（settings.newTabPath）的校验与规范化工具。
 *
 * 合法值：
 * - 绝对路径（以 `/` 开头）；
 * - `dashboard://`（打开仪表盘——内部统一存储为 `app://dashboard`）；
 * - `trash://` 或 `trash://文件夹名`（打开回收站/回收站中的目录，
 *   相对段不得含 `.`/`..`/空段，防止路径逃逸）。
 *
 * 不校验目录存在性：不存在的目录由新标签页打开时的 loadPath 报错提示
 * （与地址栏输入同语义）。
 */

/** 仪表盘虚拟路径的两种写法（内部统一存储为 app://dashboard） */
const DASHBOARD_ALIAS = 'dashboard://';
const DASHBOARD_INTERNAL = 'app://dashboard';

/**
 * 校验输入是否为合法的新标签页目录。
 *
 * @param input - 原始输入（已 trim）
 * @returns 是否合法
 */
export function isValidNewTabPath(input: string): boolean {
  if (!input) return false;
  if (input.startsWith('/')) return true;
  if (input === DASHBOARD_ALIAS || input === DASHBOARD_INTERNAL) return true;
  if (input.startsWith(TRASH_VIRTUAL_PREFIX)) {
    return isValidTrashSubPath(input.slice(TRASH_VIRTUAL_PREFIX.length));
  }
  return false;
}

/**
 * 规范化输入：仪表盘别名统一为内部形态 `app://dashboard`，其余 trim 原样返回。
 *
 * @param input - 已校验通过的输入
 * @returns 规范化后的存储值
 */
export function normalizeNewTabPath(input: string): string {
  const v = input.trim();
  return v === DASHBOARD_ALIAS ? DASHBOARD_INTERNAL : v;
}

/**
 * 存储值 → 展示形态（设置页副标题/对话框初始值）：
 * 仪表盘显示为 `dashboard://`，其余原样（空值兜底 `/`）。
 *
 * @param stored - settings.newTabPath 存储值
 * @returns 展示值
 */
export function formatNewTabPath(stored: string): string {
  return stored === DASHBOARD_INTERNAL ? DASHBOARD_ALIAS : (stored || '/');
}
