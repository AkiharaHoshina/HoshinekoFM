import { ipcMain, BrowserWindow, dialog, nativeImage, app, webContents } from 'electron';
import path from 'path';
import { promises as fs, writeFileSync, existsSync, readFileSync } from 'fs';
import { getCachedDragIconPath } from '../fsUtils';

/**
 * 活跃拖拽登记。
 * 跨窗口拖放时（Chromium↔Chromium）目标窗口收到的 DataTransfer
 * 经常拿不到文件路径；源窗口发起拖拽时把路径登记到主进程，
 * 目标窗口 drop 数据为空时回退到这里取路径，保证窗口间拖放可靠。
 */
/**
 * 被拖拽文件的元数据（随活跃拖拽登记跨窗口传递）。
 * 目标窗口据此构建 IFile，保留回收站原始位置等仅源窗口知道的信息。
 */
export interface DragFileMeta {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 回收站条目：原始绝对路径（仅回收站拖出时存在） */
  trashOriginalPath?: string;
}

/**
 * 活跃拖拽登记。
 * 跨窗口拖放时（Chromium↔Chromium）目标窗口收到的 DataTransfer
 * 经常拿不到文件路径；源窗口发起拖拽时把路径登记到主进程，
 * 目标窗口 drop 数据为空时回退到这里取路径，保证窗口间拖放可靠。
 */
interface ActiveDrag {
  /** 被拖拽的文件绝对路径 */
  paths: string[];
  /** 被拖拽文件的元数据（跨窗口保留回收站信息等） */
  files: DragFileMeta[];
  /** 源 webContents id */
  sourceId: number;
  /** 发起时间戳，用于超时清理 */
  startedAt: number;
}

let activeDrag: ActiveDrag | null = null;

/** 拖拽会话超时（毫秒），超过视为失效（防止源窗口崩溃后残留） */
const ACTIVE_DRAG_TTL = 30_000;

/**
 * 活跃拖拽 claim 的判别结果：
 * - granted：本窗口获得处理权（数据已随返回移交，登记立即清空）
 * - consumed：登记已被其他窗口拿走 → 本次 drop 是幻影 drop-back/重复处理
 * - none：没有活跃拖拽（外部应用拖入）
 */
export type DragClaimResult =
  | { status: 'granted'; files: DragFileMeta[] }
  | { status: 'consumed' }
  | { status: 'none' };

/**
 * 拖拽登记仲裁：同一次跨窗口拖放会在落点窗口与源窗口各触发一次
 * drop 事件（Wayland 自客户端拖放特性）。登记只授予一个窗口：
 * - 非源窗口（落点）claim：立即授予并消费，通知源窗口取消兜底；
 * - 源窗口自己 claim（幻影 drop-back）：延迟 500ms 让位，期间被落点
 *   窗口消费则返回 consumed（源窗口静默放弃），否则授予（极端情况）。
 *
 * 重复处理由"单次消费 + 渲染端幻影抑制"保证，不做时间窗限制——
 * 时间窗会把快速连续的第二次合法拖放误判为重复而静默丢弃。
 */
async function claimActiveDrag(senderId: number): Promise<DragClaimResult> {
  const drag = activeDrag;
  if (!drag || Date.now() - drag.startedAt >= ACTIVE_DRAG_TTL) {
    activeDrag = null;
    return { status: 'none' };
  }

  if (senderId !== drag.sourceId) {
    activeDrag = null;
    const source = webContents.fromId(drag.sourceId);
    if (source && !source.isDestroyed()) {
      source.send('dnd:externally-consumed');
    }
    return { status: 'granted', files: drag.files };
  }

  // 源窗口自身 claim：延迟让位，等待落点窗口先消费
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (activeDrag !== drag) {
    return { status: 'consumed' };
  }
  activeDrag = null;
  return { status: 'granted', files: drag.files };
}

ipcMain.handle('dnd:claim-files', async (event) => {
  return claimActiveDrag(event.sender.id);
});

/**
 * 渲染进程已消费本次拖拽（DOM drop 或兜底判定后），清除登记。
 */
ipcMain.handle('dnd:consume', () => {
  activeDrag = null;
});

/** 跨窗口剪贴板数据 */
interface ClipboardData {
  files: {
    name: string; path: string; isDirectory: boolean; size: number;
    mtime: Date; mime: string | null;
  }[];
  operation: 'copy' | 'cut';
}

let clipboardData: ClipboardData | null = null;
let clipboardLoaded = false;

/** 剪贴板持久化文件路径（重启后仍可粘贴上次复制的内容） */
const clipboardFilePath = (): string =>
  path.join(app.getPath('userData'), 'clipboard.json');

/**
 * 首次访问时从磁盘恢复剪贴板。延迟到首次读取，避免在 app ready
 * 之前调用 app.getPath 导致时序问题。mtime 在 JSON 里是字符串，
 * 恢复时转换回 Date。
 */
