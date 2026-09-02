import type { IFile } from "../../types/files";
import { getSemanticGroup } from "../../utils/fileUtils";
import { t } from "../../i18n";

export const DOUBLE_CLICK_THRESHOLD = 500;
export const AUTO_SCROLL_ZONE = 60;
export const AUTO_SCROLL_SPEED = 8;

/**
 * 分组名 → i18n key 映射。注意：翻译必须在调用时取（`t()` 惰性求值），
 * 不能做成模块级常量，否则切换语言后分组标题不会更新。
 */
const GROUP_LABEL_KEYS: Record<string, string> = {
  Folders: "group.folders",
  Media: "group.media",
  Documents: "group.documents",
  Code: "group.code",
  Archives: "group.archives",
  Executables: "group.executables",
  Others: "group.others",
};

export function tGroup(groupName: string): string {
  const key = GROUP_LABEL_KEYS[groupName];
  return key ? t(key) : groupName;
}

export function getFileTitle(file: IFile): string {
  if (file.isMountpoint && file.mountFstype) {
    if (file.mountSource && file.mountSource.startsWith("/dev/")) {
      return `${file.name}(${file.mountFstype}) \u2192 ${file.mountSource}`;
    }
    return `${file.name}(${file.mountFstype})`;
  }
  if (file.symlinkTarget && file.mountFstype) {
    return `${file.name}(${file.mountFstype}) \u2192 ${file.symlinkTarget}`;
  }
  if (file.mime === "inode/blockdevice" && file.mountFstype) {
    return `${file.name}(${file.mountFstype})`;
  }
  if (file.symlinkTarget) {
    if (file.mime === "inode/symlink") {
      return `${file.name} \u2192 ${file.symlinkTarget}\uFF08\u635F\u574F\uFF09`;
    }
    return `${file.name} \u2192 ${file.symlinkTarget}`;
  }
  return file.name;
}

export function getFileIconFromMime(
  mime: string | null,
  isDirectory: boolean,
): string {
  if (isDirectory) return "folder";
  if (!mime) return "insert_drive_file";

  if (mime === "inode/symlink") return "link";
  if (mime === "inode/blockdevice") return "hard_drive";
  if (mime === "inode/chardevice") return "keyboard";
  if (mime === "inode/fifo") return "swap_vert";
  if (mime === "inode/socket") return "settings_ethernet";

  if (mime.startsWith("font/")) return "font_download";

  switch (mime) {
  case "text/markdown":
    return "markdown";
  case "text/x-tex":
    return "article";

  case "text/javascript":
    return "javascript";
  case "text/html":
    return "html";
  case "text/css":
  case "text/x-scss":
    return "css";
  case "text/x-shell":
    return "terminal";
  case "text/x-sql":
    return "database";

  case "text/x-yaml":
  case "text/x-toml":
    return "data_object";

  case "text/csv":
  case "text/tab-separated-values":
    return "csv";

  case "text/plain":
    return "article";

  case "image/vnd.djvu":
    return "book_2";

  case "application/pdf":
    return "picture_as_pdf";
  case "application/msword":
  case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
  case "application/vnd.oasis.opendocument.text":
  case "application/vnd.oasis.opendocument.formula":
    return "description";
  case "application/vnd.ms-excel":
  case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
  case "application/vnd.oasis.opendocument.spreadsheet":
    return "table";
  case "application/vnd.ms-powerpoint":
  case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
  case "application/vnd.oasis.opendocument.presentation":
    return "slideshow";
  case "application/vnd.oasis.opendocument.graphics":
    return "stylus";
  case "application/rtf":
    return "article";

  case "application/epub+zip":
  case "application/x-mobipocket-ebook":
    return "import_contacts";

  case "application/x-iso9660-image":
    return "album";
  case "application/x-rpm":
  case "application/vnd.debian.binary-package":
    return "package_2";
  case "application/zip":
  case "application/gzip":
  case "application/x-bzip2":
  case "application/x-xz":
  case "application/x-7z-compressed":
  case "application/vnd.rar":
  case "application/x-rar-compressed":
  case "application/x-tar":
  case "application/x-lzip":
  case "application/x-lzop":
  case "application/x-lz4":
  case "application/zstd":
  case "application/vnd.ms-cab-compressed":
  case "application/x-arj":
  case "application/x-lzh":
    return "folder_zip";

  case "application/x-msdownload":
    return "deployed_code";
  case "application/java-archive":
    return "deployed_code";
  case "application/vnd.android.package-archive":
    return "android";
  case "application/wasm":
  case "application/x-python-bytecode":
  case "application/x-java-bytecode":
    return "code";
  case "application/x-elf":
  case "application/x-executable":
  case "application/x-sharedlib":
    return "terminal";

  case "application/json":
    return "file_json";
  case "application/xml":
    return "data_object";
  case "application/graphql":
    return "data_object";
  case "application/x-sqlite3":
    return "database";
  case "application/x-pem-file":
  case "application/x-x509-ca-cert":
    return "key";
  case "application/x-bittorrent":
    return "cloud_download";
  case "application/x-krita":
    return "brush";
  case "application/x-scratch":
    return "extension";

  case "application/vnd.ms-fontobject":
    return "font_download";
  }

  const cat = mime.split("/")[0];
  switch (cat) {
  case "image":
    return "image";
  case "audio":
    return "audio_file";
  case "video":
    return "movie";
  case "text":
    return "code";
  case "inode":
    return "folder";
  }

  return "insert_drive_file";
}

