import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** 启动器条目类型：桌面快捷方式 / 应用程序菜单（开始菜单）条目 */
export type LauncherEntryKind = 'desktop' | 'appmenu';

/** 确保启动器条目所需的环境路径（main.ts 用真实路径构造，e2e harness 用沙箱目录） */
export interface LauncherEntryEnv {
  /** 桌面目录（XDG_DESKTOP_DIR 解析结果，如 ~/Desktop 或 ~/桌面） */
  desktopDir: string;
  /** 应用程序菜单目录（XDG_DATA_HOME/applications，如 ~/.local/share/applications） */
  applicationsDir: string;
  /** 应用图标目录（hicolor/scalable，Icon= 引用的绝对路径落点——SVG 图标
   *  按 freedesktop 图标主题规范归入 scalable 尺寸目录） */
  iconsDir: string;
  /** userData 目录（marker 文件落点：记录「已创建过」防止删掉后反复重建） */
  userDataDir: string;
  /** 应用可执行文件路径（进程自身，AppImage 挂载路径等） */
  execPath: string;
  /** AppImage 运行路径（AppImage 运行时注入的 APPIMAGE 环境变量；无则为 null） */
  appImage: string | null;
  /** 图标源文件绝对路径（SVG：打包产物 extraResources / 开发模式仓库
   *  src/icon.svg；不存在为 null） */
  iconSource: string | null;
  /** gio 可执行文件（用于 metadata::trusted 标记，GNOME 双击信任）；
   *  e2e 传 null 跳过（沙箱无意义且要求系统装有 glib） */
  gioExecutable?: string | null;
}

/** 确保启动器条目的结果 */
export interface LauncherEntryResult {
  /** 整体操作是否成功（marker 命中/已存在也算成功） */
  success: boolean;
  /** 本次调用是否真正创建了 .desktop 文件 */
  created: boolean;
  /** 条目文件路径（已存在或创建成功时返回） */
  entryPath?: string;
  /** 失败原因码（写入失败 / 非法 kind） */
  code?: 'WRITE_FAILED' | 'INVALID_KIND';
}

/** 桌面入口文件名（与 productName 对齐，Wayland app_id 同源） */
const ENTRY_FILE_NAME = 'HoshinekoFM.desktop';

/** 图标复制落点文件名（hicolor 主题目录内的稳定名称，不随 AppImage 挂载路径
 *  变化；SVG 矢量图标放 scalable 目录，任意尺寸渲染无损） */
const ICON_FILE_NAME = 'hoshineko-fm.svg';

/** marker 文件名（userData 内；记录各条目是否已创建过——「仅首次创建」语义的落点） */
const MARKER_FILE_NAME = 'launcher-entries.json';

/**
 * .desktop Exec 值转义：桌面条目规范要求引号内转义反斜杠与双引号，
 * 保证路径含空格/引号时仍能被 launcher 正确解析。
 *
 * @param value - 原始路径
 * @returns 转义后的路径（不含外层引号）
 */
export function escapeExecValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 构造 .desktop 文件内容（与 install.sh 的品牌字段保持一致）。
 * Exec 不带任何启动参数（默认单实例语义）；%U 允许把目录拖到
 * 快捷方式上打开（经单实例转发定位，见 createWindow 启动路径）。
 *
 * @param execPath - 应用可执行文件绝对路径（APPIMAGE 优先，回落进程路径）
 * @param iconPath - 图标绝对路径；null 时省略 Icon 行（桌面环境显示通用图标）
 * @returns .desktop 文件全文
 */
export function buildLauncherEntryContent(execPath: string, iconPath: string | null): string {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=HoshinekoFM',
    'Comment=Hoshineko File Manager',
    `Exec="${escapeExecValue(execPath)}" %U`,
  ];
  if (iconPath) lines.push(`Icon=${escapeExecValue(iconPath)}`);
  lines.push(
    'Terminal=false',
    'Categories=Utility;FileTools;FileManager;',
    'StartupWMClass=HoshinekoFM',
    '',
  );
  return lines.join('\n');
}

