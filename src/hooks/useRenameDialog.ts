import { useState, useCallback } from 'react';
import { renameFile as renameFileOp } from '../utils/fileOperations';
import type { IFile } from '../types/files';

/**
 * 重命名对话框状态与执行。
 *
 * @param onTabRefresh - 重命名成功后刷新当前标签页列表
 * @param onRenamed - 可选：重命名成功后回调（oldPath → newPath），
 *   供 App 同步固定项等派生状态；仅在成功分支触发（失败弹 toast 不回调）
 */
export function useRenameDialog(
  onTabRefresh: () => void,
  onRenamed?: (oldPath: string, newPath: string) => void,
) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameFile, setRenameFile] = useState<IFile | null>(null);
  const [newName, setNewName] = useState("");

  const openRenameDialog = useCallback((file: IFile) => {
    setRenameFile(file);
    setNewName(file.name);
    setRenameDialogOpen(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (renameFile && newName && newName !== renameFile.name) {
      const lastSlashIndex = renameFile.path.lastIndexOf("/");
      const parentDir = renameFile.path.substring(0, lastSlashIndex);
      const targetPath = `${parentDir}/${newName}`;
      await renameFileOp(renameFile.path, targetPath, () => {
        onTabRefresh();
        onRenamed?.(renameFile.path, targetPath);
      });
    }
    setRenameDialogOpen(false);
    setRenameFile(null);
  }, [renameFile, newName, onTabRefresh, onRenamed]);

  return {
    renameDialogOpen,
    setRenameDialogOpen,
    renameFile,
    newName,
    setNewName,
    handleRename,
    openRenameDialog,
  };
}
