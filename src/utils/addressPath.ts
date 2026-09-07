/**
 * 地址栏路径语法展开（`~` / `./` / `../`）。
 *
 * 纯词法解析（不触碰文件系统）：
 * - `~` / `~/…`：展开为家目录；
 * - `.` / `./…` / `..` / `../…`：相对**当前显示路径**（地址栏所见，
 *   回收站浏览时为 trash://… 虚拟形态）做 POSIX 词法折叠；
 * - 绝对路径：折叠 `.`/`..`/重复斜杠；
 * - 其余（trash://、dashboard://、普通相对名）原样透传。
 *
 * 语义约定（文件管理器地址栏惯例）：
 * - 软链接路径按**词法**父级折叠（与 shell 的逻辑 PWD 不同）；
 * - `trash://…` 视为根级虚拟目录：`..` 越过 trash:// 根后回落 `/`；
 * - 仪表盘（app://dashboard / dashboard://）同视为根级：`..` → `/`，
 *   `.` → 仪表盘自身，相对段自 `/` 起算。
 */

/**
 * 地址栏输入是否按「路径导航」处理（否则按搜索）。
 *
 * `~` 仅在家目录语义下算路径：`~` 与 `~/…`；`~file.txt` 这类**以波浪号
 * 开头的文件名**不是路径语法（`~user` 展开不受支持），按搜索处理——
 * 否则输入文件名会误判为目录并弹「目录不存在」。
 */
export function looksLikePathInput(v: string): boolean {
  return (
    v.startsWith('/') ||
    v === '~' ||
    v.startsWith('~/') ||
    v === '.' ||
    v === '..' ||
    v.includes('/')
  );
}

/** POSIX 词法归一化：折叠 `.`/`..`/空段与重复斜杠（`..` 越根钳制在根） */
export function normalizePosixPath(input: string): string {
  const segs: string[] = [];
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  return `/${segs.join('/')}`;
}

/**
 * 在**当前显示路径**上解析相对段（`.`, `..`，可混入普通段）。
 * @param cwd - 当前显示路径：真实绝对路径 / `trash://…` 虚拟路径 /
 *   `app://dashboard`（或 `dashboard://`）
 * @param rel - 相对输入（如 `./x`、`../../y`、`.`、`..`）
 */
export function resolveRelativePath(cwd: string, rel: string): string {
  let baseSegs: string[];
  let scheme: string | null = null;
  if (cwd.startsWith('trash://')) {
    scheme = 'trash://';
    baseSegs = cwd.slice('trash://'.length).split('/').filter(Boolean);
  } else if (cwd === 'app://dashboard' || cwd === 'dashboard://') {
    baseSegs = [];
  } else {
    baseSegs = cwd.split('/').filter(Boolean);
  }
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (baseSegs.length > 0) {
        baseSegs.pop();
      } else if (scheme) {
        // trash:// 根之上的 `..`：回落真实根
        scheme = null;
      }
      // 真实根之上的 `..`：钳制在根（不再弹出）
      continue;
    }
    baseSegs.push(seg);
  }
  return `${scheme ?? '/'}${baseSegs.join('/')}`;
}

/**
 * 地址栏输入展开入口。
 * @param input - 地址栏输入（已 trim）
 * @param cwd - 当前显示路径（与地址栏显示一致）
 * @param home - 家目录绝对路径（`~` 展开目标）
 * @returns 可直接交给 loadPath 的路径
 */
export function expandAddressPath(input: string, cwd: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return normalizePosixPath(`${home}/${input.slice(2)}`);
  if (input.startsWith('/')) return normalizePosixPath(input);
  if (
    input === '.' ||
    input === '..' ||
    input.startsWith('./') ||
    input.startsWith('../')
  ) {
    return resolveRelativePath(cwd, input);
  }
  return input;
}