/** marker 记录：每类条目是否已创建过（删掉不补的落点） */
interface LauncherMarker {
  desktop?: boolean;
  appmenu?: boolean;
}

/** 读取 marker（不存在/损坏返回空对象） */
async function readMarker(userDataDir: string): Promise<LauncherMarker> {
  try {
    const raw = await fs.readFile(path.join(userDataDir, MARKER_FILE_NAME), 'utf-8');
    const parsed = JSON.parse(raw) as LauncherMarker;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* 文件不存在/损坏：视为未创建过 */
  }
  return {};
}

/** 写 marker（原子替换：临时文件 + rename） */
async function writeMarker(userDataDir: string, marker: LauncherMarker): Promise<void> {
  try {
    const file = path.join(userDataDir, MARKER_FILE_NAME);
    const tmp = `${file}.tmp`;
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(marker), 'utf-8');
    await fs.rename(tmp, file);
  } catch {
    /* marker 写失败不阻断条目创建（下次启动会重试；最坏情况是删掉后重建一次） */
  }
}

/**
 * 确保图标已复制到稳定目录（Icon= 必须引用不随版本/挂载变化的绝对路径）。
 * 已存在则不重复复制（按存在性判断，不校验内容）。
 *
 * @param env - 环境路径（iconsDir / iconSource）
 * @returns 图标绝对路径；源缺失/复制失败返回 null（省略 Icon 行）
 */
async function ensureIcon(env: LauncherEntryEnv): Promise<string | null> {
  if (!env.iconSource) return null;
  const dest = path.join(env.iconsDir, ICON_FILE_NAME);
  try {
    await fs.access(dest);
    return dest;
  } catch {
    /* 目标不存在：复制 */
  }
  try {
    await fs.mkdir(env.iconsDir, { recursive: true });
    await fs.copyFile(env.iconSource, dest);
    return dest;
  } catch {
    return null;
  }
}

/** 串行化链：marker 是读-改-写（read-modify-write），desktop/appmenu
 *  两路调用（乃至多窗口同时触发）若并行执行会互相覆盖 marker
 *  （后写者用旧快照整体替换，丢另一 kind 的标志）——所有 ensure/remove
 *  调用排队串行执行，消除丢失更新竞态 */
let entryChain: Promise<unknown> = Promise.resolve();

/**
 * 确保启动器条目存在（核心逻辑，main.ts 与 e2e harness 共用——单一来源，
 * 无手工副本；改坏此处 e2e 立即失败，见 AGENTS.md）：
 *
 * 1. marker 已记录 → 直接跳过（「创建一次，删掉不补」）；
 * 2. 条目文件已存在（用户自建/系统集成安装过）→ 只补 marker，绝不覆盖；
 * 3. 否则创建：复制图标 → 写 .desktop → chmod 755 → gio metadata::trusted
 *    （GNOME 双击信任，best-effort）→ 写 marker。
 *
 * 全部调用经串行链排队（见 entryChain）保证 marker 读-改-写原子。
 *
 * @param kind - 条目类型：desktop（桌面）/ appmenu（应用程序菜单）
 * @param env - 环境路径
 * @returns 操作结果（created 指示是否真正创建）
 */
