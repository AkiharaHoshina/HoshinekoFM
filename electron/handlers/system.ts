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