export function formatSize(bytes: number) {
  if (bytes === 0) return t("size.zero");
  const k = 1024;
  const sizes = [
    t("size.b"),
    t("size.kb"),
    t("size.mb"),
    t("size.gb"),
    t("size.tb"),
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export type ListItem =
  | { kind: "header"; label: string; marquee?: boolean }
  | { kind: "file"; file: IFile }
  | { kind: "grid-row"; files: IFile[] };

/**
 * 扁平化文件列表为渲染条目（分组头 + 行/网格行）。
 *
 * @param files - 已排序的文件列表（分组依赖相邻条目同组连续）
 * @param groupingEnabled - 是否分组（语义分组或 groupInfo 自定义分组）
 * @param viewMode - 网格/列表
 * @param columns - 网格列数
 * @param groupInfo - 自定义分组函数（搜索结果按目录分组用）：返回分组
 *   键与显示标签；返回 null 表示该条目不分组。缺省时走语义分组
 *   （Folders/Media/…）。自定义分组的头 marquee=true——长目录路径
 *   由渲染层截断/跑马灯（语义分组标签短，保持纯文本）。
 * @returns 渲染条目列表（header/file/grid-row）
 */
export function flattenItems(
  files: IFile[],
  groupingEnabled: boolean,
  viewMode: "grid" | "list",
  columns: number,
  groupInfo?: (file: IFile) => { key: string; label: string } | null,
): ListItem[] {
  const items: ListItem[] = [];
  let lastGroup = "";

  const groupOf = (file: IFile): { key: string; label: string } | null => {
    if (!groupingEnabled) return null;
    if (groupInfo) return groupInfo(file);
    return { key: getSemanticGroup(file), label: tGroup(getSemanticGroup(file)) };
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const group = groupOf(file);
    const key = group?.key ?? "";
    if (group && key !== lastGroup) {
      items.push({ kind: "header", label: group.label, marquee: !!groupInfo });
      lastGroup = key;
    }

    if (viewMode === "grid") {
      const rowFiles: IFile[] = [file];
      let j = i + 1;
      while (j < files.length && rowFiles.length < columns) {
        const nextFile = files[j];
        const nextKey = groupOf(nextFile)?.key ?? "";
        if (nextKey !== key) break;
        rowFiles.push(nextFile);
        j++;
      }
      items.push({ kind: "grid-row", files: rowFiles });
      i = j - 1;
    } else {
      items.push({ kind: "file", file });
    }
  }
  return items;
}

/**
 * 在扁平化布局（含分组头/网格行）中定位包含指定路径的条目下标。
 *
 * @returns 条目下标；-1 表示未找到
 */
export function findItemIndexOfPath(items: ListItem[], path: string): number {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && item.file.path === path) return i;
    if (item.kind === "grid-row" && item.files.some((f) => f.path === path)) return i;
  }
  return -1;
}

