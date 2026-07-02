import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } from 'electron';
import path from 'path';
import { promises as fs, writeFileSync, existsSync, constants } from 'fs';
import url from 'url';
import os from 'os';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import dbus from 'dbus-next';
import { setupPtyHandlers, setMainWindow, killAllPty } from './pty';
import { detectMime, getThumbnail, getDragIcon, getCachedDragIconPath } from './fsUtils';
import { startWatching, stopWatching, stopAllWatching } from './fsWatcher';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// --- State ---
let mainWindow: BrowserWindow | null = null;

// Initialize PTY handlers
setupPtyHandlers();
let terminalProcess: any = null;
let terminalSessionProxy: any = null;

// --- Helper Functions ---
async function setupTerminal(pid: number) {
  const bus = dbus.sessionBus();
  const serviceName = `org.kde.konsole - ${pid} `;

  for (let i = 0; i < 20; i++) {
    try {
      // Check if service exists by listing names? No, just try to get object.
      const sessionPath = '/Sessions/1';
      const sessionObj = await bus.getProxyObject(serviceName, sessionPath);
      const sessionInterface = sessionObj.getInterface('org.kde.konsole.Session');

      if (sessionInterface) {
        terminalSessionProxy = sessionInterface;
        console.log('Connected to Konsole DBus:', serviceName);
        return;
      }
    } catch (e) {
      // Ignore errors while waiting
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('Failed to connect to Konsole DBus after retries');
}

// Register protocol before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

// Wayland & GPU Flags
// Suppress "Incomplete image description" warning on Wayland
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// Optional: Disable GPU rasterization if glitches persist, but 'auto' ozone hint often fixes it.
// app.commandLine.appendSwitch('disable-gpu-compositing');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    autoHideMenuBar: true,
  });
  setMainWindow(mainWindow);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// --- IPC Handlers ---

ipcMain.handle('theme:get-css', async () => {
  const homeDir = os.homedir();
  const themePath = path.join(homeDir, '.config/matugen/theme.css');
  try {
    const css = await fs.readFile(themePath, 'utf-8');
    return css;
  } catch (error) {
    return null;
  }
});

/** Walk up the directory tree from `startPath` until a readable directory is found. */
async function resolveAccessibleParent(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    try {
      await fs.access(current, constants.R_OK);
      return current;
    } catch {
      // continue walking up
    }
  }
  return null;
}

async function listDirectoryContents(targetPath: string): Promise<{
  name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null;
  symlinkTarget?: string; isMountpoint?: boolean; mountSource?: string;
}[]> {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    try {
      const fullPath = path.join(targetPath, entry.name);
      const isSymlink = entry.isSymbolicLink();
      const isBlock = entry.isBlockDevice();
      const isChar = entry.isCharacterDevice();
      const isFIFO = entry.isFIFO();
      const isSock = entry.isSocket();
      const isSpecial = isBlock || isChar || isFIFO || isSock;

      if (isSpecial) {
        let mime: string;
        if (isBlock) mime = 'inode/blockdevice';
        else if (isChar) mime = 'inode/chardevice';
        else if (isFIFO) mime = 'inode/fifo';
        else mime = 'inode/socket';
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: false,
          size: 0,
          mtime: new Date(0),
          mime
        };
      }

      if (isSymlink) {
        let symlinkTarget: string | undefined;
        try {
          symlinkTarget = await fs.readlink(fullPath);
        } catch {
          return null;
        }

        if (symlinkTarget) {
          try {
            const stats = await fs.stat(fullPath);
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: stats.isDirectory(),
              size: stats.size,
              mtime: stats.mtime,
              mime: stats.isDirectory() ? 'inode/directory' : await detectMime(fullPath),
              symlinkTarget
            };
          } catch {
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              size: 0,
              mtime: new Date(0),
              mime: 'inode/symlink',
              symlinkTarget
            };
          }
        }
        return null;
      }

      const stats = await fs.stat(fullPath);
      const mime = entry.isDirectory() ? 'inode/directory' : await detectMime(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        mtime: stats.mtime,
        mime
      };
    } catch (e) {
      return null;
    }
  }));
  const filtered = results.filter(r => r !== null) as {
    name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null;
    symlinkTarget?: string; isMountpoint?: boolean; mountSource?: string;
  }[];

  // Detect mount points among directories using findmnt
  try {
    const { stdout } = await execAsync(`findmnt --json -R "${targetPath.replace(/"/g, '\\"')}"`);
    const data = JSON.parse(stdout);
    const mountMap = new Map<string, string>();
    const collect = (fslist: any[]) => {
      for (const item of fslist) {
        mountMap.set(item.target, item.source);
        if (item.children) collect(item.children);
      }
    };
    const filesystems = data.filesystems || [];
    collect(filesystems);
    for (const entry of filtered) {
      if (entry.isDirectory && mountMap.has(entry.path)) {
        entry.isMountpoint = true;
        entry.mountSource = mountMap.get(entry.path);
      }
    }
  } catch {
    // findmnt may fail on non-standard paths; silently skip
  }

  return filtered;
}

