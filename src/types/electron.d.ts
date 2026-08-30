import type { IFile, AllDevice, GvfsVolume } from './files';

export interface IDrive {
    name: string;
    label: string;
    mountpoint: string;
    size: string;
    type: string;
    removable: boolean;
    usb: boolean;
}

/** Parameters for starting a batch job on the main process. */
export interface StartJobParams {
  type: 'trash' | 'copy' | 'move' | 'delete';
  items: { src?: string; dest?: string; path?: string }[];
}

/** Progress data pushed from the main process during job execution. */
export interface JobProgress {
  jobId: string;
  /** Number of items completed so far */
  current: number;
  /** Total number of items */
  total: number;
  /** Paths that have failed so far */
  errors: string[];
}

/** Completion data pushed from the main process when a job finishes. */
export interface JobComplete {
  jobId: string;
  /** Number of items successfully processed */
  success: number;
  /** Number of items that failed */
  fail: number;
  /** All error paths collected during processing */
  errors: string[];
  /** Whether the job was cancelled by the user */
  cancelled: boolean;
}

/** Cross-window clipboard contents (held by the main process). */
export interface ClipboardData {
  files: IFile[];
  operation: 'copy' | 'cut';
}

/** 拖拽文件元数据（随活跃拖拽登记跨窗口传递） */
export interface DragFileMeta {
  path: string;
  name: string;
  isDirectory: boolean;
  trashOriginalPath?: string;
}

/** 拖拽登记 claim 结果（主进程仲裁跨窗口拖放只授予一个窗口） */
export type DragClaimResult =
  | { status: 'granted'; files: DragFileMeta[] }
  | { status: 'consumed' }
  | { status: 'none' };

export interface IElectronAPI {
    getThemeCss: () => Promise<string | null>;
    /** DMS 系统主题信息（scheme / contrast / dark+light 全套角色） */
    readDmsTheme: () => Promise<{ available: boolean; scheme?: string; contrast?: number; colors?: { dark: Record<string, string>; light: Record<string, string> } }>;
    /** 探测当前壁纸图片路径，失败返回 null */
    findWallpaper: () => Promise<string | null>;
    /** 用 matugen 从壁纸图片生成 M3 颜色方案 CSS；matugen 缺失时 fallback=true 且只返回种子色 */
    genWallpaperTheme: (imagePath: string, type: string, contrast: number) => Promise<{ success: boolean; css?: string; sourceColor?: string; fallback?: boolean; error?: string }>;
    /** 主题实时预览：把当前预览 CSS 发给主进程广播到所有窗口 */
    previewTheme: (css: string) => void;
    /** 主题预览结束（取消/关闭）：所有窗口重新应用已保存主题 */
    endThemePreview: () => void;
    /** 订阅其他窗口的主题预览 CSS（返回取消订阅函数） */
    onThemePreview: (callback: (css: string) => void) => () => void;
    /** 订阅主题预览结束（返回取消订阅函数） */
    onThemePreviewEnd: (callback: () => void) => () => void;
    listDir: (path: string) => Promise<{ data: IFile[]; actualPath: string; error?: { code: string; originalPath: string } }>;
    getParentPath: (path: string) => Promise<string>;
    getHomePath: () => Promise<string>;
    getHomeMap: () => Promise<Record<string, { username: string; uid: number }>>;
    getPlaces: () => Promise<Array<{ name: string; path: string; icon: string }>>;
    listTrash: () => Promise<IFile[]>;
    removeFromTrash: (names: string[]) => Promise<number>;
    removeTrashInfo: (names: string[]) => Promise<void>;
    emptyTrash: () => Promise<number>;
    getTrashDir: () => Promise<string>;
    copyFile: (source: string, dest: string) => Promise<boolean>;
    moveFile: (source: string, dest: string) => Promise<boolean>;
    trashFile: (path: string) => Promise<boolean>;
    renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
    createDirectory: (path: string) => Promise<boolean>;
    openPath: (path: string) => Promise<string>;
    extractFile: (path: string) => Promise<boolean>;
    getApps: () => Promise<{ name: string; icon: string; exec: string; desktopFile: string; }[]>;
    openWith: (exec: string, path: string, desktopFile?: string) => Promise<true | string>;
    openFileDialog: () => Promise<string | null>;
    pickFile: () => Promise<string | null>;
    pickDirectory: () => Promise<string | null>;
    /**
     * 打开内置文件选择器窗口；返回选中路径数组，取消/关窗返回 null。
     * mode 为第三方程序接入时声明可选条目类型的接口：
     * - 'file'：仅文件可选
     * - 'folder'：仅文件夹可选
     * - 'files'：仅文件可选（多选语义别名，与 file 行为一致）
     * - 'items'：全部可选——文件与文件夹皆可选
     * 四种模式均支持多选（框选），调用方按需取结果。
     */
    openPicker: (options: { mode: 'file' | 'folder' | 'files' | 'items' }) => Promise<string[] | null>;
    /** 选择器窗口读取自身配置（mode 声明见 openPicker；普通窗口返回 null） */
    getPickerConfig: () => Promise<{ mode: 'file' | 'folder' | 'files' | 'items' } | null>;
    /** 选择器窗口回传选中结果（null = 取消），主进程随后关闭该窗口 */
    resolvePicker: (paths: string[] | null) => Promise<void>;
    readFile: (path: string) => Promise<string | null>;
    startDrag: (paths: string | string[], files?: DragFileMeta[]) => void;
    claimDragFiles: () => Promise<DragClaimResult>;
    consumeDrag: () => Promise<void>;
    onDragConsumedExternally: (callback: () => void) => () => void;
    cacheDragIcon: (name: string, pngBase64: string) => void;

