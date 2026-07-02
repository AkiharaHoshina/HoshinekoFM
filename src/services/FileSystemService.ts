import type { IFile } from '../types/files';

export const FileSystemService = {
  async getPlaces(): Promise<Array<{ name: string; path: string; icon: string }>> {
    return window.electron.getPlaces();
  },

  async copy(source: string, dest: string): Promise<boolean> {
    return window.electron.copyFile(source, dest);
  },

  async move(source: string, dest: string): Promise<boolean> {
    return window.electron.moveFile(source, dest);
  },

  async trash(path: string): Promise<boolean> {
    return window.electron.trashFile(path);
  },

  async rename(oldPath: string, newPath: string): Promise<boolean> {
    return window.electron.renameFile(oldPath, newPath);
  },

  async mkdir(path: string): Promise<boolean> {
    return window.electron.createDirectory(path);
  },

  async open(path: string): Promise<string> {
    return window.electron.openPath(path);
  },

  async listDir(path: string): Promise<{ data: IFile[]; actualPath: string; error?: { code: string; originalPath: string } }> {
    if (window.electron && window.electron.listDir) {
      try {
        return await window.electron.listDir(path);
      } catch (error) {
        console.error('FS Error:', error);
        return { data: [], actualPath: path };
      }
    }
    return { data: [], actualPath: path };
  },

  async exists(path: string): Promise<boolean> {
    return window.electron?.exists?.(path) ?? false;
  },
};