/** 取条目内含的文件列表（header 返回空） */
function filesInItem(item: ListItem): IFile[] {
  if (item.kind === "file") return [item.file];
  if (item.kind === "grid-row") return item.files;
  return [];
}

/**
 * 方向键导航：计算目标文件（返回 null 表示不移动——如网格行首再按左）。
 * 布局基于扁平化条目（与渲染同源，含分组头）：
 * - 列表视图：上下左右均沿显示序移动（跳过分组头）；
 * - 网格视图：左右同行移动、上下跨行（列位钳制到目标行长度），
 *   行首/行尾按左/右不环绕。
 * - 无锚点（当前无选中）：Down/Right 取首个文件，Up/Left 取末个文件。
 *
 * @param items - 扁平化布局（flattenItems 产物）
 * @param anchorPath - 当前锚点文件路径（lastSelectedPath；无选中为 null）
 */
export function computeArrowTarget(
  items: ListItem[],
  anchorPath: string | null,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  viewMode: "grid" | "list",
): IFile | null {
  const anchorIdx = anchorPath ? findItemIndexOfPath(items, anchorPath) : -1;

  if (viewMode === "list") {
    const step = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
    let i = anchorIdx;
    if (i === -1) i = step > 0 ? -1 : items.length;
    for (i += step; i >= 0 && i < items.length; i += step) {
      const file = filesInItem(items[i])[0];
      if (file) return file;
    }
    return null;
  }

  // 网格：无锚点/锚点落在分组头上 → 取首个或末个文件
  if (anchorIdx === -1 || items[anchorIdx].kind === "header") {
    const rows = items.filter((it) => it.kind !== "header");
    if (rows.length === 0) return null;
    const back = key === "ArrowUp" || key === "ArrowLeft";
    const rowFiles = filesInItem(back ? rows[rows.length - 1] : rows[0]);
    return back ? rowFiles[rowFiles.length - 1] : rowFiles[0];
  }

  const rowFiles = filesInItem(items[anchorIdx]);
  const col = Math.max(0, rowFiles.findIndex((f) => f.path === anchorPath));

  if (key === "ArrowLeft") return col > 0 ? rowFiles[col - 1] : null;
  if (key === "ArrowRight") return col < rowFiles.length - 1 ? rowFiles[col + 1] : null;

  const step = key === "ArrowUp" ? -1 : 1;
  for (let i = anchorIdx + step; i >= 0 && i < items.length; i += step) {
    if (items[i].kind === "header") continue;
    const fs = filesInItem(items[i]);
    if (fs.length === 0) continue;
    return fs[Math.min(Math.max(col, 0), fs.length - 1)];
  }
  return null;
}

/**
 * Ctrl+方向键跳转（现代文件管理器惯例）：
 * - 列表视图：与 Home/End 一致——Up/Left 首项、Down/Right 末项；
 * - 网格视图：Up/Down 跳首/末行（列位钳制到当前列或 0），
 *   Left/Right 跳当前行行首/行尾；游标缺失时退化为首行。
 *
 * @param items - 扁平化布局（flattenItems 产物）
 * @param anchorPath - 当前游标文件路径（无游标为 null）
 */
export function computeCtrlArrowTarget(
  items: ListItem[],
  anchorPath: string | null,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  viewMode: "grid" | "list",
): IFile | null {
  const rows = items.filter((it) => it.kind !== "header");
  if (rows.length === 0) return null;
  const firstRow = filesInItem(rows[0]);
  const lastRow = filesInItem(rows[rows.length - 1]);
  if (firstRow.length === 0 || lastRow.length === 0) return null;

  if (viewMode === "list") {
    return key === "ArrowUp" || key === "ArrowLeft" ? firstRow[0] : lastRow[lastRow.length - 1];
  }

  const idx = anchorPath ? findItemIndexOfPath(items, anchorPath) : -1;
  const curRowFiles = idx !== -1 && items[idx].kind !== "header" ? filesInItem(items[idx]) : firstRow;
  const curCol = Math.max(0, curRowFiles.findIndex((f) => f.path === anchorPath));

  if (key === "ArrowUp") return firstRow[Math.min(curCol, firstRow.length - 1)];
  if (key === "ArrowDown") return lastRow[Math.min(curCol, lastRow.length - 1)];
  if (key === "ArrowLeft") return curRowFiles[0];
  return curRowFiles[curRowFiles.length - 1];
}

