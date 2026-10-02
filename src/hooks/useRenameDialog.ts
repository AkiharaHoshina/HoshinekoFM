import { useState, useCallback } from 'react';
import { renameFile as renameFileOp } from '../utils/fileOperations';
import { isObjectProjectionPath } from '../utils/objectDrag';
import { isSearchSchemaPath } from '../utils/searchSchema';
import { isSettingsPath } from '../utils/settingsPath';
import type { IFile } from '../types/files';

/**
 * 重命名对话框状态与执行。
 *
 * @param onTabRefresh - 重命名成功后刷新当前标签页列表
 * @param onRenamed - 可选：重命名成功后回调（oldPath → newPath），
 *   供 App 同步固定项等派生状态；仅在成功分支触发（失败弹 toast 不回调）
 * @param onRenameProjection - 可选：投影条目重命名回调（path → 新名，
 *   objects:// 对象投影与搜索 schema（search:// / objectsearch://）虚拟
 *   路径无文件系统语义——只改固定项显示名不落盘）
 */
export function useRenameDialog(
  onTabRefresh: () => void,
  onRenamed?: (oldPath: string, newPath: string) => void,
  onRenameProjection?: (path: string, newName: string) => void,
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
      // 投影条目（objects:// 对象投影 / search:// 与 objectsearch:// 等搜索
      // schema 固定项 / settings:// 设置分类固定项）无文件系统语义——只改
      // 固定项显示名不落盘。搜索 schema 判定走通用谓词 isSearchSchemaPath
      // （未来新增搜索 schema 只需在 searchSchema.ts 登记，见其文件头）。
      if (isObjectProjectionPath(renameFile.path) || isSearchSchemaPath(renameFile.path) || isSettingsPath(renameFile.path)) {
        onRenameProjection?.(renameFile.path, newName);
      } else {
        const lastSlashIndex = renameFile.path.lastIndexOf("/");
        const parentDir = renameFile.path.substring(0, lastSlashIndex);
        const targetPath = `${parentDir}/${newName}`;
        await renameFileOp(renameFile.path, targetPath, () => {
          onTabRefresh();
          onRenamed?.(renameFile.path, targetPath);
        });
      }
    }
    setRenameDialogOpen(false);
    setRenameFile(null);
  }, [renameFile, newName, onTabRefresh, onRenamed, onRenameProjection]);

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