export function ensureLauncherEntry(
  kind: LauncherEntryKind,
  env: LauncherEntryEnv,
): Promise<LauncherEntryResult> {
  const result = entryChain.then(() => ensureLauncherEntryLocked(kind, env));
  entryChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 删除启动器条目的结果 */
export interface LauncherEntryRemoveResult {
  /** 整体操作是否成功（文件不存在视为成功） */
  success: boolean;
  /** 本次调用是否真正删除了 .desktop 文件 */
  removed: boolean;
  /** 条目文件路径 */
  entryPath?: string;
  /** 失败原因码（非法 kind） */
  code?: 'INVALID_KIND';
}

/**
 * 删除启动器条目（开关关闭并确定时调用）：删除 .desktop 文件（不存在
 * 视为已删除）并清除该 kind 的 marker——之后开关重新打开并确定时可再次
 * 创建（显式开关往返 = 新的创建意图）。同样经串行链排队（marker 读-改-写）。
 *
 * @param kind - 条目类型：desktop（桌面）/ appmenu（应用程序菜单）
 * @param env - 环境路径
 * @returns 操作结果（removed 指示是否真正删除文件）
 */
export function removeLauncherEntry(
  kind: LauncherEntryKind,
  env: LauncherEntryEnv,
): Promise<LauncherEntryRemoveResult> {
  const result = entryChain.then(() => removeLauncherEntryLocked(kind, env));
  entryChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 删除执行体（见 removeLauncherEntry） */
async function removeLauncherEntryLocked(
  kind: LauncherEntryKind,
  env: LauncherEntryEnv,
): Promise<LauncherEntryRemoveResult> {
  if (kind !== 'desktop' && kind !== 'appmenu') {
    return { success: false, removed: false, code: 'INVALID_KIND' };
  }
  const target = path.join(
    kind === 'desktop' ? env.desktopDir : env.applicationsDir,
    ENTRY_FILE_NAME,
  );
  let removed = false;
  try {
    await fs.unlink(target);
    removed = true;
  } catch {
    /* 文件不存在：视为已删除 */
  }
  // 清除 marker：开关重新打开并确定时允许再次创建
  const marker = await readMarker(env.userDataDir);
  if (marker[kind]) {
    delete marker[kind];
    await writeMarker(env.userDataDir, marker);
  }
  return { success: true, removed, entryPath: target };
}

/** 串行执行体（见 ensureLauncherEntry） */
async function ensureLauncherEntryLocked(
  kind: LauncherEntryKind,
  env: LauncherEntryEnv,
): Promise<LauncherEntryResult> {
  if (kind !== 'desktop' && kind !== 'appmenu') {
    return { success: false, created: false, code: 'INVALID_KIND' };
  }

  const marker = await readMarker(env.userDataDir);
  if (marker[kind]) return { success: true, created: false };

  const target = path.join(
    kind === 'desktop' ? env.desktopDir : env.applicationsDir,
    ENTRY_FILE_NAME,
  );

  // 文件已存在：不覆盖（用户可能手动改过 Exec），只补 marker 防止重复处理
  try {
    await fs.access(target);
    marker[kind] = true;
    await writeMarker(env.userDataDir, marker);
    return { success: true, created: false, entryPath: target };
  } catch {
    /* 文件不存在：继续创建 */
  }

  // Exec 优先 APPIMAGE（AppImage 形态的稳定入口），回落进程路径
  const execPath = env.appImage && env.appImage.length > 0 ? env.appImage : env.execPath;
  const iconPath = await ensureIcon(env);
  const content = buildLauncherEntryContent(execPath, iconPath);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
    await fs.chmod(target, 0o755);
  } catch {
    return { success: false, created: false, code: 'WRITE_FAILED' };
  }

  // GNOME 对桌面上未 trusted 的 .desktop 双击拒绝执行（"Untrusted application
  // launcher"）；gio 标记为 best-effort——gio 缺失/失败不阻断（其他桌面环境
  // 不依赖该元数据，且用户可在 Nautilus 中手动「允许运行」）
  if (env.gioExecutable !== null) {
    try {
      await execFileAsync(env.gioExecutable ?? 'gio', ['set', target, 'metadata::trusted', 'true'], {
        timeout: 3000,
      });
    } catch {
      /* gio 不存在/失败：忽略（非关键路径） */
    }
  }

  marker[kind] = true;
  await writeMarker(env.userDataDir, marker);
  return { success: true, created: true, entryPath: target };
}