    // 跨窗口剪贴板
    clipboardSet: (data: ClipboardData) => Promise<void>;
    clipboardGet: () => Promise<ClipboardData | null>;
    clipboardClear: () => Promise<void>;
    onClipboardChange: (callback: (data: ClipboardData | null) => void) => () => void;
    getStartupPath: () => Promise<string | null>;
    /** 应用版本号（package.json 的 version） */
    getVersion: () => Promise<string>;
    /** 用系统默认浏览器打开外部 http/https 链接 */
    openExternal: (url: string) => Promise<boolean>;
    search: (directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => Promise<IFile[]>;
    getDirectorySize: (path: string) => Promise<number>;
    setIcon: (iconType: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    existsBatch: (paths: string[]) => Promise<Record<string, boolean>>;
    getStorageUsage: () => Promise<{ total: number; used: number; free: number } | null>;
    /**
     * 批量查询路径所属文件系统的存储占用（statfs，按查询路径逐条返回；
     * 单条失败跳过）。
     */
    getStorageUsages: (paths: string[]) => Promise<Array<{ path: string; total: number; used: number; free: number }>>;
    getDrives: () => Promise<IDrive[]>;
    getAllDevices: () => Promise<AllDevice[]>;
    /** GVfs 会话设备列表（MTP 手机 / PTP 相机，含未挂载卷） */
    getGvfsVolumes: () => Promise<GvfsVolume[]>;
    /**
     * 挂载一个未挂载的 GVfs 卷（gio mount -d），成功时返回挂载点。
     * name 用于失败后按显示名匹配新 USB 地址重试。
     * 结构化错误码：TIMEOUT / NO_SUCH_DEVICE / INVALID_DEVICE。
     */
    mountGvfs: (deviceId: string, name: string) => Promise<{ success: boolean; mountpoint?: string; code?: string; error?: string }>;
    /** 卸载一个 GVfs 会话挂载（gio mount -u） */
    unmountGvfs: (mountpoint: string) => Promise<{ success: boolean; error?: string }>;
    getMountMap: () => Promise<Record<string, { source: string; fstype: string }>>;
    mountDevice: (devicePath: string) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
    unmountDevice: (devicePath: string) => Promise<{ success: boolean; error?: string }>;
    ejectDevice: (devicePath: string) => Promise<{ success: boolean; error?: string; code?: string }>;
    getSymlinkTarget: (path: string) => Promise<{ isSymlink: boolean; target?: string; targetExists: boolean }>;
    checkSymlinks: (paths: string[]) => Promise<{ path: string; isSymlink: boolean; target?: string }[]>;
    realpath: (path: string) => Promise<string>;
    stat: (path: string) => Promise<{ isDirectory: boolean; size: number; mtime: Date } | null>;
    getRecommendedApps: (path: string) => Promise<{ name: string; icon: string | null; exec: string; path: string; }[]>;

    // 默认终端
    /** 在系统默认终端中打开目录 */
    openTerminal: (dir: string) => Promise<{ success: boolean; code?: string; error?: string }>;
    /** 在系统默认终端中运行可执行文件 */
    runInTerminal: (filePath: string) => Promise<{ success: boolean; code?: string; error?: string }>;

    // PTY
    ptySpawn: (cwd: string) => Promise<number>;
    ptyWrite: (pid: number, data: string) => void;
    ptyResize: (pid: number, cols: number, rows: number) => void;
    ptyKill: (pid: number) => void;
    createFile: (path: string) => Promise<boolean>;
    ptyOnData: (pid: number, callback: (data: string) => void) => () => void;
    ptyOnExit: (pid: number, callback: () => void) => () => void;

    // 终端右键菜单辅助
    /** 写入系统剪贴板文本（终端「复制」） */
    ptyClipboardWrite: (text: string) => Promise<void>;
    /** 读取系统剪贴板文本（终端「粘贴」） */
    ptyClipboardRead: () => Promise<string>;
    /**
     * 导出完整终端日志到 txt（保存对话框 + 写文件）。
     * 返回 ok = 已写入成功；canceled = 用户在对话框中取消。
     */
    ptyExportLog: (content: string) => Promise<{ ok: boolean; canceled: boolean; path?: string }>;

    // File watching
    watchDirectory: (dir: string) => Promise<void>;
    unwatchDirectory: (dir: string) => Promise<void>;
    onDirChanged: (callback: (dir: string) => void) => () => void;

    // Device event push
    onDeviceChange: (callback: (devices: AllDevice[]) => void) => () => void;
    hasDeviceWatcher: () => Promise<boolean>;
    // GVfs session devices (MTP phones / PTP cameras) event push
    onGvfsChange: (callback: (volumes: GvfsVolume[]) => void) => () => void;

    // Job system (batch file operations with progress + cancel)
    startJob: (params: StartJobParams) => Promise<string>;
    cancelJob: (jobId: string) => Promise<void>;
    onJobProgress: (jobId: string, callback: (data: JobProgress) => void) => () => void;
    onJobComplete: (jobId: string, callback: (data: JobComplete) => void) => () => void;
}

declare global {
    interface Window {
        electron: IElectronAPI;
    }
}
