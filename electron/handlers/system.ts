import { ipcMain, BrowserWindow, app } from 'electron';
import path from 'path';
import { promises as fs, watch as fsWatch, existsSync } from 'fs';
import os from 'os';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import dbus from 'dbus-next';
import { getMountMap, invalidateMountMapCache, getExecError } from '../shared';
import { getThumbnailCacheInfo, clearThumbnailCache, detectMime } from '../fsUtils';
import { getLastBackendRegistration } from '../backends';
import { PORTAL_BUS_NAME, PORTAL_FILE_CHOOSER_PATH, PORTAL_FILE_CHOOSER_IFACE } from './portalFileChooser';
import { FILE_MANAGER1_NAME, FILE_MANAGER1_PATH, FILE_MANAGER1_IFACE } from './fileManager1';
import {
  queryBackendConflict,
  type BackendConflictInfo,
  type BackendKind,
} from './backendInfo';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface LsblkDevice {
  name: string;
  kname?: string;
  label?: string;
  mountpoint?: string | null;
  size?: string;
  type?: string;
  tran?: string;
  rm?: boolean;
  hotplug?: boolean;
  fstype?: string;
  model?: string;
  ro?: boolean;
  children?: LsblkDevice[];
  devicePath?: string;
  mounted?: boolean;
  isExternal?: boolean;
  parentDisk?: string;
}

interface DriveInfo {
  name: string;
  label: string;
  mountpoint: string;
  size?: string;
  type?: string;
  removable: boolean;
  usb: boolean;
}

let appsCache: { name: string; icon: string; exec: string; desktopFile: string; }[] | null = null;

// ── 默认终端检测 ──

/** 单个终端模拟器的启动参数规格 */
interface TerminalSpec {
  /**
   * 执行命令（argv 数组）的参数构造器：把目标命令 argv 转成该终端的
   * 完整 spawn 参数。null 表示无专用语法，回退到通用 `-e`。
   */
  exec: ((argv: string[]) => string[]) | null;
}

/**
 * 常见终端参数规格表（按二进制 basename 匹配）。
 * 不同终端执行命令的参数风格差异很大，无法用一套参数通吃。
 *
 * 注意：刻意不用各终端的 `--working-directory` 类标志打开目录——
 * 单实例/CS 架构的终端（如 ghostty）在转发新窗口请求时会丢弃该标志，
 * 窗口会继承 server 进程的 cwd。统一改为「在终端里执行
 * `sh -c 'cd "$1" && exec "$SHELL"'`」的命令包装，命令本身会被可靠转发。
 */
const TERMINAL_SPECS: Record<string, TerminalSpec> = {
  'ghostty': { exec: (argv) => ['-e', ...argv] },
  'gnome-terminal': { exec: (argv) => ['--', ...argv] },
  'kgx': { exec: (argv) => ['-e', ...argv] },
  'konsole': { exec: (argv) => ['-e', ...argv] },
  'xfce4-terminal': { exec: (argv) => ['-x', ...argv] },
  'kitty': { exec: (argv) => argv },
  'alacritty': { exec: (argv) => ['-e', ...argv] },
  'foot': { exec: (argv) => argv },
  'wezterm': { exec: (argv) => ['start', '--', ...argv] },
  'tilix': { exec: (argv) => ['-e', ...argv] },
  'xterm': { exec: (argv) => ['-e', ...argv] },
  'x-terminal-emulator': { exec: (argv) => ['-e', ...argv] },
};

/** 硬编码兜底扫描列表（按优先级从高到低） */
const FALLBACK_TERMINALS = [
  'ghostty',
  'kitty',
  'alacritty',
  'wezterm',
  'foot',
  'gnome-terminal',
  'kgx',
  'konsole',
  'xfce4-terminal',
  'tilix',
  'xterm',
];

/** 默认终端检测结果 */
interface DetectedTerminal {
  /** 实际执行的命令（终端二进制名/路径，或 xdg-terminal-exec） */
  command: string;
  /** 是否为 xdg-terminal-exec 委托模式（参数整体交给它构造） */
  delegate: boolean;
  /** 参数规格；委托模式或未知终端时为 null */
  spec: TerminalSpec | null;
}

/** 默认终端检测缓存（Promise 级缓存；未找到时不缓存，下次重试） */
let terminalDetection: Promise<DetectedTerminal | null> | null = null;

/**
 * 自定义终端配置文件路径：`~/.config/HoshinekoFM/terminal.conf`。
 *
 * 格式（简单键值或裸命令均可）：
 * ```
 * # 注释
 * command = foot
 * ```
 * 或直接写一行命令：`foot`。`command` 值/裸行取第一个空白分隔的词
 * 作为终端命令（与 $TERMINAL 处理一致），支持绝对路径。
 *
 * 配置文件存在时**优先于** $TERMINAL / xdg-terminal-exec 等全部
 * 系统检测链（docs/bugs.md 遗留项「在自定义终端中打开」的实现方式——
 * 读取程序外配置文件指定终端）。参数风格按命令 basename 查
 * {@link TERMINAL_SPECS}，未知终端回退通用 `-e` 风格。
 *
 * 文件缺失/解析失败/命令不存在时返回 null（继续走系统检测链）。
 */
const CUSTOM_TERMINAL_CONFIG = path.join(os.homedir(), '.config/HoshinekoFM/terminal.conf');

/** 读取自定义终端配置（返回终端命令或 null） */
async function readCustomTerminal(): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(CUSTOM_TERMINAL_CONFIG, 'utf-8');
  } catch {
    return null;
  }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // command = <cmd> 或裸命令行
    const eq = line.indexOf('=');
    const value = (eq >= 0 ? line.slice(eq + 1) : line).trim();
    const cmd = value.split(/\s+/)[0];
    if (cmd) return cmd;
  }
  return null;
}

/** 检查命令是否存在于 PATH（which 实现） */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测系统默认终端模拟器，按优先级依次尝试：
 * 0. 自定义终端配置 `~/.config/HoshinekoFM/terminal.conf`（用户显式覆盖）
 * 1. `$TERMINAL` 环境变量（用户显式指定）
 * 2. `xdg-terminal-exec`（freedesktop 新标准，可整包委托）
 * 3. `gsettings`（GNOME / Cinnamon / MATE / Budgie 的默认终端配置）
 * 4. `exo-open --launch TerminalEmulator`（XFCE）
 * 5. `kreadconfig`（KDE Plasma 5/6）
 * 6. 常见终端二进制扫描（含 ghostty）
 * 7. `x-terminal-emulator`（Debian alternatives 符号链接）
 *
 * 命中即返回对应命令与参数规格；全部失败返回 null。
 */
async function detectDefaultTerminal(): Promise<DetectedTerminal | null> {
  // 0) 自定义终端配置（程序外配置文件，优先级最高）
  const customTerminal = await readCustomTerminal();
  if (customTerminal && (await commandExists(customTerminal))) {
    return { command: customTerminal, delegate: false, spec: TERMINAL_SPECS[path.basename(customTerminal)] ?? null };
  }

  // 1) $TERMINAL 环境变量
  const envTerminal = process.env.TERMINAL;
  if (envTerminal) {
    const cmd = envTerminal.trim().split(/\s+/)[0];
    if (cmd && (await commandExists(cmd))) {
      return { command: cmd, delegate: false, spec: TERMINAL_SPECS[path.basename(cmd)] ?? null };
    }
  }

  // 2) xdg-terminal-exec（存在则整包委托，由它负责终端选择与参数构造）
  if (await commandExists('xdg-terminal-exec')) {
    return { command: 'xdg-terminal-exec', delegate: true, spec: null };
  }

  // 3) gsettings 系列 schema
  const gsettingsSchemas = [
    'org.gnome.desktop.default-applications.terminal',
    'org.cinnamon.desktop.default-applications.terminal',
    'org.mate.applications-terminal',
  ];
  if (await commandExists('gsettings')) {
    for (const schema of gsettingsSchemas) {
      try {
        const { stdout } = await execFileAsync('gsettings', ['get', schema, 'exec']);
        const cmd = stdout.trim().replace(/^'|'$/g, '');
        if (cmd && (await commandExists(cmd))) {
          return { command: cmd, delegate: false, spec: TERMINAL_SPECS[path.basename(cmd)] ?? null };
        }
      } catch { /* 尝试下一个 schema */ }
    }
  }

  // 4) exo-open（XFCE）
  if (await commandExists('exo-open')) {
    try {
      const { stdout } = await execFileAsync('exo-open', ['--launch', 'TerminalEmulator']);
      const cmd = stdout.trim().split(/\s+/)[0];
      if (cmd && (await commandExists(cmd))) {
        return { command: cmd, delegate: false, spec: TERMINAL_SPECS[path.basename(cmd)] ?? null };
      }
    } catch { /* continue */ }
  }

  // 5) kreadconfig（KDE Plasma 6 → 5）
  for (const tool of ['kreadconfig6', 'kreadconfig']) {
    if (!(await commandExists(tool))) continue;
    try {
      const { stdout } = await execFileAsync(tool, ['--file', 'kdeglobals', '--group', 'General', '--key', 'TerminalApplication']);
      const cmd = stdout.trim();
      if (cmd && (await commandExists(cmd))) {
        return { command: cmd, delegate: false, spec: TERMINAL_SPECS[path.basename(cmd)] ?? null };
      }
    } catch { /* 尝试 kreadconfig（Plasma 5） */ }
  }

  // 6) 常见终端扫描
  for (const cmd of FALLBACK_TERMINALS) {
    if (await commandExists(cmd)) {
      return { command: cmd, delegate: false, spec: TERMINAL_SPECS[cmd] ?? null };
    }
  }

  // 7) Debian alternatives
  if (await commandExists('x-terminal-emulator')) {
    return { command: 'x-terminal-emulator', delegate: false, spec: TERMINAL_SPECS['x-terminal-emulator'] };
  }

  return null;
}

