/**
 * 回收站虚拟路径（`trash://`）与真实 `Trash/files` 目录路径的互转工具。
 *
 * 语义约定（与 electron/handlers/fs.ts 的 getTrashRoot 一致）：
 * - `trash://` = 回收站根（映射到 `<Trash>/files`，即 `fs:get-trash-dir` 返回值）；
 * - `trash://a/b` = 回收站内条目 `a` 下的 `b`（相对 files 目录的路径）。
 *
 * 前端「混合路径」模型：主窗口浏览回收站子目录时 currentPath 仍为真实
 * 路径（文件操作/搜索/监听全部照常工作），仅地址栏显示与编辑时换算为
 * 虚拟路径（见 ExplorerTab 的 displayPath / Breadcrumbs 的 trash 分支）。
 */

/** 回收站虚拟路径前缀 */
export const TRASH_VIRTUAL_PREFIX = 'trash://';

/**
 * 是否为回收站虚拟路径（`trash://` 或 `trash://…`）。
 *
 * @param p - 待判定路径
 * @returns 是否为虚拟路径
 */
export function isTrashVirtualPath(p: string): boolean {
  return p === TRASH_VIRTUAL_PREFIX || p.startsWith(TRASH_VIRTUAL_PREFIX);
}

/**
 * 虚拟路径的相对段是否合法（供新标签页目录等输入校验用）。
 * 拒绝 `.`/`..`/空段，防止路径逃逸到回收站之外；
 * 空相对段 = `trash://` 根本身，合法。
 *
 * @param rel - `trash://` 之后的相对部分（如 `folder/sub`，根为空串）
 * @returns 是否合法
 */
export function isValidTrashSubPath(rel: string): boolean {
  if (rel === '') return true;
  return rel.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * 回收站虚拟路径 → 真实 files 目录路径。
 * 非法段（`.`/`..`/空段）被静默剔除——绝不逃逸到回收站目录之外。
 *
 * @param p - 虚拟路径（`trash://` 或 `trash://a/b`）
 * @param trashRoot - 回收站 files 目录真实路径（`fs:get-trash-dir` 返回值）
 * @returns 真实路径
 */
export function trashVirtualToReal(p: string, trashRoot: string): string {
  const rel = p.slice(TRASH_VIRTUAL_PREFIX.length);
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.' && s !== '..');
  return segments.length === 0 ? trashRoot : `${trashRoot}/${segments.join('/')}`;
}

/**
 * 真实路径 → 回收站虚拟路径。
 * 路径位于 files 目录下时返回 `trash://…`（files 根返回 `trash://`），
 * 否则原样返回（不改变普通路径）。
 *
 * @param p - 真实路径
 * @param trashRoot - 回收站 files 目录真实路径
 * @returns 虚拟路径（回收站内）或原路径（回收站外）
 */
export function realToTrashVirtual(p: string, trashRoot: string): string {
  if (p === trashRoot) return TRASH_VIRTUAL_PREFIX;
  if (p.startsWith(trashRoot + '/')) {
    return TRASH_VIRTUAL_PREFIX + p.slice(trashRoot.length + 1);
  }
  return p;
}
