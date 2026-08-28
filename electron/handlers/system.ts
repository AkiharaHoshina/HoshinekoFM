import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { promises as fs, watch as fsWatch } from 'fs';
import os from 'os';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import dbus from 'dbus-next';
import { getMountMap, getExecError } from '../shared';

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

export function registerSystemHandlers() {
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

  /**
   * 在系统默认终端中运行可执行文件。
   * 后端复核可执行位（防御性检查，前端只对可执行文件显示入口）：
   * 目录虽有 X_OK 位但无法被终端执行，需单独排除；
   * 不可执行时返回 `code: 'NOT_EXECUTABLE'`。
   */
  ipcMain.handle('system:run-in-terminal', async (_event, filePath: string) => {
    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) return { success: false, code: 'NOT_EXECUTABLE' };
    } catch {
      return { success: false, code: 'NOT_EXECUTABLE' };
    }

    try {
      await fs.access(filePath, fs.constants.X_OK);
    } catch {
      return { success: false, code: 'NOT_EXECUTABLE' };
    }

    const terminal = await getDefaultTerminal();
    if (!terminal) return { success: false, code: 'NO_TERMINAL' };

    const cwd = path.dirname(filePath);

    if (terminal.delegate) {
      const result = await spawnDetached(terminal.command, [filePath], cwd);
      return result === true ? { success: true } : { success: false, error: result };
    }

    const args = terminal.spec?.exec ? terminal.spec.exec([filePath]) : ['-e', filePath];
    const result = await spawnDetached(terminal.command, args, cwd);
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

  ipcMain.handle('system:get-all-devices', async () => getAllDevices());

  ipcMain.handle('system:has-device-watcher', async () => udisks2Available);

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
      if (mountMatch) return { success: true, mountpoint: mountMatch[1].trim() };
      const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
      if (alreadyMatch) return { success: true, mountpoint: alreadyMatch[1] };
      return { success: false, error: stderr || 'Unknown error' };
    } catch (e) {
      const { stderr } = getExecError(e);
      const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
      if (alreadyMatch) return { success: true, mountpoint: alreadyMatch[1] };
      return { success: false, error: stderr || getExecError(e).message || 'Mount failed' };
    }
  });

  ipcMain.handle('system:unmount-device', async (_event, devicePath: string) => {
    try {
      await execAsync(`udisksctl unmount -b "${devicePath}"`);
      return { success: true };
    } catch (e) {
      const { stderr, message } = getExecError(e);
      return { success: false, error: stderr || message || 'Unmount failed' };
    }
  });

  /**
   * Eject (power off) a device. Fails with a `code` of `PARTITIONS_MOUNTED`
   * when the device still has mounted partitions — the renderer translates
   * the code instead of receiving a hardcoded message.
   */
  ipcMain.handle('system:eject-device', async (_event, devicePath: string) => {
    try {
      const mountMap = await getMountMap();
      for (const [, info] of mountMap) {
        if (info.source && info.source.startsWith(devicePath) && info.source !== devicePath) {
          return { success: false, code: 'PARTITIONS_MOUNTED' };
        }
      }
      await execAsync(`udisksctl power-off -b "${devicePath}"`);
      return { success: true };
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

  ipcMain.handle('system:search', async (_, directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => {
    try {
      const args = [directory];
      if (options?.type) args.push('-type', options.type);
      if (query) args.push('-iname', `*${query}*`);
      if (options?.minSize) args.push('-size', `+${options.minSize}`);
      if (options?.maxSize) args.push('-size', `-${options.maxSize}`);

      const { stdout } = await execFileAsync('find', args, { maxBuffer: 1024 * 1024 * 10 });

      const lines = stdout.split('\n').filter(Boolean);
      const results: { name: string; path: string; isDirectory: boolean; size: number; mtime: Date }[] = [];

      const topLines = lines.slice(0, 100);

      for (const pathStr of topLines) {
        try {
          const stats = await fs.stat(pathStr);
          results.push({
            name: path.basename(pathStr),
            path: pathStr,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime
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