/**
 * 获取默认终端（带缓存）。未找到时不缓存结果，
 * 下次调用会重新检测（用户可能刚安装了终端）。
 */
async function getDefaultTerminal(): Promise<DetectedTerminal | null> {
  if (!terminalDetection) {
    terminalDetection = detectDefaultTerminal().then((result) => {
      if (!result) terminalDetection = null;
      return result;
    });
  }
  return terminalDetection;
}

/**
 * 以 detached 模式启动进程（与窗口生命周期解耦），返回 true 或错误消息。
 * 参数用数组传递而非 shell 字符串，避免路径含空格时被拆分。
 */
function spawnDetached(command: string, args: string[], cwd?: string): Promise<true | string> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        cwd,
        env: { ...process.env },
      });
      child.on('error', (err: Error) => {
        resolve(err.message);
      });
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch (e) {
      resolve(getExecError(e).message);
    }
  });
}

let udisks2Available = false;
let deviceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let previousExternalDevicesJson = '';

async function getAllDevices(): Promise<LsblkDevice[]> {
  try {
    const { stdout } = await execAsync('lsblk --json -o NAME,KNAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM,FSTYPE,MODEL,HOTPLUG,RO');
    const data = JSON.parse(stdout);
    const devices: LsblkDevice[] = data.blockdevices || [];
    const processDevice = (dev: LsblkDevice, parentModel?: string, parentDisk?: string): LsblkDevice => ({
      name: dev.name,
      devicePath: `/dev/${dev.kname}`,
      label: dev.label || dev.name,
      mountpoint: dev.mountpoint,
      mounted: dev.mountpoint !== null && dev.mountpoint !== '[SWAP]',
      size: dev.size,
      type: dev.type,
      tran: dev.tran || undefined,
      rm: dev.rm || false,
      hotplug: dev.hotplug || false,
      fstype: dev.fstype || undefined,
      model: dev.model || parentModel || undefined,
      isExternal: !!(dev.hotplug || dev.rm || dev.tran === 'usb'),
      parentDisk: dev.type === 'part' ? parentDisk : undefined,
      children: dev.children ? dev.children.map(c => processDevice(c, dev.model || parentModel, `/dev/${dev.kname}`)) : undefined,
    });
    return devices.map(d => processDevice(d));
  } catch (e) {
    console.error('Failed to get all devices', e);
    return [];
  }
}

function scheduleExternalDevicesRefresh(getWindows: () => BrowserWindow[]) {
  if (deviceRefreshTimer) clearTimeout(deviceRefreshTimer);
  deviceRefreshTimer = setTimeout(async () => {
    deviceRefreshTimer = null;
    try {
      const allDevices = await getAllDevices();
      const externalDevices = allDevices.filter(d => d.isExternal);
      const json = JSON.stringify(externalDevices);
      if (json !== previousExternalDevicesJson) {
        previousExternalDevicesJson = json;
        // 广播给所有窗口
        for (const win of getWindows()) {
          if (win && !win.isDestroyed()) {
            win.webContents.send('system:devices-changed', externalDevices);
          }
        }
      }
    } catch (e) {
      console.error('Device refresh error:', e);
    }
  }, 300);
}

export async function setupUdisks2Monitor(getWindows: () => BrowserWindow[]) {
  try {
    const bus = dbus.systemBus();
    const obj = await bus.getProxyObject('org.freedesktop.UDisks2', '/org/freedesktop/UDisks2');
    const objectManager = obj.getInterface('org.freedesktop.DBus.ObjectManager');
    udisks2Available = true;
    console.log('udisks2 monitor active');

    objectManager.on('InterfacesAdded', () => scheduleExternalDevicesRefresh(getWindows));
    objectManager.on('InterfacesRemoved', () => scheduleExternalDevicesRefresh(getWindows));
  } catch {
    console.warn('udisks2 not available, device polling will be used');
    udisks2Available = false;
  }
}

// ── GVfs 会话设备（MTP 手机 / PTP 相机）──

/**
 * GVfs 会话设备条目。手机选「传输文件」（MTP）或相机（PTP）时，
 * gvfs 栈（gvfsd-mtp / gvfs-gphoto2）在用户会话里管理它们——这类设备
 * 不出现在 `lsblk` / UDisks2 的块设备树里，必须单独枚举。
 *
 * 已挂载的由 gvfs FUSE 根目录枚举（挂载点直接可浏览）；
 * 未挂载的（插着但未自动挂载，或用户卸载过）由 `gio mount -l` 枚举，
 * 可经 `gio mount -d <unix-device>` 挂载。
 */
export interface GvfsVolume {
  /** 显示名（gvfs-info 的 display name / gio 卷名，通常为手机/相机型号） */
  name: string;
  /** 挂载类别：mtp = 手机（MTP/AFC），gphoto2 = 相机（PTP） */
  kind: 'mtp' | 'gphoto2';
  /** FUSE 挂载点绝对路径；未挂载时为 null */
  mountpoint: string | null;
  /** GVfs URI（已 percent 解码，如 `mtp:host=[usb:001,012]`）；可能为 null */
  uri: string | null;
  /** 未挂载卷的设备标识（unix-device，如 `/dev/bus/usb/001/012`），用于 `gio mount -d` */
  deviceId: string | null;
  /** 是否已挂载 */
  mounted: boolean;
}

/** gvfs FUSE 聚合根目录（gvfsd-fuse 挂载在用户运行时目录下） */
function getGvfsRoot(): string {
  return path.join('/run/user', String(os.userInfo().uid), 'gvfs');
}

/** gio 轮询间隔：检测未挂载卷的插拔（已挂载变化由 inotify 即时感知） */
const GVFS_POLL_INTERVAL_MS = 3000;

let gvfsWatcher: ReturnType<typeof fsWatch> | null = null;
let gvfsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let previousGvfsVolumesJson = '';

/**
 * 用 gvfs-info 查询挂载根目录的显示名（手机型号等）。
 * gvfs-info 缺失或查询失败时回退到传入的默认值
 * （解码后的 URI，如 `mtp:host=[usb:001,012]`）。
 */
async function getGvfsDisplayName(mountpoint: string, fallback: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gvfs-info', [mountpoint], { timeout: 3000 });
    const match = stdout.match(/^display name:\s*(.+)$/m);
    if (match && match[1]) return match[1].trim();
  } catch { /* gvfs-info 不可用或查询超时，用 URI 兜底 */ }
  return fallback;
}

/**
 * 从已挂载卷的 URI 推导 unix-device 标识
 * （如 `mtp:host=[usb:001,014]` → `/dev/bus/usb/001/014`）。
 * USB 总线地址不稳定（重枚举会变），仅用于本次会话内的匹配。
 */
function deriveUsbDeviceId(uri: string | null): string | null {
  if (!uri) return null;
  const m = uri.match(/\[usb:(\d{1,3}),(\d{1,3})\]/i);
  if (!m) return null;
  return `/dev/bus/usb/${m[1]}/${m[2]}`;
}

/**
 * 枚举已挂载的 gvfs 设备：列 gvfs FUSE 根目录（每个挂载对应一个子目录，
 * 目录名即 percent 编码的 URI），仅保留 MTP / PTP 类（手机与相机）。
 */
async function listMountedGvfsVolumes(): Promise<GvfsVolume[]> {
  const root = getGvfsRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    // gvfsd-fuse 未运行（无 gvfs 会话）：返回空列表
    return [];
  }

  const volumes: GvfsVolume[] = [];
  for (const entry of entries) {
    let uri = entry;
    try {
      uri = decodeURIComponent(entry);
    } catch { /* 非法编码时保留原名 */ }
    const kind = uri.startsWith('mtp:') ? 'mtp' : uri.startsWith('gphoto2:') ? 'gphoto2' : null;
    if (!kind) continue;
    const mountpoint = path.join(root, entry);
    volumes.push({
      name: await getGvfsDisplayName(mountpoint, uri),
      kind,
      mountpoint,
      uri,
      deviceId: deriveUsbDeviceId(uri),
      mounted: true,
    });
  }
  return volumes;
}

/** `gio mount -l` 解析出的卷（中间结构） */
interface ParsedGioVolume {
  name: string;
  /** 卷监视器类型（如 GProxyVolumeMonitorMTP） */
  monitor: string;
  /** unix-device 标识（如 /dev/bus/usb/001/012） */
  deviceId: string | null;
  /** 是否已有 Mount 条目 */
  mounted: boolean;
  /** Mount 条目中的 URI */
  uri: string | null;
}

/**
 * 解析 `LC_ALL=C gio mount -l -i` 输出，提取全部卷。
 * 行格式（英文固定）：`Volume(N): <name>` 开始一个卷块，
 * 块内 `Type: GProxyVolume (<Monitor>)` 给出监视器类型、
 * `unix-device: '<path>'` 给出设备标识、`Mount(N): <name> -> <uri>` 表示已挂载。
 */
function parseGioMountList(stdout: string): ParsedGioVolume[] {
  const volumes: ParsedGioVolume[] = [];
  let current: ParsedGioVolume | null = null;
  for (const line of stdout.split('\n')) {
    if (/^Drive\(\d+\):/.test(line)) {
      // 驱动器块开始：其 ids 段不属于任何卷
      current = null;
      continue;
    }
    const volMatch = line.match(/^\s*Volume\(\d+\): (.*)$/);
    if (volMatch) {
      current = { name: volMatch[1].trim(), monitor: '', deviceId: null, mounted: false, uri: null };
      volumes.push(current);
      continue;
    }
    if (!current) continue;
    const typeMatch = line.match(/GProxyVolume \((GProxyVolumeMonitor\w+)\)/);
    if (typeMatch) current.monitor = typeMatch[1];
    const devMatch = line.match(/unix-device: '([^']+)'/);
    if (devMatch) current.deviceId = devMatch[1];
    const mountMatch = line.match(/^\s*Mount\(\d+\): .+ -> (\S+)$/);
    if (mountMatch) {
      current.mounted = true;
      current.uri = mountMatch[1];
    }
  }
  return volumes;
}

