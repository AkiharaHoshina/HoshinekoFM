import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getThemeCss: () => ipcRenderer.invoke('theme:get-css'),
  listDir: (path: string) => ipcRenderer.invoke('fs:list-dir', path),
  getParentPath: (path: string) => ipcRenderer.invoke('fs:get-parent', path),
  getHomePath: () => ipcRenderer.invoke('fs:get-home'),
  getPlaces: () => ipcRenderer.invoke('fs:get-places'),
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
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  startDrag: (paths: string | string[]) => ipcRenderer.send('dnd:start', paths),
  cacheDragIcon: (name: string, pngBase64: string) => ipcRenderer.send('cache:drag-icon', name, pngBase64),
  getStorageUsage: () => ipcRenderer.invoke('system:get-storage-usage'),
  getStartupPath: () => ipcRenderer.invoke('app:get-startup-path'),
  exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  setIcon: (iconPath: string) => ipcRenderer.invoke('window:set-icon', iconPath),
  search: (dir: string, query: string, options?: any) => ipcRenderer.invoke('system:search', dir, query, options),
  getDirectorySize: (path: string) => ipcRenderer.invoke('system:get-directory-size', path),
  getDrives: () => ipcRenderer.invoke('system:get-drives'),
  getAllDevices: () => ipcRenderer.invoke('system:get-all-devices'),
  getMountMap: () => ipcRenderer.invoke('system:get-mount-map'),
  mountDevice: (devicePath: string) => ipcRenderer.invoke('system:mount-device', devicePath),
  unmountDevice: (devicePath: string) => ipcRenderer.invoke('system:unmount-device', devicePath),
  ejectDevice: (devicePath: string) => ipcRenderer.invoke('system:eject-device', devicePath),
  getSymlinkTarget: (path: string) => ipcRenderer.invoke('fs:get-symlink-target', path),
  checkSymlinks: (paths: string[]) => ipcRenderer.invoke('fs:check-symlinks', paths),
  getRecommendedApps: (path: string) => ipcRenderer.invoke('system:get-recommended-apps', path),

  // PTY
  ptySpawn: (cwd: string) => ipcRenderer.invoke('terminal:spawn', cwd),
  ptyWrite: (pid: number, data: string) => ipcRenderer.send('terminal:write', pid, data),
  ptyResize: (pid: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', pid, cols, rows),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:create-file', filePath),
  ptyKill: (pid: number) => ipcRenderer.send('terminal:kill', pid),
  ptyOnData: (pid: number, callback: (data: string) => void) => {
    const handler = (_: any, data: string) => callback(data);
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
    const handler = (_: any, dir: string) => callback(dir);
    ipcRenderer.on('fs:dir-changed', handler);
    return () => ipcRenderer.removeListener('fs:dir-changed', handler);
  }
});
