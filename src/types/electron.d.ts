import type { IFile, AllDevice } from './files';

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
    search: (directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => Promise<IFile[]>;
    getDirectorySize: (path: string) => Promise<number>;
    setIcon: (iconType: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    existsBatch: (paths: string[]) => Promise<Record<string, boolean>>;
    getStorageUsage: () => Promise<{ total: number; used: number; free: number } | null>;
    getDrives: () => Promise<IDrive[]>;
    getAllDevices: () => Promise<AllDevice[]>;
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

    // File watching
    watchDirectory: (dir: string) => Promise<void>;
    unwatchDirectory: (dir: string) => Promise<void>;
    onDirChanged: (callback: (dir: string) => void) => () => void;

    // Device event push
    onDeviceChange: (callback: (devices: AllDevice[]) => void) => () => void;
    hasDeviceWatcher: () => Promise<boolean>;

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