/** 卷监视器类型 → 设备类别（仅手机/相机类，其余返回 null） */
function gioMonitorToKind(monitor: string): 'mtp' | 'gphoto2' | null {
  if (monitor === 'GProxyVolumeMonitorGPhoto2') return 'gphoto2';
  if (monitor === 'GProxyVolumeMonitorMTP' || monitor === 'GProxyVolumeMonitorAfc') return 'mtp';
  return null;
}

/**
 * 把 `gio mount -l` 的 Mount URI 转成 gvfs FUSE 根目录名的候选形式。
 * FUSE 目录名形如 `mtp:host=<host>`（host percent 编码），gio 打印的
 * URI 形如 `mtp://<host>/`，两侧编码形式可能不同，生成多种候选逐一比对。
 */
function uriToFuseCandidates(uri: string): string[] {
  const m = uri.match(/^(mtp|gphoto2):\/\/(.*?)\/?$/);
  if (!m) return [];
  const scheme = m[1];
  const host = m[2];
  const candidates = new Set<string>([`${scheme}:host=${host}`]);
  try { candidates.add(`${scheme}:host=${decodeURIComponent(host)}`); } catch { /* 非法编码 */ }
  try { candidates.add(`${scheme}:host=${encodeURIComponent(host)}`); } catch { /* 无法编码 */ }
  return [...candidates];
}

/**
 * 合并枚举全部 gvfs 会话设备：
 * - 已挂载：来自 gvfs FUSE 根目录（带挂载点），并按 URI 与 gio 卷列表
 *   关联补上显示名与 unix-device——MTP 挂载点的 URI 不含 USB 地址
 *   （如三星的 `mtp:host=SAMSUNG_SAMSUNG_Android_XXX`），
 *   无法从 URI 推导 deviceId，必须靠关联补齐
 * - 未挂载：来自 `gio mount -l`（带 unix-device，可挂载）；
 *   deviceId 与某个已挂载卷重复的是 gio 尚未更新 Mount 行的陈旧条目，
 *   剔除，避免侧边栏同时显示同一设备的两个条目
 */
async function listGvfsVolumes(): Promise<GvfsVolume[]> {
  const fuseVolumes = await listMountedGvfsVolumes();

  let gioVolumes: ParsedGioVolume[] = [];
  try {
    const { stdout } = await execFileAsync('gio', ['mount', '-l', '-i'], {
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 5000,
    });
    gioVolumes = parseGioMountList(stdout);
  } catch { /* gio 不可用：仅显示已挂载设备 */ }

  // gio 中已挂载的卷（有 Mount 条目）按候选 URI 建索引
  const gioMountedByUri = new Map<string, ParsedGioVolume>();
  for (const gv of gioVolumes) {
    if (!gioMonitorToKind(gv.monitor) || !gv.mounted || !gv.uri) continue;
    for (const cand of uriToFuseCandidates(gv.uri)) {
      gioMountedByUri.set(cand, gv);
    }
  }

  // 关联：FUSE 条目补显示名与 deviceId
  const mounted = fuseVolumes.map(fv => {
    const gioEntry = fv.uri ? gioMountedByUri.get(fv.uri) : undefined;
    if (!gioEntry) return fv;
    return {
      ...fv,
      name: gioEntry.name || fv.name,
      deviceId: gioEntry.deviceId ?? fv.deviceId,
    };
  });

  const mountedDeviceIds = new Set(
    mounted.map(v => v.deviceId).filter((d): d is string => !!d)
  );

  const unmounted: GvfsVolume[] = [];
  for (const gv of gioVolumes) {
    const kind = gioMonitorToKind(gv.monitor);
    if (!kind || gv.mounted) continue;
    if (gv.deviceId && mountedDeviceIds.has(gv.deviceId)) continue; // 陈旧条目
    unmounted.push({
      name: gv.name,
      kind,
      mountpoint: null,
      uri: gv.uri,
      deviceId: gv.deviceId,
      mounted: false,
    });
  }
  return [...mounted, ...unmounted];
}

/**
 * 尝试对 gvfs 根目录建立 inotify 监听：手机挂载/卸载会在根目录下
 * 创建/删除子目录。根目录不存在（gvfsd-fuse 未运行）时静默跳过，
 * 由常开轮询在根目录出现后重试。
 */
function tryGvfsWatch(getWindows: () => BrowserWindow[]) {
  if (gvfsWatcher) return;
  try {
    gvfsWatcher = fsWatch(getGvfsRoot(), () => scheduleGvfsRefresh(getWindows));
    gvfsWatcher.on('error', () => {
      // 根目录被卸载（gvfsd-fuse 退出）：watcher 失效，由轮询兜底并重试
      gvfsWatcher?.close();
      gvfsWatcher = null;
    });
  } catch { /* 根目录不存在：轮询兜底 */ }
}

/** 防抖刷新 gvfs 设备列表，变化时广播给所有窗口 */
function scheduleGvfsRefresh(getWindows: () => BrowserWindow[]) {
  if (gvfsRefreshTimer) clearTimeout(gvfsRefreshTimer);
  gvfsRefreshTimer = setTimeout(async () => {
    gvfsRefreshTimer = null;
    try {
      const volumes = await listGvfsVolumes();
      const json = JSON.stringify(volumes);
      if (json !== previousGvfsVolumesJson) {
        previousGvfsVolumesJson = json;
        console.log(
          '[gvfs] volumes changed:',
          volumes.map(v => `${v.name}(${v.kind},${v.mounted ? `mounted@${v.mountpoint}` : `unmounted@${v.deviceId}`})`).join(' | ') || '(none)'
        );
        for (const win of getWindows()) {
          if (win && !win.isDestroyed()) {
            win.webContents.send('system:gvfs-changed', volumes);
          }
        }
      }
    } catch (e) {
      console.error('GVfs refresh error:', e);
    }
  }, 300);
}

/**
 * 启动 gvfs 会话设备监听（MTP 手机 / PTP 相机）。
 * 与 UDisks2 监听互补：块设备走 lsblk/udisks，gvfs 设备走这里。
 * - inotify：已挂载状态变化即时感知
 * - 常开轮询（应用生命周期内不停止）：未挂载卷的插拔（gvfs 无对应
 *   事件）与 gvfs 根目录探测
 * 初始化后立即刷新一次，供已打开的窗口拿到初始列表。
 */
export function setupGvfsMonitor(getWindows: () => BrowserWindow[]) {
  tryGvfsWatch(getWindows);
  setInterval(() => {
    tryGvfsWatch(getWindows);
    void scheduleGvfsRefresh(getWindows);
  }, GVFS_POLL_INTERVAL_MS);
  void scheduleGvfsRefresh(getWindows);
}

/** `system:mount-gvfs` 的结构化返回 */
export interface GvfsMountResult {
  success: boolean;
  /** 挂载成功的挂载点；已挂载/自动挂载时也尽量补齐供前端跳转 */
  mountpoint?: string;
  /** 结构化错误码：TIMEOUT / NO_SUCH_DEVICE / INVALID_DEVICE */
  code?: 'TIMEOUT' | 'NO_SUCH_DEVICE' | 'INVALID_DEVICE';
  /** 非结构化错误信息（原始 stderr 等） */
  error?: string;
}

/**
 * 单次 `gio mount -d` 尝试。
 * 超时（execFile 的 timeout kill 掉 gio 进程）与「设备不存在/地址漂移」
 * 映射为结构化错误码，其余失败透传原始信息。
 *
 * gio 以 0 退出即视为成功——MTP 挂载的输出可能只有警告（stderr）而没有
 * 「Mounted … at …」行，此时挂载点由 {@link mountGvfsRobust} 的观察循环
 * 通过重新枚举补齐。
 */
async function tryMountGvfsInner(deviceId: string): Promise<GvfsMountResult> {
  try {
    const { stdout } = await execFileAsync('gio', ['mount', '-d', deviceId], {
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 20000,
    });
    const mountMatch = stdout.match(/Mounted .+ at (.+)$/m);
    if (mountMatch) return { success: true, mountpoint: mountMatch[1].trim() };
    return { success: true };
  } catch (e) {
    const err = e as { killed?: boolean; code?: string | number };
    const { stderr, message } = getExecError(e);
    if (err.killed || err.code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
      return { success: false, code: 'TIMEOUT' };
    }
    if (/already mounted/i.test(stderr)) return { success: true };
    if (/no volume for device|doesn'?t exist|no such file/i.test(`${stderr} ${message}`)) {
      return { success: false, code: 'NO_SUCH_DEVICE', error: stderr || message };
    }
    return { success: false, error: stderr || message || 'Mount failed' };
  }
}

/** 带日志的单次挂载尝试（诊断用） */
async function tryMountGvfs(deviceId: string): Promise<GvfsMountResult> {
  const result = await tryMountGvfsInner(deviceId);
  console.log(`[gvfs] try mount deviceId=${deviceId} result=${JSON.stringify(result)}`);
  return result;
}