ipcMain.handle('fs:list-dir', async (_, dirPath: string) => {
  const targetPath = dirPath || os.homedir();
  try {
    const data = await listDirectoryContents(targetPath);
    return { data, actualPath: targetPath };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error('Failed to list dir', targetPath, err);
    const resolvedPath = await resolveAccessibleParent(targetPath);
    if (resolvedPath) {
      console.warn(`[fs:list-dir] resolved "${targetPath}" → "${resolvedPath}"`);
      const data = await listDirectoryContents(resolvedPath);
      return {
        data,
        actualPath: resolvedPath,
        error: { code: err.code || 'UNKNOWN', originalPath: targetPath },
      };
    }
    throw error;
  }
});

ipcMain.handle('fs:get-places', () => {
  const home = app.getPath('home');
  return [
    { name: 'Home', path: home, icon: '🏠' },
    { name: 'Desktop', path: app.getPath('desktop'), icon: '🖥️' },
    { name: 'Documents', path: app.getPath('documents'), icon: '📄' },
    { name: 'Downloads', path: app.getPath('downloads'), icon: '⬇️' },
    { name: 'Music', path: app.getPath('music'), icon: '🎵' },
    { name: 'Pictures', path: app.getPath('pictures'), icon: '🖼️' },
    { name: 'Videos', path: app.getPath('videos'), icon: '🎥' },
  ];
});

ipcMain.handle('fs:copy', async (_, source: string, dest: string) => {
  // Simple copy for now. For directories, we might need recursive copy.
  // fs.cp is available in Node 16.7.0+
  await fs.cp(source, dest, { recursive: true, force: false });
  return true;
});

ipcMain.handle('fs:move', async (_, source: string, dest: string) => {
  await fs.rename(source, dest);
  return true;
});

ipcMain.handle('fs:trash', async (_, filePath: string) => {
  await shell.trashItem(filePath);
  return true;
});

ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
  await fs.rename(oldPath, newPath);
  return true;
});

ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle('fs:create-file', async (_, filePath: string) => {
  await fs.writeFile(filePath, '', 'utf-8');
  return true;
});

ipcMain.handle('fs:open', async (_, filePath: string) => {
  const error = await shell.openPath(filePath);
  return error; // returns error string or empty if success
});

ipcMain.handle('fs:extract', async (_, filePath: string) => {
  try {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Simple extraction logic - extend as needed
    if (ext === '.zip') {
      await execAsync(`unzip "${filePath}" -d "${dir}"`);
    } else if (ext === '.tar' || ext === '.gz' || ext === '.xz') {
      await execAsync(`tar -xf "${filePath}" -C "${dir}"`);
    } else {
      return false; // Unsupported
    }
    return true;
  } catch (e) {
    console.error('Extract failed', e);
    return false;
  }
});

// Cache for apps
let appsCache: { name: string; icon: string; exec: string; desktopFile: string; }[] | null = null;

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
          } catch { }
        }
      }
    } catch { }
  }

  appsCache = apps.sort((a, b) => a.name.localeCompare(b.name));
  return appsCache;
});