/**
 * 网格 Shift 范围：锚点行当前选中的列区间。
 * 游标行比锚点行选区短时（如第一行 5 个、第二行 3 个），以锚点行为准
 * 决定列区间——锚点行选区不被收缩，短行按列区间钳制取全部。
 *
 * @param items - 扁平化布局（flattenItems 产物）
 * @param anchorPath - Shift 锚点
 * @param selectedPaths - 当前选中集（Shift 更新前）
 * @returns 锚点行选中的列区间；锚点行不可用/非网格行时 null
 */
export function computeAnchorRowSpan(
  items: ListItem[],
  anchorPath: string | null,
  selectedPaths: Set<string>,
): { low: number; high: number } | null {
  const anchorIdx = anchorPath ? findItemIndexOfPath(items, anchorPath) : -1;
  if (anchorIdx === -1) return null;
  const item = items[anchorIdx];
  if (item.kind !== 'grid-row') return null;
  const cols: number[] = [];
  item.files.forEach((f, i) => {
    if (selectedPaths.has(f.path)) cols.push(i);
  });
  // 锚点列始终纳入区间（锚点被 Ctrl 移出选中时仍保持矩形语义）
  const aCol = item.files.findIndex((f) => f.path === anchorPath);
  if (aCol >= 0) cols.push(aCol);
  if (cols.length === 0) return null;
  return { low: Math.min(...cols), high: Math.max(...cols) };
}

/**
 * Shift 范围选择：计算锚点（anchorPath）与游标（cursorPath）之间的选中集。
 * - 列表视图：扁平显示序上 anchor↔cursor 的连续区间（跳过分组头）；
 * - 网格视图：anchor 与 cursor 所在 grid-row 的 (row, col) 为对角线的
 *   **矩形**——中间行整行纳入、边界行按列区间钳制；分组头跳过，
 *   矩形**跨分类连续**（开启分类后 Shift 仍可跨组选择）。
 *   列区间以**锚点行（基准行）**为准：游标在锚点行内时由游标完全控制
 *   （行内收缩/扩展）；游标在其他行（含跨分类）时锚点行当前选区
 *   （anchorSpan）不收缩，游标只能在基准两侧扩展——第一行 5 个、
 *   第二行 3 个时两行分别选 5/3，继续 Down 到满行也不缩回 3 个；
 *   短行按列区间钳制取全部。
 * 锚点缺失/落在分组头时退化为仅选中游标项。
 *
 * @param items - 扁平化布局（flattenItems 产物，与渲染同源）
 * @param anchorPath - Shift 锚点（无锚点时 null）
 * @param cursorPath - 当前游标文件路径
 * @param viewMode - 网格/列表
 * @param anchorSpan - 锚点行当前选中的列区间（computeAnchorRowSpan 产物，
 *   游标在其他行时作为基准；null 时退化为锚点列）
 * @returns 应选中的路径集合
 */