function ensureClipboardLoaded() {
  if (clipboardLoaded) return;
  clipboardLoaded = true;
  try {
    const p = clipboardFilePath();
    if (!existsSync(p)) return;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as ClipboardData | null;
    if (raw && Array.isArray(raw.files) && (raw.operation === 'copy' || raw.operation === 'cut')) {
      clipboardData = {
        ...raw,
        files: raw.files.map((f) => ({ ...f, mtime: new Date(f.mtime) })),
      };
    }
  } catch { /* 损坏或不可读时按空剪贴板处理 */ }
}

/** 把剪贴板变更广播给所有窗口 */
function broadcastClipboard() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('clipboard:changed', clipboardData);
    }
  }
}

ipcMain.handle('clipboard:set', (_, data: ClipboardData) => {
  clipboardLoaded = true;
  clipboardData = data;
  try {
    writeFileSync(clipboardFilePath(), JSON.stringify(data));
  } catch { /* 磁盘不可写时仅内存态 */ }
  broadcastClipboard();
});

ipcMain.handle('clipboard:get', () => {
  ensureClipboardLoaded();
  return clipboardData;
});

ipcMain.handle('clipboard:clear', () => {
  clipboardData = null;
  try {
    const p = clipboardFilePath();
    if (existsSync(p)) fs.unlink(p).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
  broadcastClipboard();
});

/** 窗口级处理器：窗口图标等设置会应用到所有窗口（多窗口共享一个后端） */
export function registerWindowHandlers(getWindows: () => BrowserWindow[]) {
  /**
   * 界面缩放（整页缩放，Electron zoom factor）。
   *
   * 由请求窗口的渲染进程发起，只作用于该窗口自己的 webContents——
   * 多窗口同步靠渲染端的 storage 事件（每个窗口各自重设自己的缩放）。
   * preload 在页面加载前用 webFrame 同步应用初始缩放，避免首帧闪烁；
   * 此 handler 用于设置变更后的实时应用。
   *
   * 缩放范围限制在 0.5–2.0（对应设置条 50%–200%），
   * 超出范围的值直接拒绝，防止异常状态。
   */
  ipcMain.handle('window:set-zoom', (_event, factor: number) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0.5 || factor > 2) {
      return;
    }
    // 幂等：当前已是目标缩放时跳过。重复调用 setZoomFactor（即使同值）
    // 会触发一次多余的 zoom 变更，破坏 react-window/AutoSizer 的初始测量
    if (Math.abs(_event.sender.getZoomFactor() - factor) < 1e-6) return;
    _event.sender.setZoomFactor(factor);
  });

  ipcMain.handle('dialog:open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSS Files', extensions: ['css'] }]
    });
    if (canceled) return null;
    return filePaths[0];
  });

  /**
   * Pick a single file (no extension filter). Used by the dashboard
   * "pin file" action. Separate from the directory picker because on
   * Linux the GTK file chooser treats `openFile` and `openDirectory`
   * as mutually exclusive.
   */
  ipcMain.handle('dialog:pick-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
    });
    if (canceled) return null;
    return filePaths[0];
  });

  /**
   * Pick a single directory. Used by the dashboard "pin folder" action.
   */
  ipcMain.handle('dialog:pick-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
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

  ipcMain.on('dnd:start', (event, payload: string | string[] | { paths: string[]; files: DragFileMeta[] }) => {
    const paths = Array.isArray(payload) || typeof payload === 'string' ? (Array.isArray(payload) ? payload : [payload]) : payload.paths;
    const files = Array.isArray(payload) || typeof payload === 'string' ? [] : (payload.files ?? []);
    // 登记活跃拖拽（路径 + 元数据），供同应用其他窗口的 drop 回退取用。
    // 登记依赖 TTL 与新拖拽覆盖清理。
    activeDrag = {
      paths,
      files,
      sourceId: event.sender.id,
      startedAt: Date.now(),
    };
    const cachedPath = getCachedDragIconPath('insert_drive_file');
    if (!existsSync(cachedPath)) {
      try {
        const img = nativeImage.createFromDataURL(
          'data:image/svg+xml;base64,' +
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="16" fill="#4285F4"/></svg>').toString('base64')
        );
        writeFileSync(cachedPath, img.toPNG());
      } catch { /* continue */ }
    }
    event.sender.startDrag({
      file: paths[0],
      files: paths,
      icon: cachedPath,
    });
  });

  /**
   * 自定义标题栏的窗口控制（frameless 窗口）：
   * - minimize / toggle-maximize / close 作用于发起请求的窗口；
   * - is-maximized 查询当前最大化状态（标题栏按钮图标随状态切换，
   *   状态变化经 maximize/unmaximize 事件由 main.ts 广播）。
   */
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('window:set-icon', async (_, iconType: 'light' | 'dark' | string) => {
    const apply = (iconPath: string) => {
      for (const win of getWindows()) {
        if (win && !win.isDestroyed()) {
          win.setIcon(iconPath);
        }
      }
    };

    if (path.isAbsolute(iconType)) {
      apply(iconType);
    } else {
      const possiblePaths = [
        path.join(__dirname, `../assets/icon-${iconType}.png`),
        path.join(process.resourcesPath, `assets/icon-${iconType}.png`)
      ];
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          apply(p);
          return;
        } catch { /* continue */ }
      }
    }
  });
}