/**
 * 稳健挂载 gvfs 卷。快照数据（deviceId / 挂载状态）最多滞后约 3 秒，
 * 手机切换 USB 模式（如三星：仅充电 → 传输文件）时会重枚举：
 * 总线地址漂移 + gvfs 需要数秒重新探测注册新卷，因此：
 * 1. 单次尝试 `gio mount -d`
 * 2. 观察循环（每次先等待再重新枚举）：
 *    - 失败：等待 gvfs 重枚举探测 / gvfsd 后台收尾；发现已挂载 → 成功；
 *      发现地址漂移 → 换新地址重试
 *    - 成功但无挂载点：等待挂载点出现（gio 只报 exit 0 或 gvfsd 仍在收尾）
 * 3. 同名卷已换新 deviceId → 用新地址重试；卷名也变了时兜底启发式：
 *    旧地址已消失且仅剩一个未挂载的手机/相机卷 → 直接用
 * 4. 循环耗尽后最后补查一次
 *
 * 超时后的等待间隔更长：gio 被 kill 后 gvfsd 往往还需数秒才能完成挂载。
 *
 * @param deviceId - 侧边栏快照中的 unix-device（如 /dev/bus/usb/001/012）
 * @param nameHint - 卷显示名，用于漂移后的匹配（重试新地址）
 */
async function mountGvfsRobust(deviceId: string, nameHint?: string): Promise<GvfsMountResult> {
  /** 在当前卷列表中找已挂载的目标（优先 deviceId，回退显示名，最后兜底） */
  const findMounted = async (devId: string): Promise<GvfsVolume | null> => {
    const volumes = await listGvfsVolumes();
    const byDevice = volumes.find(v => v.mounted && v.mountpoint && v.deviceId === devId);
    if (byDevice?.mountpoint) return byDevice;
    if (nameHint) {
      const byName = volumes.find(v => v.mounted && v.mountpoint && v.name === nameHint);
      if (byName?.mountpoint) return byName;
    }
    // 兜底：gio 尚未更新（无 Mount 条目可关联）的过渡窗口，
    // 仅剩一个已挂载的手机/相机卷时直接视为目标
    const mountedVols = volumes.filter(v => v.mounted && v.mountpoint);
    return mountedVols.length === 1 ? mountedVols[0] : null;
  };

  /**
   * 在未挂载卷中找重试目标：
   * 1. 同名卷（地址漂移后 gvfs 已注册新卷）
   * 2. 兜底：旧地址已不在列表且仅剩一个未挂载的手机/相机卷时直接用
   *    （切换 USB 模式后卷名可能变化）
   * 旧地址仍在列表时不做他卷启发式——此时失败可能是瞬态错误而非漂移。
   */
  const findFresh = async (currentId: string): Promise<GvfsVolume | null> => {
    const volumes = await listGvfsVolumes();
    const unmounted = volumes.filter(v => !v.mounted && v.deviceId);
    if (nameHint) {
      const byName = unmounted.find(v => v.name === nameHint);
      if (byName) return byName;
    }
    if (unmounted.some(v => v.deviceId === currentId)) return null;
    return unmounted.length === 1 ? unmounted[0] : null;
  };

  const MAX_ATTEMPTS = 3;
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  console.log(`[gvfs] mount start deviceId=${deviceId} name=${nameHint ?? ''}`);

  let result = await tryMountGvfs(deviceId);
  let currentId = deviceId;

  // 超时后 gvfsd 仍需数秒收尾：观察间隔拉长
  const delays = result.code === 'TIMEOUT' ? [2000, 3000, 4000] : [1200, 1800, 2500];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (result.success && result.mountpoint) return result;

    await sleep(delays[attempt] ?? 2500);
    const nowMounted = await findMounted(currentId);
    if (nowMounted?.mountpoint) {
      console.log(`[gvfs] mount done (observed) currentId=${currentId} mountpoint=${nowMounted.mountpoint} attempt=${attempt}`);
      return { success: true, mountpoint: nowMounted.mountpoint };
    }

    if (result.success) continue; // 已成功，只等挂载点出现

    const fresh = await findFresh(currentId);
    if (fresh?.deviceId && fresh.deviceId !== currentId) {
      console.log(`[gvfs] mount retry with drifted id: ${currentId} -> ${fresh.deviceId}`);
      currentId = fresh.deviceId;
    }
    result = await tryMountGvfs(currentId);
  }

  // 观察循环耗尽后最后补查一次
  if (result.success && !result.mountpoint) {
    const now = await findMounted(currentId);
    if (now?.mountpoint) return { success: true, mountpoint: now.mountpoint };
  }
  console.log(`[gvfs] mount final result=${JSON.stringify(result)}`);
  return result;
}

/** 平铺 WM 名称白名单（跟随系统时自定义标题栏隐藏） */
const TILING_WMS = new Set([
  'niri', 'hyprland', 'sway', 'i3', 'qtile', 'awesome', 'dwm', 'bspwm',
  'xmonad', 'river', 'spectrwm', 'herbstluftwm', 'leftwm', 'dusk',
]);

/** 常规（堆叠式）桌面环境白名单（标题栏显示） */
const STACKING_DESKTOPS = new Set([
  'gnome', 'kde', 'plasma', 'xfce', 'cinnamon', 'mate', 'budgie', 'lxde',
  'lxqt', 'pantheon', 'deepin', 'unity', 'openbox', 'fluxbox', 'labwc',
  'wayfire', 'weston', 'enlightenment', 'gnome-classic', 'unity:unity7',
]);

/** 窗口管理器检测结果 */
export interface WindowManagerResult {
  /** 窗口管理类型：tiling = 平铺（隐藏自定义标题栏），stacking = 常规桌面 */
  kind: 'tiling' | 'stacking';
  /** 检测来源：XDG_CURRENT_DESKTOP / XDG_SESSION_DESKTOP / fallback */
  source: 'xdg_current_desktop' | 'xdg_session_desktop' | 'fallback';
  /** 检测到的桌面环境名称（未归一，供 UI 显示） */
  name?: string;
}

/**
 * 检测窗口管理器类型（自定义标题栏「跟随系统」模式的依据）。
 * 探测链：XDG_CURRENT_DESKTOP → XDG_SESSION_DESKTOP（取值可为冒号
 * 分隔的列表，逐项归一后查白名单）；平铺命中优先于常规命中；
 * 全部未命中时 fallback 常规桌面（标题栏显示）。
 */
function detectWindowManager(): WindowManagerResult {
  for (const [source, value] of [
    ['xdg_current_desktop', process.env.XDG_CURRENT_DESKTOP],
    ['xdg_session_desktop', process.env.XDG_SESSION_DESKTOP],
  ] as const) {
    if (!value) continue;
    const names = value.split(':').map((s) => s.trim()).filter(Boolean);
    for (const rawName of names) {
      const name = rawName.replace(/^x-/, '').toLowerCase();
      if (TILING_WMS.has(name)) return { kind: 'tiling', source, name: rawName };
    }
    for (const rawName of names) {
      const name = rawName.replace(/^x-/, '').toLowerCase();
      if (STACKING_DESKTOPS.has(name)) return { kind: 'stacking', source, name: rawName };
    }
  }
  return { kind: 'stacking', source: 'fallback' };
}

// ── 后端总线名冲突诊断（方案 B：运行时版本探测）──
// 注册总线名失败（被占用）时探测占名者版本，识别「旧版常驻仍在
// 应答」/「僵尸占名无响应」两类升级接管问题（探测逻辑见 backendInfo.ts）。

/** 冲突探测缓存：首次发起后复用（注册只发生一次，探测结果稳定） */
let backendConflictsPromise: Promise<BackendConflictInfo[]> | null = null;

/** 各后端的探测目标（总线名 / 对象路径 / 接口名，与后端注册参数一致） */
const BACKEND_PROBE_TARGETS: Record<BackendKind, {
  busName: string;
  objectPath: string;
  ifaceName: string;
}> = {
  portal: {
    busName: PORTAL_BUS_NAME,
    objectPath: PORTAL_FILE_CHOOSER_PATH,
    ifaceName: PORTAL_FILE_CHOOSER_IFACE,
  },
  fileManager1: {
    busName: FILE_MANAGER1_NAME,
    objectPath: FILE_MANAGER1_PATH,
    ifaceName: FILE_MANAGER1_IFACE,
  },
};

/**
 * 探测全部指定后端并生成报告（并行，单探测最长 3s 超时，
 * 见 BACKEND_CONFLICT_QUERY_TIMEOUT_MS）。探测不冲突（名字已释放）
 * 的后端不进报告。
 *
 * @param kinds - 注册失败的后端类型
 * @returns 冲突报告（未诊断出的条目被过滤）
 */
async function probeBackendConflicts(kinds: BackendKind[]): Promise<BackendConflictInfo[]> {
  const results = await Promise.all(kinds.map(async (kind) => {
    const target = BACKEND_PROBE_TARGETS[kind];
    const probe = await queryBackendConflict(target.busName, target.objectPath, target.ifaceName);
    return probe ? { backend: kind, busName: target.busName, ...probe } : null;
  }));
  return results.filter((r): r is BackendConflictInfo => r !== null);
}

/**
 * 启动后端总线名冲突探测（幂等：并发调用共享同一 Promise，结果缓存）。
 * 注册失败后由 main.ts 调用（GUI 模式）；探测完成后每个冲突输出
 * console.error（含占名者版本与状态，便于终端定位）。
 *
 * @param kinds - 注册失败的后端类型
 * @returns 冲突报告（渲染进程经 system:get-backend-conflicts 获取）
 */
