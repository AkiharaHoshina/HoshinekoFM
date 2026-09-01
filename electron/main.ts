import { app, BrowserWindow, protocol, net, ipcMain, shell, type WebContents } from 'electron';
import path from 'path';
import url from 'url';
import os from 'os';
import { promises as fs, createReadStream } from 'fs';
import { Readable } from 'stream';
import { setupPtyHandlers, killAllPty } from './pty';
import { getThumbnail, detectMime } from './fsUtils';
import { startWatching, stopWatching, stopAllWatching } from './fsWatcher';
import { registerFsHandlers } from './handlers/fs';
import { registerSystemHandlers, setupUdisks2Monitor, setupGvfsMonitor } from './handlers/system';
import { registerWindowHandlers } from './handlers/window';
import { registerThemeHandlers } from './handlers/theme';
import { registerPickerHandlers, type PickerConfig } from './handlers/picker';
import { initJobHandlers } from './jobs';

/** 所有打开的窗口（单实例多窗口，共享一个后端） */
const windows = new Set<BrowserWindow>();

/** 每个窗口的启动路径（由启动参数解析，键为窗口实例） */
const startupPathByWindow = new WeakMap<BrowserWindow, string | null>();

/** 选择器窗口的配置（键为窗口实例；普通窗口无条目） */
const pickerConfigByWindow = new WeakMap<BrowserWindow, PickerConfig>();

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
 *
 * 窗口对象同步构造并立即加入 `windows` 集合，再异步解析启动路径写入
 * `startupPathByWindow`——这样 second-instance 处理器 await 返回后拿到的
 * 一定是刚创建的窗口，不会误取到旧窗口（旧实现先 await 后构造，处理器
 * 同步取"最后一个窗口"时新窗口尚未入集合，focus 到旧窗口导致 Wayland
 * 合成器（niri 等）视口跳转到旧窗口所在工作区）。
 *
 * @param startupArgs - 启动参数，用于解析窗口专属启动路径
 * @param options - 附加选项；picker 模式创建文件选择器窗口
 * @returns 创建的窗口实例
 */
async function createWindow(
  startupArgs: string[] = process.argv,
  options: { picker?: boolean; pickerConfig?: PickerConfig; parent?: BrowserWindow } = {},
): Promise<BrowserWindow> {
  const isPicker = options.picker === true;
  const win = new BrowserWindow({
    width: isPicker ? 900 : 1200,
    height: isPicker ? 620 : 800,
    minWidth: isPicker ? 640 : 480,
    minHeight: isPicker ? 480 : 360,
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
    // 选择器窗口关联发起窗口：保持堆叠关系（Wayland 下经 xdg-foreign 处理）
    ...(isPicker && options.parent ? { parent: options.parent } : {}),
  });

  const wc = win.webContents;
  windows.add(win);

  if (isPicker && options.pickerConfig) {
    pickerConfigByWindow.set(win, options.pickerConfig);
  }

  // 窗口专属的启动路径（异步解析，保证渲染进程调用 get-startup-path 时已就绪；
  // 解析期间窗口已入集合，不影响 second-instance 的窗口定位）
  void resolveStartupPath(startupArgs).then((startupPath) => {
    if (!win.isDestroyed()) {
      startupPathByWindow.set(win, startupPath);
    }
  });

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
    win.loadURL('http://localhost:5173' + (isPicker ? '?mode=picker' : ''));
    if (!isPicker) win.webContents.openDevTools();
  } else {
    win.loadFile(
      path.join(__dirname, '../dist/index.html'),
      isPicker ? { search: '?mode=picker' } : {},
    );
  }

  return win;
}

// Initialize PTY handlers
setupPtyHandlers();

// Register protocol before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
  // preview 必须 standard + corsEnabled：pdf.js 经 fetch() 拉取预览文件，
  // 缺 corsEnabled 时跨源 fetch 直接失败（Unexpected server response (0)）。
  // standard 使 URL 按「主机+路径」解析（渲染侧统一用 preview://localhost
  // 前缀，pdf.js 的 URL 往返序列化不会吃掉路径首斜杠）。
  { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }
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
    // 已有实例运行：打开新窗口（共享同一个后端）。
    // 必须 await 新窗口实例后再 focus：新窗口由 niri 等 Wayland 合成器
    // 映射到"当前活动工作区"，若误 focus 旧窗口会把视口拉回旧窗口的
    // 工作区，新窗口随后也会开在那里（跨工作区回跳问题）。
    const open = async () => {
      const win = await createWindow(argv);
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      // 新窗口显示后由合成器按 open-focused 规则自动聚焦，
      // 这里只在已显示时补一次 focus，绝不触碰其他窗口
      if (win.isVisible()) win.focus();
    };
    if (app.isReady()) {
      void open();
    } else {
      app.whenReady().then(() => void open());
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

/**
 * 主题实时预览广播：设置窗口预览主题变化（选择预设/壁纸取色/
 * 调色盘确定）时把 CSS 发给主进程，主进程广播到所有窗口，
 * 各窗口注入同一份 CSS 实现「选择颜色后所有窗口立刻同步」。
 * CSS 校验为字符串并限制长度，防止任意数据注入渲染进程。
 */
ipcMain.on('theme:preview', (_event, css: unknown) => {
  if (typeof css !== 'string' || css.length > 2_000_000) return;
  for (const win of getWindows()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme:preview-css', css);
    }
  }
});

