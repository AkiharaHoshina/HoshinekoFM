import { ipcMain, BrowserWindow, app } from 'electron';
import path from 'path';
import { promises as fs, watch as fsWatch, existsSync, constants, open as fsOpen, read as fsRead, close as fsClose } from 'fs';
import os from 'os';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import dbus from 'dbus-next';
import { getMountMap, invalidateMountMapCache, getExecError } from '../shared';
import { getThumbnailCacheInfo, clearThumbnailCache, detectMime } from '../fsUtils';
import { getExtensionsForMime, EXT_TO_MIME } from '../mimeMap';
import { readOpenRule, writeOpenRule, deleteOpenRule, listOpenRules, clearAllOpenRules, type OpenRule } from '../openRules';
import { launchWithApp } from '../openLaunch';
import { getLastBackendRegistration } from '../backends';
import { quoteExecArg } from '../launcherEntry';
import { listRegisteredMime } from '../mimeRegistry';
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
export function detectWindowManager(): WindowManagerResult {
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
 * 打开方式配置管理：单条系统默认打开方式（各层 mimeapps.list 合并）。
 */
export interface SystemDefaultEntry {
  /** MIME 类型（如 text/plain） */
  mime: string;
  /** 桌面文件 id（如 org.gnome.TextEditor.desktop） */
  desktopId: string;
  /** 程序显示名（桌面文件 Name=；解析失败回落 desktopId） */
  name: string;
  /** 桌面文件绝对路径（找到时；未找到为 null） */
  desktopFile: string | null;
  /** 清洗后的 Exec 行（绝对路径命令时以 / 开头） */
  exec: string;
  /** 该文件类型的常见扩展名（如 ['.txt', '.log']，供条目展示后缀） */
  extensions: string[];
}

/**
 * 枚举全部系统默认打开方式：按 XDG 优先级从低到高遍历各层
 * mimeapps.list 的 `[Default Applications]` 段（低层先写入 map、
 * 高层覆盖，`~/.config/mimeapps.list` 最终生效）。
 *
 * 过滤规则（决策：目录/协议/内容类型不走 fs:open 的 DefaultOpenRule
 * 查询——fs:open 规则应用有 `stats.isFile()` 守卫，这些条目写入用户
 * 规则永不生效，展示会误导用户）：
 * - `inode/`：目录与设备节点（目录默认程序由设置「默认文件管理器」
 *   独立管理）；
 * - `x-scheme-handler/`：URL 协议（不经过文件打开链路）；
 * - `x-content/`：媒体内容类型伪 MIME（同理）。
 */
async function listSystemDefaultHandlers(): Promise<SystemDefaultEntry[]> {
  const dataDirs = (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':').filter(Boolean);
  const mimeappsFiles: string[] = [];
  for (const dir of dataDirs) mimeappsFiles.push(path.join(dir, 'applications', 'mimeapps.list'));
  mimeappsFiles.push(path.join(os.homedir(), '.local', 'share', 'applications', 'mimeapps.list'));
  mimeappsFiles.push(path.join(os.homedir(), '.config', 'mimeapps.list'));

  const defaults = new Map<string, string>(); // mime → desktop id
  for (const file of mimeappsFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      let inSection = false;
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
          inSection = trimmed === '[Default Applications]';
          continue;
        }
        if (!inSection || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eq = trimmed.indexOf('=');
        const mime = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().split(';')[0].trim();
        if (!mime || !value) continue;
        if (mime.startsWith('inode/') || mime.startsWith('x-scheme-handler/') || mime.startsWith('x-content/')) continue;
        defaults.set(mime, value);
      }
    } catch {
      /* 该层文件不存在：跳过 */
    }
  }

  const searchDirs = [
    path.join(os.homedir(), '.local', 'share', 'applications'),
    path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
    '/usr/local/share/applications',
    '/usr/share/applications',
  ];

  const entries: SystemDefaultEntry[] = [];
  for (const [mime, desktopId] of defaults) {
    let desktopFile: string | null = null;
    for (const dir of searchDirs) {
      const candidate = path.join(dir, desktopId);
      try {
        await fs.access(candidate);
        desktopFile = candidate;
        break;
      } catch {
        /* 该目录无此桌面文件：继续找 */
      }
    }
    let name = desktopId;
    let exec = '';
    if (desktopFile) {
      try {
        const content = await fs.readFile(desktopFile, 'utf-8');
        const nameMatch = content.match(/^Name=(.*)$/m);
        const execMatch = content.match(/^Exec=(.*)$/m);
        if (nameMatch && nameMatch[1]) name = nameMatch[1];
        if (execMatch) exec = execMatch[1].replace(/%[fFuUikc]/g, '').trim();
      } catch {
        /* 解析失败：回落 desktopId */
      }
    }
    entries.push({ mime, desktopId, name, desktopFile, exec, extensions: getExtensionsForMime(mime) });
  }
  return entries;
}

/**
 * 运行系统集成脚本（install.sh / uninstall.sh / reinstall.sh）。
 * 打包版脚本与 packaging 配置经 asarUnpack 解包到
 * `resources/app.asar.unpacked`（spawn 不能执行 asar 内文件，
 * 且 bash 需要真实文件系统里的 packaging 目录）。
 *
 * AppImage 经 FUSE 挂载运行时，挂载点对 root 不可见：pkexec 以
 * root 重入执行脚本会 EACCES。因此先把脚本与 packaging 复制到
 * 真实文件系统的临时目录（/tmp，root 可访问），脚本执行结束后清理。
 *
 * GUI 经 system:install/uninstall/reinstall-system-integration IPC
 * 调用（收集输出返回渲染层）；CLI 子命令（--install-portal 等）以
 * stream 模式调用（stdio 直通终端，实时看到脚本进度与 pkexec 提示）。
 *
 * @param scriptName - scripts/system-integration 下的脚本文件名
 * @param args - 传给脚本的参数（[] = 完整执行含 pkexec 重入）
 * @param options - stream=true 时脚本 stdio 直通终端（CLI 用），
 *   output/error 不收集；缺省捕获输出供 IPC 返回
 * @returns 执行结果；code：NO_SCRIPT / SCRIPT_FAILED / SCRIPT_TIMEOUT
 *   （10 分钟硬超时兜底——脚本内系统命令挂起时强制终止并返回）
 */
export async function runIntegrationScript(
  scriptName: string,
  args: string[],
  options?: { stream?: boolean },
): Promise<{ success: boolean; code?: string; output: string; error: string }> {
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
      ...(options?.stream ? { stdio: 'inherit' } : {}),
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
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (error += String(d)));
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
}

/**
 * 注册 system 相关 IPC handler。
 *
 * @param onSessionBusRestarted - 会话总线重启成功后的回调（main.ts 注入：
 *   重新注册 D-Bus 服务后端并作废冲突探测缓存；e2e harness 不注入）
 * @param onIntegrationChanged - 系统集成安装/卸载/重装成功后的回调
 *   （main.ts 注入：脚本已清理旧常驻，立即重新注册后端让本窗口接管
 *   总线名——无需重启应用即用新版本应答；e2e harness 不注入）
 */
