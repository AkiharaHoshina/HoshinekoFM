import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
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