ipcMain.handle('system:open-with', async (_, execPath: string, filePath: string, desktopFile?: string) => {
  let cwd: string | undefined;

  if (desktopFile) {
    try {
      const content = await fs.readFile(desktopFile, 'utf-8');
      const pathMatch = content.match(/^Path=(.*)$/m);
      if (pathMatch && pathMatch[1].trim()) {
        cwd = pathMatch[1].trim();
      }
    } catch { }
  }

  return new Promise((resolve) => {
    let cmdLine = execPath;
    if (cmdLine.includes('@@')) {
      cmdLine = cmdLine.replace(/@@u\s*@@/g, `@@u ${filePath} @@`);
      cmdLine = cmdLine.replace(/@@\s*@@/g, `@@ ${filePath} @@`);
    } else {
      cmdLine += ` "${filePath}"`;
    }

    try {
      const child = spawn(cmdLine, [], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        cwd: cwd,
        env: { ...process.env }
      });
      child.on('error', (err: any) => {
        resolve((err?.message || err) as string);
      });
      child.unref();
      child.on('spawn', () => resolve(true));
    } catch (e: any) {
      resolve((e?.message || e) as string);
    }
  });
});

ipcMain.handle('fs:get-parent', (_, dirPath: string) => {
  return path.dirname(dirPath);
});

ipcMain.handle('fs:get-home', () => {
  return os.homedir();
});

ipcMain.handle('dialog:open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSS Files', extensions: ['css'] }]
  });
  if (canceled) return null;
  return filePaths[0];
});

ipcMain.on('cache:drag-icon', (_event, iconName: string, pngBase64: string) => {
  const target = getCachedDragIconPath(iconName);
  try {
    const buf = Buffer.from(pngBase64, 'base64');
    writeFileSync(target, buf);
  } catch {
    // Silently skip — fallback will be used
  }
});

ipcMain.on('dnd:start', (event, filePaths: string | string[]) => {
  const files = Array.isArray(filePaths) ? filePaths : [filePaths];
  const cachedPath = getCachedDragIconPath('insert_drive_file');
  if (!existsSync(cachedPath)) {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromDataURL(
        'data:image/svg+xml;base64,' +
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="16" fill="#4285F4"/></svg>').toString('base64')
      );
      writeFileSync(cachedPath, img.toPNG());
    } catch {}
  }
  event.sender.startDrag({
    file: files[0],
    files,
    icon: cachedPath,
  });
});

ipcMain.handle('fs:exists', async (_, filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs:watch-dir', (_event, dir: string) => {
  try {
    startWatching(dir, (changedDir) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:dir-changed', changedDir);
      }
    });
  } catch {
    // directory already gone or inaccessible — silently skip
  }
});

ipcMain.handle('fs:unwatch-dir', (_event, dir: string) => {
  stopWatching(dir);
});