export function startBackendConflictQuery(kinds: BackendKind[]): Promise<BackendConflictInfo[]> {
  if (!backendConflictsPromise) {
    backendConflictsPromise = probeBackendConflicts(kinds).then((report) => {
      for (const conflict of report) {
        console.error(
          `[backend-conflict] ${conflict.backend} 总线名 ${conflict.busName} 被占用：` +
          `state=${conflict.state}` +
          `${conflict.remoteVersion ? ` remoteVersion=${conflict.remoteVersion}` : ''}` +
          ` appVersion=${conflict.appVersion}` +
          (conflict.state === 'outdated' || conflict.state === 'noVersion'
            ? '（旧版常驻仍在应答，建议卸载重装以接管）'
            : conflict.state === 'unresponsive'
              ? '（占名者无响应，疑似残留进程，建议重装或重启会话总线）'
              : ''),
        );
      }
      return report;
    });
  }
  return backendConflictsPromise;
}

/**
 * 作废冲突探测缓存（会话总线重启后调用）：占名状态已随总线重建改变，
 * 下一次 startBackendConflictQuery 重新探测、渲染进程重新获取报告。
 */
export function resetBackendConflictCache(): void {
  backendConflictsPromise = null;
}

/**
 * 注册 system 相关 IPC handler。
 *
 * @param onSessionBusRestarted - 会话总线重启成功后的回调（main.ts 注入：
 *   重新注册 D-Bus 服务后端并作废冲突探测缓存；e2e harness 不注入）
 */
