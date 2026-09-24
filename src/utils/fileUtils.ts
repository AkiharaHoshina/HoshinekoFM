import type { IFile } from '../types/files';

export type FileGroup = 'Folders' | 'Code' | 'Media' | 'Documents' | 'Archives' | 'Executables' | 'Others'
  | 'DevBlockMountable' | 'DevBlockOther' | 'DevTty' | 'DevCharOther' | 'DevSymlink' | 'DevFifo' | 'DevSocket';

export const GROUP_ORDER: FileGroup[] = [
  'Folders',
  'Media',
  'Documents',
  'Code',
  'Archives',
  'Executables',
  'Others'
];

/** /dev 根目录（设备分组生效的唯一路径；子目录保持通用语义分组） */
export const DEV_DIR = '/dev';

/**
 * /dev 设备分组显示顺序（与语义 GROUP_ORDER 独立——设备组键不参与
 * 通用分组排序，避免影响外观设置预览等按 GROUP_ORDER 迭代的场景）。
 */
export const DEV_GROUP_ORDER: FileGroup[] = [
  'Folders',
  'DevBlockMountable',
  'DevBlockOther',
  'DevTty',
  'DevCharOther',
  'DevSymlink',
  'DevFifo',
  'DevSocket',
  'Others'
];

const codeMimeSubtypes = new Set([
  'javascript', 'typescript', 'html', 'css', 'x-scss', 'x-python',
  'x-java', 'x-c', 'x-c++', 'x-csharp', 'x-go', 'x-rust', 'x-lua',
  'x-php', 'x-ruby', 'x-sql', 'x-shell', 'x-yaml', 'x-toml', 'x-perl',
  'x-swift', 'x-kotlin', 'x-dart', 'x-haskell', 'x-scala',
  'xml', 'json',
]);

const archiveMimeTypes = new Set([
  'application/zip', 'application/gzip', 'application/x-bzip2',
  'application/x-xz', 'application/x-7z-compressed', 'application/vnd.rar',
  'application/x-rar-compressed', 'application/x-tar',
  'application/x-iso9660-image',
]);

const docMimeTypes = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'application/x-krita',
  'application/x-scratch',
]);

const execMimeTypes = new Set([
  'application/x-elf', 'application/x-executable',
  'application/x-sharedlib', 'application/x-python-bytecode',
]);

export function getSemanticGroup(file: IFile): FileGroup {
  if (file.isDirectory) return 'Folders';

  const mime = file.mime;
  if (!mime) return 'Others';

  const [cat, sub] = mime.split('/');

  switch (cat) {
  case 'image':
  case 'audio':
  case 'video':
    return 'Media';
  case 'text':
    return codeMimeSubtypes.has(sub) ? 'Code' : 'Documents';
  case 'application':
    if (codeMimeSubtypes.has(sub)) return 'Code';
    if (docMimeTypes.has(mime)) return 'Documents';
    if (archiveMimeTypes.has(mime)) return 'Archives';
    if (execMimeTypes.has(mime)) return 'Executables';
    return 'Others';
  default:
    return 'Others';
  }
}

/**
 * /dev 终端类字符设备名：控制台、tty 系（tty/ttyS…/ttyUSB…/ttyprintk…）、
 * 伪终端主端 ptmx、蓝牙串口 rfcomm…。虚拟控制台内存设备（vcs/vcsa）、
 * 帧缓冲（fb…）等不在此列。
 */
function isTtyDeviceName(name: string): boolean {
  return name === 'console' || name === 'ptmx' || name.startsWith('tty') || name.startsWith('rfcomm');
}

/**
 * /dev 根目录设备分组（仅 path === '/dev' 时由调用方使用，子目录保持
 * 通用语义分组——/dev/shm、/dev/pts 等挂载点内容是普通文件）。
 * 分类依据后端已富化的 `mime`（inode/blockdevice 等）与 `isMountable`：
 *
 * - 块设备按 `isMountable`（分区/DM 设备，可经 udisks 挂载）拆分；
 * - 字符设备按终端名规则拆「电传打字机(tty)」与「其他字符设备」；
 * - 链接 / 管道 / 套接字各成一组（/dev 下三者语义差异明显）；
 * - 目录复用语义「文件夹」，普通文件复用「其他」。
 *
 * @param file - /dev 条目
 * @returns 设备分组键（Folders/Others 与语义分组共用键）
 */
export function getDeviceGroup(file: IFile): FileGroup {
  // 符号链接优先：后端对可解析的链接按目标分类（如 /dev/stdin →
  // /proc/self/fd/0 归类为字符设备、/dev/fd → 目录），但 /dev 下
  // 条目本质是链接——按 symlinkTarget 存在性归入链接组（含指向目录/
  // 设备的链接），语义更符合用户预期
  if (file.symlinkTarget) return 'DevSymlink';
  if (file.isDirectory) return 'Folders';
  switch (file.mime) {
  case 'inode/blockdevice':
    return file.isMountable ? 'DevBlockMountable' : 'DevBlockOther';
  case 'inode/chardevice':
    return isTtyDeviceName(file.name) ? 'DevTty' : 'DevCharOther';
  case 'inode/symlink':
    return 'DevSymlink';
  case 'inode/fifo':
    return 'DevFifo';
  case 'inode/socket':
    return 'DevSocket';
  default:
    return 'Others';
  }
}

/**
 * 从文件列表推断所在目录：条目共享同一父目录（主窗口/选择器/保存器
 * 的普通列表均如此）；空列表返回 null（无分组可算，与无条目等价）。
 * sortFiles 与 flattenItems 共用同一推导，保证排序与组头渲染同源。
 *
 * @param files - 当前列表（过滤/排序前的原始列表亦可）
 * @returns 父目录路径；无法推断时为 null
 */
export function groupingDirOf(files: readonly IFile[]): string | null {
  if (files.length === 0) return null;
  const p = files[0].path;
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.substring(0, idx);
}

/**
 * 该列表是否应启用 /dev 设备分组（与「分组开启」开关正交——开关关闭
 * 时仍走目录优先平铺）。
 */
export function isDevGroupingList(files: readonly IFile[]): boolean {
  return groupingDirOf(files) === DEV_DIR;
}
