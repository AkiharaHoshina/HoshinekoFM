import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getThemeCss: () => ipcRenderer.invoke('theme:get-css'),
  readDmsTheme: () => ipcRenderer.invoke('theme:read-dms'),
  /** 检测系统明暗偏好（跟随系统默认值） */
  detectColorScheme: () => ipcRenderer.invoke('theme:detect-color-scheme'),
  /** 设置应用级明暗来源（dark/light/system），全局立即生效 */
  setThemeSource: (source: 'dark' | 'light' | 'system') => ipcRenderer.invoke('theme:set-source', source),
  findWallpaper: () => ipcRenderer.invoke('theme:find-wallpaper'),
  genWallpaperTheme: (imagePath: string, type: string, contrast: number) => ipcRenderer.invoke('theme:gen-wallpaper', imagePath, type, contrast),
  // 主题实时预览：预览变化 → 主进程广播到所有窗口
  previewTheme: (css: string) => ipcRenderer.send('theme:preview', css),
  endThemePreview: () => ipcRenderer.send('theme:preview-end'),
  onThemePreview: (callback: (css: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, css: string) => callback(css);
    ipcRenderer.on('theme:preview-css', handler);
    return () => ipcRenderer.removeListener('theme:preview-css', handler);
  },
  onThemePreviewEnd: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('theme:preview-end', handler);
    return () => ipcRenderer.removeListener('theme:preview-end', handler);
  },
  /** 订阅系统明暗变化（跟随系统模式下主进程检测链变化时广播） */
  onSystemSchemeChanged: (callback: (mode: 'dark' | 'light') => void) => {
    const handler = (_: Electron.IpcRendererEvent, mode: unknown) => {
      if (mode === 'dark' || mode === 'light') callback(mode);
    };
    ipcRenderer.on('theme:system-scheme-changed', handler);
    return () => ipcRenderer.removeListener('theme:system-scheme-changed', handler);
  },
  /** 订阅固定项快照变化（服务模式常驻进程广播，打开中的选择器/保存器实时跟随） */
  onPickerPinnedDirsChanged: (callback: (dirs: Array<{ name: string; path: string; isDir: boolean }>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, dirs: unknown) => {
      if (Array.isArray(dirs)) {
        callback(dirs as Array<{ name: string; path: string; isDir: boolean }>);
      }
    };
    ipcRenderer.on('picker:pinned-dirs-changed', handler);
    return () => ipcRenderer.removeListener('picker:pinned-dirs-changed', handler);
  },
  /** 订阅选择器显示偏好变化（服务模式常驻进程广播；null = 快照被清，回落注入值/默认） */
  onPickerViewPrefsChanged: (callback: (prefs: {
    viewMode: 'grid' | 'list';
    iconSize: number;
    showHiddenFiles: boolean;
    filledIcons: boolean;
    marqueeEnabled: boolean;
  } | null) => void) => {
    const handler = (_: Electron.IpcRendererEvent, prefs: unknown) => {
      if (prefs === null || typeof prefs === 'object') {
        callback(prefs as {
          viewMode: 'grid' | 'list';
          iconSize: number;
          showHiddenFiles: boolean;
          filledIcons: boolean;
          marqueeEnabled: boolean;
        } | null);
      }
    };
    ipcRenderer.on('picker:view-prefs-changed', handler);
    return () => ipcRenderer.removeListener('picker:view-prefs-changed', handler);
  },
  listDir: (path: string) => ipcRenderer.invoke('fs:list-dir', path),
  getParentPath: (path: string) => ipcRenderer.invoke('fs:get-parent', path),
  getHomePath: () => ipcRenderer.invoke('fs:get-home'),
  getHomeMap: () => ipcRenderer.invoke('fs:get-home-map'),
  getPlaces: () => ipcRenderer.invoke('fs:get-places'),
  listTrash: () => ipcRenderer.invoke('fs:trash-list'),
  removeFromTrash: (names: string[]) => ipcRenderer.invoke('fs:trash-remove', names),
  removeTrashInfo: (names: string[]) => ipcRenderer.invoke('fs:trash-remove-info', names),
  emptyTrash: () => ipcRenderer.invoke('fs:trash-empty'),
  getTrashDir: () => ipcRenderer.invoke('fs:get-trash-dir'),
  copyFile: (source: string, dest: string) => ipcRenderer.invoke('fs:copy', source, dest),
  moveFile: (source: string, dest: string) => ipcRenderer.invoke('fs:move', source, dest),
  /** 修改文件/目录权限（3 位八进制模式，如 '755'） */
  chmodFile: (path: string, mode: string) => ipcRenderer.invoke('fs:chmod', path, mode),
  trashFile: (path: string) => ipcRenderer.invoke('fs:trash', path),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  createDirectory: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
  openPath: (path: string) => ipcRenderer.invoke('fs:open', path),
  extractFile: (path: string) => ipcRenderer.invoke('fs:extract', path),
  /** 压缩为 zip / tar.gz（同目录条目 → 归档文件） */
  compress: (params: { paths: string[]; destPath: string; format: 'zip' | 'tar.gz' }) => ipcRenderer.invoke('fs:compress', params),
  getApps: () => ipcRenderer.invoke('system:get-apps'),
  openWith: (exec: string, path: string, desktopFile?: string) => ipcRenderer.invoke('system:open-with', exec, path, desktopFile),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  /**
   * 内置文件选择器（独立窗口）。
   * mode 是第三方程序接入时声明可选条目类型的接口：
   * - 'file'：仅文件可选
   * - 'folder'：仅文件夹可选
   * - 'files'：仅文件可选（多选语义别名，与 file 行为一致）
   * - 'items'：全部可选——文件与文件夹皆可选
   * file/folder/files/items 均支持多选（框选），调用方按需取结果。
   */
  openPicker: (options: { mode: 'file' | 'folder' | 'files' | 'items' }) => ipcRenderer.invoke('picker:open', options),
  getPickerConfig: () => ipcRenderer.invoke('picker:get-config'),
  resolvePicker: (paths: string[] | null) => ipcRenderer.invoke('picker:resolve', paths),
  /** 上报侧边栏固定项（主进程落盘快照，供服务模式选择器窗口显示固定目录） */
  setPinnedDirs: (pinnedDirs: unknown) => ipcRenderer.invoke('app:set-pinned-dirs', pinnedDirs),
  /** 上报选择器显示偏好（主进程落盘快照，供服务模式选择器窗口跟随视图模式等只读设置） */
  setPickerViewPrefs: (prefs: unknown) => ipcRenderer.invoke('app:set-picker-view-prefs', prefs),
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  readPreviewText: (path: string) => ipcRenderer.invoke('fs:read-preview-text', path),
  listArchive: (path: string, requestId?: string) => ipcRenderer.invoke('fs:list-archive', path, requestId),
  /** 取消指定 requestId 的归档列表（切文件时调用，杀掉后台 unzip/tar 进程组） */
  cancelArchiveList: (requestId: string) => ipcRenderer.send('fs:cancel-archive-list', requestId),
  getDirInfo: (path: string) => ipcRenderer.invoke('fs:get-dir-info', path),
  /** 窗口管理器类型检测（自定义标题栏跟随系统模式） */
  detectWindowManager: () => ipcRenderer.invoke('system:detect-window-manager'),
  /** 默认文件管理器：查询/设置 inode/directory 的默认处理程序（xdg-mime） */
  getDirMimeHandler: () => ipcRenderer.invoke('system:get-dir-mime-handler'),
  setDirMimeHandler: (handler: string) => ipcRenderer.invoke('system:set-dir-mime-handler', handler),
  /** 清除本应用的默认文件管理器关联（无恢复记录时的兜底，回落系统默认） */
  clearDirMimeHandler: () => ipcRenderer.invoke('system:clear-dir-mime-handler'),
  /** 系统集成一键安装（portal 配置 + D-Bus 激活文件，经 pkexec 授权） */
  installSystemIntegration: (userOnly?: boolean) => ipcRenderer.invoke('system:install-system-integration', userOnly ?? false),
  /** 系统集成一键卸载（install.sh 的逆操作，经 pkexec 授权移除 root 级文件） */
  uninstallSystemIntegration: (userOnly?: boolean) => ipcRenderer.invoke('system:uninstall-system-integration', userOnly ?? false),
  getSystemIntegrationStatus: () => ipcRenderer.invoke('system:get-system-integration-status'),
  /** 后端总线名冲突报告（注册失败诊断：旧版常驻/僵尸占名；无冲突为空数组） */
  getBackendConflicts: () => ipcRenderer.invoke('system:get-backend-conflicts'),
  /** 重启会话总线（清除僵尸占名；成功后主进程自动重新注册后端） */
  restartSessionBus: () => ipcRenderer.invoke('system:restart-session-bus'),
  /** 自定义标题栏窗口控制 */
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizeChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: unknown, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },
  startDrag: (paths: string | string[], files?: { path: string; name: string; isDirectory: boolean; trashOriginalPath?: string }[]) => ipcRenderer.send('dnd:start', { paths, files }),
  claimDragFiles: () => ipcRenderer.invoke('dnd:claim-files'),
  consumeDrag: () => ipcRenderer.invoke('dnd:consume'),
  onDragConsumedExternally: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('dnd:externally-consumed', handler);
    return () => ipcRenderer.removeListener('dnd:externally-consumed', handler);
  },
  cacheDragIcon: (name: string, pngBase64: string) => ipcRenderer.send('cache:drag-icon', name, pngBase64),

  // 跨窗口剪贴板（主进程持有，广播到所有窗口）
  clipboardSet: (data: unknown) => ipcRenderer.invoke('clipboard:set', data),
  clipboardGet: () => ipcRenderer.invoke('clipboard:get'),
  clipboardClear: () => ipcRenderer.invoke('clipboard:clear'),
  onClipboardChange: (callback: (data: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('clipboard:changed', handler);
    return () => ipcRenderer.removeListener('clipboard:changed', handler);
  },
  getStorageUsage: () => ipcRenderer.invoke('system:get-storage-usage'),
  getStorageUsages: (paths: string[]) => ipcRenderer.invoke('system:get-storage-usages', paths),
  /** 缩略图缓存占用统计（设置页显示） */
  getThumbnailCacheInfo: () => ipcRenderer.invoke('system:get-thumbnail-cache-info'),
  /** 清空缩略图缓存，返回清除前文件数与释放字节数 */
  clearThumbnailCache: () => ipcRenderer.invoke('system:clear-thumbnail-cache'),
  getStartupPath: () => ipcRenderer.invoke('app:get-startup-path'),
  getStartupRequest: () => ipcRenderer.invoke('app:get-startup-request'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  existsBatch: (paths: string[]) => ipcRenderer.invoke('fs:exists-batch', paths),
  setIcon: (iconPath: string) => ipcRenderer.invoke('window:set-icon', iconPath),
  /** 界面缩放：设置本窗口 zoom factor（0.5–2.0），跨窗口同步由 storage 事件驱动各窗口自行调用 */
  setUiZoom: (factor: number) => ipcRenderer.invoke('window:set-zoom', factor),
  search: (dir: string, query: string, options?: { type?: 'f' | 'd'; minSize?: string; maxSize?: string }) => ipcRenderer.invoke('system:search', dir, query, options),
  getDirectorySize: (path: string, requestId?: string) => ipcRenderer.invoke('system:get-directory-size', path, requestId),
  /** 取消目录大小统计（团体属性对话框关闭时杀残留 du；requestId 定向匹配） */
  cancelDirectorySize: (requestId?: string) => ipcRenderer.send('system:cancel-directory-size', requestId),
  getDrives: () => ipcRenderer.invoke('system:get-drives'),
  getAllDevices: () => ipcRenderer.invoke('system:get-all-devices'),
  getGvfsVolumes: () => ipcRenderer.invoke('system:get-gvfs-volumes'),
  mountGvfs: (deviceId: string, name: string) => ipcRenderer.invoke('system:mount-gvfs', deviceId, name),
  unmountGvfs: (mountpoint: string) => ipcRenderer.invoke('system:unmount-gvfs', mountpoint),
  getMountMap: () => ipcRenderer.invoke('system:get-mount-map'),
  mountDevice: (devicePath: string) => ipcRenderer.invoke('system:mount-device', devicePath),
  unmountDevice: (devicePath: string) => ipcRenderer.invoke('system:unmount-device', devicePath),
  ejectDevice: (devicePath: string) => ipcRenderer.invoke('system:eject-device', devicePath),
  getSymlinkTarget: (path: string) => ipcRenderer.invoke('fs:get-symlink-target', path),
  checkSymlinks: (paths: string[]) => ipcRenderer.invoke('fs:check-symlinks', paths),
  realpath: (path: string) => ipcRenderer.invoke('fs:realpath', path),
  stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
  getRecommendedApps: (path: string) => ipcRenderer.invoke('system:get-recommended-apps', path),
  openTerminal: (dir: string) => ipcRenderer.invoke('system:open-terminal', dir),

  // PTY
  ptySpawn: (cwd: string) => ipcRenderer.invoke('terminal:spawn', cwd),
  ptyWrite: (pid: number, data: string) => ipcRenderer.send('terminal:write', pid, data),
  ptyResize: (pid: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', pid, cols, rows),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  ptyKill: (pid: number) => ipcRenderer.send('terminal:kill', pid),
  ptyOnData: (pid: number, callback: (data: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(`terminal:data:${pid}`, handler);
    return () => ipcRenderer.removeListener(`terminal:data:${pid}`, handler);
  },
  ptyOnExit: (pid: number, callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(`terminal:exit:${pid}`, handler);
    return () => ipcRenderer.removeListener(`terminal:exit:${pid}`, handler);
  },

  // 终端右键菜单辅助：系统剪贴板读写与日志导出
  ptyClipboardWrite: (text: string) => ipcRenderer.invoke('terminal:clipboard-write', text),
  ptyClipboardRead: () => ipcRenderer.invoke('terminal:clipboard-read') as Promise<string>,
  ptyExportLog: (content: string) => ipcRenderer.invoke('terminal:export-log', content) as Promise<{ ok: boolean; canceled: boolean; path?: string }>,

  // File watching
  watchDirectory: (dir: string) => ipcRenderer.invoke('fs:watch-dir', dir),
  unwatchDirectory: (dir: string) => ipcRenderer.invoke('fs:unwatch-dir', dir),
  onDirChanged: (callback: (dir: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, dir: string) => callback(dir);
    ipcRenderer.on('fs:dir-changed', handler);
    return () => ipcRenderer.removeListener('fs:dir-changed', handler);
  },

  // Device event push
  onDeviceChange: (callback: (devices: unknown[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, devices: unknown[]) => callback(devices);
    ipcRenderer.on('system:devices-changed', handler);
    return () => ipcRenderer.removeListener('system:devices-changed', handler);
  },
  // GVfs session devices (MTP phones / PTP cameras) event push
  onGvfsChange: (callback: (volumes: unknown[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, volumes: unknown[]) => callback(volumes);
    ipcRenderer.on('system:gvfs-changed', handler);
    return () => ipcRenderer.removeListener('system:gvfs-changed', handler);
  },
  hasDeviceWatcher: () => ipcRenderer.invoke('system:has-device-watcher'),

  // Job system (batch file operations with progress + cancel)
  startJob: (params: unknown) => ipcRenderer.invoke('job:start', params),
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId),
  onJobProgress: (jobId: string, callback: (data: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => {
      if ((data as { jobId?: string }).jobId === jobId) callback(data);
    };
    ipcRenderer.on('job:progress', handler);
    return () => ipcRenderer.removeListener('job:progress', handler);
  },
  onJobComplete: (jobId: string, callback: (data: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => {
      if ((data as { jobId?: string }).jobId === jobId) {
        callback(data);
        ipcRenderer.removeListener('job:complete', handler);
      }
    };
    ipcRenderer.on('job:complete', handler);
    return () => ipcRenderer.removeListener('job:complete', handler);
  },
});