export function registerSystemHandlers(onSessionBusRestarted?: () => void) {
  /** 窗口管理器类型检测（自定义标题栏跟随系统模式） */
  ipcMain.handle('system:detect-window-manager', () => detectWindowManager());

  /** 用户级桌面入口（「设为默认文件管理器」时安装，xdg-mime 关联才能生效） */
  const USER_APPS_DIR = path.join(os.homedir(), '.local', 'share', 'applications');
  const DESKTOP_ENTRY_NAME = 'HoshinekoFM.desktop';
  /** 系统集成安装的固定路径（install.sh root 级安装的 D-Bus 激活执行体） */
  const SYSTEM_BIN_PATH = '/usr/local/bin/HoshinekoFM';
  /** 用户级固定副本路径（install.sh 用户级部分安装，防原始 AppImage 被删） */
  const userBinPath = path.join(os.homedir(), '.local', 'bin', 'HoshinekoFM');
  /** portal 配置目录（install.sh 同款覆盖：HOSHINEKO_PORTALS_DIR，测试沙箱用） */
  const PORTALS_DIR = process.env.HOSHINEKO_PORTALS_DIR || '/usr/share/xdg-desktop-portal/portals';
  /** 安装脚本写入的版本号文件（启动时与 app.getVersion() 比对，见
   *  system:get-portal-runtime-info） */
  const PORTAL_VERSION_FILE = path.join(PORTALS_DIR, 'hoshineko.version');

  /** 生成桌面入口内容：Exec 按环境选择——
   *  固定安装路径（系统级 /usr/local/bin/HoshinekoFM 优先，其次用户级
   *  ~/.local/bin/HoshinekoFM）存在时用固定路径（防原始 AppImage 被移动/
   *  删除后默认打开失效）；否则 AppImage 用 APPIMAGE 路径；开发环境
   *  = `<electron> "<appPath>" %U`（只写 electron 二进制路径会启动空白
   *  窗口，必须带应用路径参数） */
  const buildDesktopEntry = () => {
    const fixedBin = existsSync(SYSTEM_BIN_PATH)
      ? SYSTEM_BIN_PATH
      : existsSync(userBinPath)
        ? userBinPath
        : null;
    const execLine = fixedBin
      ? `Exec="${fixedBin}" %U`
      : process.env.APPIMAGE
        ? `Exec="${process.env.APPIMAGE}" %U`
        : `Exec="${process.execPath}" "${app.getAppPath()}" %U`;
    const iconLine = process.env.APPIMAGE
      ? '' // AppImage 集成通常自带 .desktop 与图标
      : `Icon=${path.join(app.getAppPath(), 'assets', 'icon.png')}`;
    return (
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=HoshinekoFM',
        'Comment=Hoshineko File Manager',
        execLine,
        iconLine,
        'Terminal=false',
        'StartupWMClass=HoshinekoFM',
        'MimeType=inode/directory;',
        'Categories=Utility;FileManager;',
        '',
      ].filter((line) => line !== '').join('\n') + '\n'
    );
  };

  /**
   * 查询 inode/directory 的当前默认处理程序。
   * 优先解析用户级 mimeapps.list 的 [Default Applications] 条目
   * （GIO 实际采用、且 `xdg-mime query default` 在该环境存在
   * 不更新读值的怪癖）；解析失败时回退 xdg-mime query。
   */
  ipcMain.handle('system:get-dir-mime-handler', async () => {
    const mimeappsPath = path.join(os.homedir(), '.config', 'mimeapps.list');
    try {
      const content = await fs.readFile(mimeappsPath, 'utf-8');
      let inDefaultSection = false;
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
          inDefaultSection = trimmed === '[Default Applications]';
          continue;
        }
        if (!inDefaultSection) continue;
        const m = trimmed.match(/^inode\/directory=(.+)$/);
        if (m) {
          const handler = m[1].trim();
          if (handler) return { success: true, handler };
        }
      }
    } catch {
      /* 文件不存在：回退 xdg-mime */
    }
    try {
      const { stdout } = await execAsync('xdg-mime query default inode/directory');
      const handler = stdout.trim();
      return { success: true, handler: handler || null };
    } catch {
      return { success: false, handler: null };
    }
  });

  /**
   * 系统集成状态检测：portal 配置、两个 D-Bus 激活文件与 portals.conf
   * 是否存在（设置内显示安装状态）。portalsConf 为内容检测：文件里
   * 是否包含 preferred=hoshineko 项（仅存在文件不算已配置）。
   */
  const getIntegrationStatus = async (): Promise<{
    portalConfig: boolean;
    fileManager1Service: boolean;
    portalService: boolean;
    portalsConf: boolean;
  }> => {
    const exists = async (p: string) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    };
    const home = os.homedir();
    let portalsConf: boolean;
    try {
      const content = await fs.readFile(
        path.join(home, '.config', 'xdg-desktop-portal', 'portals.conf'),
        'utf-8',
      );
      portalsConf = content.includes('org.freedesktop.impl.portal.FileChooser=hoshineko');
    } catch {
      portalsConf = false;
    }
    return {
      portalConfig: await exists(path.join(PORTALS_DIR, 'hoshineko.portal')),
      fileManager1Service: await exists('/usr/share/dbus-1/services/org.freedesktop.FileManager1.service'),
      portalService: await exists('/usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.hoshineko.service'),
      portalsConf,
    };
  };

  ipcMain.handle('system:get-system-integration-status', () => getIntegrationStatus());

  /**
   * 后端总线名冲突报告（注册失败时由 main.ts 发起探测；未发起/无冲突
   * 返回空数组）。设置页「系统集成」据此提示「旧版常驻/无响应」状态。
   */
  ipcMain.handle('system:get-backend-conflicts', () =>
    backendConflictsPromise ?? Promise.resolve([] as BackendConflictInfo[]),
  );

  /**
   * 重启会话总线（清除僵尸占名）：
   * 会话总线名被已死进程泄漏的连接占有时（unresponsive 冲突态），无
   * 进程级手段可释放——只能重建会话总线。按发行版实现依次尝试
   * dbus-broker.service / dbus.service（用户级 systemctl restart）。
   *
   * 注意：总线重启会断开**所有**应用的会话 D-Bus 连接（包括本应用
   * 自身的后端连接）——后端已挂 error 监听防崩溃，成功后经
   * onSessionBusRestarted 回调延迟重新注册（main.ts 注入）。
   * 单次尝试 30s 超时（systemctl 在异常总线状态下可能挂起）。
   *
   * @returns success 与所用服务名；失败附 stderr 摘要
   */
  ipcMain.handle('system:restart-session-bus', async () => {
    const candidates = ['dbus-broker.service', 'dbus.service'];
    let lastError = '';
    for (const service of candidates) {
      try {
        const { stdout, stderr } = await execFileAsync(
          'systemctl', ['--user', 'restart', service], { timeout: 30_000 },
        );
        console.log(`[system] 会话总线已重启（${service}）：${stdout.trim()}${stderr.trim() ? ` stderr: ${stderr.trim()}` : ''}`);
        // 总线重建需要数秒：延迟回调让 main.ts 重新注册后端、
        // 作废冲突缓存（见 resetBackendConflictCache）
        setTimeout(() => {
          onSessionBusRestarted?.();
        }, 2500);
        return { success: true, service, output: stdout.trim() };
      } catch (e) {
        lastError = getExecError(e).message;
        console.error(`[system] 重启会话总线失败（${service}）：${lastError}`);
      }
    }
    return { success: false, error: lastError };
  });

  /**
   * 运行系统集成脚本（install.sh / uninstall.sh）并收集输出。
   * 打包版脚本与 packaging 配置经 asarUnpack 解包到
   * `resources/app.asar.unpacked`（spawn 不能执行 asar 内文件，
   * 且 bash 需要真实文件系统里的 packaging 目录）。
   *
   * AppImage 经 FUSE 挂载运行时，挂载点对 root 不可见：pkexec 以
   * root 重入执行脚本会 EACCES。因此先把脚本与 packaging 复制到
   * 真实文件系统的临时目录（/tmp，root 可访问），脚本执行结束后清理。
   *
   * @param scriptName - scripts/system-integration 下的脚本文件名
   * @param args - 传给脚本的参数（[] = 完整执行含 pkexec 重入）
   * @returns 执行结果；code：NO_SCRIPT / SCRIPT_FAILED / SCRIPT_TIMEOUT
   *   （10 分钟硬超时兜底——脚本内系统命令挂起时强制终止并返回）
   */
  const runIntegrationScript = async (
    scriptName: string,
    args: string[],
  ): Promise<{ success: boolean; code?: string; output: string; error: string }> => {
    // 开发分支用编译产物 __dirname 锚定仓库根（dist-electron/handlers →
    // 仓库根）：e2e harness 里 app.getAppPath() 是 scripts/e2e，不能直接用。
    const baseDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : path.join(__dirname, '..', '..');
    const srcScript = path.join(baseDir, 'scripts', 'system-integration', scriptName);
    const srcScriptDir = path.dirname(srcScript);
    const srcPackaging = path.join(baseDir, 'packaging');
    try {
      await fs.access(srcScript);
    } catch {
      return { success: false, code: 'NO_SCRIPT', output: '', error: `${scriptName} 不存在` };
    }
    const runDir = await fs
      .mkdtemp(path.join(os.tmpdir(), 'hoshineko-integration-'))
      .catch(() => null);
    if (runDir === null) {
      return { success: false, code: 'NO_SCRIPT', output: '', error: '创建临时目录失败' };
    }
    try {
      // 源脚本自带执行位，fs.cp 默认保留源文件 mode（勿传 mode 选项：
      // Node 22 对 fs.cp 的 mode 校验会拒绝 0o755 这类完整权限值）
      await fs.cp(srcScript, path.join(runDir, scriptName));
      // reinstall.sh 会 source 同目录的 install.sh / uninstall.sh 复用
      // 函数（单次 pkexec 合并卸载+安装）：依赖脚本必须一并复制，
      // 否则 source 行直接「没有那个文件或目录」失败
      if (scriptName === 'reinstall.sh') {
        for (const dep of ['install.sh', 'uninstall.sh']) {
          await fs.cp(path.join(srcScriptDir, dep), path.join(runDir, dep));
        }
      }
      await fs.cp(srcPackaging, path.join(runDir, 'packaging'), { recursive: true });
    } catch (e) {
      void fs.rm(runDir, { recursive: true, force: true }).catch(() => { /* 清理失败忽略 */ });
      return {
        success: false,
        code: 'NO_SCRIPT',
        output: '',
        error: `复制 ${scriptName} 到临时目录失败：${getExecError(e).message}`,
      };
    }
    const scriptPath = path.join(runDir, scriptName);
    const packagingDir = path.join(runDir, 'packaging');
    /** 清理临时目录（脚本执行结束后调用，IPC 返回前保证完成） */
    const cleanup = () =>
      fs.rm(runDir, { recursive: true, force: true }).catch(() => { /* 清理失败忽略 */ });
    // 脚本级硬超时兜底：会话总线/portal 单元状态异常时脚本内的系统命令
    // （如 systemctl restart）可能挂起，导致 IPC 永不返回、设置页按钮一直
    // 忙碌禁用。10 分钟足够覆盖 pkexec 交互授权耗时。
    const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
    return new Promise((resolve) => {
      // detached：独立进程组——超时时 kill(-pid) 连带杀掉脚本内的
      // pkexec/systemctl 子进程，且不会误伤应用自身进程组
      const child = spawn(scriptPath, args, {
        env: { ...process.env, HOSHINEKO_PACKAGING_DIR: packagingDir, HOSHINEKO_VERSION: app.getVersion() },
        detached: true,
      });
      let settled = false;
      let output = '';
      let error = '';
      const settle = (result: {
        success: boolean;
        code?: 'NO_SCRIPT' | 'SCRIPT_FAILED' | 'SCRIPT_TIMEOUT';
        output: string;
        error: string;
      }) => {
        if (settled) return;
        settled = true;
        void cleanup().finally(() => resolve(result));
      };
      const killTimer = setTimeout(() => {
        // 超时：杀进程组（脚本内的 pkexec/systemctl 子进程一并清理）
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        settle({
          success: false,
          code: 'SCRIPT_TIMEOUT',
          output,
          error: `${error}\n[超时] ${scriptName} 执行超过 ${SCRIPT_TIMEOUT_MS / 60000} 分钟，已强制终止`,
        });
      }, SCRIPT_TIMEOUT_MS);
      child.stdout.on('data', (d) => (output += String(d)));
      child.stderr.on('data', (d) => (error += String(d)));
      child.on('error', (e) => {
        clearTimeout(killTimer);
        settle({ success: false, output, error: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        settle({
          success: code === 0,
          code: code === 0 ? undefined : 'SCRIPT_FAILED',
          output,
          error,
        });
      });
    });
  };

  /**
   * 一键安装系统集成（幂等脚本）：
   * - root 级：portal 配置 + D-Bus 激活文件 → 经 pkexec 授权；
   * - 用户级：portals.conf preferred 项、xdg-mime 关联、portal 服务重启。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:install-system-integration', async (_event, userOnly: unknown) => {
    return runIntegrationScript('install.sh', userOnly === true ? ['--user-only'] : []);
  });

  /**
   * 一键卸载系统集成（幂等脚本，install.sh 的逆操作）：
   * - root 级：移除 portal 配置 + D-Bus 激活文件 → 经 pkexec 授权；
   * - 用户级：移除 portals.conf preferred 项、portal 服务重启。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:uninstall-system-integration', async (_event, userOnly: unknown) => {
    return runIntegrationScript('uninstall.sh', userOnly === true ? ['--user-only'] : []);
  });

  /**
   * 一键重装系统集成（版本不一致弹窗「一键重装」按钮的执行体）：
   * reinstall.sh 把卸载 + 安装合并为单次 pkexec 授权（分别跑两个脚本
   * 会各弹一次密码框；见 scripts/system-integration/reinstall.sh）。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:reinstall-system-integration', async (_event, userOnly: unknown) => {
    return runIntegrationScript('reinstall.sh', userOnly === true ? ['--user-only'] : []);
  });

  /**
   * portal 运行时诊断信息（启动版本检查 + 开发模式详情弹窗用）：
   * - 版本对比：安装脚本写入的 hoshineko.version vs app.getVersion()。
   *   仅当版本号文件存在时才比较——文件缺失视为「portal 未被新版
   *   安装流程安装过」（旧流程残留/不完整安装），不弹版本弹窗；
   * - 集成状态：portal 配置/激活文件/portals.conf 存在性；
   * - 后端注册结果：本进程最近一次 registerServiceBackends 的结果
   *   （会话总线重启后的重新注册会更新）；
   * - 冲突报告：总线名被占用时的诊断缓存（未发起探测返回空数组）。
   */
  ipcMain.handle('system:get-portal-runtime-info', async () => {
    const integration = await getIntegrationStatus();
    let installedVersion: string | null = null;
    try {
      const content = await fs.readFile(PORTAL_VERSION_FILE, 'utf-8');
      installedVersion = content.trim() || null;
    } catch { /* 版本文件不存在：旧流程安装/残留，不弹版本弹窗 */ }
    const appVersion = app.getVersion();
    const conflicts = await (backendConflictsPromise ?? Promise.resolve([] as BackendConflictInfo[]));
    return {
      isPackaged: app.isPackaged,
      appVersion,
      portalInstalled: integration.portalConfig,
      installedVersion,
      versionMismatch:
        integration.portalConfig && installedVersion !== null && installedVersion !== appVersion,
      portalsDir: PORTALS_DIR,
      versionFilePath: PORTAL_VERSION_FILE,
      integration,
      registration: getLastBackendRegistration(),
      conflicts,
    };
  });
  /**
   * 设置 inode/directory 的默认处理程序（xdg-mime default，写用户级
   * mimeapps.list，无需 root）。handler 为 HoshinekoFM.desktop 时先
   * 确保用户级桌面入口存在（xdg-mime 才能关联成功）。
   * handler 白名单校验：`*.desktop` 文件名形态。
   */
  ipcMain.handle('system:set-dir-mime-handler', async (_, handler: string) => {
    if (typeof handler !== 'string' || !/^[A-Za-z0-9._-]+\.desktop$/.test(handler)) {
      return { success: false, error: 'invalid handler' };
    }
    try {
      if (handler === DESKTOP_ENTRY_NAME) {
        await fs.mkdir(USER_APPS_DIR, { recursive: true });
        await fs.writeFile(path.join(USER_APPS_DIR, DESKTOP_ENTRY_NAME), buildDesktopEntry(), 'utf-8');
      }
      await execAsync(`xdg-mime default "${handler}" inode/directory`);
      return { success: true };
    } catch (e) {
      return { success: false, error: getExecError(e).message };
    }
  });

  /**
   * 清除 inode/directory 对本应用的默认关联（「恢复为系统默认」无
   * 记录时的兜底路径——如系统集成安装脚本直接写 xdg-mime 关联、未
   * 经过设置按钮记录原处理程序）。从用户级 mimeapps.list 两处
   * （XDG 配置目录与本地数据目录）移除 [Default Applications] 的
   * HoshinekoFM.desktop 行与 [Added Associations] 中的对应项，
   * 清除后默认回落系统级配置。文件不存在视为已清除。
   *
   * @returns success 恒为 true；changed 表示是否实际改动过文件
   */
  ipcMain.handle('system:clear-dir-mime-handler', async () => {
    const files = [
      path.join(os.homedir(), '.config', 'mimeapps.list'),
      path.join(USER_APPS_DIR, 'mimeapps.list'),
    ];
    let changed = false;
    for (const file of files) {
      let content: string;
      try {
        content = await fs.readFile(file, 'utf-8');
      } catch {
        continue;
      }
      let fileChanged = false;
      let section = '';
      const out: string[] = [];
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
          section = trimmed;
          out.push(line);
          continue;
        }
        if (section === '[Default Applications]' && /^inode\/directory\s*=\s*HoshinekoFM\.desktop\s*$/.test(trimmed)) {
          fileChanged = true;
          continue;
        }
        if (section === '[Added Associations]') {
          const m = trimmed.match(/^inode\/directory\s*=\s*(.+)$/);
          if (m) {
            const apps = m[1]
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s.length > 0 && s !== DESKTOP_ENTRY_NAME);
            if (apps.length !== m[1].split(';').filter((s) => s.trim()).length) {
              fileChanged = true;
            }
            if (apps.length === 0) continue;
            out.push(`inode/directory=${apps.join(';')};`);
            continue;
          }
        }
        out.push(line);
      }
      if (fileChanged) {
        await fs.writeFile(file, out.join('\n'), 'utf-8');
        changed = true;
      }
    }
    return { success: true, changed };
  });
  ipcMain.handle('system:get-apps', async () => {
    if (appsCache) return appsCache;

    const apps: { name: string; icon: string; exec: string; desktopFile: string; }[] = [];
    const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(os.homedir(), '.local/share/applications')];

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.desktop')) {
            try {
              const desktopPath = path.join(dir, file);
              const content = await fs.readFile(desktopPath, 'utf-8');
              const nameMatch = content.match(/^Name=(.*)$/m);
              const iconMatch = content.match(/^Icon=(.*)$/m);
              const execMatch = content.match(/^Exec=(.*)$/m);

              if (nameMatch && execMatch) {
                const name = nameMatch[1];
                const execCmd = execMatch[1].replace(/%[fFuUikc]/g, '').trim();
                const icon = iconMatch ? iconMatch[1] : '';
                apps.push({ name, icon, exec: execCmd, desktopFile: desktopPath });
              }
            } catch { /* continue */ }
          }
        }
      } catch { /* continue */ }
    }

    appsCache = apps.sort((a, b) => a.name.localeCompare(b.name));
    return appsCache;
  });

  /**
   * Open a file with a chosen application.
   *
   * When the original `.desktop` file is available it is preferred to launch
   * through `gio launch`, which resolves the same desktop environment as
   * double-click (`shell.openPath`/xdg-open). Spawning the raw `Exec=` line
   * directly can drop session environment variables, making apps started via
   * "Open with" behave differently from double-click.
   *
   * Falls back to spawning the Exec line with proper field-code substitution
   * when GIO is unavailable or no desktop file was provided.
   */
  ipcMain.handle('system:open-with', async (_, execPath: string, filePath: string, desktopFile?: string) => {
    if (desktopFile) {
      try {
        await execFileAsync('gio', ['launch', desktopFile, filePath]);
        return true;
      } catch (gioErr) {
        console.warn('gio launch failed, falling back to direct spawn:', getExecError(gioErr).message);
      }
    }

    let cwd: string | undefined;
    if (desktopFile) {
      try {
        const content = await fs.readFile(desktopFile, 'utf-8');
        const pathMatch = content.match(/^Path=(.*)$/m);
        if (pathMatch && pathMatch[1].trim()) {
          cwd = pathMatch[1].trim().replace(/^~(?=$|\/)/, os.homedir());
        }
      } catch { /* continue */ }
    }

    // Substitute Desktop Entry field codes per spec: %f/%F/%u/%U become the
    // file path, the remaining codes (%d/%D/%n/%N/%i/%c/%k/%v/%m) are removed.
    // `%%` is escaped to a literal `%`.
    const quotedPath = `"${filePath.replace(/"/g, '\\"')}"`;
    let cmdLine: string;
    if (execPath.includes('%')) {
      cmdLine = execPath.replace(/%%|%[fFuUdDnNickvm]/g, (match, code) => {
        if (match === '%%') return '%';
        return (code === 'f' || code === 'F' || code === 'u' || code === 'U') ? quotedPath : '';
      });
    } else {
      cmdLine = `${execPath} ${quotedPath}`;
    }

    return new Promise((resolve) => {
      try {
        const child = spawn(cmdLine, [], {
          detached: true,
          stdio: 'ignore',
          shell: true,
          cwd,
          env: { ...process.env }
        });
        child.on('error', (err: Error) => {
          resolve(err.message);
        });
        child.on('spawn', () => {
          child.unref();
          resolve(true);
        });
      } catch (e) {
        resolve(getExecError(e).message);
      }
    });
  });

  /**
   * 在系统默认终端中打开目录。
   *
   * 实现为「在终端里执行 `sh -c 'cd "$1" && exec "$SHELL"' sh <dir>`」：
   * 命令会被单实例/CS 架构的终端（ghostty 等）可靠转发，
   * 而 `--working-directory` 类标志与 spawn cwd 在这类终端上会被丢弃
   * （窗口继承 server 进程的 cwd）。spawn cwd 仍一并设置作为兜底。
   *
   * 返回 `{ success: false, code: 'NO_TERMINAL' }` 表示未找到默认终端，
   * `{ success: false, code: 'NOT_DIRECTORY' / 'NOT_FOUND' }` 表示目录无效，
   * 由渲染端按错误码翻译提示。
   */
  ipcMain.handle('system:open-terminal', async (_event, dir: string) => {
    try {
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) return { success: false, code: 'NOT_DIRECTORY' };
    } catch {
      return { success: false, code: 'NOT_FOUND' };
    }

    const terminal = await getDefaultTerminal();
    if (!terminal) return { success: false, code: 'NO_TERMINAL' };

    // sh -c 'cd "$1" && exec "${SHELL:-bash}"' sh <dir>
    // $1 以 argv 传递，目录含空格/引号时无需转义
    const shellArgv = ['sh', '-c', 'cd "$1" && exec "${SHELL:-bash}"', 'sh', dir];

    if (terminal.delegate) {
      // xdg-terminal-exec 负责挑选终端并正确构造参数
      const result = await spawnDetached(terminal.command, shellArgv);
      return result === true ? { success: true } : { success: false, error: result };
    }

    const args = terminal.spec?.exec ? terminal.spec.exec(shellArgv) : ['-e', ...shellArgv];
    const result = await spawnDetached(terminal.command, args, dir);
    return result === true ? { success: true } : { success: false, error: result };
  });

  ipcMain.handle('system:get-drives', async () => {
    try {
      const { stdout } = await execAsync('lsblk --json -o NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM');
      const data = JSON.parse(stdout);
      const devices = data.blockdevices || [];

      const drives: DriveInfo[] = [];
      const processDevice = (dev: LsblkDevice) => {
        if (dev.mountpoint) {
          drives.push({
            name: dev.name,
            label: dev.label || dev.name,
            mountpoint: dev.mountpoint,
            size: dev.size,
            type: dev.type,
            removable: dev.rm || dev.tran === 'usb',
            usb: dev.tran === 'usb'
          });
        }
        if (dev.children) {
          dev.children.forEach(processDevice);
        }
      };

      devices.forEach(processDevice);
      return drives.filter(d => d.removable || d.mountpoint.startsWith('/run/media'));
    } catch (e) {
      console.error('Failed to get drives', e);
      return [];
    }
  });

  ipcMain.handle('system:get-storage-usage', async () => {
    try {
      const { stdout } = await execAsync('df -kP /');
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return null;

      const parts = lines[1].split(/\s+/);
      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      const free = parseInt(parts[3]) * 1024;

      return { total, used, free };
    } catch (e) {
      console.error('Failed to get storage usage', e);
      return null;
    }
  });

  /**
   * 批量查询路径所属文件系统的存储占用（statfs，按查询路径逐条返回）。
   * 前端仪表盘用：系统（/）、家目录、已挂载外接设备（含 gvfs FUSE 挂载点）
   * 一次 IPC 批量获取。statfs 返回整个文件系统的块统计——/home 与 / 同分区
   * 时两条数值相同（前端按需决定是否都展示）。
   * 单条失败（路径不存在/无权限）跳过该条目，不影响其余。
   */
  ipcMain.handle('system:get-storage-usages', async (_event, paths: unknown) => {
    try {
      if (!Array.isArray(paths)) return [];
      const list = paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (list.length === 0) return [];

      const results: Array<{ path: string; total: number; used: number; free: number }> = [];
      for (const p of list) {
        try {
          const s = await fs.statfs(p);
          results.push({
            path: p,
            total: s.blocks * s.bsize,
            used: (s.blocks - s.bfree) * s.bsize,
            free: s.bavail * s.bsize,
          });
        } catch {
          // 该路径已不存在（设备刚拔出）或无权限：跳过
        }
      }
      return results;
    } catch (e) {
      console.error('Failed to get storage usages', e);
      return [];
    }
  });

  ipcMain.handle('system:get-all-devices', async () => getAllDevices());

  ipcMain.handle('system:has-device-watcher', async () => udisks2Available);

  /**
   * 缩略图缓存占用统计（设置页「缩略图缓存」行副标题显示）。
   * 目录不存在/读取失败返回全 0。
   */
  ipcMain.handle('system:get-thumbnail-cache-info', async () => getThumbnailCacheInfo());

  /**
   * 清空缩略图缓存（整目录删除后重建空目录）。
   * 返回清除前的文件数与释放字节数，供前端 toast 提示。
   */
  ipcMain.handle('system:clear-thumbnail-cache', async () => clearThumbnailCache());

  /**
   * 当前 gvfs 会话设备列表（MTP 手机 / PTP 相机，含未挂载卷）。
   * 前端侧边栏与块设备列表合并展示。
   */
  ipcMain.handle('system:get-gvfs-volumes', async () => listGvfsVolumes());

  /**
   * 挂载一个未挂载的 gvfs 卷（`gio mount -d <unix-device>`）。
   * 设备标识必须位于 /dev/bus 下，防止任意路径被传给 gio。
   * 用 {@link mountGvfsRobust} 处理 USB 地址漂移与自动挂载竞态。
   */
  ipcMain.handle('system:mount-gvfs', async (_event, deviceId: string, nameHint?: string) => {
    if (typeof deviceId !== 'string' || !deviceId.startsWith('/dev/bus/')) {
      return { success: false, code: 'INVALID_DEVICE' };
    }
    return mountGvfsRobust(deviceId, typeof nameHint === 'string' ? nameHint : undefined);
  });

  /**
   * 卸载一个 gvfs 会话挂载（`gio mount -u`）。
   * 挂载点必须位于 gvfs 根目录下，防止任意路径被传给 gio。
   */
  ipcMain.handle('system:unmount-gvfs', async (_event, mountpoint: string) => {
    if (typeof mountpoint !== 'string' || !mountpoint.startsWith(getGvfsRoot() + path.sep)) {
      return { success: false, error: 'Invalid mountpoint' };
    }
    try {
      await execFileAsync('gio', ['mount', '-u', mountpoint]);
      return { success: true };
    } catch (e) {
      const { stderr, message } = getExecError(e);
      return { success: false, error: stderr || message || 'Unmount failed' };
    }
  });

  ipcMain.handle('system:get-mount-map', async () => {
    const map = await getMountMap();
    const result: Record<string, { source: string; fstype: string }> = {};
    for (const [k, v] of map) {
      result[k] = v;
    }
    return result;
  });

  ipcMain.handle('system:mount-device', async (_event, devicePath: string) => {
    try {
      const { stdout, stderr } = await execAsync(`udisksctl mount -b "${devicePath}"`);
      const mountMatch = stdout.match(/Mounted .+ at (.+)/);
      if (mountMatch) {
        invalidateMountMapCache();
        return { success: true, mountpoint: mountMatch[1].trim() };
      }
      const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
      if (alreadyMatch) {
        invalidateMountMapCache();
        return { success: true, mountpoint: alreadyMatch[1] };
      }
      return { success: false, error: stderr || 'Unknown error' };
    } catch (e) {
      const { stderr } = getExecError(e);
      const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
      if (alreadyMatch) {
        invalidateMountMapCache();
        return { success: true, mountpoint: alreadyMatch[1] };
      }
      return { success: false, error: stderr || getExecError(e).message || 'Mount failed' };
    }
  });

  ipcMain.handle('system:unmount-device', async (_event, devicePath: string) => {
    try {
      await execAsync(`udisksctl unmount -b "${devicePath}"`);
      invalidateMountMapCache();
      return { success: true };
    } catch (e) {
      const { stderr, message } = getExecError(e);
      return { success: false, error: stderr || message || 'Unmount failed' };
    }
  });

  /**
   * 判断挂载源（/proc/mounts 的 source 字段）是否属于某个磁盘的分区：
   * `/dev/sda1`、`/dev/nvme0n1p1`、`/dev/mmcblk0p1` 分别属于对应磁盘。
   * 用「后缀 p?数字」匹配而非前缀 startsWith——后者会把 `/dev/sdab`
   * 误判为 `/dev/sda` 的分区（多盘环境罕见但存在）。
   * 磁盘本身被整体挂载时（source === devicePath，rest 为空）不算分区。
   */
  function isPartitionSourceOf(source: string, diskPath: string): boolean {
    if (!source.startsWith(diskPath)) return false;
    const rest = source.slice(diskPath.length);
    return /^p?\d+$/.test(rest);
  }

  /**
   * Eject (power off) a device. Fails with a `code` of `PARTITIONS_MOUNTED`
   * when the device still has mounted partitions — the renderer translates
   * the code instead of receiving a hardcoded message.
   * 预检必须读实时挂载表（getMountMap(true) 绕过 30s TTL 缓存）：
   * 卸载分区后立即弹出时，缓存可能仍是卸载前的旧表，
   * 会误报「分区仍挂载」。
   */
  ipcMain.handle('system:eject-device', async (_event, devicePath: string) => {
    try {
      const mountMap = await getMountMap(true);
      for (const [, info] of mountMap) {
        if (isPartitionSourceOf(info.source, devicePath)) {
          return { success: false, code: 'PARTITIONS_MOUNTED' };
        }
      }
      try {
        await execAsync(`udisksctl power-off -b "${devicePath}"`);
        invalidateMountMapCache();
        return { success: true };
      } catch (e) {
        const { stderr, message } = getExecError(e);
        // 预检通过但 udisks 仍拒绝（竞态/设备占用）：busy/mounted 类
        // 错误按「分区仍挂载」归类，前端给出同样明确的引导文案。
        if (/mount|busy/i.test(stderr)) {
          return { success: false, code: 'PARTITIONS_MOUNTED' };
        }
        return { success: false, error: stderr || message || 'Eject failed' };
      }
    } catch (e) {
      const { stderr, message } = getExecError(e);
      return { success: false, error: stderr || message || 'Eject failed' };
    }
  });

  ipcMain.handle('system:get-recommended-apps', async (_, filePath: string) => {
    try {
      const safePath = filePath.replace(/"/g, '\\"');
      const { stdout: mimeOut } = await execAsync(`xdg-mime query filetype "${safePath}"`);
      const mime = mimeOut.trim();
      if (!mime) return [];

      const searchPaths = [
        '/usr/share/applications',
        path.join(os.homedir(), '.local/share/applications'),
        '/var/lib/flatpak/exports/share/applications',
        path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')
      ];

      const appFiles = new Set<string>();
      for (const searchPath of searchPaths) {
        try {
          await fs.access(searchPath);
          const { stdout: grepOut } = await execAsync(`grep -l "${mime}" "${searchPath}"/*.desktop || true`);
          grepOut.split('\n').filter(Boolean).forEach(f => appFiles.add(f));
        } catch {
          // continue
        }
      }

      const apps: { name: string; icon: string | null; exec: string; path: string }[] = [];
      for (const file of appFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const nameMatch = content.match(/^Name=(.*)$/m);
          const iconMatch = content.match(/^Icon=(.*)$/m);
          const execMatch = content.match(/^Exec=(.*)$/m);
          const noDisplayMatch = content.match(/^NoDisplay=(.*)$/m);
          if (noDisplayMatch && noDisplayMatch[1].toLowerCase() === 'true') continue;

          if (nameMatch && execMatch) {
            const execCmd = execMatch[1].replace(/%[fFuUikc]/g, '').trim();
            apps.push({
              name: nameMatch[1],
              icon: iconMatch ? iconMatch[1] : null,
              exec: execCmd,
              path: file
            });
          }
        } catch { /* continue */ }
      }
      return apps;
    } catch (err) {
      console.error('Error getting recommended apps:', err);
      return [];
    }
  });

  /**
   * 把 find 的 -size 数值字符串翻倍（保留单位），用于 maxSize 过滤。
   *
   * find 的 -size 比较会把文件大小**向上取整**到目标单位：10 字节的
   * 文件在 MiB 单位下取整为 1M。因此 `-size -1M` 会把所有 ≤ 1MiB 的
   * 文件全部排除（它们取整后都等于 1M）——语义完全错误。取整后
   * `-size -2M` 恰好等价于「大小 ≤ 1M」，故把数值翻倍即可得到正确
   * 语义。单位不限（b/k/M/G/T 及默认 512 字节块），解析失败返回 null
   * （跳过该过滤，不生成错误的参数）。
   *
   * @param size - find 风格的大小字符串，如 '1M'、'500k'、'10'
   */
  function doubleSizeValue(size: string): string | null {
    const m = /^(\d+(?:\.\d+)?)([bckwMGTP]?)$/.exec(size.trim());
    if (!m) return null;
    const num = parseFloat(m[1]) * 2;
    const text = Number.isInteger(num)
      ? String(num)
      : num.toFixed(2).replace(/\.?0+$/, '');
    return text + m[2];
  }

  /**
   * 文件搜索（find -iname）：目录树中部分子目录无访问权限时 find 仍
   * 输出可访问部分的匹配结果、仅以退出码 1 与 stderr 报告权限问题——
   * 必须用 spawn 手动收集 stdout，不能在非零退出码时整体丢弃
   * （否则「/tmp 搜 proc」这类场景会因个别 systemd 私有目录而零结果）。
   * stderr（权限提示）静默忽略，符合常规文件管理器行为。
   */
  ipcMain.handle('system:search', async (_, directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => {
    try {
      const args = [directory];
      if (options?.type) args.push('-type', options.type);
      if (query) args.push('-iname', `*${query}*`);
      // 最小大小：+N 语义为「严格大于 N」（find 取整后），与用户直觉一致
      if (options?.minSize) args.push('-size', `+${options.minSize}`);
      // 最大大小：见 doubleSizeValue——直接 -N 会因 find 取整排除所有 ≤N 的文件
      if (options?.maxSize) {
        const doubled = doubleSizeValue(options.maxSize);
        if (doubled) args.push('-size', `-${doubled}`);
      }

      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn('find', args);
        let out = '';
        child.stdout.on('data', (d) => (out += String(d)));
        child.stderr.on('data', () => { /* 权限不足等提示忽略 */ });
        child.on('error', reject);
        child.on('close', () => resolve(out));
      });

      const lines = stdout.split('\n').filter(Boolean);
      const results: { name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null }[] = [];

      const topLines = lines.slice(0, 100);

      for (const pathStr of topLines) {
        try {
          const stats = await fs.stat(pathStr);
          // mime 必须随结果返回：文件列表图标/缩略图按 mime 判定——
          // 缺省会让搜索结果全部显示为通用文件图标（与真实类型不符）
          const mime = stats.isDirectory() ? 'inode/directory' : await detectMime(pathStr);
          results.push({
            name: path.basename(pathStr),
            path: pathStr,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime,
            mime,
          });
        } catch { /* continue */ }
      }
      return results;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  });
}
