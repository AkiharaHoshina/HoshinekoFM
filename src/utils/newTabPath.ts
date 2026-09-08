import { TRASH_VIRTUAL_PREFIX, isValidTrashSubPath } from './trashPath';
import { expandAddressPath } from './addressPath';

/**
 * 自定义新标签页目录（settings.newTabPath）的校验与规范化工具。
 *
 * 合法值：
 * - 绝对路径（以 `/` 开头）；
 * - `~` / `~/…`（家目录展开——确认时经 expandNewTabPathTilde
 *   展开为绝对路径后存储；IME 输入的全角 `～` 归一为 `~`）；
 * - `app://dashboard`（打开仪表盘，内部统一存储形态；`dashboard://`
 *   旧别名仍可输入，归一化为 `app://dashboard`）；
 * - `trash://` 或 `trash://文件夹名`（打开回收站/回收站中的目录，
 *   相对段不得含 `.`/`..`/空段，防止路径逃逸）。
 *
 * 不校验目录存在性：不存在的目录由新标签页打开时的 loadPath 报错提示
 * （与地址栏输入同语义）。
 */

/** 仪表盘虚拟路径的两种写法（内部统一存储为 app://dashboard） */
const DASHBOARD_ALIAS = 'dashboard://';
const DASHBOARD_INTERNAL = 'app://dashboard';

/** 全角波浪号（中文/日文 IME 输入 `~` 时常产出 U+FF5E） */
const FULLWIDTH_TILDE = '～';

/**
 * 前置全角波浪号归一：`～` / `～/…` 视为 `~` / `~/…`（IME 用户）。
 * 其余位置的全角波浪号不动（按无效输入处理，与 `~file` 同语义）。
 *
 * @param input - 原始输入（已 trim）
 * @returns 归一化后的输入
 */
function normalizeTildePrefix(input: string): string {
  if (input === FULLWIDTH_TILDE || input.startsWith(`${FULLWIDTH_TILDE}/`)) {
    return `~${input.slice(FULLWIDTH_TILDE.length)}`;
  }
  return input;
}

/**
 * 校验输入是否为合法的新标签页目录。
 *
 * @param input - 原始输入（已 trim）
 * @returns 是否合法
 */
export function isValidNewTabPath(input: string): boolean {
  if (!input) return false;
  const v = normalizeTildePrefix(input);
  if (v.startsWith('/')) return true;
  if (v === '~' || v.startsWith('~/')) return true;
  if (v === DASHBOARD_ALIAS || v === DASHBOARD_INTERNAL) return true;
  if (v.startsWith(TRASH_VIRTUAL_PREFIX)) {
    return isValidTrashSubPath(v.slice(TRASH_VIRTUAL_PREFIX.length));
  }
  return false;
}

/**
 * 规范化输入：仪表盘别名统一为内部形态 `app://dashboard`，
 * 前置全角波浪号归一为 `~`，其余 trim 原样返回。
 *
 * @param input - 已校验通过的输入
 * @returns 规范化后的存储值
 */
export function normalizeNewTabPath(input: string): string {
  const v = normalizeTildePrefix(input.trim());
  return v === DASHBOARD_ALIAS ? DASHBOARD_INTERNAL : v;
}

/**
 * 展开 `~` / `~/…` 前缀为家目录绝对路径（与地址栏同款词法折叠，
 * 见 utils/addressPath 的 expandAddressPath）；其余形态（绝对路径/
 * 虚拟路径）原样透传。
 *
 * @param input - 已通过 isValidNewTabPath 校验的输入（已 trim）
 * @param home - 家目录绝对路径（`~` 展开目标）
 * @returns 可直接交给 loadPath 的存储值
 */
export function expandNewTabPathTilde(input: string, home: string): string {
  if (input === '~' || input.startsWith('~/')) {
    return expandAddressPath(input, '/', home);
  }
  return input;
}

/**
 * 存储值 → 展示形态（设置页副标题/对话框初始值）：
 * 仪表盘显示为内部形态 `app://dashboard`，其余原样（空值兜底 `/`）。
 *
 * @param stored - settings.newTabPath 存储值
 * @returns 展示值
 */
export function formatNewTabPath(stored: string): string {
  return stored || '/';
}
