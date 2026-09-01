import { ipcMain, BrowserWindow } from 'electron';
import { EXT_TO_MIME } from '../mimeMap';

/**
 * 文件选择器模式：第三方程序接入时以此声明可选条目类型。
 * - `file`：仅文件可选
 * - `folder`：仅文件夹可选
 * - `files`：仅文件可选（多选语义别名，与 file 行为一致）
 * - `items`：全部可选——文件与文件夹皆可选
 * 四种模式均支持多选（框选），调用方按需取结果。
 */
export interface PickerFilter {
  /** 过滤器标识（defaultFilterId 引用；同一请求内须唯一） */
  id: string;
  /** 显示名（缺省时前端由描述体系生成 i18n 名） */
  label?: string;
  /** 扩展名列表（`.ext` 形态） */
  extensions: string[];
  /** MIME 类型列表（支持 `type/*` 通配；与 extensions 或关系） */
  mimes?: string[];
  /** 文件名正则源列表（portal 后端 glob 过滤器转来，大小写不敏感） */
  patterns?: string[];
  /** 主进程解析出的首扩展名 MIME（仅用于缺省 label 生成，不做匹配依据） */
  resolvedMime?: string;
}

/**
 * 选择器配置（picker:open 的声明 / picker:get-config 的返回）。
 * 字段与 `src/types/picker.ts` 的 PickerConfig 一一对应——前端类型
 * 文档同源，修改时须同步。
 */
export interface PickerConfig {
  /** 选择模式（可选条目类型声明） */
  mode: 'file' | 'folder' | 'files' | 'items';
  /** 类型过滤器；缺失/空数组 = 仅「所有文件」 */
  filters?: PickerFilter[];
  /** 初始目录（绝对路径；缺省从家目录开始浏览） */
  initialPath?: string;
  /** 默认选中的过滤器 id（缺省 = 「所有文件」） */
  defaultFilterId?: string;
}

/** 合法的选择模式白名单（防止任意值进入配置） */
const VALID_MODES = new Set<string>(['file', 'folder', 'files', 'items']);

/** 单个请求的过滤器/扩展名数量上限（防滥用） */
const MAX_FILTERS = 20;
const MAX_EXTENSIONS_PER_FILTER = 30;
const MAX_MIMES_PER_FILTER = 30;

/** 等待结果的选择器窗口：picker 窗口 webContents.id → resolver */
interface PendingPicker {
  resolve: (paths: string[] | null) => void;
  /** 选择器窗口实例（portal 后端的 Request.Close 需按窗口关闭） */
  win: BrowserWindow;
}
/** 按窗口隔离的待决请求——多个选择器窗口并发打开时互不影响 */
const pendingPickers = new Map<number, PendingPicker>();

/**
 * 创建选择器窗口并登记待决请求（picker:open 与 portal 后端共用）。
 * 返回的 Promise 在选择器回传时 resolve；取消/直接关窗 resolve(null)。
 *
 * @param onWindow - 可选：窗口创建成功的回调（portal 后端用于
 *   Request.Close 时关闭对应选择器窗口）
 */
export function openPickerWindow(
  config: PickerConfig,
  parent: BrowserWindow | undefined,
  createPicker: (config: PickerConfig, parent: BrowserWindow | undefined) => Promise<BrowserWindow>,
  onWindow?: (win: BrowserWindow) => void,
): Promise<string[] | null> {
  return new Promise<string[] | null>((resolve) => {
    createPicker(config, parent)
      .then((win) => {
        const wcId = win.webContents.id;
        pendingPickers.set(wcId, { resolve, win });
        onWindow?.(win);
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
}

/**
 * 校验并归一化 picker:open 的选项：
 * - mode 白名单；
 * - initialPath 为绝对路径字符串；
 * - filters ≤ 20，每项 id 非空、extensions 为合法 `.ext` 形态（≤ 30）、
 *   mimes 为合法 mime 形态（≤ 30）、label 为可选字符串；
 * - 对缺省 label 的 filter 解析首扩展名 mime（resolvedMime，供前端
 *   生成 i18n 显示名）。
 * 未知字段一律忽略（向前兼容）；已知字段非法时忽略该字段（mode 非法抛错）。
 */
function sanitizeOptions(options: unknown): PickerConfig {
  const raw = (options ?? {}) as Record<string, unknown>;
  const mode = raw.mode;
  if (typeof mode !== 'string' || !VALID_MODES.has(mode)) {
    throw new Error('Invalid picker mode');
  }
  const config: PickerConfig = { mode: mode as PickerConfig['mode'] };

  if (typeof raw.initialPath === 'string' && raw.initialPath.startsWith('/')) {
    config.initialPath = raw.initialPath;
  }
  if (typeof raw.defaultFilterId === 'string' && raw.defaultFilterId) {
    config.defaultFilterId = raw.defaultFilterId;
  }

  if (Array.isArray(raw.filters)) {
    const filters: PickerFilter[] = [];
    for (const item of raw.filters.slice(0, MAX_FILTERS)) {
      const f = (item ?? {}) as Record<string, unknown>;
      if (typeof f.id !== 'string' || !f.id) continue;
      const filter: PickerFilter = { id: f.id, extensions: [] };
      if (typeof f.label === 'string' && f.label) filter.label = f.label;
      if (Array.isArray(f.extensions)) {
        for (const ext of f.extensions.slice(0, MAX_EXTENSIONS_PER_FILTER)) {
          if (typeof ext === 'string' && /^\.[A-Za-z0-9_+-]+$/.test(ext)) {
            filter.extensions.push(ext.toLowerCase());
          }
        }
      }
      if (Array.isArray(f.mimes)) {
        const mimes: string[] = [];
        for (const m of f.mimes.slice(0, MAX_MIMES_PER_FILTER)) {
          if (typeof m === 'string' && /^[A-Za-z0-9.+-]+\/(\*|[A-Za-z0-9.+-]+)$/.test(m)) {
            mimes.push(m);
          }
        }
        if (mimes.length > 0) filter.mimes = mimes;
      }
      if (filter.extensions.length === 0 && !filter.mimes) continue;
      // 缺省 label：解析首扩展名 mime，供前端生成 i18n 显示名
      if (!filter.label && filter.extensions.length > 0) {
        const mime = EXT_TO_MIME[filter.extensions[0]];
        if (mime) filter.resolvedMime = mime;
      }
      filters.push(filter);
    }
    if (filters.length > 0) config.filters = filters;
  }

  return config;
}

/**
 * 注册文件选择器 IPC：
 * - `picker:open`：请求方（任意窗口）发起，主进程创建选择器窗口并
 *   返回 Promise——选择器回传路径数组时 resolve，取消/直接关窗时
 *   resolve(null)。**并发语义**：每次调用创建独立窗口并登记独立
 *   待决项（按窗口 webContents.id 隔离），多个选择器互不影响；
 * - `picker:resolve`：选择器窗口回传选中路径（null = 取消），
 *   主进程把结果交给对应请求方并关闭该选择器窗口。
 *
 * @param createPicker - 创建选择器窗口的工厂（由 main.ts 注入，
 *   复用 createWindow 的窗口集合/加载/清理逻辑）
 */
export function registerPickerHandlers(
  createPicker: (config: PickerConfig, parent: BrowserWindow | undefined) => Promise<BrowserWindow>,
) {
  ipcMain.handle('picker:open', (event, options: unknown) => {
    const config = sanitizeOptions(options);
    const requester = BrowserWindow.fromWebContents(event.sender);

    return openPickerWindow(config, requester ?? undefined, createPicker);
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
