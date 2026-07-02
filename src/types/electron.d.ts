import { IFile } from './files';

export interface IDrive {
    name: string;
    label: string;
    mountpoint: string;
    size: string;
    type: string;
    removable: boolean;
    usb: boolean;
}

export interface IElectronAPI {
    getThemeCss: () => Promise<string | null>;
    listDir: (path: string) => Promise<{ data: IFile[]; actualPath: string; error?: { code: string; originalPath: string } }>;
    getParentPath: (path: string) => Promise<string>;
    getHomePath: () => Promise<string>;
    getPlaces: () => Promise<Array<{ name: string; path: string; icon: string }>>;
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
    readFile: (path: string) => Promise<string | null>;
    startDrag: (paths: string | string[]) => void;
    cacheDragIcon: (name: string, pngBase64: string) => void;
    getStartupPath: () => Promise<string | null>;
    search: (directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => Promise<IFile[]>;
    getDirectorySize: (path: string) => Promise<number>;
    setIcon: (iconType: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    getStorageUsage: () => Promise<{ total: number; used: number; free: number } | null>;
    getDrives: () => Promise<IDrive[]>;
    getRecommendedApps: (path: string) => Promise<{ name: string; icon: string | null; exec: string; path: string; }[]>;

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
}

declare global {
    interface Window {
        electron: IElectronAPI;
    }
}