/**
 * 主题预览结束（设置窗口取消/关闭）：广播通知所有窗口
 * 重新应用各自已保存的主题配置，回退预览期间的临时 CSS。
 */
ipcMain.on('theme:preview-end', () => {
  for (const win of getWindows()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme:preview-end');
    }
  }
});

/** 返回应用版本号（package.json 的 version），设置弹窗"关于"部分显示 */
ipcMain.handle('app:get-version', () => app.getVersion());

/**
 * 用系统默认浏览器打开外部链接。
 * 仅允许 http/https 协议，防止任意 scheme 被打开。
 */
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
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

// 选择器窗口读取自身配置（普通窗口返回 null）
ipcMain.handle('picker:get-config', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? (pickerConfigByWindow.get(win) ?? null) : null;
});

registerFsHandlers();
registerSystemHandlers();
registerWindowHandlers(getWindows);
registerThemeHandlers();
registerPickerHandlers((config, parent) =>
  createWindow(process.argv, { picker: true, pickerConfig: config, parent }),
);
initJobHandlers();

/**
 * 解析单段 Range 请求头（`bytes=a-b` / `bytes=a-` / `bytes=-b`）。
 *
 * @param header - 原始 Range 头（如 `bytes=0-1023`）
 * @param size - 文件总大小（字节）
 * @returns 闭区间 [start, end]；无 Range 传 null 时返回 null；
 *          头存在但无法解析（多段 range、语法错误、区间越界）时返回 'invalid'
 */
function parseRangeHeader(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const first = m[1];
  const last = m[2];
  if (first === '' && last === '') return 'invalid';
  let start: number;
  let end: number;
  if (first === '') {
    // 后缀范围 bytes=-N：文件最后 N 字节
    const suffix = parseInt(last, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(first, 10);
    end = last === '' ? size - 1 : parseInt(last, 10);
    if (!Number.isFinite(start) || (last !== '' && !Number.isFinite(end))) return 'invalid';
    end = Math.min(end, size - 1);
  }
  if (start < 0 || end < start || start >= size) return 'invalid';
  return { start, end };
}

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

  /**
   * preview:// 协议：以原图/原文件（非缩略图）服务本地文件，
   * 供文件预览面板加载图片/视频/音频/PDF。
   *
   * 与 media:// 的区别：media:// 对图片会优先返回 ≤256px 缩略图
   * （文件列表图标用），且不处理 Range——预览面板需要原图与
   * 视频 seek（206 分段响应），故独立协议。
   *
   * URL 形态为 `preview://localhost<绝对路径>`（scheme 注册为 standard，
   * 主机固定 localhost、真实路径在 pathname 里）——pdf.js 会经
   * `new URL()` 往返序列化 URL，`preview:///path` 的空主机形态会被
   * 序列化成 `preview://path`（首斜杠被主机吃掉），pathname 形态
   * 往返稳定。只允许绝对路径的普通文件；大文件以流式返回，不整体缓冲。
   */
  protocol.handle('preview', async (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    if (!path.isAbsolute(filePath)) {
      return new Response('invalid path', { status: 400 });
    }
    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!stats.isFile()) {
      return new Response('not a regular file', { status: 400 });
    }

    const mime = await detectMime(filePath).catch(() => null);
    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime ?? 'application/octet-stream',
    };

    // Range 支持：视频元素 seek/拖进度条依赖 206 分段响应
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      const parsed = parseRangeHeader(rangeHeader, stats.size);
      if (parsed === 'invalid' || parsed === null) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stats.size}` },
        });
      }
      const { start, end } = parsed;
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        },
      });
    }

    // 无 Range：全量流式返回（图片/小文件直接消费）
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(stats.size) },
    });
  });

  createWindow();
  setupUdisks2Monitor(getWindows);
  setupGvfsMonitor(getWindows);
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