ipcMain.handle('system:get-drives', async () => {
  try {
    const { stdout } = await execAsync('lsblk --json -o NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM');
    const data = JSON.parse(stdout);
    const devices = data.blockdevices || [];

    const drives: any[] = [];
    const processDevice = (dev: any) => {
      // We want devices that have a mountpoint OR children with mountpoints?
      // Actually, usually partition has mountpoint.
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
    return drives.filter(d => d.removable || d.mountpoint.startsWith('/run/media')); // Filter for interesting drives
  } catch (e) {
    console.error('Failed to get drives', e);
    return [];
  }
});

ipcMain.handle('system:get-storage-usage', async () => {
  try {
    // Linux: df -kP / (output in 1K blocks)
    // Output format: Filesystem 1024-blocks Used Available Capacity Mounted on
    const { stdout } = await execAsync('df -kP /');
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return null;

    const parts = lines[1].split(/\s+/);
    // parts[1] = total, parts[2] = used, parts[3] = available, parts[4] = percent
    const total = parseInt(parts[1]) * 1024; // Convert to bytes
    const used = parseInt(parts[2]) * 1024;
    const free = parseInt(parts[3]) * 1024;

    return { total, used, free };
  } catch (e) {
    console.error('Failed to get storage usage', e);
    return null;
  }
});

ipcMain.handle('system:get-all-devices', async () => {
  try {
    const { stdout } = await execAsync('lsblk --json -o NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM,FSTYPE,MODEL,HOTPLUG,RO');
    const data = JSON.parse(stdout);
    const devices = data.blockdevices || [];
    const processDevice = (dev: any, parentModel?: string): any => ({
      name: dev.name,
      devicePath: `/dev/${dev.name}`,
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
      children: dev.children ? dev.children.map((c: any) => processDevice(c, dev.model || parentModel)) : undefined,
    });
    return devices.map((d: any) => processDevice(d));
  } catch (e) {
    console.error('Failed to get all devices', e);
    return [];
  }
});

ipcMain.handle('system:mount-device', async (_event, devicePath: string) => {
  try {
    const { stdout, stderr } = await execAsync(`udisksctl mount -b "${devicePath}"`);
    const mountMatch = stdout.match(/Mounted .+ at (.+)/);
    if (mountMatch) return { success: true, mountpoint: mountMatch[1].trim() };
    const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
    if (alreadyMatch) return { success: true, mountpoint: alreadyMatch[1] };
    return { success: false, error: stderr || 'Unknown error' };
  } catch (e: any) {
    const stderr = e.stderr || '';
    const alreadyMatch = stderr.match(/already mounted at ['`](.+?)['`]/);
    if (alreadyMatch) return { success: true, mountpoint: alreadyMatch[1] };
    return { success: false, error: stderr || e.message || 'Mount failed' };
  }
});

ipcMain.handle('system:unmount-device', async (_event, devicePath: string) => {
  try {
    await execAsync(`udisksctl unmount -b "${devicePath}"`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.stderr || e.message || 'Unmount failed' };
  }
});

ipcMain.handle('system:eject-device', async (_event, devicePath: string) => {
  try {
    await execAsync(`udisksctl power-off -b "${devicePath}"`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.stderr || e.message || 'Eject failed' };
  }
});

ipcMain.handle('fs:get-symlink-target', async (_event, filePath: string) => {
  try {
    const lstat = await fs.lstat(filePath);
    if (!lstat.isSymbolicLink()) return { isSymlink: false };
    const target = await fs.readlink(filePath);
    let targetExists = false;
    try { await fs.access(target); targetExists = true; } catch {}
    return { isSymlink: true, target, targetExists };
  } catch {
    return { isSymlink: false };
  }
});

ipcMain.handle('fs:check-symlinks', async (_event, paths: string[]) => {
  const results: { path: string; isSymlink: boolean; target?: string }[] = [];
  for (const p of paths) {
    try {
      const lstat = await fs.lstat(p);
      if (lstat.isSymbolicLink()) {
        const target = await fs.readlink(p);
        results.push({ path: p, isSymlink: true, target });
      } else {
        results.push({ path: p, isSymlink: false });
      }
    } catch {
      results.push({ path: p, isSymlink: false });
    }
  }
  return results;
});

ipcMain.handle('fs:read-file', async (_, filePath: string) => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('app:get-startup-path', async () => {
  const args = process.argv;
  // In dev, args are [electron, ., path?]
  // In prod, args are [app, path?]
  const lastArg = args[args.length - 1];

  if (!lastArg || lastArg === '.' || lastArg === process.execPath) {
    return null; // Ignore if it's the executable itself or current dir placeholder
  }

  try {
    if (path.isAbsolute(lastArg)) {
      const stats = await fs.stat(lastArg);
      if (stats.isDirectory()) {
        return lastArg;
      } else if (stats.isFile()) {
        return path.dirname(lastArg); // Open parent folder if file passed
      }
    }
  } catch (e) {
    // Path doesn't exist or other error
    return null;
  }
  return null;
});

ipcMain.handle('window:set-icon', async (_, iconType: 'light' | 'dark' | string) => {
  if (!mainWindow) return;

  if (path.isAbsolute(iconType)) {
    mainWindow.setIcon(iconType);
  } else {
    // Construct path to assets
    const possiblePaths = [
      path.join(__dirname, `../assets/icon-${iconType}.png`),
      path.join(process.resourcesPath, `assets/icon-${iconType}.png`)
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        mainWindow.setIcon(p);
        return;
      } catch { }
    }
  }
});

ipcMain.handle('system:get-directory-size', async (_, dirPath: string) => {
  try {
    // Use du -sb for bytes (Linux/GNU). -s = summary, -b = bytes
    const { stdout } = await execAsync(`du -sb "${dirPath}"`);
    const match = stdout.match(/^(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 0;
  } catch (error: any) {
    // du might fail on some files but still return partial
    if (error.stdout) {
      const match = error.stdout.match(/^(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }
});

ipcMain.handle('system:get-recommended-apps', async (_, filePath: string) => {
  try {
    // 1. Get Mime Type
    // Escape double quotes in filePath for shell command
    const safePath = filePath.replace(/"/g, '\\"');
    const { stdout: mimeOut } = await execAsync(`xdg-mime query filetype "${safePath}"`);
    const mime = mimeOut.trim();
    if (!mime) return [];

    // console.log('MIME:', mime, 'for', filePath);

    // 2. Find desktop files
    const searchPaths = [
      '/usr/share/applications',
      path.join(os.homedir(), '.local/share/applications'),
      '/var/lib/flatpak/exports/share/applications',
      path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')
    ];

    const appFiles = new Set<string>();
    for (const searchPath of searchPaths) {
      try {
        // Check if directory exists first
        await fs.access(searchPath);

        // Use grep to find files containing the mime type
        // -l = list filenames only
        // escape mime type for grep? usually mime has / and -, safeish.
        const { stdout: grepOut } = await execAsync(`grep -l "${mime}" "${searchPath}"/*.desktop || true`);
        grepOut.split('\n').filter(Boolean).forEach(f => appFiles.add(f));
      } catch (e) {
        // console.log('Error searching path:', searchPath, e);
      }
    }

    // 3. Parse desktop files
    const apps: any[] = [];
    for (const file of appFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const nameMatch = content.match(/^Name=(.*)$/m);
        const iconMatch = content.match(/^Icon=(.*)$/m);
        const execMatch = content.match(/^Exec=(.*)$/m);
        const noDisplayMatch = content.match(/^NoDisplay=(.*)$/m);
        // Only show if not hidden
        if (noDisplayMatch && noDisplayMatch[1].toLowerCase() === 'true') continue;

        if (nameMatch && execMatch) {
          // Clean Exec command (remove %f, %U etc)
          const execCmd = execMatch[1].replace(/%[fFuUikc]/g, '').trim();
          // If quotes wrap the command, remove them? usually Exec="cmd" isn't standard, but Exec=cmd param is.

          apps.push({
            name: nameMatch[1],
            icon: iconMatch ? iconMatch[1] : null, // Frontend should handle icon resolution
            exec: execCmd,
            path: file
          });
        }
      } catch { }
    }
    // console.log('Found apps:', apps.length);
    return apps;
  } catch (err) {
    console.error('Error getting recommended apps:', err);
    return [];
  }
});

// Search
ipcMain.handle('system:search', async (_, directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => {
  try {
    // Build find command
    const args = [directory];
    if (options?.type) args.push('-type', options.type);
    if (query) args.push('-iname', `*${query}*`);
    if (options?.minSize) args.push('-size', `+${options.minSize}`);
    if (options?.maxSize) args.push('-size', `-${options.maxSize}`);

    // Limit results logic if needed, but for now standard execution
    const { stdout } = await execFileAsync('find', args, { maxBuffer: 1024 * 1024 * 10 });

    const lines = stdout.split('\n').filter(Boolean);
    const results: any[] = []; // Use any to avoid IFile import issues

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
      } catch { }
    }
    return results;
  } catch (error) {
    console.error('Search failed:', error);
    return [];
  }
});

// --- App Lifecycle ---

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    const filePath = request.url.slice('media://'.length);
    const decodedPath = decodeURIComponent(filePath);

    // Try to serve a cached/generated thumbnail (returns null for non-images)
    const thumbPath = await getThumbnail(decodedPath, 256);
    if (thumbPath) {
      return net.fetch(url.pathToFileURL(thumbPath).toString());
    }

    // Not an image — serve the original file
    return net.fetch(url.pathToFileURL(decodedPath).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (terminalProcess) {
    process.kill(terminalProcess.pid);
    terminalProcess = null;
  }
  stopAllWatching();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