export function computeShiftRange(
  items: ListItem[],
  anchorPath: string | null,
  cursorPath: string,
  viewMode: "grid" | "list",
  anchorSpan?: { low: number; high: number } | null,
): Set<string> {
  const result = new Set<string>();
  const cursorIdx = findItemIndexOfPath(items, cursorPath);
  if (cursorIdx === -1) return result;
  const anchorIdx = anchorPath ? findItemIndexOfPath(items, anchorPath) : -1;
  if (anchorIdx === -1 || items[anchorIdx].kind === "header") {
    // 无锚点：仅游标项（Shift 从无选中开始的退化语义）
    result.add(cursorPath);
    return result;
  }

  if (viewMode === "list") {
    const low = Math.min(anchorIdx, cursorIdx);
    const high = Math.max(anchorIdx, cursorIdx);
    for (let i = low; i <= high; i++) {
      const fs = filesInItem(items[i]);
      for (const f of fs) result.add(f.path);
    }
    return result;
  }

  // 网格：矩形（锚点与游标所在行/列为对角线；每行都取对角线列区间
  //  colLow..colHigh 内的列——含边界行与中间行，列区间按行长度钳制）。
  // 分组头跳过：矩形跨分类连续，不截断。
  // 列区间规则（基准行 = 锚点行）：
  // - 游标在锚点行内：游标完全控制列区间（行内收缩/扩展）；
  // - 游标在其他行（含跨分类）：以锚点行当前选区（anchorSpan）为基准——
  //   各行选取数由基准行决定，游标只能在基准两侧扩展、不能收缩
  //   （第一行 5 个、第二行 3 个：两行分别选 5/3；继续 Down 到满行
  //   也不会缩回 3 个）；短行按列区间钳制取全部
  const anchorRowFiles = filesInItem(items[anchorIdx]);
  const cursorRowFiles = filesInItem(items[cursorIdx]);
  const aCol = Math.max(0, anchorRowFiles.findIndex((f) => f.path === anchorPath));
  const cCol = Math.max(0, cursorRowFiles.findIndex((f) => f.path === cursorPath));
  const hasAnchorSpan = anchorSpan !== null && anchorSpan !== undefined;
  const colLow = cursorIdx !== anchorIdx && hasAnchorSpan
    ? Math.min(anchorSpan.low, cCol)
    : Math.min(aCol, cCol);
  const colHigh = cursorIdx !== anchorIdx && hasAnchorSpan
    ? Math.max(anchorSpan.high, cCol)
    : Math.max(aCol, cCol);
  const step = cursorIdx >= anchorIdx ? 1 : -1;

  for (let i = anchorIdx; i >= 0 && i < items.length; i += step) {
    const item = items[i];
    if (item.kind === "header") continue; // 跨分类：跳过而不截断
    const fs = filesInItem(item);
    if (fs.length === 0) break;
    for (let c = colLow; c <= colHigh && c < fs.length; c++) {
      result.add(fs[c].path);
    }
    if (i === cursorIdx) break;
  }
  return result;
}

export function listSpacing(iconSize: number) {
  const gap = Math.max(4, Math.round(iconSize * 0.3125));
  const paddingV = Math.max(2, Math.round(iconSize * 0.125));
  const paddingH = Math.max(4, Math.round(iconSize * 0.1875));
  const marginV = Math.max(2, Math.round(iconSize * 0.125));
  const marginH = Math.max(4, Math.round(iconSize * 0.1875));
  const borderRadius = Math.max(4, Math.round(iconSize * 0.1875));
  const innerH = Math.max(iconSize, 20) + paddingV * 2;
  return { gap, paddingV, paddingH, marginV, marginH, borderRadius, innerH };
}

export function LIST_ROW_HEIGHT(iconSize: number) {
  const sp = listSpacing(iconSize);
  return sp.innerH + sp.marginV * 2;
}
export function GRID_ROW_HEIGHT(iconSize: number) { return iconSize + 38; }
export const HEADER_HEIGHT = 48;

export interface ItemBox {
  path: string;
  top: number;
  height: number;
  left: number;
  width: number;
}

export function computeItemBoxes(
  items: ListItem[],
  columns: number,
  containerWidth: number,
  iconSize: number,
): ItemBox[] {
  const boxes: ItemBox[] = [];
  let y = 0;
  for (const item of items) {
    if (item.kind === "header") {
      y += HEADER_HEIGHT;
    } else if (item.kind === "file") {
      boxes.push({
        path: item.file.path,
        top: y,
        height: LIST_ROW_HEIGHT(iconSize),
        left: 0,
        width: containerWidth,
      });
      y += LIST_ROW_HEIGHT(iconSize);
    } else {
      const h = GRID_ROW_HEIGHT(iconSize);
      const cw = containerWidth / columns;
      for (let gi = 0; gi < item.files.length; gi++) {
        boxes.push({
          path: item.files[gi].path,
          top: y,
          height: h,
          left: gi * cw,
          width: cw,
        });
      }
      y += h;
    }
  }
  return boxes;
}
