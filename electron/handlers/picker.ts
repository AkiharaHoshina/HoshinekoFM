import { ipcMain, BrowserWindow } from 'electron';

/** 文件选择器模式：单文件 / 单文件夹 / 多文件（框选）/ 混合条目（文件与文件夹皆可选、多选） */
export interface PickerConfig {
  /** 选择模式 */
  mode: 'file' | 'folder' | 'files' | 'items';
}

/** 合法的选择模式白名单（防止任意值进入配置） */
const VALID_MODES = new Set<string>(['file', 'folder', 'files', 'items']);

/** 等待结果的选择器窗口：picker 窗口 webContents.id → resolver */
interface PendingPicker {
  resolve: (paths: string[] | null) => void;
}
const pendingPickers = new Map<number, PendingPicker>();

/**
 * 注册文件选择器 IPC：
 * - `picker:open`：请求方（任意窗口）发起，主进程创建选择器窗口并
 *   返回 Promise——选择器回传路径数组时 resolve，取消/直接关窗时
 *   resolve(null)；
 * - `picker:resolve`：选择器窗口回传选中路径（null = 取消），
 *   主进程把结果交给请求方并关闭选择器窗口。
 *
 * @param createPicker - 创建选择器窗口的工厂（由 main.ts 注入，
 *   复用 createWindow 的窗口集合/加载/清理逻辑）
 */
export function registerPickerHandlers(
  createPicker: (config: PickerConfig, parent: BrowserWindow | undefined) => Promise<BrowserWindow>,
) {
  ipcMain.handle('picker:open', (event, options: unknown) => {
    const mode = (options as { mode?: unknown } | null)?.mode;
    if (typeof mode !== 'string' || !VALID_MODES.has(mode)) {
      throw new Error('Invalid picker mode');
    }
    const config: PickerConfig = { mode: mode as PickerConfig['mode'] };
    const requester = BrowserWindow.fromWebContents(event.sender);

    return new Promise<string[] | null>((resolve) => {
      createPicker(config, requester ?? undefined)
        .then((win) => {
          const wcId = win.webContents.id;
          pendingPickers.set(wcId, { resolve });
          // 用户直接关闭窗口（未点选择/取消）：视为取消
          win.once('closed', () => {
            const pending = pendingPickers.get(wcId);
            if (pending) {
              pendingPickers.delete(wcId);
              pending.resolve(null);
            }
          });
        })
        .catch(() => resolve(null));
    });
  });

  ipcMain.handle('picker:resolve', (event, paths: unknown) => {
    const wcId = event.sender.id;
    const pending = pendingPickers.get(wcId);
    if (!pending) return;
    pendingPickers.delete(wcId);

    const result = Array.isArray(paths)
      ? (paths as unknown[]).filter((p): p is string => typeof p === 'string')
      : null;
    pending.resolve(result);

    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}