export function registerSystemHandlers(
  onSessionBusRestarted?: () => void,
  onIntegrationChanged?: () => void,
) {
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
      ? `Exec=${quoteExecArg(fixedBin)} %U`
      : process.env.APPIMAGE
        ? `Exec=${quoteExecArg(process.env.APPIMAGE)} %U`
        : `Exec=${quoteExecArg(process.execPath)} ${quoteExecArg(app.getAppPath())} %U`;
    const iconLine = process.env.APPIMAGE
      ? '' // AppImage 集成通常自带 .desktop 与图标
      : `Icon=${path.join(app.getAppPath(), 'src', 'icon.svg')}`;
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
   * 一键安装系统集成（幂等脚本）：
   * - root 级：portal 配置 + D-Bus 激活文件 → 经 pkexec 授权；
   * - 用户级：portals.conf preferred 项、xdg-mime 关联、portal 服务重启。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:install-system-integration', async (_event, userOnly: unknown) => {
    const res = await runIntegrationScript('install.sh', userOnly === true ? ['--user-only'] : []);
    // 脚本已清理旧常驻：立即重新注册后端，本窗口直接接管总线名
    //（下次 portal 请求即由新版本应答，无需重启应用）
    if (res.success) onIntegrationChanged?.();
    return res;
  });

  /**
   * 一键卸载系统集成（幂等脚本，install.sh 的逆操作）：
   * - root 级：移除 portal 配置 + D-Bus 激活文件 → 经 pkexec 授权；
   * - 用户级：移除 portals.conf preferred 项、portal 服务重启。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:uninstall-system-integration', async (_event, userOnly: unknown) => {
    const res = await runIntegrationScript('uninstall.sh', userOnly === true ? ['--user-only'] : []);
    // 脚本已清理常驻：重新注册后端与启动时行为保持一致（GUI 仍持名，
    // 卸载只是移除激活文件与 portal 配置）
    if (res.success) onIntegrationChanged?.();
    return res;
  });

  /**
   * 一键重装系统集成（版本不一致弹窗「一键重装」按钮的执行体）：
   * reinstall.sh 把卸载 + 安装合并为单次 pkexec 授权（分别跑两个脚本
   * 会各弹一次密码框；见 scripts/system-integration/reinstall.sh）。
   *
   * @param userOnly - 仅执行用户级部分（无 polkit 环境降级 / 测试用）
   */
  ipcMain.handle('system:reinstall-system-integration', async (_event, userOnly: unknown) => {
    const res = await runIntegrationScript('reinstall.sh', userOnly === true ? ['--user-only'] : []);
    // 重装脚本已击杀旧常驻并验证退出：立即重新注册后端，本窗口
    // 直接以新版本接管 portal 总线名，无需重启应用（重装前旧常驻
    // 持名导致本窗口注册失败的场景由此闭环）
    if (res.success) onIntegrationChanged?.();
    return res;
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
   *
   * 执行体在 openLaunch.ts 共享：fs:open 的 DefaultOpenRule 覆盖路径
   * 走同一函数，两条打开链路语义必须一致。
   */
  ipcMain.handle('system:open-with', async (_, execPath: string, filePath: string, desktopFile?: string) => {
    return launchWithApp(execPath, filePath, desktopFile);
  });

  /**
   * 查询文件的「手动默认打开方式」规则（DefaultOpenRule，按 MIME 键）。
   * 返回规则对象或 null（无规则/检测失败）。
   */
  ipcMain.handle('system:get-open-rule', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return null;
    const mime = await detectMime(filePath).catch(() => null);
    if (!mime) return null;
    return readOpenRule(mime);
  });

  /**
   * 写入文件的「手动默认打开方式」规则（打开方式对话框勾选「设为默认」）。
   * MIME 检测失败或参数缺失返回 false。
   */
  ipcMain.handle('system:set-open-rule', async (_, filePath: string, execPath: string, desktopFile?: string, name?: string) => {
    if (typeof filePath !== 'string' || !filePath || typeof execPath !== 'string' || !execPath) return false;
    const mime = await detectMime(filePath).catch(() => null);
    if (!mime) return false;
    const rule: OpenRule = { mime, exec: execPath };
    if (typeof desktopFile === 'string' && desktopFile) rule.desktopFile = desktopFile;
    if (typeof name === 'string' && name) rule.name = name;
    await writeOpenRule(rule);
    return true;
  });

  /**
   * 删除文件的「手动默认打开方式」规则（打开方式对话框「还原默认
   * 打开方式」链接）。文件不存在视为成功。
   */
  ipcMain.handle('system:delete-open-rule', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return false;
    const mime = await detectMime(filePath).catch(() => null);
    if (!mime) return false;
    return deleteOpenRule(mime);
  });

  /**
   * 打开方式配置管理：列出全部用户手动默认规则（DefaultOpenRule
   * 目录，按 MIME 键）。文件损坏/缺失跳过（与 readOpenRule 同语义）；
   * 每条附 extensions（常见扩展名，供条目展示文件后缀）。
   */
  ipcMain.handle('system:list-open-rules', async () => {
    const rules = await listOpenRules();
    return rules.map((rule) => ({ ...rule, extensions: getExtensionsForMime(rule.mime) }));
  });

  /**
   * 打开方式配置管理：列出全部系统默认打开方式（各层 mimeapps.list
   * [Default Applications] 合并解析；inode//x-scheme-handler//x-content/
   * 过滤，见 listSystemDefaultHandlers 注释）。
   */
  ipcMain.handle('system:list-system-defaults', () => listSystemDefaultHandlers());

  /**
   * 打开方式配置管理：按 MIME 直写用户规则（无文件路径可检测 MIME 的
   * 场景——配置管理编辑确认/复制系统配置；与 system:set-open-rule
   * 同存储同语义，仅 MIME 来源不同）。
   */
  ipcMain.handle('system:set-open-rule-mime', async (_, mime: string, execPath: string, desktopFile?: string, name?: string) => {
    if (typeof mime !== 'string' || !mime || typeof execPath !== 'string' || !execPath) return false;
    const rule: OpenRule = { mime, exec: execPath };
    if (typeof desktopFile === 'string' && desktopFile) rule.desktopFile = desktopFile;
    if (typeof name === 'string' && name) rule.name = name;
    await writeOpenRule(rule);
    return true;
  });

  /**
   * 打开方式配置管理：按 MIME 删除用户规则（编辑确认输入框为空 =
   * 回归系统默认）。文件不存在视为成功。
   */
  ipcMain.handle('system:delete-open-rule-mime', async (_, mime: string) => {
    if (typeof mime !== 'string' || !mime) return false;
    return deleteOpenRule(mime);
  });

  /**
   * 打开方式配置管理：清除全部用户规则（对话框内「清除全部用户配置」
   * 按钮，带确认）。返回删除条数。
   */
  ipcMain.handle('system:clear-all-open-rules', () => clearAllOpenRules());

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

  /**
   * 查询指定 MIME 的推荐程序（打开方式对话框 / 打开方式配置管理
   * 快速导入共用）。搜索各应用目录下声明了该 MIME 的 .desktop 文件
   * （grep -l 固定串；mime 由调用方保证为 xdg-mime 产出或经合法
   * 形态校验的字符串，含引号会被转义）。
   */
  const getRecommendedAppsForMime = async (mime: string): Promise<{ name: string; icon: string | null; exec: string; path: string }[]> => {
    const safeMime = mime.replace(/"/g, '\\"');

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
        const { stdout: grepOut } = await execAsync(`grep -l "${safeMime}" "${searchPath}"/*.desktop || true`);
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
  };

  ipcMain.handle('system:get-recommended-apps', async (_, filePath: string) => {
    try {
      const safePath = filePath.replace(/"/g, '\\"');
      const { stdout: mimeOut } = await execAsync(`xdg-mime query filetype "${safePath}"`);
      const mime = mimeOut.trim();
      if (!mime) return [];
      return await getRecommendedAppsForMime(mime);
    } catch (err) {
      console.error('Error getting recommended apps:', err);
      return [];
    }
  });

  /**
   * 打开方式配置管理「快速导入」：按 MIME 直查推荐程序（无文件路径
   * 的场景）。mime 为 IPC 入参，须校验合法形态（防 shell 注入）。
   */
  ipcMain.handle('system:get-recommended-apps-mime', async (_, mime: string) => {
    if (typeof mime !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) return [];
    try {
      return await getRecommendedAppsForMime(mime);
    } catch (err) {
      console.error('Error getting recommended apps by mime:', err);
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
   * 搜索结果（system:search 返回值）：
   * - cancelled = 被取消/超时/被新搜索顶替，results 为空；
   * - reason：'timeout'（超时自动取消）/ 'cancelled'（用户取消或
   *   单飞行顶替）；正常完成与 error 均为 undefined；
   * - error：spawn 失败等硬错误信息（渲染层弹搜索失败通知）；
   * - partial：部分内容缺失（find 权限错误以非零退出码/写 stderr 报告）。
   */
  interface SearchResult {
    results: { name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null }[];
    partial: boolean;
    cancelled: boolean;
    reason?: 'timeout' | 'cancelled';
    error?: string;
  }

  /** 活跃搜索（按发送者 id 单飞行：每窗口至多一个 find 子进程） */
  interface ActiveSearch {
    child: ReturnType<typeof spawn> | null;
    timer: ReturnType<typeof setTimeout> | null;
    out: string;
    err: string;
    limit: number;
    earlyStop: boolean;
    settled: boolean;
    /** 原始 promise resolve（settleActiveSearch 内部调用，防递归） */
    resolve: (result: SearchResult) => void;
    /** 公开结算入口：先从注册表摘除再结算 */
    settle: (result: SearchResult) => void;
  }

  const activeSearches = new Map<number, ActiveSearch>();
  /** 已注册 destroyed 清理的发送者（每发送者仅注册一次，防监听器堆积） */
  const senderDestroyedHooked = new Map<number, boolean>();

  /** 结算一次搜索：杀残留子进程、清计时器、resolve 结果（幂等） */
  function settleActiveSearch(entry: ActiveSearch, result: SearchResult): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
      try { entry.child.kill('SIGTERM'); } catch { /* 已退出 */ }
    }
    entry.resolve(result);
  }

  /** 结果数超过该值改用「扩展名快查」mime（跳过 magic 读与 `file`
   *  子进程）：移除上限后的大宗搜索（/ 搜 '1' 可命中数十万条）逐文件
   *  detectMime 需数分钟，用户感知为卡死 */
  const FAST_MIME_THRESHOLD = 2000;
  /** 并发 stat+mime 池大小（大宗结果逐条顺序处理是第二个卡顿源） */
  const MIME_POOL_SIZE = 24;

  /** 扩展名快查 mime（大宗结果的图标判定；未知扩展名回落 null = 通用图标） */
  function mimeByExtensionFast(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) return null;
    return EXT_TO_MIME[ext] ?? null;
  }

  /** 收集到的行 → stat + mime 组装结果（早停/正常结束共用；
   *  大宗结果并发处理 + 扩展名快查 mime） */
  async function buildSearchResults(entry: ActiveSearch, code: number | null, earlyStop: boolean): Promise<SearchResult> {
    const lines = entry.out.split('\n').filter(Boolean).slice(0, entry.limit);
    const useFastMime = lines.length > FAST_MIME_THRESHOLD;
    const results: { name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null }[] = new Array(lines.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!entry.settled) {
        const i = cursor++;
        if (i >= lines.length) return;
        const pathStr = lines[i];
        try {
          const stats = await fs.stat(pathStr);
          // mime 必须随结果返回：文件列表图标/缩略图按 mime 判定——
          // 缺省会让搜索结果全部显示为通用文件图标（与真实类型不符）。
          // 仅普通文件跑 detectMime：FIFO/设备/socket 等特殊文件（/ 搜索
          // 大量命中 /proc、/run）会让 magic 读取/`file` 子进程阻塞。
          const mime = stats.isDirectory()
            ? 'inode/directory'
            : (!stats.isFile() ? null : (useFastMime ? mimeByExtensionFast(pathStr) : await detectMime(pathStr)));
          results[i] = {
            name: path.basename(pathStr),
            path: pathStr,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime,
            mime,
          };
        } catch { /* continue */ }
      }
    };
    const poolSize = Math.max(1, Math.min(MIME_POOL_SIZE, lines.length));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    if (entry.settled) return { results: [], partial: false, cancelled: true, reason: 'cancelled' };
    const cleaned = results.filter((r): r is NonNullable<typeof r> => r !== undefined);
    // partial：stderr 有权限提示，或 find **自然**非零退出（早停/被杀不算）
    const partial = entry.err.trim().length > 0 || (!earlyStop && code !== null && code !== 0);
    return { results: cleaned, partial, cancelled: false };
  }

  /**
   * 文件搜索（find -iname）：目录树中部分子目录无访问权限时 find 仍
   * 输出可访问部分的匹配结果、仅以退出码 1 与 stderr 报告权限问题——
   * 必须用 spawn 手动收集 stdout，不能在非零退出码时整体丢弃
   * （否则「/tmp 搜 proc」这类场景会因个别 systemd 私有目录而零结果）。
   * stderr（权限提示）不再静默忽略：以返回值的 partial 标记透传给渲染
   * 层弹通知（用户要求：部分内容无法显示时提示）。
   *
   * options：
   * - type：find -type（f/d）；
   * - minSize/maxSize：find -size 风格大小串（单位 b/k/M/G/T）；
   * - extensions：扩展名白名单（如 ['doc','txt']）——以
   *   `\( -iname '*.a' -o -iname '*.b' \)` 组合**下放 find**：结果截断
   *   发生在 find 之后，渲染层过滤会因截断漏掉匹配（例如前 200 条全是
   *   其他扩展名时白名单过滤后为空——错误结果）；
   * - limit：结果上限（默认由渲染层传 settings.searchLimit；
   *   NaN/越界回落 200）——**凑满即 SIGTERM 早停**（内存上界 O(limit)、
   *   大搜索提前结束）；
   * - timeoutMs：超时毫秒（渲染层传 settings.searchTimeout；null = 不
   *   限时——搜索页「移除超时时长」的会话级覆盖；越界回落默认 30s）。
   *
   * 进程管理（防溢出，决策：每窗口 1 个并发）：
   * - 按发送者单飞行：同一窗口新搜索先取消旧搜索（杀 find）；
   * - 超时/取消/早停/窗口销毁统一 kill；
   * - 流式计数 + 早停：stdout 不再无界累积（/ 搜 '1' 曾可命中数十万
   *   条目致内存暴涨）。
   *
   * @returns SearchResult——cancelled.reason='timeout' 时渲染层弹超时
   * 通知并复原视图；'cancelled' 为显式取消（渲染层已复原，静默丢弃）。
   */
  ipcMain.handle('system:search', async (event, directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string, extensions?: string[], limit?: number | null, timeoutMs?: number | null }): Promise<SearchResult> => {
    const senderId = event.sender.id;

    // 单飞行：同窗口新搜索先取消旧搜索（kill 旧 find，防并发堆积）
    const prev = activeSearches.get(senderId);
    if (prev && !prev.settled) {
      activeSearches.delete(senderId);
      settleActiveSearch(prev, { results: [], partial: false, cancelled: true, reason: 'cancelled' });
    }

    // 窗口销毁回收：find 不留孤儿进程（每发送者仅注册一次）
    if (!senderDestroyedHooked.has(senderId)) {
      senderDestroyedHooked.set(senderId, true);
      event.sender.once('destroyed', () => {
        senderDestroyedHooked.delete(senderId);
        const entry = activeSearches.get(senderId);
        if (entry && !entry.settled) {
          activeSearches.delete(senderId);
          settleActiveSearch(entry, { results: [], partial: false, cancelled: true, reason: 'cancelled' });
        }
      });
    }

    try {
      const args = [directory];
      if (options?.type) args.push('-type', options.type);
      // 扩展名白名单：sanitize 防 find 参数注入/选项误解析（仅字母数字
      // 与 _+-，剔除 * 与前导点）；括号分组保证 -o 只作用于各 -iname
      // （与后续关键词 -iname 为与关系）
      const exts = (options?.extensions ?? [])
        .map((e) => e.trim().replace(/^\*+/, '').replace(/^\.+/, ''))
        .filter((e) => /^[A-Za-z0-9_+-]+$/.test(e))
        .slice(0, 64);
      if (exts.length > 0) {
        args.push('(');
        for (let i = 0; i < exts.length; i++) {
          if (i > 0) args.push('-o');
          args.push('-iname', `*.${exts[i]}`);
        }
        args.push(')');
      }
      if (query) args.push('-iname', `*${query}*`);
      // 最小大小：+N 语义为「严格大于 N」（find 取整后），与用户直觉一致
      if (options?.minSize) args.push('-size', `+${options.minSize}`);
      // 最大大小：见 doubleSizeValue——直接 -N 会因 find 取整排除所有 ≤N 的文件
      if (options?.maxSize) {
        const doubled = doubleSizeValue(options.maxSize);
        if (doubled) args.push('-size', `-${doubled}`);
      }

      // 结果上限：null = 无限制（用户移除上限/无效输入）——仍设硬安全
      // 上限防内存/进程失控（「无限制」在实践中即 100000 条）；数值须
      // 正整数 ≤ 100000，否则回落默认 200
      const DEFAULT_SEARCH_LIMIT = 200;
      const HARD_SEARCH_LIMIT = 100000;
      const limit = options?.limit === null
        ? HARD_SEARCH_LIMIT
        : (Number.isInteger(options?.limit) && (options?.limit as number) > 0 && (options?.limit as number) <= 100000
          ? (options!.limit as number)
          : DEFAULT_SEARCH_LIMIT);

      // 超时：null = 不限时；数值须 1..180000ms（设置页上限 180s）；
      // HOSHINEKO_E2E_SEARCH_TIMEOUT_MS 为测试强制覆盖（渲染层总传设置值，
      // 不用它覆盖则 e2e 需等满 30s）
      const envTimeout = Number(process.env.HOSHINEKO_E2E_SEARCH_TIMEOUT_MS);
      const envOverride = Number.isFinite(envTimeout) && envTimeout > 0 && envTimeout <= 180000
        ? envTimeout
        : null;
      const DEFAULT_SEARCH_TIMEOUT_MS = 30000;
      const timeoutMs = options?.timeoutMs === null
        ? null
        : (envOverride !== null
          ? envOverride
          : (typeof options?.timeoutMs === 'number' && options.timeoutMs > 0 && options.timeoutMs <= 180000
            ? options.timeoutMs
            : DEFAULT_SEARCH_TIMEOUT_MS));

      return await new Promise<SearchResult>((resolve) => {
        const entry: ActiveSearch = {
          child: null,
          timer: null,
          out: '',
          err: '',
          limit,
          earlyStop: false,
          settled: false,
          resolve,
          settle: () => { /* 下方立即覆盖 */ },
        };
        entry.settle = (result: SearchResult) => {
          activeSearches.delete(senderId);
          settleActiveSearch(entry, result);
        };
        activeSearches.set(senderId, entry);

        const child = spawn('find', args);
        entry.child = child;

        let nlCount = 0;
        child.stdout.on('data', (d) => {
          if (entry.settled) return;
          const s = String(d);
          entry.out += s;
          // 流式计数：凑满 limit 行即早停（内存上界 O(limit)）
          nlCount += (s.match(/\n/g) ?? []).length;
          if (nlCount >= limit) {
            entry.earlyStop = true;
            if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
            try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
            void buildSearchResults(entry, null, true).then((result) => {
              entry.settle(result);
            });
          }
        });
        child.stderr.on('data', (d) => {
          if (!entry.settled) entry.err += String(d);
        });
        child.on('error', (err) => {
          if (entry.settled) return;
          entry.settle({ results: [], partial: false, cancelled: false, error: String((err as Error)?.message ?? err) });
        });
        child.on('close', (code) => {
          if (entry.settled) return;
          if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
          void buildSearchResults(entry, code, entry.earlyStop).then((result) => {
            entry.settle(result);
          });
        });

        // 超时自动取消（null = 本次搜索不限时）
        if (timeoutMs !== null) {
          entry.timer = setTimeout(() => {
            entry.settle({ results: [], partial: false, cancelled: true, reason: 'timeout' });
          }, timeoutMs);
        }
      });
    } catch (error) {
      console.error('Search failed:', error);
      return { results: [], partial: false, cancelled: false, error: String((error as Error)?.message ?? error) };
    }
  });

  /**
   * 取消当前窗口的搜索（搜索页「取消搜索」按钮）：杀 find 并以
   * cancelled 结算 pending promise——渲染层 seq 守卫丢弃结果并复原视图。
   */
  ipcMain.handle('system:cancel-search', (event) => {
    const entry = activeSearches.get(event.sender.id);
    if (entry && !entry.settled) {
      entry.settle({ results: [], partial: false, cancelled: true, reason: 'cancelled' });
    }
    return true;
  });

  /**
   * 系统注册文件格式枚举（「按格式筛选」快捷添加对话框与扩展名描述
   * 查表数据源）：解析 mimeinfo.cache + shared-mime-info XML，见
   * ../mimeRegistry。解析失败整体回退空列表（渲染层有内置兜底文案）。
   */
  ipcMain.handle('system:list-registered-mime', async () => {
    try {
      return await listRegisteredMime();
    } catch (error) {
      console.error('List registered mime failed:', error);
      return [];
    }
  });

  // ── Object Panel（objects:// 虚拟页集，v1）────────────────────────
  //
  // 设计见 docs/ObjectPanel可行性报告.md。v1 三类对象：
  // - storage：块设备（磁盘/分区）与挂载点（getAllDevices + getMountMap）；
  // - processor：固定实例 cpu / memory（/proc/stat、/proc/meminfo）；
  // - tty：/sys/class/tty 下的控制台终端（v1 **完全只读**输出流——
  //   逻辑上为读写终端预留：tty 流式通道按「读流」实现，未来交互写入
  //   只需在同一通道上增加写分支，勿破坏现有 start/stop 契约）。

  /** OP 对象实例 */
  interface ObjectInstance {
    /** 类内唯一 id：存储类=设备路径或挂载点，cpu/memory 固定，tty=tty 名，
     *  进程类=pid、thermal=hwmon 目录名、backlight/network/power=sysfs 目录名 */
    id: string;
    /** 显示名 */
    name: string;
    /** 副标题（模型/挂载点/cmdline 截断等；可为 null） */
    subtitle: string | null;
    /** 实例种类（决定双击/详情页行为） */
    kind: 'disk' | 'partition' | 'mount' | 'cpu' | 'memory' | 'tty' | 'process' | 'thermal' | 'backlight' | 'network' | 'power' | 'gpu';
    /** Material Symbols 图标名 */
    icon: string;
    /** 进程类列表指标（枚举时一并算出，其他类不传）：
     *  cpuPct 为与上次枚举采样的差值（单核语义，钳制 0–100）；
     *  ppid 供树视图建层级（进程类专有） */
    metrics?: { cpuPct: number; rssBytes: number; state: string; ppid?: number };
    /** 访问受限标记（tty 类：/dev/ttyN 不可读——非本会话控制台）。
     *  以管理员模式运行的进程 R_OK 预检自然通过（远期设计，见报告）。 */
    restricted?: boolean;
    /** 原生拖出路径（对象行拖到其他应用等价拖该路径）——存储类 =
     *  挂载点（已挂载）或块设备节点（未挂载）、tty = /dev/ttyN、
     *  power/thermal/backlight/network = sysfs 类目录、process =
     *  /proc/<pid>、cpu = /proc/stat、memory = /proc/meminfo、
     *  gpu = /dev/dri 设备节点；无路径语义的类不传 */
    nativePath?: string;
    /** 原生拖出路径是否为目录（挂载点/sysfs/proc 目录 = true；
     *  设备节点/统计文件 = false；无 nativePath 时不传） */
    nativeIsDir?: boolean;
    /**
     * 存储类实例的显式分类（D8 定案：后端明确传类型、前端不猜——
     *  仅 disk/partition/mount 三种 kind 传）：'mounted' = 已挂载
     *  （分区带挂载点/mount 实例）；'device' = 未挂载块设备（磁盘/带
     *  文件系统的未挂载分区）；'other' = swaplike/无文件系统（fstype
     *  为 swap 或缺失的未挂载分区）。前端存储类筛选 chips 直接按该
     *  字段分组，不推 nativeIsDir/fstype。
     */
    storageKind?: 'mounted' | 'device' | 'other';
    /** 充电阈值支持标记（power 类电池：charge_control_end_threshold
     *  文件存在——检测到才显示；写入是否生效靠写后读回校验兜底） */
    chargeControl?: boolean;
  }

  /** OP 类信息（渲染层按 id 翻译显示名） */
  interface ObjectClassInfo {
    id: 'storage' | 'processor' | 'tty' | 'process' | 'thermal' | 'backlight' | 'network' | 'power' | 'gpu';
    icon: string;
    instances: ObjectInstance[];
  }

  /** 实时读数（按 kind 判别） */
  type ObjectReading =
    | { kind: 'cpu'; model: string | null; totalPct: number; cores: { id: string; pct: number }[] }
    | { kind: 'memory'; totalBytes: number; usedBytes: number; availableBytes: number; percent: number }
    | { kind: 'storage'; name: string; mounted: boolean; mountpoint: string | null; sizeLabel: string | null; usedBytes: number | null; totalBytes: number | null; percent: number | null; fstype: string | null }
    | { kind: 'process'; pid: number; name: string; user: string | null; state: string; cpuPct: number; rssBytes: number; threads: number; nice: number; ppid: number; startedAt: number | null; exe: string | null; cwd: string | null; isSelf: boolean; ownUser: boolean }
    | { kind: 'thermal'; name: string; temps: { id: string; label: string | null; valueC: number }[]; fans: { id: string; label: string | null; rpm: number }[]; currs: { id: string; label: string | null; mA: number }[]; voltages: { id: string; label: string | null; mV: number }[] }
    | { kind: 'backlight'; brightness: number; maxBrightness: number; actualBrightness: number; writable: boolean }
    | { kind: 'network'; operstate: string; speedMbps: number | null; addresses: string[]; rxBytesPerSec: number; txBytesPerSec: number; isLoopback: boolean }
    | { kind: 'power'; capacity: number | null; status: string; energyNow: number | null; energyFull: number | null; cycleCount: number | null; type: string; chargeThreshold?: number | null }
    | { kind: 'gpu'; vendor: 'nvidia' | 'amd' | 'intel'; utilizationPct: number | null; memUsedBytes: number | null; memTotalBytes: number | null; tempC: number | null };

  /** CPU 占用百分比缓存：/proc/stat 是单调计数，需与上次采样做差 */
  let lastCpuSample: { total: number; idle: number; perCore: Map<string, { total: number; idle: number }> } | null = null;
  let cpuModelCache: string | null | undefined;

  /** 读取 CPU 模型名（/proc/cpuinfo 首条 model name；失败回落 null） */
  async function readCpuModel(): Promise<string | null> {
    if (cpuModelCache !== undefined) return cpuModelCache;
    try {
      const content = await readFileTimed('/proc/cpuinfo', ENUM_READ_TIMEOUT_MS);
      if (!content) return null;
      const m = /^model name\s*:\s*(.+)$/m.exec(content);
      cpuModelCache = m ? m[1].trim() : null;
    } catch {
      cpuModelCache = null;
    }
    return cpuModelCache;
  }

  /** 解析一行 /proc/stat 的 cpu 计数（user+nice+system+irq+softirq+steal 为忙，idle+iowait 为空闲） */
  function parseCpuLine(line: string): { total: number; idle: number } {
    const nums = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
    const total = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    return { total, idle };
  }

  /** 计算 CPU 占用百分比（需上次采样；无上次采样时返回 0，下一次轮询出真值） */
  function cpuPercent(cur: { total: number; idle: number }, prev: { total: number; idle: number } | undefined): number {
    if (!prev) return 0;
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    if (dTotal <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 100)));
  }

  /** 枚举存储类对象：磁盘/分区（lsblk 树）+ /dev 背书的挂载点 */
  async function listStorageObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    const seenMountpoints = new Set<string>();
    try {
      const devices = await getAllDevices();
      const walk = (d: LsblkDevice) => {
        if (d.type === 'disk') {
          instances.push({
            id: d.devicePath ?? `/dev/${d.name}`,
            name: d.label ?? d.name,
            subtitle: d.model && d.model !== d.name ? d.model : (d.size ?? null),
            kind: 'disk',
            icon: 'hard_drive',
            // 未挂载磁盘的原生拖出路径 = 块设备节点（挂载点在分区实例上）
            nativePath: d.devicePath ?? `/dev/${d.name}`,
            nativeIsDir: false,
            storageKind: 'device',
          });
        } else if (d.type === 'part') {
          const name = d.label ?? d.name;
          // 显式分类（D8）：已挂载 = mounted；未挂载 swap/无文件系统 = other；
          // 其余未挂载块设备 = device
          const storageKind: 'mounted' | 'device' | 'other' = d.mountpoint
            ? 'mounted'
            : (!d.fstype || d.fstype === 'swap' ? 'other' : 'device');
          instances.push({
            id: d.devicePath ?? `/dev/${d.name}`,
            name,
            subtitle: d.mountpoint ?? (d.fstype ?? null),
            kind: 'partition',
            icon: 'storage',
            nativePath: d.mountpoint ?? d.devicePath ?? `/dev/${d.name}`,
            nativeIsDir: !!d.mountpoint,
            storageKind,
          });
          if (d.mountpoint) seenMountpoints.add(d.mountpoint);
        }
        if (d.children) for (const c of d.children) walk(c);
      };
      for (const d of devices) walk(d);
    } catch { /* lsblk 失败：仅挂载点 */ }

    try {
      const mounts = await getMountMap();
      for (const [mp, info] of Object.entries(mounts)) {
        if (!info.source.startsWith('/dev/')) continue;
        if (seenMountpoints.has(mp)) continue; // 分区实例已含挂载点副标题
        const name = path.basename(mp) || mp;
        instances.push({
          id: mp,
          name,
          subtitle: info.source,
          kind: 'mount',
          icon: 'folder_open',
          nativePath: mp,
          nativeIsDir: true,
          storageKind: 'mounted',
        });
      }
    } catch { /* 挂载表不可用：仅 lsblk 结果 */ }

    instances.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return instances;
  }

  /** sysfs 根目录（e2e 经 HOSHINEKO_E2E_SYSFS_DIR 指向沙箱；默认 /sys） */
  function getSysfsRoot(): string {
    return process.env.HOSHINEKO_E2E_SYSFS_DIR ?? '/sys';
  }

  /**
   * sysfs 目录类实例 id 白名单（thermal/backlight/network/power 共用）：
   * 允许冒号与点（power_supply 有 `ucsi-source-psy-USBC000:002`、
   * `hid-0018:04F3:4653.0003-battery-7` 之类名字）——仍**无斜杠、无 `..` 段**，
   * 天然防路径逃逸。枚举与读数同源，杜绝「枚举不校验、读数校验过严」的
   * 不对称（e2e 81d 覆盖）。
   */
  const SYSFS_ID_RE = /^[A-Za-z0-9_.:-]+$/;

  /** 枚举 tty 类对象（/sys/class/tty 下的控制台终端 ttyN；R_OK 预检标记受限） */
  async function listTtyObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    try {
      const entries = await fs.readdir(path.join(getSysfsRoot(), 'class', 'tty'));
      for (const name of entries) {
        if (!/^tty\d+$/.test(name)) continue;
        // 预检可读性：非本会话控制台（root:tty 600）读不了——类页标
        // 「需要权限」，实例页不再徒劳开流。以管理员模式运行的进程
        // R_OK 自然通过（远期设计：管理员启动可读全部 tty）。
        let restricted = false;
        try {
          await fs.access(`/dev/${name}`, fs.constants.R_OK);
        } catch {
          restricted = true;
        }
        instances.push({ id: name, name, subtitle: null, kind: 'tty', icon: 'terminal', restricted, nativePath: `/dev/${name}`, nativeIsDir: false });
      }
    } catch { /* /sys/class/tty 不可用：空列表 */ }
    instances.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return instances;
  }

  /** 枚举处理器与内存类对象（固定实例；原生拖出路径 = 聚合统计的
   *  真实来源文件——cpu = /proc/stat、memory = /proc/meminfo） */
  async function listProcessorObjects(): Promise<ObjectInstance[]> {
    return [
      { id: 'cpu', name: 'CPU', subtitle: await readCpuModel(), kind: 'cpu', icon: 'memory', nativePath: '/proc/stat', nativeIsDir: false },
      { id: 'memory', name: 'Memory', subtitle: null, kind: 'memory', icon: 'memory', nativePath: '/proc/meminfo', nativeIsDir: false },
    ];
  }

  // ── 进程类 ──

  /** Linux 用户态 HZ（jiffies/秒，/proc 计数字段单位；x86/arm64 实际均为 100） */
  const USER_HZ = 100;

  /** 解析 /proc/<pid>/stat：comm（括号字段，防空格截断）+ 关键数值字段 */
  function parseProcStat(content: string): {
    comm: string; state: string; ppid: number; utime: number; stime: number;
    nice: number; threads: number; starttime: number;
  } | null {
    const open = content.indexOf('(');
    const close = content.lastIndexOf(')');
    if (open < 0 || close < open) return null;
    const comm = content.slice(open + 1, close);
    // comm 后的字段（stat 手册序）：0=state 1=ppid … 11=utime 12=stime
    // 16=nice 17=num_threads 19=starttime
    const nums = content.slice(close + 1).trim().split(/\s+/);
    const n = (i: number): number => {
      const v = Number(nums[i]);
      return Number.isFinite(v) ? v : NaN;
    };
    return {
      comm,
      state: nums[0] ?? '?',
      ppid: n(1),
      utime: n(11),
      stime: n(12),
      nice: n(16),
      threads: n(17),
      starttime: n(19),
    };
  }

  /** 进程 CPU 占用（与上次采样做差；单核语义，钳制 0–100；无上次采样 = 0） */
  function procCpuPct(ticks: number, ts: number, prev: { ticks: number; ts: number } | undefined): number {
    if (!prev) return 0;
    const dTicks = ticks - prev.ticks;
    const dSec = (ts - prev.ts) / 1000;
    if (dSec <= 0 || dTicks <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((dTicks / USER_HZ / dSec) * 100)));
  }

  /** 进程 CPU 采样：枚举与读数各持一份（间隔不同，互不污染）；pid 消失随重建自然清理 */
  let lastProcSample: Map<string, { ticks: number; ts: number }> | null = null;
  let lastProcReadSample: Map<string, { ticks: number; ts: number }> | null = null;

  /** /etc/passwd uid→用户名缓存（30s TTL） */
  let passwdMapCache: { ts: number; map: Map<number, string> } | null = null;
  async function getPasswdMap(): Promise<Map<number, string>> {
    if (passwdMapCache && Date.now() - passwdMapCache.ts < 30000) return passwdMapCache.map;
    const map = new Map<number, string>();
    try {
      const content = await readFileTimed('/etc/passwd', ENUM_READ_TIMEOUT_MS);
      if (!content) return map;
      for (const line of content.split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 3) {
          const uid = Number(parts[2]);
          if (Number.isFinite(uid)) map.set(uid, parts[0] ?? String(uid));
        }
      }
    } catch { /* 无 passwd：回落数字 uid */ }
    passwdMapCache = { ts: Date.now(), map };
    return map;
  }

  /** 系统启动时刻（/proc/stat btime，epoch 秒；失败 null） */
  let bootTimeCache: number | null | undefined;
  async function getBootTime(): Promise<number | null> {
    if (bootTimeCache !== undefined) return bootTimeCache;
    try {
      const stat = await readFileTimed('/proc/stat', READ_TIMEOUT_MS);
      if (!stat) return null;
      const m = /^btime\s+(\d+)/m.exec(stat);
      bootTimeCache = m ? Number(m[1]) : null;
    } catch {
      bootTimeCache = null;
    }
    return bootTimeCache;
  }

  /** 枚举进程类对象（/proc 数字目录；读取竞态/无权限的 pid 跳过） */
  async function listProcessObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    let entries: string[];
    try {
      entries = (await fs.readdir('/proc')).filter((e) => /^\d+$/.test(e));
    } catch {
      return instances;
    }
    const now = Date.now();
    const prevMap = lastProcSample ?? new Map();
    const nextMap = new Map<string, { ticks: number; ts: number }>();
    await Promise.all(entries.map(async (pid) => {
      try {
        const statContent = await readFileTimed(`/proc/${pid}/stat`, ENUM_READ_TIMEOUT_MS);
        if (!statContent) return;
        const parsed = parseProcStat(statContent);
        if (!parsed) return;
        const ticks = parsed.utime + parsed.stime;
        nextMap.set(pid, { ticks, ts: now });
        let rssBytes = 0;
        const status = await readFileTimed(`/proc/${pid}/status`, ENUM_READ_TIMEOUT_MS);
        if (status) {
          const rss = /^VmRSS:\s+(\d+)/m.exec(status);
          if (rss) rssBytes = Number(rss[1]) * 1024;
        }
        let cmdline: string | null = null;
        const raw = await readFileTimed(`/proc/${pid}/cmdline`, ENUM_READ_TIMEOUT_MS);
        if (raw) {
          const joined = raw.split('\0').filter(Boolean).join(' ');
          cmdline = joined ? joined.slice(0, 256) : null;
        }
        instances.push({
          id: pid,
          name: parsed.comm,
          subtitle: cmdline ?? `[${parsed.comm}]`,
          kind: 'process',
          icon: 'app_shortcut',
          nativePath: `/proc/${pid}`,
          nativeIsDir: true,
          metrics: {
            cpuPct: procCpuPct(ticks, now, prevMap.get(pid)),
            rssBytes,
            state: parsed.state,
            ppid: parsed.ppid,
          },
        });
      } catch { /* 进程已消失/无权限 */ }
    }));
    lastProcSample = nextMap;
    instances.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return instances;
  }

  // ── 传感器（hwmon）类 ──

  /** sysfs/proc 读超时（毫秒）：读数默认 2000；枚举 1000（见各调用点）。
   *  部分硬件（I²C/SMBus 传感器、慢固件）的 sysfs 读会阻塞——所有
   *  fs.readFile 经此 helper 带超时，超时/失败统一回 null（「无法读取」）。 */
  const READ_TIMEOUT_MS = 2000;
  const ENUM_READ_TIMEOUT_MS = 1000;

  /** 带超时读文件（utf-8）；超时/任何失败回 null */
  async function readFileTimed(file: string, timeoutMs: number): Promise<string | null> {
    try {
      return await fs.readFile(file, { encoding: 'utf-8', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return null;
    }
  }

  /** 读 sysfs 数值文件（trim + Number；失败/超时 null） */
  async function readSysfsNum(file: string, timeoutMs = READ_TIMEOUT_MS): Promise<number | null> {
    const content = await readFileTimed(file, timeoutMs);
    if (content === null) return null;
    const v = Number(content.trim());
    return Number.isFinite(v) ? v : null;
  }

  /** 读 sysfs 文本文件（trim；失败/超时 null） */
  async function readSysfsStr(file: string, timeoutMs = READ_TIMEOUT_MS): Promise<string | null> {
    const content = await readFileTimed(file, timeoutMs);
    if (content === null) return null;
    return content.trim() || null;
  }

  /** 枚举传感器类对象（/sys/class/hwmon；chip name + 首个温度概览） */
  async function listThermalObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    const root = path.join(getSysfsRoot(), 'class', 'hwmon');
    try {
      const entries = await fs.readdir(root);
      for (const name of entries) {
        const chipName = (await readSysfsStr(path.join(root, name, 'name'))) ?? name;
        // 首个温度概览（读文件目录名数字最小者）
        let overview: string | null = null;
        try {
          const files = await fs.readdir(path.join(root, name));
          const first = files.filter((f) => /^temp\d+_input$/.test(f)).sort()[0];
          if (first) {
            const mC = await readSysfsNum(path.join(root, name, first));
            if (mC !== null) overview = `${(mC / 1000).toFixed(1)}°C`;
          }
        } catch { /* 无温度文件 */ }
        instances.push({ id: name, name: chipName, subtitle: overview, kind: 'thermal', icon: 'device_thermostat', nativePath: path.join(root, name), nativeIsDir: true });
      }
    } catch { /* hwmon 不可用：空列表 */ }
    instances.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return instances;
  }

  // ── 背光类 ──

  /** 枚举背光类对象（/sys/class/backlight；无背光设备（台式机）为空） */
  async function listBacklightObjects(): Promise<ObjectInstance[]> {
    const root = path.join(getSysfsRoot(), 'class', 'backlight');
    try {
      const entries = await fs.readdir(root);
      return entries
        .map((name) => ({ id: name, name, subtitle: null, kind: 'backlight' as const, icon: 'light_mode', nativePath: path.join(root, name), nativeIsDir: true }))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    } catch {
      return [];
    }
  }

  // ── 网络类 ──

  /** 枚举网络类对象（/sys/class/net；无线/有线按 wireless 目录判别图标） */
  async function listNetworkObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    const root = path.join(getSysfsRoot(), 'class', 'net');
    try {
      const entries = await fs.readdir(root);
      for (const name of entries) {
        const operstate = await readSysfsStr(path.join(root, name, 'operstate'));
        let wireless = false;
        try {
          await fs.access(path.join(root, name, 'wireless'));
          wireless = true;
        } catch { /* 有线 */ }
        instances.push({
          id: name,
          name,
          subtitle: operstate ?? null,
          kind: 'network',
          icon: wireless ? 'wifi' : 'settings_ethernet',
          nativePath: path.join(root, name),
          nativeIsDir: true,
        });
      }
    } catch { /* net 不可用：空列表 */ }
    instances.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return instances;
  }

  // ── 电源类 ──

  /** 枚举电源类对象（/sys/class/power_supply：电池/AC 适配器） */
  async function listPowerObjects(): Promise<ObjectInstance[]> {
    const instances: ObjectInstance[] = [];
    const root = path.join(getSysfsRoot(), 'class', 'power_supply');
    try {
      const entries = await fs.readdir(root);
      for (const name of entries) {
        const type = await readSysfsStr(path.join(root, name, 'type'));
        const capacity = await readSysfsNum(path.join(root, name, 'capacity'));
        // 充电阈值支持预检（charge_control_end_threshold 文件存在才显示
        // ——检测到才显示哲学；厂商差异靠写后读回校验兜底）
        let chargeControl = false;
        try {
          await fs.access(path.join(root, name, 'charge_control_end_threshold'));
          chargeControl = true;
        } catch { /* 不支持 */ }
        instances.push({
          id: name,
          name,
          subtitle: capacity !== null ? `${capacity}%` : (type ?? null),
          kind: 'power',
          icon: type === 'Battery' ? 'battery_full' : 'power',
          nativePath: path.join(root, name),
          nativeIsDir: true,
          chargeControl,
        });
      }
    } catch { /* power_supply 不可用：空列表 */ }
    instances.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return instances;
  }

  // ── GPU 类 ──

  /** GPU vendor 工具名（探测顺序 = 优先级；首个可用者胜出） */
  const GPU_TOOLS: Array<{ vendor: 'nvidia' | 'amd' | 'intel'; tool: string }> = [
    { vendor: 'nvidia', tool: 'nvidia-smi' },
    { vendor: 'amd', tool: 'rocm-smi' },
    { vendor: 'intel', tool: 'intel_gpu_top' },
  ];

  /**
   * GPU 工具路径解析：`HOSHINEKO_E2E_GPU_TOOLS` 指向沙箱目录时用
   * `<dir>/<tool>`（e2e 假工具，PATH 影子化同款手法）；否则裸工具名
   * 走 PATH。execFile 无 shell，无注入面。
   */
  function gpuToolPath(tool: string): string {
    const dir = process.env.HOSHINEKO_E2E_GPU_TOOLS;
    return dir ? path.join(dir, tool) : tool;
  }

  /** 探测首个可用的 GPU vendor 工具（--version 快速失败即无） */
  async function detectGpuTool(): Promise<{ vendor: 'nvidia' | 'amd' | 'intel'; tool: string } | null> {
    for (const { vendor, tool } of GPU_TOOLS) {
      try {
        await execFileAsync(gpuToolPath(tool), ['--version'], { timeout: 3000 });
        return { vendor, tool };
      } catch { /* 下一个 */ }
    }
    return null;
  }

  /**
   * 解析 GPU 的 DRI 设备节点（原生拖出路径语义）：优先首个 card*（设备
   * 本体），回落 renderD*（渲染节点）；无 /dev/dri 回 null。e2e 沙箱
   * 经 `HOSHINEKO_E2E_DRI_DIR` 覆盖（与 sysfs/GPU 工具同款手法）。
   */
  let driNodeCache: string | null | undefined;
  async function resolveDriNode(): Promise<string | null> {
    if (driNodeCache !== undefined) return driNodeCache;
    driNodeCache = null;
    const driDir = process.env.HOSHINEKO_E2E_DRI_DIR ?? '/dev/dri';
    try {
      const entries = await fs.readdir(driDir);
      const first = (re: RegExp) => entries.filter((e) => re.test(e)).sort()[0];
      driNodeCache = first(/^card\d+$/) ?? first(/^renderD\d+$/) ?? null;
      if (driNodeCache) driNodeCache = path.join(driDir, driNodeCache);
    } catch { /* 无 DRI */ }
    return driNodeCache;
  }

  /**
   * 枚举 GPU 类对象（vendor 工具驱动；检测到工具才显示——SMART 同款
   * 「检测不到不显示空卡」哲学，根页空类隐藏天然兜底）。解析失败/
   * 工具挂起（execFile timeout 杀进程）回空数组，不崩。
   */
  async function listGpuObjects(): Promise<ObjectInstance[]> {
    try {
      const det = await detectGpuTool();
      if (!det) return [];
      const dri = await resolveDriNode();
      const gpuNative = (id: string, name: string, subtitle: string): ObjectInstance => ({
        id,
        name,
        subtitle,
        kind: 'gpu',
        icon: 'developer_board',
        ...(dri ? { nativePath: dri, nativeIsDir: false } : {}),
      });
      if (det.vendor === 'nvidia') {
        const { stdout } = await execFileAsync(
          gpuToolPath(det.tool),
          ['--query-gpu=index,name', '--format=csv,noheader,nounits'],
          { timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        const instances: ObjectInstance[] = [];
        for (const line of stdout.split('\n')) {
          const m = /^\s*(\d+)\s*,\s*(.+?)\s*$/.exec(line.trim());
          if (!m) continue;
          instances.push(gpuNative(`nvidia-${m[1]}`, m[2].trim(), 'NVIDIA'));
        }
        return instances;
      }
      if (det.vendor === 'amd') {
        const { stdout } = await execFileAsync(gpuToolPath(det.tool), ['--showid'], { timeout: 5000, maxBuffer: 1024 * 1024 });
        const instances: ObjectInstance[] = [];
        for (const line of stdout.split('\n')) {
          const m = /GPU\[(\d+)\]/i.exec(line);
          if (!m) continue;
          instances.push(gpuNative(`amd-${m[1]}`, `AMD GPU ${m[1]}`, 'AMD'));
        }
        return instances;
      }
      // intel：intel_gpu_top 无可解析的一次性枚举输出——检测到工具即单实例
      return [gpuNative('intel-0', 'Intel GPU', 'Intel')];
    } catch {
      return [];
    }
  }

  /** 读取 GPU 实例读数（利用率/显存/温度）。三厂商工具输出形态差异大，
   *  尽力而为解析，字段失败回 null（「—」）；intel 工具为常驻流式输出，
   *  靠 execFile timeout 杀掉后从缓冲里取首个 JSON——失败回 null 字段。 */
  async function readGpuReading(instanceId: string): Promise<ObjectReading | null> {
    if (!/^[A-Za-z0-9-]+$/.test(instanceId)) return null;
    const dash = instanceId.indexOf('-');
    if (dash <= 0) return null;
    const vendor = instanceId.slice(0, dash) as 'nvidia' | 'amd' | 'intel';
    const idx = Number(instanceId.slice(dash + 1));
    if (!Number.isFinite(idx)) return null;
    const num = (s: string | undefined): number | null => {
      const v = Number((s ?? '').trim());
      return Number.isFinite(v) ? v : null;
    };
    try {
      const det = await detectGpuTool();
      if (!det || det.vendor !== vendor) return null;
      if (vendor === 'nvidia') {
        const { stdout } = await execFileAsync(
          gpuToolPath(det.tool),
          ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits', '-i', String(idx)],
          { timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        const parts = stdout.trim().split(',');
        const memUsed = num(parts[1]);
        const memTotal = num(parts[2]);
        return {
          kind: 'gpu',
          vendor: 'nvidia',
          utilizationPct: num(parts[0]),
          memUsedBytes: memUsed !== null ? memUsed * 1024 * 1024 : null, // MiB → B
          memTotalBytes: memTotal !== null ? memTotal * 1024 * 1024 : null,
          tempC: num(parts[3]),
        };
      }
      if (vendor === 'amd') {
        const { stdout } = await execFileAsync(
          gpuToolPath(det.tool),
          ['--showuse', '--showtemp', '-i', String(idx)],
          { timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        const utilMatch = /GPU use\s*\(%\)\s*:\s*(\d+(?:\.\d+)?)/i.exec(stdout);
        const tempMatch = /Temperature\s*\(Sensor junction\)\s*\(C\)\s*:\s*(\d+(?:\.\d+)?)/i.exec(stdout);
        return {
          kind: 'gpu',
          vendor: 'amd',
          utilizationPct: utilMatch ? Number(utilMatch[1]) : null,
          memUsedBytes: null,
          memTotalBytes: null,
          tempC: tempMatch ? Number(tempMatch[1]) : null,
        };
      }
      // intel：intel_gpu_top -J 持续输出 JSON——execFile timeout 杀进程后
      // 从 error.stdout 取缓冲的首个 JSON 块解析 busy 百分比
      let stdout = '';
      try {
        ({ stdout } = await execFileAsync(
          gpuToolPath(det.tool),
          ['-J', '-s', '250', '-o', '-'],
          { timeout: 1500, maxBuffer: 1024 * 1024 },
        ));
      } catch (e) {
        stdout = String((e as { stdout?: string })?.stdout ?? '');
      }
      const busy = /"busy":\s*(\d+(?:\.\d+)?)/.exec(stdout);
      return { kind: 'gpu', vendor: 'intel', utilizationPct: busy ? Number(busy[1]) : null, memUsedBytes: null, memTotalBytes: null, tempC: null };
    } catch {
      return null;
    }
  }

  /** 类枚举器注册表：新增类只需加一行（类序 = 根卡片序；进程类靠后——
   *  根页跨类搜索命中上限 200 条在渲染层截断） */
  const OBJECT_CLASS_ENUMERATORS: Array<{ id: ObjectClassInfo['id']; icon: string; enumerate: () => Promise<ObjectInstance[]> }> = [
    { id: 'storage', icon: 'hard_drive', enumerate: listStorageObjects },
    { id: 'processor', icon: 'memory', enumerate: listProcessorObjects },
    { id: 'tty', icon: 'terminal', enumerate: listTtyObjects },
    { id: 'process', icon: 'app_shortcut', enumerate: listProcessObjects },
    { id: 'thermal', icon: 'device_thermostat', enumerate: listThermalObjects },
    { id: 'backlight', icon: 'light_mode', enumerate: listBacklightObjects },
    { id: 'network', icon: 'wifi', enumerate: listNetworkObjects },
    { id: 'power', icon: 'battery_full', enumerate: listPowerObjects },
    { id: 'gpu', icon: 'developer_board', enumerate: listGpuObjects },
  ];

  /**
   * 枚举全部 OP 对象（按类分组，类枚举器表驱动并行枚举）。结果内存缓存
   * 3s：存储/进程类随设备与进程变化——缓存短 TTL + 设备事件主动失效由
   * 渲染层轮询自然覆盖。
   */
  let objectsCache: { ts: number; classes: ObjectClassInfo[] } | null = null;
  async function listObjectsCached(force = false): Promise<ObjectClassInfo[]> {
    if (!force && objectsCache && Date.now() - objectsCache.ts < 3000) {
      return objectsCache.classes;
    }
    const classes: ObjectClassInfo[] = await Promise.all(
      OBJECT_CLASS_ENUMERATORS.map(async (c) => ({ id: c.id, icon: c.icon, instances: await c.enumerate() })),
    );
    objectsCache = { ts: Date.now(), classes };
    return classes;
  }

  /** 按 id 找实例（listObjectsCached 结果内） */
  async function findObjectInstance(classId: string, instanceId: string): Promise<{ cls: ObjectClassInfo; inst: ObjectInstance } | null> {
    const classes = await listObjectsCached();
    const cls = classes.find((c) => c.id === classId);
    const inst = cls?.instances.find((i) => i.id === instanceId);
    return cls && inst ? { cls, inst } : null;
  }

  /** 读取进程实例读数（/proc/<pid>/stat+status+exe/cwd；消失/无权限回落 null） */
  async function readProcessReading(instanceId: string): Promise<ObjectReading | null> {
    if (!/^\d+$/.test(instanceId)) return null;
    const pidNum = Number(instanceId);
    if (!Number.isFinite(pidNum) || pidNum < 1) return null;
    try {
      const statContent = await readFileTimed(`/proc/${instanceId}/stat`, READ_TIMEOUT_MS);
      if (!statContent) return null;
      const parsed = parseProcStat(statContent);
      if (!parsed) return null;
      const now = Date.now();
      const ticks = parsed.utime + parsed.stime;
      const prev = lastProcReadSample?.get(instanceId);
      const nextMap = lastProcReadSample ? new Map(lastProcReadSample) : new Map();
      nextMap.set(instanceId, { ticks, ts: now });
      if (nextMap.size > 8192) nextMap.clear(); // 防 pid 频繁更替导致 map 无限增长
      lastProcReadSample = nextMap;

      const status = (await readFileTimed(`/proc/${instanceId}/status`, READ_TIMEOUT_MS)) ?? '';
      const rss = /^VmRSS:\s+(\d+)/m.exec(status);
      const uidMatch = /^Uid:\s+(\d+)/m.exec(status);
      const uid = uidMatch ? Number(uidMatch[1]) : null;
      const ownUser = uid !== null && uid === os.userInfo().uid;
      const user = uid !== null ? ((await getPasswdMap()).get(uid) ?? null) : null;

      let exe: string | null = null;
      try { exe = await fs.readlink(`/proc/${instanceId}/exe`); } catch { exe = null; }
      let cwd: string | null = null;
      try { cwd = await fs.readlink(`/proc/${instanceId}/cwd`); } catch { cwd = null; }

      const boot = await getBootTime();
      const startedAt = boot !== null ? boot + Math.floor(parsed.starttime / USER_HZ) : null;

      return {
        kind: 'process',
        pid: pidNum,
        name: parsed.comm,
        user,
        state: parsed.state,
        cpuPct: procCpuPct(ticks, now, prev),
        rssBytes: rss ? Number(rss[1]) * 1024 : 0,
        threads: parsed.threads,
        nice: parsed.nice,
        ppid: parsed.ppid,
        startedAt,
        exe,
        cwd,
        isSelf: pidNum === process.pid,
        ownUser,
      };
    } catch {
      return null;
    }
  }

  /** 读取传感器实例读数（temp/fan/curr/in 输入；毫摄氏度 → °C、电流 mA、电压 mV）。
   *  ucsi/hid 等电源芯片 hwmon 只有 curr/in 输入无 temp/fan——此前
   *  temps/fans 全空时前端显示「无法加载对象」误导用户；现补齐电流/电压
   *  输入，全部为空才由前端显示「无可读输入」解释文案。 */
  async function readThermalReading(instanceId: string): Promise<ObjectReading | null> {
    if (!SYSFS_ID_RE.test(instanceId)) return null;
    const dir = path.join(getSysfsRoot(), 'class', 'hwmon', instanceId);
    try {
      const files = await fs.readdir(dir);
      const temps: { id: string; label: string | null; valueC: number }[] = [];
      const fans: { id: string; label: string | null; rpm: number }[] = [];
      const currs: { id: string; label: string | null; mA: number }[] = [];
      const voltages: { id: string; label: string | null; mV: number }[] = [];
      for (const f of files) {
        const tm = /^temp(\d+)_input$/.exec(f);
        if (tm) {
          const mC = await readSysfsNum(path.join(dir, f));
          if (mC === null) continue;
          const label = await readSysfsStr(path.join(dir, `temp${tm[1]}_label`));
          temps.push({ id: tm[1], label, valueC: mC / 1000 });
          continue;
        }
        const fm = /^fan(\d+)_input$/.exec(f);
        if (fm) {
          const rpm = await readSysfsNum(path.join(dir, f));
          if (rpm === null) continue;
          const label = await readSysfsStr(path.join(dir, `fan${fm[1]}_label`));
          fans.push({ id: fm[1], label, rpm });
          continue;
        }
        const cm = /^curr(\d+)_input$/.exec(f);
        if (cm) {
          const mA = await readSysfsNum(path.join(dir, f));
          if (mA === null) continue;
          const label = await readSysfsStr(path.join(dir, `curr${cm[1]}_label`));
          currs.push({ id: cm[1], label, mA });
          continue;
        }
        const vm = /^in(\d+)_input$/.exec(f);
        if (vm) {
          const mV = await readSysfsNum(path.join(dir, f));
          if (mV === null) continue;
          const label = await readSysfsStr(path.join(dir, `in${vm[1]}_label`));
          voltages.push({ id: vm[1], label, mV });
        }
      }
      const chipName = (await readSysfsStr(path.join(dir, 'name'))) ?? instanceId;
      temps.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      fans.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      currs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      voltages.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      return { kind: 'thermal', name: chipName, temps, fans, currs, voltages };
    } catch {
      return null;
    }
  }

  /** 读取背光实例读数（brightness/max_brightness/actual_brightness + 可写性） */
  async function readBacklightReading(instanceId: string): Promise<ObjectReading | null> {
    if (!SYSFS_ID_RE.test(instanceId)) return null;
    const dir = path.join(getSysfsRoot(), 'class', 'backlight', instanceId);
    const brightness = await readSysfsNum(path.join(dir, 'brightness'));
    if (brightness === null) return null;
    // 可写性预检（fs.access W_OK）：root:root 644 的 intel_backlight 等
    // 只读实例由前端「先解锁再拖」——解锁经 write-object 的 pkexec 回落
    let writable = false;
    try {
      await fs.access(path.join(dir, 'brightness'), fs.constants.W_OK);
      writable = true;
    } catch { /* 只读 */ }
    return {
      kind: 'backlight',
      brightness,
      maxBrightness: (await readSysfsNum(path.join(dir, 'max_brightness'))) ?? brightness,
      actualBrightness: (await readSysfsNum(path.join(dir, 'actual_brightness'))) ?? brightness,
      writable,
    };
  }

  /** 网络速率差值采样（ifname → { rx, tx, ts }；map 上限 256 全清） */
  let lastNetSample: Map<string, { rx: number; tx: number; ts: number }> | null = null;

  /** 无线协商速率缓存（iface → { ts, mbps }；iw 每次 spawn 有开销，10s TTL；
   *  map 上限 256 全清防增长） */
  const wirelessBitrateCache = new Map<string, { ts: number; mbps: number | null }>();

  /**
   * 经 `iw dev <iface> link` 读取无线协商速率（MBit/s → Mbps）。
   * 多数 WiFi 驱动（iwlwifi 等）不在 sysfs 暴露 `speed` 文件——速率行
   * 恒显「—」；此处回落 iw。非无线/未连接/工具缺失回 null（保持「—」语义）。
   *
   * rx 与 tx 双解析取较大值：`rx bitrate` 是「最后一帧的速率」——空闲/
   * 省电时只收到 6 Mbps 基本速率信标帧，rx 被持续刷新为 6.0（实测
   * iwlwifi：rx 6.0 / tx 866.7 VHT-MCS 9），只读 rx 会把协商速率显示成
   * 6 Mbps 虚数；tx bitrate 是协商速率，稳定得多。取两者较大值对称
   * 防御其他驱动 tx 侧衰减的情况。
   */
  async function readWirelessBitrateMbps(iface: string): Promise<number | null> {
    const cached = wirelessBitrateCache.get(iface);
    if (cached && Date.now() - cached.ts < 10000) return cached.mbps;
    let mbps: number | null = null;
    try {
      const { stdout } = await execFileAsync('iw', ['dev', iface, 'link'], { timeout: 3000 });
      const rx = /rx bitrate:\s*([\d.]+)\s*MBit\/s/i.exec(stdout);
      const tx = /tx bitrate:\s*([\d.]+)\s*MBit\/s/i.exec(stdout);
      const best = Math.max(
        rx ? Number(rx[1]) : 0,
        tx ? Number(tx[1]) : 0,
      );
      if (Number.isFinite(best) && best > 0) mbps = Math.round(best * 10) / 10;
    } catch { /* iw 缺失/非无线接口/未连接：保持 null */ }
    if (wirelessBitrateCache.size > 256) wirelessBitrateCache.clear();
    wirelessBitrateCache.set(iface, { ts: Date.now(), mbps });
    return mbps;
  }

  /** 读取网络接口读数（operstate/速率/地址 + rx/tx 差值速率） */
  async function readNetworkReading(instanceId: string): Promise<ObjectReading | null> {
    if (!SYSFS_ID_RE.test(instanceId)) return null;
    const dir = path.join(getSysfsRoot(), 'class', 'net', instanceId);
    try {
      const operstate = (await readSysfsStr(path.join(dir, 'operstate'))) ?? 'unknown';
      const speedRaw = await readSysfsNum(path.join(dir, 'speed')); // Mbit/s；-1 = 未知
      let speedMbps = speedRaw !== null && speedRaw > 0 ? speedRaw : null;
      // sysfs 无 speed（WiFi 常见）：回落 iw 协商速率
      if (speedMbps === null) speedMbps = await readWirelessBitrateMbps(instanceId);
      const addresses: string[] = [];
      const mac = await readSysfsStr(path.join(dir, 'address'));
      if (mac) addresses.push(mac);
      // IPv4 地址经 ip 命令（只读、快；失败仅回退 MAC）
      try {
        const { stdout } = await execFileAsync('ip', ['-o', '-4', 'addr', 'show', 'dev', instanceId], { timeout: 3000 });
        for (const m of stdout.matchAll(/inet\s+(\S+)/g)) {
          if (m[1]) addresses.push(m[1]);
        }
      } catch { /* ip 不可用 */ }
      const rx = (await readSysfsNum(path.join(dir, 'statistics', 'rx_bytes'))) ?? 0;
      const tx = (await readSysfsNum(path.join(dir, 'statistics', 'tx_bytes'))) ?? 0;
      const now = Date.now();
      const prev = lastNetSample?.get(instanceId);
      const nextMap = lastNetSample ? new Map(lastNetSample) : new Map();
      nextMap.set(instanceId, { rx, tx, ts: now });
      if (nextMap.size > 256) nextMap.clear();
      lastNetSample = nextMap;
      let rxBytesPerSec = 0;
      let txBytesPerSec = 0;
      if (prev) {
        const dSec = (now - prev.ts) / 1000;
        if (dSec > 0) {
          rxBytesPerSec = Math.max(0, Math.round((rx - prev.rx) / dSec));
          txBytesPerSec = Math.max(0, Math.round((tx - prev.tx) / dSec));
        }
      }
      return {
        kind: 'network',
        operstate,
        speedMbps,
        addresses,
        rxBytesPerSec,
        txBytesPerSec,
        isLoopback: instanceId === 'lo',
      };
    } catch {
      return null;
    }
  }

  /** 读取电源实例读数（电量/状态/能量/循环次数）。
   *  全部属性**并行**读（每文件仍经 readFileTimed 2s 超时）——EC 慢的
   *  笔记本上顺序读 6 文件单 tick 最坏 12s（读数区长时间停在旧值），
   *  并行后单 tick 最坏 = 单文件 2s，天然构成 tick 总预算。 */
  async function readPowerReading(instanceId: string): Promise<ObjectReading | null> {
    if (!SYSFS_ID_RE.test(instanceId)) return null;
    const dir = path.join(getSysfsRoot(), 'class', 'power_supply', instanceId);
    try {
      const [capacity, status, type, energyNow, energyFull, cycleCount, chargeThreshold] = await Promise.all([
        readSysfsNum(path.join(dir, 'capacity')),
        readSysfsStr(path.join(dir, 'status')),
        readSysfsStr(path.join(dir, 'type')),
        readSysfsNum(path.join(dir, 'energy_now')), // µWh
        readSysfsNum(path.join(dir, 'energy_full')),
        readSysfsNum(path.join(dir, 'cycle_count')),
        readSysfsNum(path.join(dir, 'charge_control_end_threshold')), // 缺失 = 不支持
      ]);
      return { kind: 'power', capacity, status: status ?? 'Unknown', energyNow, energyFull, cycleCount, type: type ?? 'Unknown', chargeThreshold };
    } catch {
      return null;
    }
  }

  /** 读取对象实时读数（cpu/memory/storage/process/thermal/backlight/network/power；tty 走流式通道） */
  async function readObjectReading(classId: string, instanceId: string): Promise<ObjectReading | null> {
    try {
      if (classId === 'processor' && instanceId === 'cpu') {
        const content = await fs.readFile('/proc/stat', 'utf-8');
        const lines = content.split('\n');
        const cur = parseCpuLine(lines[0] ?? '');
        const prev = lastCpuSample;
        const perCorePrev = prev?.perCore ?? new Map();
        const perCore = new Map<string, { total: number; idle: number }>();
        const cores: { id: string; pct: number }[] = [];
        for (const line of lines) {
          if (!line.startsWith('cpu')) continue;
          const coreId = line.slice(3).trim();
          if (!/^\d+$/.test(coreId)) continue;
          const sample = parseCpuLine(line);
          perCore.set(coreId, sample);
          cores.push({ id: coreId, pct: cpuPercent(sample, perCorePrev.get(coreId)) });
        }
        lastCpuSample = { total: cur.total, idle: cur.idle, perCore };
        return { kind: 'cpu', model: await readCpuModel(), totalPct: cpuPercent(cur, prev ?? undefined), cores };
      }
      if (classId === 'processor' && instanceId === 'memory') {
        const content = await fs.readFile('/proc/meminfo', 'utf-8');
        const kb = (key: string): number => {
          // `m` 标志必须存在：/proc/meminfo 只有首行（MemTotal）在串首，
          // MemFree/MemAvailable 等在后续行——无 `m` 时 `^` 永远匹配不到
          // 它们，可用内存恒为 0（显示「占满、可用 0%」的根因）。
          const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(content);
          return m ? Number(m[1]) * 1024 : 0;
        };
        const total = kb('MemTotal');
        const available = kb('MemAvailable');
        const used = Math.max(0, total - available);
        return {
          kind: 'memory',
          totalBytes: total,
          usedBytes: used,
          availableBytes: available,
          percent: total > 0 ? Math.round((used / total) * 100) : 0,
        };
      }
      if (classId === 'storage') {
        const inst = await findObjectInstance(classId, instanceId);
        if (!inst) return null;
        let mountpoint: string | null = null;
        let fstype: string | null = null;
        let sizeLabel: string | null = null;
        if (inst.inst.kind === 'mount') {
          mountpoint = inst.inst.id;
          const mounts = await getMountMap();
          fstype = mounts.get(inst.inst.id)?.fstype ?? null;
        } else {
          const devices = await getAllDevices();
          const flat: LsblkDevice[] = [];
          const walk = (d: LsblkDevice) => { flat.push(d); if (d.children) d.children.forEach(walk); };
          devices.forEach(walk);
          const dev = flat.find((d) => (d.devicePath ?? `/dev/${d.name}`) === inst.inst.id);
          if (dev) {
            mountpoint = dev.mountpoint ?? null;
            fstype = dev.fstype ?? null;
            sizeLabel = dev.size ?? null;
          }
        }
        let usedBytes: number | null = null;
        let totalBytes: number | null = null;
        let percent: number | null = null;
        if (mountpoint) {
          try {
            const s = await fs.statfs(mountpoint);
            totalBytes = s.blocks * s.bsize;
            usedBytes = (s.blocks - s.bfree) * s.bsize;
            percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
          } catch { /* 挂载点刚消失：保持 null */ }
        }
        return {
          kind: 'storage',
          name: inst.inst.name,
          mounted: mountpoint !== null,
          mountpoint,
          sizeLabel,
          usedBytes,
          totalBytes,
          percent,
          fstype,
        };
      }
      if (classId === 'process') {
        return await readProcessReading(instanceId);
      }
      if (classId === 'thermal') {
        return await readThermalReading(instanceId);
      }
      if (classId === 'backlight') {
        return await readBacklightReading(instanceId);
      }
      if (classId === 'network') {
        return await readNetworkReading(instanceId);
      }
      if (classId === 'power') {
        return await readPowerReading(instanceId);
      }
      if (classId === 'gpu') {
        return await readGpuReading(instanceId);
      }
      return null;
    } catch (e) {
      console.error('read-object failed', classId, instanceId, e);
      return null;
    }
  }

  /** 活跃的 tty 读流（streamId → 非阻塞轮询句柄：fd + 定时器） */
  const ttyStreams = new Map<number, { fd: number; timer: ReturnType<typeof setInterval> }>();
  let ttyStreamSeq = 0;

  /**
   * 给异步任务加整体截止时间：超时回 fallback（unref 计时器不阻退出）。
   * 对象枚举/读数的底层 sysfs·proc 读单个有超时，但整条链路没有总闸——
   * 线程池被阻塞读占满时任务会**永久挂起**（既不 resolve 也不 reject，
   * 前端无数据也无报错、只剩旧缓存值）。总闸把「永久挂起」变成
   * 「按超时报错」：list-objects 回 timeout 哨兵（前端显示加载失败）、
   * read-object 回 null（前端连续失败计数 → 「无法读取」）。
   */
  async function withDeadline<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        task,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  ipcMain.handle('system:list-objects', async (_event, force?: boolean) => {
    try {
      // 整体截止 12s（正常枚举 ~0.2–3s；GPU 探测最坏 ~9s 留余量）
      const result = await withDeadline(listObjectsCached(force === true), 12000, null);
      if (result === null) {
        console.error('list-objects timed out');
        return { timeout: true };
      }
      return result;
    } catch (e) {
      console.error('list-objects failed', e);
      return [];
    }
  });

  ipcMain.handle('system:read-object', async (_event, classId: string, instanceId: string) => {
    // 整体截止 5s（单读超时 2s + 并行聚合余量）；超时回 null = 读数失败语义
    return await withDeadline(readObjectReading(classId, instanceId), 5000, null);
  });

  /**
   * 带超时 readlink（/proc/<pid>/exe 等）：D 状态进程的 readlink 会阻塞，
   * Promise.race + unref 计时器 2s 超时回 null（超时后遗留的 readlink
   * 承诺自然收尾，无泄漏风险——菜单点击频率低）。
   */
  async function readlinkTimed(file: string, timeoutMs = READ_TIMEOUT_MS): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        fs.readlink(file),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 解析对象在文件系统中的位置（对象行右键菜单「定位至对象位置」）。
   * 渲染层传入**点击时的实例快照**（枚举可能已刷新，点击行数据才是
   * 用户所见——与「先排序后过滤」同源语义）：进程类读 /proc/<pid>/exe
   * （内核线程/僵尸/已退出回 NO_EXE；带 ` (deleted)` 后缀 = 可执行文件
   * 已删除——剥离后缀回传 deleted 标记，渲染层提示后仍按路径导航，
   * loadPath 的最近可用父级回落兜底）；磁盘/分区 = 块设备节点（枚举
   * id 即 devicePath）；其余类 = 枚举时算好的 nativePath/nativeIsDir。
   * 不 join 入参进路径（无注入面）：实例字段只做形态校验后原样回传。
   */
  ipcMain.handle('system:resolve-object-location', async (_event, inst: unknown) => {
    const o = (inst ?? {}) as Partial<ObjectInstance>;
    if (typeof o.id !== 'string' || typeof o.kind !== 'string') return { ok: false, reason: 'INVALID' };
    if (o.kind === 'process') {
      if (!/^\d+$/.test(o.id)) return { ok: false, reason: 'INVALID' };
      const exe = await readlinkTimed(`/proc/${o.id}/exe`);
      if (!exe) return { ok: false, reason: 'NO_EXE' };
      const DELETED_SUFFIX = ' (deleted)';
      if (exe.endsWith(DELETED_SUFFIX)) {
        return { ok: true, path: exe.slice(0, -DELETED_SUFFIX.length), isDir: false, deleted: true };
      }
      return { ok: true, path: exe, isDir: false };
    }
    if (o.kind === 'disk' || o.kind === 'partition') {
      if (!o.id.startsWith('/dev/')) return { ok: false, reason: 'NO_PATH' };
      return { ok: true, path: o.id, isDir: false };
    }
    if (typeof o.nativePath !== 'string' || !o.nativePath) return { ok: false, reason: 'NO_PATH' };
    return { ok: true, path: o.nativePath, isDir: o.nativeIsDir === true };
  });

  /**
   * 终止进程（危险动作护栏收敛主进程）：信号白名单 TERM/KILL、pid 整数
   * 校验、拒绝终止自身（SELF）。跨用户 EPERM 不引入提权——失败透传渲染层。
   */
  ipcMain.handle('system:process-signal', async (_event, pid: unknown, signal: unknown) => {
    const pidNum = typeof pid === 'number' ? pid : NaN;
    const sig = typeof signal === 'string' ? signal : '';
    if (!Number.isInteger(pidNum) || pidNum < 1 || pidNum > 4194304) return { ok: false, error: 'INVALID_PID' };
    if (sig !== 'TERM' && sig !== 'KILL') return { ok: false, error: 'INVALID_SIGNAL' };
    if (pidNum === process.pid) return { ok: false, error: 'SELF' };
    try {
      process.kill(pidNum, `SIG${sig}` as NodeJS.Signals);
      return { ok: true };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM') return { ok: false, error: 'EPERM' };
      if (code === 'ESRCH') return { ok: false, error: 'GONE' };
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });

  /**
   * 跨 locale 的权限拒绝判定（renice / ip 等 CLI 工具）。EPERM/EACCES 的
   * stderr 是 strerror 译文——随系统 glibc 语言变化（如 zh_CN glibc ≥2.41
   * 译「权限不够」而非「不允许的操作」）；Node 的 execFile 失败时
   * error.message 会附加 stderr（`Command failed: …\n<stderr>`）。覆盖
   * 应用 12 语言对应 glibc 译文 + 英文原样；新增语言变体在此补充。
   */
  const PERMISSION_DENIED_RE = /permission denied|not permitted|不允许的操作|不允許的操作|权限不够|權限不足|權限不夠|許可されていません|許可されていない|허용되지 않습니다|허용되지 않는|권한이 없습니다|Операция не позволена|Операция не разрешена|Операцію не дозволено|Операція не дозволена/i;

  /**
   * 调整进程 nice（-20..19；renice util-linux 通用）。renice 对同用户
   * 进程只允许**增大** nice（降低优先级）——减小 nice（提高优先级，
   * 如「恢复原值」从 2 回到 0）或跨用户/root 进程需要 CAP_SYS_NICE，
   * 直跑 EPERM。EPERM 时经持久特权助手回落（一次 pkexec 授权——前端
   * 「解锁」按钮 = 以当前 nice 写一次触发授权，与背光同款语义）。自身
   * 进程按同用户语义允许调整（renice 自身可逆无危险；终止动作的 SELF
   * 保护在 process-signal 保留）。失败码结构化：NO_TOOL（renice 缺失）/
   * AUTH_FAILED（授权取消/超时）/HELPER_FAILED（助手返回 err——进程
   * 消失等）/其余截尾透传。
   */
  ipcMain.handle('system:process-nice', async (_event, pid: unknown, nice: unknown) => {
    const pidNum = typeof pid === 'number' ? pid : NaN;
    const niceNum = typeof nice === 'number' ? nice : NaN;
    if (!Number.isInteger(pidNum) || pidNum < 1 || pidNum > 4194304) return { ok: false, error: 'INVALID_PID' };
    if (!Number.isInteger(niceNum) || niceNum < -20 || niceNum > 19) return { ok: false, error: 'INVALID_NICE' };
    try {
      await execFileAsync('renice', ['-n', String(niceNum), '-p', String(pidNum)], { timeout: 5000 });
      return { ok: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'NO_TOOL' };
      const msg = getExecError(e).message;
      if (PERMISSION_DENIED_RE.test(msg)) {
        try {
          const helper = await ensurePrivHelper();
          if (!helper) return { ok: false, error: 'AUTH_FAILED' };
          const wrote = await privilegedHelperWrite(helper, `nice ${niceNum} ${pidNum}`);
          return wrote ? { ok: true, escalated: true } : { ok: false, error: 'HELPER_FAILED' };
        } catch (e2) {
          return { ok: false, error: getExecError(e2).message.slice(0, 200) || 'AUTH_FAILED' };
        }
      }
      return { ok: false, error: msg.slice(0, 200) || 'UNKNOWN' };
    }
  });

  // ── 持久特权写助手（背光 / 进程 nice 共用） ──

  /**
   * 持久特权助手：一次 pkexec 拉起常驻 sh，stdin 行协议 → stdout
   * ok/err 确认行。
   *
   * 动机：pkexec 的 polkit 授权缓存按「动作 + 命令行细节」键控——命令行
   * 携带**每次不同的值**时，每次写入都是不同的授权请求：拖一次滑条
   * 弹一次密码框（实测每松手一弹），且弹框抢焦点/用户取消/超时都会让
   * 写入失败。助手方案：首次写入经**一次** pkexec 拉起常驻 sh（用户只
   * 授权一次），后续值经 stdin 行协议写入——授权次数 = 1，拖动不再弹框、
   * 写入必达。
   *
   * 安全：脚本只执行**单一动作**（背光写 sysfs / 进程 renice），入参在
   * 主进程侧校验（SYSFS_ID_RE + 前缀双保险 / 整数 pid+nice）后才进
   * stdin；助手内位置参数形式无注入面。主进程退出时管道 EOF，助手
   * read 返回非零自然退出（无僵尸残留）；授权失败/超时（30s）杀掉进程
   * 并从表移除，用户可重新点「解锁」重试。
   */
  interface PrivilegedHelper {
    /** pkexec 常驻子进程（sh 读 stdin 行 → 执行动作 → 回 ok/err 行） */
    proc: ReturnType<typeof spawn>;
    /** stdout 行缓冲（ok/err 确认行跨 chunk 拼接） */
    buf: string;
    /** 等待确认的写队列（FIFO，与 stdin 写入顺序一一对应） */
    waiters: Array<(ok: boolean) => void>;
  }

  /**
   * 拉起持久特权助手并等待 ready 握手（ready = pkexec 授权成功、sh
   * 就绪；30s 超时）。失败（用户取消/超时/spawn 失败）杀进程并从
   * registry 移除（key 定位，保证表中不留死助手）；调用侧可在下次触发
   * 时重新拉起（再弹一次授权框）。script 为 sh -c 脚本体，name 为 $0，
   * args 为 $1 起的位置参数。
   */
  async function launchPrivilegedHelper(
    registry: Map<string, PrivilegedHelper>,
    key: string,
    script: string,
    name: string,
    args: string[],
  ): Promise<PrivilegedHelper | null> {
    const helper: PrivilegedHelper = {
      proc: spawn('pkexec', ['sh', '-c', script, name, ...args], { stdio: ['pipe', 'pipe', 'pipe'] }),
      buf: '',
      waiters: [],
    };
    registry.set(key, helper);
    const ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      helper.proc.stdout?.on('data', (chunk: Buffer) => {
        helper.buf += chunk.toString();
        let idx: number;
        while ((idx = helper.buf.indexOf('\n')) >= 0) {
          const line = helper.buf.slice(0, idx).trim();
          helper.buf = helper.buf.slice(idx + 1);
          if (!line) continue;
          if (line === 'ready') { settle(true); continue; }
          const w = helper.waiters.shift();
          if (w) w(line === 'ok');
        }
      });
      helper.proc.once('error', () => {
        settle(false);
        // spawn 失败只派发 error 不派发 exit：挂起写入同样按失败结算
        while (helper.waiters.length > 0) helper.waiters.shift()?.(false);
        if (registry.get(key) === helper) registry.delete(key);
      });
      helper.proc.once('exit', () => {
        settle(false);
        // 进程退出：全部挂起写入按失败结算（不悬挂渲染层）
        while (helper.waiters.length > 0) helper.waiters.shift()?.(false);
        if (registry.get(key) === helper) registry.delete(key);
      });
    });
    const ok = await Promise.race([
      ready,
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 30000);
        timer.unref?.();
      }),
    ]);
    if (!ok) {
      try { helper.proc.kill(); } catch { /* 已退出 */ }
      if (registry.get(key) === helper) registry.delete(key);
      return null;
    }
    return helper;
  }

  /** 经助手写一行（stdin 行协议；等待 ok/err 确认行） */
  function privilegedHelperWrite(helper: PrivilegedHelper, line: string): Promise<boolean> {
    return new Promise((resolve) => {
      helper.waiters.push(resolve);
      try {
        helper.proc.stdin?.write(`${line}\n`);
      } catch {
        const idx = helper.waiters.indexOf(resolve);
        if (idx >= 0) helper.waiters.splice(idx, 1);
        resolve(false);
      }
    });
  }

  // ── 背光特权写助手 ──

  // ── 通用特权助手（review 22：背光 / 充电阈值 / 进程 nice 合并） ──

  /**
   * 通用持久特权助手——一次 pkexec 授权覆盖全部需要提权的滑条写入
   * （sysfs 只读文件的背光/充电阈值直写 EACCES 回落、跨用户 renice
   * EPERM 回落）。「先解锁再拖」模型下所有滑条默认锁定，任一解锁按钮 =
   * system:privileged-auth 提前拉起本助手（一次 pkexec）；本会话内
   * 任意写入零弹框；任一锁定按钮 = system:privileged-lock kill 助手、
   * 全部复锁（review 22 用户定案：解锁/锁定全局通用、切换页面不复锁）。
   *
   * stdin 行协议（主进程侧校验后才进 stdin）：
   * - `write <path> <value>` → `printf %s value > path` → ok/err（path 经
   *   SYSFS_ID_RE + 前缀 + 固定文件名解析，无空格/斜杠注入面；value 整数）；
   * - `nice <nice> <pid>` → `renice -n nice -p pid` → ok/err（nice/pid 整数；
   *   renice 绝对路径经 command -v 解析——pkexec 环境无 PATH，与
   *   network-set 的 ip 同源手法；缺失时 nice 命令恒 err = NO_TOOL 语义）。
   *
   * 助手脚本只用 shell 内建（printf/read/test/case）+ renice——pkexec
   * 环境无 PATH，不依赖外部命令。单例（key 'priv'）：授权一次覆盖全部
   * 目标；安全面与旧按 target 键控助手一致（路径仍由主进程白名单解析，
   * 助手不接触任何用户可控字符串之外的数据）。
   */
  const privHelpers = new Map<string, PrivilegedHelper>();

  /** renice 绝对路径解析（会话内缓存——renice 不会中途消失） */
  let renicePathCache: string | null | undefined;
  async function resolveRenicePath(): Promise<string | null> {
    if (renicePathCache !== undefined) return renicePathCache;
    renicePathCache = null;
    try {
      const { stdout } = await execFileAsync('sh', ['-c', 'command -v renice'], { timeout: 3000 });
      renicePathCache = stdout.trim() || null;
    } catch { /* renice 缺失 */ }
    return renicePathCache;
  }

  /**
   * 获取（或拉起）全局通用特权助手；授权失败/超时回 null。写入侧调用——
   * 非 null 即已收到 ready 行（pkexec 授权成功、sh 就绪）。
   */
  async function ensurePrivHelper(): Promise<PrivilegedHelper | null> {
    const existing = privHelpers.get('priv');
    if (existing) {
      if (existing.proc.exitCode === null && existing.proc.signalCode === null) return existing;
      privHelpers.delete('priv');
    }
    const renicePath = await resolveRenicePath();
    return launchPrivilegedHelper(
      privHelpers,
      'priv',
      'printf "ready\\n"; R="$1"; while IFS= read -r line; do set -- $line; case "$1" in write) printf "%s" "$3" > "$2" && printf "ok\\n" || printf "err\\n";; nice) [ -n "$R" ] && "$R" -n "$2" -p "$3" >/dev/null 2>&1 && printf "ok\\n" || printf "err\\n";; esac; done',
      'hoshineko-priv',
      [renicePath ?? ''],
    );
  }

  /**
   * 提前授权全部特权滑条写入（前端任一「解锁」按钮，review 22 全局化）：
   * 直接拉起通用持久助手——一次 pkexec 授权，**本会话有效**（助手常驻到
   * 主进程退出，与 polkit 5 分钟临时授权缓存无关；后续写走 stdin 行协议
   * 零弹框）。失败码：AUTH_FAILED（授权取消/超时/助手拉起失败）。
   */
  ipcMain.handle('system:privileged-auth', async () => {
    try {
      const helper = await ensurePrivHelper();
      return helper ? { ok: true } : { ok: false, error: 'AUTH_FAILED' };
    } catch (e) {
      return { ok: false, error: getExecError(e).message.slice(0, 200) || 'AUTH_FAILED' };
    }
  });

  /** 终止持久特权助手（kill 进程；exit 事件会结算挂起写队列并移出 registry） */
  function killPrivilegedHelper(registry: Map<string, PrivilegedHelper>, key: string): void {
    const helper = registry.get(key);
    if (!helper) return;
    try { helper.proc.kill(); } catch { /* 已退出 */ }
  }

  /**
   * 撤销全部特权授权（前端任一「锁定」按钮，review 22 全局化）：kill
   * 通用助手——下次任何需要提权的写入重新弹 pkexec 授权。所有锁定键
   * 通用（用户定案）。
   */
  ipcMain.handle('system:privileged-lock', () => {
    killPrivilegedHelper(privHelpers, 'priv');
    return { ok: true };
  });

  /** 批量进程操作单次上限（防误伤；与搜索结果上限同精神） */
  const PROCESS_BATCH_MAX = 50;

  /** 性能模式白名单（power-profiles-daemon 标准档位） */
  const POWER_PROFILE_MODES = new Set(['performance', 'balanced', 'power-saver']);

  /** ppd D-Bus 读取（无 CLI 时回落）：UPower.PowerProfiles 属性——
   *  Fedora 等发行版守护进程默认在而 powerprofilesctl CLI 可能未安装 */
  async function readPowerProfilesDbus(): Promise<{ available: string[]; active: string } | null> {
    try {
      const bus = dbus.systemBus();
      const obj = await bus.getProxyObject('org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles');
      const props = obj.getInterface('org.freedesktop.DBus.Properties');
      const profiles = await props.Get('org.freedesktop.UPower.PowerProfiles', 'Profiles');
      const active = await props.Get('org.freedesktop.UPower.PowerProfiles', 'ActiveProfile');
      const available = ((profiles.value ?? []) as Array<{ Profile?: { value?: string } }>)
        .map((p) => p.Profile?.value ?? '')
        .filter(Boolean);
      const activeMode = (active.value as string) ?? '';
      if (available.length === 0) return null;
      return { available, active: available.includes(activeMode) ? activeMode : available[0] };
    } catch {
      return null;
    }
  }

  /** ppd D-Bus 设置档位（守护进程侧 polkit 授权，活跃本地会话通常免密） */
  async function setPowerProfileDbus(mode: string): Promise<void> {
    const bus = dbus.systemBus();
    const obj = await bus.getProxyObject('org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles');
    // 新版 ppd（HoldProfile/ReleaseProfile API）已移除 SetActiveProfile
    // 方法且 introspect 不宣布属性——档位经 Properties.Set 写
    // ActiveProfile（实测 gdbus 直设可写）；旧版保留方法的优先调用
    const iface = obj.getInterface('org.freedesktop.UPower.PowerProfiles');
    if (typeof (iface as unknown as Record<string, unknown>).SetActiveProfile === 'function') {
      await (iface as unknown as { SetActiveProfile: (m: string) => Promise<void> }).SetActiveProfile(mode);
      return;
    }
    const props = obj.getInterface('org.freedesktop.DBus.Properties');
    await props.Set('org.freedesktop.UPower.PowerProfiles', 'ActiveProfile', new dbus.Variant('s', mode));
  }

  /** powerprofilesctl 绝对路径解析（pkexec 环境无 PATH；会话内缓存。
   *  `HOSHINEKO_E2E_POWER_PROFILES` 沙箱覆盖（e2e 假工具） */
  let powerProfilesPathCache: string | null | undefined;
  async function getPowerProfilesctlPath(): Promise<string | null> {
    if (powerProfilesPathCache !== undefined) return powerProfilesPathCache;
    powerProfilesPathCache = null;
    const override = process.env.HOSHINEKO_E2E_POWER_PROFILES;
    if (override) {
      powerProfilesPathCache = override;
      return powerProfilesPathCache;
    }
    try {
      const { stdout } = await execFileAsync('sh', ['-c', 'command -v powerprofilesctl'], { timeout: 3000 });
      powerProfilesPathCache = stdout.trim() || null;
    } catch { /* 工具缺失 */ }
    return powerProfilesPathCache;
  }

  /**
   * 读取性能模式（power-profiles-daemon）：优先 `powerprofilesctl list`
   * 解析可用档位 + 当前档位（`*` 前缀行）；CLI 缺失回落 D-Bus
   * UPower.PowerProfiles 属性。两者皆不可用回 NO_TOOL（检测到才显示
   * 哲学——守护进程在而 CLI 未安装的系统也能用）。
   */
  ipcMain.handle('system:power-profile-info', async () => {
    const tool = await getPowerProfilesctlPath();
    if (tool) {
      try {
        const { stdout } = await execFileAsync(tool, ['list'], { timeout: 5000 });
        const modes: string[] = [];
        let active: string | null = null;
        for (const line of stdout.split('\n')) {
          const m = /^\s*(\*?)\s*([a-z-]+):\s*$/.exec(line);
          if (!m) continue;
          modes.push(m[2]);
          if (m[1]) active = m[2];
        }
        if (modes.length > 0) return { ok: true, available: modes, active: active ?? modes[0] };
      } catch { /* CLI 失败——回落 D-Bus */ }
    }
    const dbusInfo = await readPowerProfilesDbus();
    if (dbusInfo) return { ok: true, ...dbusInfo };
    return { ok: false, reason: 'NO_TOOL' };
  });

  /**
   * 设置性能模式：优先直试 `powerprofilesctl set <mode>`（白名单档位），
   * 权限错误（polkit 授权）经 pkexec 绝对路径回落（network-set 同款）；
   * CLI 缺失回落 D-Bus SetActiveProfile（守护进程侧 polkit 授权）。
   */
  ipcMain.handle('system:power-profile-set', async (_event, mode: unknown) => {
    if (typeof mode !== 'string' || !POWER_PROFILE_MODES.has(mode)) return { ok: false, error: 'INVALID_MODE' };
    const tool = await getPowerProfilesctlPath();
    if (tool) {
      try {
        await execFileAsync(tool, ['set', mode], { timeout: 8000 });
        return { ok: true, escalated: false };
      } catch (e) {
        const msg = getExecError(e).message;
        if (PERMISSION_DENIED_RE.test(msg)) {
          try {
            await execFileAsync('pkexec', [tool, 'set', mode], { timeout: 30000 });
            return { ok: true, escalated: true };
          } catch (e2) {
            return { ok: false, error: getExecError(e2).message.slice(0, 200) || 'AUTH_FAILED' };
          }
        }
        return { ok: false, error: msg.slice(0, 200) || 'UNKNOWN' };
      }
    }
    try {
      await setPowerProfileDbus(mode);
      return { ok: true, escalated: false };
    } catch (e) {
      return { ok: false, error: getExecError(e).message.slice(0, 200) || 'AUTH_FAILED' };
    }
  });

  // ── 搜索历史（文件/对象；数据非设置，落盘 ~/.config/HoshinekoFM） ──

  /** 单条历史上限（各 100 条；UI 展示条数由设置 searchRecentCount 控制） */
  const SEARCH_HISTORY_MAX = 100;

  /** 搜索历史落盘目录（`HOSHINEKO_E2E_CONFIG_DIR` 沙箱覆盖——e2e 防写真实配置） */
  function searchHistoryDir(): string {
    return process.env.HOSHINEKO_E2E_CONFIG_DIR || path.join(os.homedir(), '.config', 'HoshinekoFM');
  }
  function searchHistoryFile(kind: 'file' | 'object'): string {
    return path.join(searchHistoryDir(), `search-history-${kind}.json`);
  }

  /** 读取搜索历史（损坏/缺失回空数组；逐条校验形态 + 截断上限） */
  ipcMain.handle('system:load-search-history', async (_event, kind: unknown) => {
    if (kind !== 'file' && kind !== 'object') return [];
    try {
      const raw = await fs.readFile(searchHistoryFile(kind), 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      if (kind === 'object') {
        return parsed.filter((x): x is string => typeof x === 'string' && !!x).slice(0, SEARCH_HISTORY_MAX);
      }
      return parsed
        .filter((x): x is { dir: string; query: string } =>
          !!x && typeof x === 'object' && typeof x.dir === 'string' && typeof x.query === 'string' && !!x.query)
        .slice(0, SEARCH_HISTORY_MAX);
    } catch {
      return [];
    }
  });

  /** 保存搜索历史（原子写：临时文件 + rename；逐条校验 + 截断上限） */
  ipcMain.handle('system:save-search-history', async (_event, kind: unknown, entries: unknown) => {
    if (kind !== 'file' && kind !== 'object') return { ok: false, error: 'INVALID_KIND' };
    const list = kind === 'object'
      ? (Array.isArray(entries) ? entries.filter((x): x is string => typeof x === 'string' && !!x).slice(0, SEARCH_HISTORY_MAX) : [])
      : (Array.isArray(entries)
        ? entries.filter((x): x is { dir: string; query: string } =>
          !!x && typeof x === 'object' && typeof x.dir === 'string' && typeof x.query === 'string' && !!x.query).slice(0, SEARCH_HISTORY_MAX)
        : []);
    try {
      const file = searchHistoryFile(kind);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf-8');
      await fs.rename(tmp, file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });

  /**
   * 批量终止进程（多选）：逐 pid 执行信号（TERM/KILL 白名单、自身拒绝、
   * EPERM/GONE 结构化）并聚合结果——单次上限 PROCESS_BATCH_MAX。确认与
   * 汇总在渲染层（一次确认 + 结果 toast）。
   */
  ipcMain.handle('system:process-signal-batch', async (_event, pids: unknown, signal: unknown) => {
    const sig = typeof signal === 'string' ? signal : '';
    if (sig !== 'TERM' && sig !== 'KILL') return { ok: false, error: 'INVALID_SIGNAL' };
    if (!Array.isArray(pids) || pids.length === 0 || pids.length > PROCESS_BATCH_MAX) return { ok: false, error: 'INVALID_PIDS' };
    const results: { pid: unknown; ok: boolean; error?: string }[] = [];
    for (const pid of pids) {
      const pidNum = typeof pid === 'number' ? pid : NaN;
      if (!Number.isInteger(pidNum) || pidNum < 1 || pidNum > 4194304) {
        results.push({ pid, ok: false, error: 'INVALID_PID' });
        continue;
      }
      if (pidNum === process.pid) {
        results.push({ pid, ok: false, error: 'SELF' });
        continue;
      }
      try {
        process.kill(pidNum, `SIG${sig}` as NodeJS.Signals);
        results.push({ pid, ok: true });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        results.push({ pid, ok: false, error: code === 'EPERM' ? 'EPERM' : code === 'ESRCH' ? 'GONE' : String((e as Error)?.message ?? e) });
      }
    }
    return { ok: true, results };
  });

  /**
   * 批量调整进程 nice（多选预设档）：逐 pid 复刻 process-nice 语义——
   * 直跑 renice、EPERM（减小 nice 提高优先级）经持久助手回落；聚合
   * 结果（成功/失败逐项）。渲染层在未解锁时不提供该入口。
   */
  ipcMain.handle('system:process-nice-batch', async (_event, pids: unknown, nice: unknown) => {
    const niceNum = typeof nice === 'number' ? nice : NaN;
    if (!Number.isInteger(niceNum) || niceNum < -20 || niceNum > 19) return { ok: false, error: 'INVALID_NICE' };
    if (!Array.isArray(pids) || pids.length === 0 || pids.length > PROCESS_BATCH_MAX) return { ok: false, error: 'INVALID_PIDS' };
    const results: { pid: unknown; ok: boolean; error?: string }[] = [];
    for (const pid of pids) {
      const pidNum = typeof pid === 'number' ? pid : NaN;
      if (!Number.isInteger(pidNum) || pidNum < 1 || pidNum > 4194304) {
        results.push({ pid, ok: false, error: 'INVALID_PID' });
        continue;
      }
      try {
        await execFileAsync('renice', ['-n', String(niceNum), '-p', String(pidNum)], { timeout: 5000 });
        results.push({ pid, ok: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          results.push({ pid, ok: false, error: 'NO_TOOL' });
          continue;
        }
        const msg = getExecError(e).message;
        if (PERMISSION_DENIED_RE.test(msg)) {
          try {
            const helper = await ensurePrivHelper();
            if (!helper) {
              results.push({ pid, ok: false, error: 'AUTH_FAILED' });
              continue;
            }
            const wrote = await privilegedHelperWrite(helper, `nice ${niceNum} ${pidNum}`);
            results.push(wrote ? { pid, ok: true } : { pid, ok: false, error: 'HELPER_FAILED' });
          } catch (e2) {
            results.push({ pid, ok: false, error: getExecError(e2).message.slice(0, 200) || 'AUTH_FAILED' });
          }
        } else {
          results.push({ pid, ok: false, error: msg.slice(0, 200) || 'UNKNOWN' });
        }
      }
    }
    return { ok: true, results };
  });

  /**
   * 兑现 v1 预留的写通道（决策 5）：仅 backlight 类 brightness 键。
   * 三层校验：类/键白名单 + instanceId 形态（SYSFS_ID_RE，无斜杠，天然
   * 防 ../ 逃逸）+ 值范围（0..max_brightness，写前读上限）。写前读旧值
   * 回传供「恢复原值」。直写 EACCES/EPERM（root:root 644 的
   * intel_backlight 等）时经持久助手回落（一次 pkexec 授权，拖动不再
   * 重复弹框，见 BacklightHelper 注释）。
   */
  ipcMain.handle('system:write-object', async (_event, classId: unknown, instanceId: unknown, key: unknown, value: unknown) => {
    if (typeof instanceId !== 'string' || !SYSFS_ID_RE.test(instanceId)) return { ok: false, error: 'INVALID_ID' };
    let target: string;
    let rangeMax: number | null;
    let previous: number | null;
    if (classId === 'backlight' && key === 'brightness') {
      const base = path.join(getSysfsRoot(), 'class', 'backlight');
      const dir = path.join(base, instanceId);
      if (!dir.startsWith(base + path.sep)) return { ok: false, error: 'INVALID_ID' };
      rangeMax = await readSysfsNum(path.join(dir, 'max_brightness'));
      if (rangeMax === null) return { ok: false, error: 'NO_DEVICE' };
      previous = await readSysfsNum(path.join(dir, 'brightness'));
      target = path.join(dir, 'brightness');
    } else if (classId === 'power' && key === 'chargeThreshold') {
      const base = path.join(getSysfsRoot(), 'class', 'power_supply');
      const dir = path.join(base, instanceId);
      if (!dir.startsWith(base + path.sep)) return { ok: false, error: 'INVALID_ID' };
      rangeMax = 100;
      previous = await readSysfsNum(path.join(dir, 'charge_control_end_threshold'));
      target = path.join(dir, 'charge_control_end_threshold');
    } else {
      return { ok: false, error: 'UNKNOWN_CLASS' };
    }
    const v = typeof value === 'number' ? value : NaN;
    if (!Number.isInteger(v) || v < 0 || v > rangeMax) return { ok: false, error: 'OUT_OF_RANGE' };
    try {
      await fs.writeFile(target, String(v));
      return { ok: true, previous, escalated: false };
    } catch (e1) {
      const msg = String((e1 as NodeJS.ErrnoException)?.message ?? e1);
      // EACCES/EPERM（root:root 644 的 intel_backlight 等）：持久助手回落。
      if (!/EACCES|EPERM|permission denied/i.test(msg)) {
        return { ok: false, error: msg.slice(0, 200) };
      }
      try {
        const helper = await ensurePrivHelper();
        if (!helper) return { ok: false, error: 'AUTH_FAILED' };
        const wrote = await privilegedHelperWrite(helper, `write ${target} ${v}`);
        return wrote ? { ok: true, previous, escalated: true } : { ok: false, error: 'WRITE_FAILED' };
      } catch (e2) {
        return { ok: false, error: getExecError(e2).message.slice(0, 200) || 'AUTH_FAILED' };
      }
    }
  });

  /** SMART 属性筛选关键词（id/名称包含任一者才保留，信息密度优先） */
  const SMART_ATTR_KEYWORDS = [
    'reallocated_sector', 'current_pending_sector', 'power_on_hours', 'temperature',
    'wear_leveling', 'media_wearout', 'percentage_used', 'unsafe_shutdown', 'power_cycle',
  ];

  /**
   * 读取块设备 SMART 健康（smartctl 一次性静态信息，绝不自检/写）。
   * 工具缺失/需 root/不支持分别返回结构化 reason（渲染层占位提示），
   * 遵循「检测到才显示、未检测到提示用户」语义。
   */
  ipcMain.handle('system:smart-info', async (_event, devicePath: unknown) => {
    if (typeof devicePath !== 'string' || !devicePath.startsWith('/dev/')) {
      return { ok: false, reason: 'NO_DEVICE' };
    }
    try {
      await execFileAsync('smartctl', ['--version'], { timeout: 3000 });
    } catch {
      return { ok: false, reason: 'NO_TOOL' };
    }
    try {
      const { stdout } = await execFileAsync('smartctl', ['-A', '-i', devicePath], { timeout: 5000, maxBuffer: 1024 * 1024 });
      const model = /^(?:Model Family|Device Model|Model Number):\s*(.+)$/m.exec(stdout)?.[1]?.trim() ?? null;
      const nvmeTemp = /^Temperature:\s*(\d+)\s*Celsius/m.exec(stdout)?.[1];
      const nvmeHours = /^Power On Hours:\s*(\d+)/m.exec(stdout)?.[1];
      const attributes: { name: string; raw: string; value: number | null; worst: number | null; threshold: number | null }[] = [];
      for (const line of stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(\S+)\s+\S+\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+\S+){2,3}\s+(\S+.*)$/.exec(line);
        if (!m) continue;
        const name = m[2];
        if (!SMART_ATTR_KEYWORDS.some((k) => name.toLowerCase().includes(k))) continue;
        attributes.push({
          name,
          raw: m[6].trim(),
          value: Number(m[3]),
          worst: Number(m[4]),
          threshold: Number(m[5]),
        });
      }
      // NVMe 输出不是 ATA 属性表：把关键健康行降级为伪属性（value/threshold 无意义）
      if (attributes.length === 0 && /nvme/i.test(stdout)) {
        const nvmeRows: Array<[string, RegExp]> = [
          ['Percentage Used', /^Percentage Used:\s*(\S+)/],
          ['Available Spare', /^Available Spare:\s*(\S+)/],
          ['Unsafe Shutdowns', /^Unsafe Shutdowns:\s*(\S+)/],
          ['Power Cycles', /^Power Cycles:\s*(\S+)/],
        ];
        for (const [name, re] of nvmeRows) {
          const m = re.exec(stdout);
          if (m) attributes.push({ name, raw: m[1], value: null, worst: null, threshold: null });
        }
      }
      const tempC = attributes.find((a) => a.name.toLowerCase().includes('temperature'))?.raw ?? (nvmeTemp ? nvmeTemp : null);
      const powerOnHours = attributes.find((a) => a.name.toLowerCase().includes('power_on_hours'))?.raw ?? (nvmeHours ?? null);
      return {
        ok: true,
        model,
        tempC: tempC !== null ? Number(String(tempC).replace(/\D/g, '')) || null : null,
        powerOnHours: powerOnHours !== null ? Number(String(powerOnHours).replace(/\D/g, '')) || null : null,
        attributes,
      };
    } catch (e) {
      const out = String((e as { stdout?: string })?.stdout ?? '') + String((e as { stderr?: string })?.stderr ?? '') + String((e as Error)?.message ?? '');
      if (/permission denied|requires root|smartctl: .*Permission/i.test(out)) return { ok: false, reason: 'NEED_ROOT' };
      if (/unable to detect device type|doesn.t support|unsupported/i.test(out)) return { ok: false, reason: 'NOT_SUPPORTED' };
      return { ok: false, reason: 'NOT_SUPPORTED' };
    }
  });

  /** ip 工具绝对路径（pkexec 最小环境无 PATH）；检测一次缓存 */
  let ipPathCache: string | null | undefined;
  async function getIpPath(): Promise<string | null> {
    if (ipPathCache !== undefined) return ipPathCache;
    ipPathCache = null;
    for (const cand of ['/usr/sbin/ip', '/usr/bin/ip', '/sbin/ip', '/bin/ip']) {
      if (existsSync(cand)) { ipPathCache = cand; break; }
    }
    return ipPathCache;
  }

  /**
   * 网络接口 up/down（L2 危险动作，确认在渲染层）。普通用户直接尝试
   * （有 CAP_NET_ADMIN 的环境免提权）；Operation not permitted 回落
   * pkexec 提权（ip 传绝对路径，pkexec 环境无 PATH）。lo 拒绝操作。
   */
  ipcMain.handle('system:network-set', async (_event, iface: unknown, up: unknown) => {
    if (typeof iface !== 'string' || !SYSFS_ID_RE.test(iface)) return { ok: false, error: 'INVALID_IFACE' };
    if (typeof up !== 'boolean') return { ok: false, error: 'INVALID_VALUE' };
    if (iface === 'lo') return { ok: false, error: 'LOOPBACK' };
    const ipPath = await getIpPath();
    if (!ipPath) return { ok: false, error: 'NO_IP_TOOL' };
    const args = ['link', 'set', 'dev', iface, up ? 'up' : 'down'];
    try {
      await execFileAsync(ipPath, args, { timeout: 8000 });
      return { ok: true, escalated: false };
    } catch (e1) {
      const msg = String((e1 as { stderr?: string })?.stderr ?? '') + String((e1 as Error)?.message ?? '');
      if (!PERMISSION_DENIED_RE.test(msg)) {
        return { ok: false, error: getExecError(e1).message.slice(0, 200) || msg.slice(0, 200) };
      }
      try {
        await execFileAsync('pkexec', [ipPath, ...args], { timeout: 30000 });
        return { ok: true, escalated: true };
      } catch (e2) {
        return { ok: false, error: getExecError(e2).message.slice(0, 200) || 'AUTH_FAILED' };
      }
    }
  });

  /**
   * 开始读取 tty 输出流（v1 只读）：白名单 ttyN（防任意设备路径）。
   * 数据经 `objects:tty-data:<streamId>` 事件推送；错误/关闭各有事件。
   *
   * **非阻塞轮询实现（线程池泄漏修复）**：旧实现 createReadStream 阻塞
   * 读 tty——等数据、永不 EOF，每条流**占死一个 libuv 线程池线程**；
   * 且 `stream.destroy()` 无法打断已阻塞的 read(2)（实测 close 后线程
   * 仍卡 n_tty_read 直到 tty 有新输入），渲染层「离开页面即回收」竞态
   * 再一叠加，反复进出 tty 页就永久泄漏线程、4 条即耗尽线程池导致
   * 全应用文件 I/O 冻结（排查报告 §3）。现改为 **O_NONBLOCK 打开 +
   * 定时轮询**：每次 read 立即返回（EAGAIN 静默），线程只在 syscall
   * 瞬间被占用——流关闭后线程即时释放，无泄漏面。上限守卫防 fd 泄漏
   * 兜底。**写入预留**：未来交互式终端只需在本通道加写分支（保持
   * start/stop 契约不变），不新开协议。
   */
  const MAX_TTY_STREAMS = 16;
  /** tty 轮询间隔（毫秒）：非阻塞读开销极小，500ms 足够及时 */
  const TTY_POLL_MS = 500;
  ipcMain.handle('objects:tty-start', async (event, ttyId: string) => {
    if (typeof ttyId !== 'string' || !/^tty\d+$/.test(ttyId)) {
      return { ok: false, error: 'INVALID_ID' };
    }
    if (ttyStreams.size >= MAX_TTY_STREAMS) {
      return { ok: false, error: 'TOO_MANY' };
    }
    let fd: number;
    try {
      fd = await new Promise<number>((resolve, reject) => {
        fsOpen(`/dev/${ttyId}`, constants.O_RDONLY | constants.O_NONBLOCK, (err, f) => {
          if (err) reject(err);
          else resolve(f);
        });
      });
    } catch {
      return { ok: false, error: 'OPEN_FAILED' };
    }
    const streamId = ++ttyStreamSeq;
    const buffer = Buffer.alloc(4096);
    const cleanup = () => {
      const entry = ttyStreams.get(streamId);
      if (!entry) return;
      ttyStreams.delete(streamId);
      clearInterval(entry.timer);
      fsClose(entry.fd, () => { /* 忽略关闭错误 */ });
    };
    const timer = setInterval(() => {
      fsRead(fd, buffer, 0, buffer.length, null, (err, bytesRead) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'EAGAIN') return; // 无数据，静默
          cleanup();
          if (!event.sender.isDestroyed()) {
            event.sender.send(`objects:tty-error:${streamId}`, String(err.message ?? err));
          }
          return;
        }
        if (bytesRead === 0) return; // 无数据
        if (!event.sender.isDestroyed()) {
          event.sender.send(`objects:tty-data:${streamId}`, buffer.toString('utf8', 0, bytesRead));
        }
      });
    }, TTY_POLL_MS);
    timer.unref?.();
    ttyStreams.set(streamId, { fd, timer });
    event.sender.once('destroyed', () => {
      cleanup();
      if (!event.sender.isDestroyed()) {
        event.sender.send(`objects:tty-close:${streamId}`);
      }
    });
    return { ok: true, streamId };
  });

  /** 停止 tty 输出流（关闭 fd + 清轮询；已停止幂等） */
  ipcMain.handle('objects:tty-stop', (_event, streamId: number) => {
    const entry = ttyStreams.get(streamId);
    if (entry) {
      ttyStreams.delete(streamId);
      clearInterval(entry.timer);
      fsClose(entry.fd, () => { /* 忽略关闭错误 */ });
    }
    return true;
  });
}
