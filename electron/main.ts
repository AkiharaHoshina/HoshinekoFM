import { app, BrowserWindow, protocol, net, ipcMain, type WebContents } from 'electron';
import path from 'path';
import url from 'url';
import os from 'os';
import { promises as fs } from 'fs';
import { setupPtyHandlers, killAllPty } from './pty';
import { getThumbnail } from './fsUtils';
import { startWatching, stopWatching, stopAllWatching } from './fsWatcher';
import { registerFsHandlers } from './handlers/fs';
import { registerSystemHandlers, setupUdisks2Monitor } from './handlers/system';
import { registerWindowHandlers } from './handlers/window';
import { initJobHandlers } from './jobs';

/** 所有打开的窗口（单实例多窗口，共享一个后端） */
const windows = new Set<BrowserWindow>();

/** 每个窗口的启动路径（由启动参数解析，键为窗口实例） */
const startupPathByWindow = new WeakMap<BrowserWindow, string | null>();

/** 每个窗口注册的目录监听器（窗口关闭时统一移除） */
const watchListenersByWindow = new WeakMap<WebContents, Map<string, (dir: string) => void>>();

function getWindows(): BrowserWindow[] {
  return Array.from(windows);
}

/**
 * 从启动参数解析启动路径：最后一个参数若是存在的目录则直接使用，
 * 若是文件则取其所在目录；否则返回 null。
 */
async function resolveStartupPath(argv: string[]): Promise<string | null> {
  const lastArg = argv[argv.length - 1];

  if (!lastArg || lastArg === '.' || lastArg === process.execPath) {
    return null;
  }

  try {
    if (path.isAbsolute(lastArg)) {
      const stats = await fs.stat(lastArg);
      if (stats.isDirectory()) {
        return lastArg;
      } else if (stats.isFile()) {
        return path.dirname(lastArg);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 创建一个新窗口。所有窗口共享同一主进程后端
 * （模块级缓存、UDISKS2 连接、inotify watcher 去重等）。
 */
async function createWindow(startupArgs: string[] = process.argv) {
  // 先解析启动路径，确保渲染进程调用 get-startup-path 时已就绪
  const startupPath = await resolveStartupPath(startupArgs);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // 首帧渲染前的底色，避免白屏闪烁；ready-to-show 后才会真正显示窗口
    backgroundColor: '#1b1b1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    autoHideMenuBar: true,
  });

  const wc = win.webContents;
  windows.add(win);

  // 窗口专属的启动路径
  startupPathByWindow.set(win, startupPath);

  win.once('closed', () => {
    windows.delete(win);
    // 清理该窗口注册的目录监听器，避免 watcher 集合泄漏
    const listeners = watchListenersByWindow.get(wc);
    if (listeners) {
      for (const [dir, listener] of listeners) {
        stopWatching(dir, listener);
      }
      watchListenersByWindow.delete(wc);
    }
  });

  // 等首帧渲染完成再显示：直接显示会白屏，多实例启动时
  // GPU/CPU 争抢会拉长白屏时间
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Initialize PTY handlers
setupPtyHandlers();

// Register protocol before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

// Wayland & GPU Flags
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// ── 单实例锁：第二次启动复用已有后端，为其再开一个窗口 ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // 已有实例运行：打开新窗口（共享同一个后端）
    const open = () => {
      createWindow(argv);
      const wins = getWindows();
      const win = wins[wins.length - 1];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    };
    if (app.isReady()) {
      open();
    } else {
      app.whenReady().then(open);
    }
  });
}

ipcMain.handle('theme:get-css', async () => {
  const homeDir = os.homedir();
  const themePath = path.join(homeDir, '.config/matugen/theme.css');
  try {
    return await fs.readFile(themePath, 'utf-8');
  } catch {
    return null;
  }
});

// 每个窗口独立注册目录监听；watcher 在 main 进程内按目录去重
ipcMain.handle('fs:watch-dir', (event, dir: string) => {
  const sender = event.sender;
  let listeners = watchListenersByWindow.get(sender);
  if (!listeners) {
    listeners = new Map();
    watchListenersByWindow.set(sender, listeners);
  }
  if (listeners.has(dir)) return;

  const listener = (changedDir: string) => {
    if (!sender.isDestroyed()) {
      sender.send('fs:dir-changed', changedDir);
    }
  };
  listeners.set(dir, listener);

  try {
    startWatching(dir, listener);
  } catch {
    // directory already gone or inaccessible — silently skip
  }
});

ipcMain.handle('fs:unwatch-dir', (event, dir: string) => {
  const listeners = watchListenersByWindow.get(event.sender);
  if (!listeners) return;
  const listener = listeners.get(dir);
  if (listener) {
    listeners.delete(dir);
    stopWatching(dir, listener);
  }
});

// 启动路径按发起请求的窗口返回
ipcMain.handle('app:get-startup-path', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? (startupPathByWindow.get(win) ?? null) : null;
});

registerFsHandlers();
registerSystemHandlers();
registerWindowHandlers(getWindows);
initJobHandlers();

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    const filePath = request.url.slice('media://'.length);
    const decodedPath = decodeURIComponent(filePath);

    const thumbPath = await getThumbnail(decodedPath, 256);
    if (thumbPath) {
      return net.fetch(url.pathToFileURL(thumbPath).toString());
    }

    return net.fetch(url.pathToFileURL(decodedPath).toString());
  });
  createWindow();
  setupUdisks2Monitor(getWindows);
});

app.on('window-all-closed', () => {
  killAllPty();
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
