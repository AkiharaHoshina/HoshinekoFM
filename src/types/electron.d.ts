import type { IFile, AllDevice, GvfsVolume } from './files';
import type { PickerConfig } from './picker';

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
    /**
     * 检测系统明暗偏好：DMS(门户) → GNOME → KDE → fallback 暗色。
     * 返回生效模式与检测来源（供「跟随系统（GNOME）」副标题显示）。
     * niri 不负责明暗主题，不参与检测链。
     */
    detectColorScheme: () => Promise<{ mode: 'dark' | 'light'; source: 'dms' | 'gnome' | 'kde' | 'fallback' }>;
    /**
     * 设置应用级明暗来源（Electron nativeTheme.themeSource，全局立即生效）：
     * 'dark'/'light' 强制模式（prefers-color-scheme 随之变化，现有主题
     * CSS 无需改动即切换）；'system' 恢复跟随操作系统。
     */
    setThemeSource: (source: 'dark' | 'light' | 'system') => Promise<void>;
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
    /**
     * 修改文件/目录权限。mode 为 3 位八进制字符串（如 '755'）。
     * 失败返回结构化错误码：INVALID_PATH / INVALID_MODE。
     */
    chmodFile: (path: string, mode: string) => Promise<{ success: boolean; code?: string; error?: string }>;
    trashFile: (path: string) => Promise<boolean>;
    renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
    createDirectory: (path: string) => Promise<boolean>;
    openPath: (path: string) => Promise<string>;
    extractFile: (path: string) => Promise<boolean>;
    /**
     * 压缩一组同目录条目为归档（zip 走 `zip -r`，tar.gz 走 `tar -czf`）。
     * 失败时返回结构化错误码：NO_TOOL（zip 未安装）/ INVALID_ARGS。
     */
    compress: (params: { paths: string[]; destPath: string; format: 'zip' | 'tar.gz' }) => Promise<{ success: boolean; code?: string; error?: string }>;
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
    /**
     * 打开内置文件选择器窗口；返回选中路径数组，取消/关窗返回 null。
     * 选项（mode 必填，其余可选）：filters 类型过滤器（底部下拉，
     * 缺省仅「所有文件」）、initialPath 初始目录、defaultFilterId 默认过滤。
     * 协议详见 docs/picker-api.md 与 src/types/picker.ts。
     */
    openPicker: (options: PickerConfig) => Promise<string[] | null>;
    /** 选择器窗口读取自身配置（完整 PickerConfig；普通窗口返回 null） */
    getPickerConfig: () => Promise<PickerConfig | null>;
    /** 选择器窗口回传选中结果（null = 取消），主进程随后关闭该窗口 */
    resolvePicker: (paths: string[] | null) => Promise<void>;
    readFile: (path: string) => Promise<string | null>;
    /**
     * 读取文本预览内容（预览面板用）。大小上限 512 KiB：
     * 超限返回 `{ success: false, code: 'TOO_LARGE', size }`；
     * 其他错误码：INVALID_PATH / NOT_FILE / READ_FAILED。
     */
    readPreviewText: (path: string) => Promise<{
      success: boolean;
      content?: string;
      code?: 'INVALID_PATH' | 'NOT_FILE' | 'TOO_LARGE' | 'READ_FAILED';
      size?: number;
    }>;
    /**
     * 列出归档文件内容条目（预览面板归档视图用）。
     * entries 上限 5000（超出 truncated=true）；
     * requestId 供切文件时经 cancelArchiveList 定向取消；
     * 收集满上限后主进程会提前终止列表进程——此时 total 为 null
     * （未提前终止且截断时 total 为完整总数）。
     * 错误码：INVALID_PATH / NOT_FILE / UNSUPPORTED / NO_TOOL /
     * READ_FAILED / TIMEOUT / KILLED（切换文件或取消时旧请求被终止）。
     */
    listArchive: (path: string, requestId?: string) => Promise<{
      success: boolean;
      entries?: string[];
      truncated?: boolean;
      /** 完整条目总数（截断时用；提前终止时为 null） */
      total?: number | null;
      code?: 'INVALID_PATH' | 'NOT_FILE' | 'UNSUPPORTED' | 'NO_TOOL' | 'READ_FAILED' | 'TIMEOUT' | 'KILLED';
      error?: string;
    }>;
    /** 取消指定 requestId 的归档列表（切文件时调用，杀掉后台 unzip/tar 进程组） */
    cancelArchiveList: (requestId: string) => void;
    /**
     * 读取目录属性信息（预览面板「未选中条目」时的目录属性视图，
     * **轻量**：不含 du，大小由前端另走 getDirectorySize）。
     * trash:// 映射到真实回收站 files 目录，path 返回真实路径；
     * 错误码：INVALID_PATH / NOT_DIR / READ_FAILED。
     */
    getDirInfo: (path: string) => Promise<{
      success: boolean;
      path?: string;
      mtime?: string;
      mode?: number;
      uid?: number;
      gid?: number;
      userName?: string;
      groupName?: string;
      code?: 'INVALID_PATH' | 'NOT_DIR' | 'READ_FAILED';
    }>;
    /**
     * 窗口管理器类型检测（自定义标题栏「跟随系统」模式）。
     * kind: tiling（平铺 WM：niri/hyprland/i3 等）→ 隐藏标题栏；
     * stacking（常规 DE）→ 显示；检测不到 fallback stacking。
     */
    detectWindowManager: () => Promise<{
      kind: 'tiling' | 'stacking';
      source: 'xdg_current_desktop' | 'xdg_session_desktop' | 'fallback';
      name?: string;
    }>;
    /** 默认文件管理器：查询 inode/directory 的当前默认处理程序（如 'org.gnome.Nautilus.desktop'） */
    getDirMimeHandler: () => Promise<{ success: boolean; handler: string | null }>;
    /** 设置 inode/directory 默认处理程序（'*.desktop' 白名单；设为
     *  HoshinekoFM.desktop 时先安装用户级桌面入口） */
    setDirMimeHandler: (handler: string) => Promise<{ success: boolean; error?: string }>;
    /** 清除本应用 inode/directory 默认关联（无恢复记录时的兜底）：
     *  从用户级 mimeapps.list 移除关联行，回落系统级默认 */
    clearDirMimeHandler: () => Promise<{ success: boolean; changed?: boolean; error?: string }>;
    /**
     * 一键安装系统集成（幂等脚本）：root 级经 pkexec（portal 配置 +
     * D-Bus 激活文件），用户级写 portals.conf preferred 项 + 重启 portal
     * 服务。userOnly=true 仅执行用户级（无 polkit 环境降级）。
     * 错误码：NO_SCRIPT / SCRIPT_FAILED。
     */
    installSystemIntegration: (userOnly?: boolean) => Promise<{
      success: boolean;
      code?: 'NO_SCRIPT' | 'SCRIPT_FAILED';
      output: string;
      error: string;
    }>;
    /**
     * 一键卸载系统集成（幂等脚本，安装的逆操作）：root 级经 pkexec
     * 移除 portal 配置 + D-Bus 激活文件，用户级移除 portals.conf
     * preferred 项 + 重启 portal 服务。错误码同安装。
     */
    uninstallSystemIntegration: (userOnly?: boolean) => Promise<{
      success: boolean;
      code?: 'NO_SCRIPT' | 'SCRIPT_FAILED';
      output: string;
      error: string;
    }>;
    /**
     * 系统集成安装状态（各文件存在性；portalsConf 为内容检测：
     * portals.conf 是否含 preferred=hoshineko 项）
     */
    getSystemIntegrationStatus: () => Promise<{
      portalConfig: boolean;
      fileManager1Service: boolean;
      portalService: boolean;
      portalsConf: boolean;
    }>;
    /** 自定义标题栏窗口控制（frameless 窗口） */
    minimizeWindow: () => Promise<void>;
    toggleMaximizeWindow: () => Promise<boolean>;
    closeWindow: () => Promise<void>;
    isWindowMaximized: () => Promise<boolean>;
    /** 订阅最大化状态变化（标题栏 最大化/还原 图标切换） */
    onWindowMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
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
    /**
     * 启动请求（路径 + 定位/属性提示）：FileManager1 ShowItems/
     * ShowItemProperties 经此让窗口打开目录后选中条目（必要时弹属性）。
     * selectFileName 为 undefined 表示无定位提示。
     */
    getStartupRequest: () => Promise<{
      startPath: string | null;
      selectFileName?: string;
      openProperties: boolean;
    }>;
    /** 应用版本号（package.json 的 version） */
    getVersion: () => Promise<string>;
    /** 用系统默认浏览器打开外部 http/https 链接 */
    openExternal: (url: string) => Promise<boolean>;
    search: (directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => Promise<IFile[]>;
    /**
     * 计算目录总大小（后端 `du -sb`）。
     * 并发策略：同一时刻只允许一个 du——新请求到达（目录切换）会杀掉旧
     * du（旧请求以 KILLED 返回）；单次超过 10s 杀掉并返回 TIMEOUT。
     * 失败返回 `{ success: false, code }`，调用方显示「无法获取」。
     */
    getDirectorySize: (path: string) => Promise<
      | { success: true; size: number }
      | { success: false; code: 'TIMEOUT' | 'KILLED' | 'FAILED' }
    >;
    setIcon: (iconType: string) => Promise<void>;
    /**
     * 界面缩放：设置本窗口的整页缩放（zoom factor，范围 0.5–2.0）。
     * 对应设置「界面缩放」滑条（50%–200%）；各窗口经 storage 事件
     * 同步后自行调用；初始缩放在 main.tsx 于首帧绘制前应用。
     */
    setUiZoom: (factor: number) => Promise<void>;
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
