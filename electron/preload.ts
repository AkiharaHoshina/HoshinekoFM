import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getThemeCss: () => ipcRenderer.invoke('theme:get-css'),
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
  trashFile: (path: string) => ipcRenderer.invoke('fs:trash', path),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  createDirectory: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
  openPath: (path: string) => ipcRenderer.invoke('fs:open', path),
  extractFile: (path: string) => ipcRenderer.invoke('fs:extract', path),
  getApps: () => ipcRenderer.invoke('system:get-apps'),
  openWith: (exec: string, path: string, desktopFile?: string) => ipcRenderer.invoke('system:open-with', exec, path, desktopFile),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
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
  getStartupPath: () => ipcRenderer.invoke('app:get-startup-path'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  existsBatch: (paths: string[]) => ipcRenderer.invoke('fs:exists-batch', paths),
  setIcon: (iconPath: string) => ipcRenderer.invoke('window:set-icon', iconPath),
  search: (dir: string, query: string, options?: { type?: 'f' | 'd'; minSize?: string; maxSize?: string }) => ipcRenderer.invoke('system:search', dir, query, options),
  getDirectorySize: (path: string) => ipcRenderer.invoke('system:get-directory-size', path),
  getDrives: () => ipcRenderer.invoke('system:get-drives'),
  getAllDevices: () => ipcRenderer.invoke('system:get-all-devices'),
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
  runInTerminal: (filePath: string) => ipcRenderer.invoke('system:run-in-terminal', filePath),

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
