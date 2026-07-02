import { showToast } from './toast';
import {
  checkConflicts,
  generateSafeName,
  splitNameExt,
  prepareDestParent,
  type ConflictEntry,
  type ConflictResult,
} from './fileConflict';

export function formatFileOpError(operation: string, fileRef: string, error: any): string {
  let code: string = error?.code || '';
  const msg = (error?.message || error?.toString() || '').toLowerCase();

  if (!code) {
    const m = msg.match(/error:\s*(\w+):/);
    if (m) code = m[1].toUpperCase();
  }

  switch (code) {
  case 'EEXIST':  return `${operation} ${fileRef}: 存在重名文件`;
  case 'ENOENT':  return `${operation} ${fileRef}: 文件或目录不存在`;
  case 'EACCES':
  case 'EPERM':   return `${operation} ${fileRef}: 权限不足`;
  case 'ENOSPC':  return `${operation} ${fileRef}: 磁盘空间不足`;
  case 'EROFS':   return `${operation} ${fileRef}: 文件系统只读`;
  case 'EISDIR':  return `${operation} ${fileRef}: 路径是一个目录`;
  case 'ENOTDIR': return `${operation} ${fileRef}: 路径不是一个目录`;
  case 'EXDEV':   return `${operation} ${fileRef}: 无法跨设备移动文件`;
  case 'EBUSY':   return `${operation} ${fileRef}: 文件被占用，请关闭后重试`;
  }

  if (msg.includes('same file') || msg.includes('same path') || msg.includes('source and destination')) {
    return `${operation} ${fileRef}: 目标不能是自身`;
  }
  if (msg.includes('already exists') || msg.includes('exists')) {
    return `${operation} ${fileRef}: 存在重名文件`;
  }
  if (msg.includes('no such file') || msg.includes('not found') || msg.includes('不存在')) {
    return `${operation} ${fileRef}: 找不到文件`;
  }
  if (msg.includes('permission denied') || msg.includes('not permitted') || msg.includes('eacces') || msg.includes('eperm')) {
    return `${operation} ${fileRef}: 权限不足`;
  }
  if (msg.includes('not a directory')) {
    return `${operation} ${fileRef}: 路径不是一个目录`;
  }
  if (msg.includes('is a directory')) {
    return `${operation} ${fileRef}: 路径是一个目录`;
  }
  if (msg.includes('no space') || msg.includes('device') || msg.includes('enospc')) {
    return `${operation} ${fileRef}: 磁盘空间不足`;
  }
  if (msg.includes('read-only') || msg.includes('erofs')) {
    return `${operation} ${fileRef}: 文件系统只读`;
  }
  if (msg.includes('busy') || msg.includes('ebusy')) {
    return `${operation} ${fileRef}: 文件被占用，请关闭后重试`;
  }

  return `${operation} ${fileRef}: ${error?.message || error || '未知错误'}`;
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
}

function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const result: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { result.pop(); continue; }
    result.push(p);
  }
  return (path.startsWith('/') ? '/' : '') + result.join('/');
}

export async function createFile(
  filePath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await window.electron.createFile(filePath);
    showToast(`文件 ${fileName(filePath)} 已创建`, 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('创建文件', fileName(filePath), e), 'error');
  }
}

export async function createDirectory(
  dirPath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await window.electron.createDirectory(dirPath);
    showToast(`文件夹 ${fileName(dirPath)} 已创建`, 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('创建文件夹', fileName(dirPath), e), 'error');
  }
}

export async function renameFile(
  oldPath: string,
  newPath: string,
  onSuccess?: () => void,
): Promise<void> {
  const oldParent = oldPath.substring(0, oldPath.lastIndexOf('/'));
  const newParent = newPath.substring(0, newPath.lastIndexOf('/'));
  const oldName = fileName(oldPath);
  const newName = fileName(newPath);
  try {
    const targetExists = await window.electron.exists(newPath);
    if (targetExists) {
      showToast(`重命名失败：${newName} 已存在`, 'error');
      return;
    }
    if (newParent !== oldParent) {
      const ok = await prepareDestParent(newPath);
      if (!ok) return;
    }
    await window.electron.renameFile(oldPath, newPath);
    if (oldParent === newParent) {
      showToast(`重命名：${oldName} -> ${newName}`, 'success');
    } else {
      showToast(`重命名：${oldName} 已移动至 ${normalizePath(newPath)}`, 'success');
    }
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('重命名', `${oldName} -> ${normalizePath(newPath)}`, e), 'error');
  }
}

export async function trashFile(
  filePath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await window.electron.trashFile(filePath);
    showToast(`${fileName(filePath)} 已删除`, 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('删除', fileName(filePath), e), 'error');
  }
}

export async function trashFiles(
  paths: string[],
  onSuccess?: () => void,
): Promise<void> {
  let success = 0;
  let fail = 0;
  for (const p of paths) {
    try {
      await window.electron.trashFile(p);
      success++;
    } catch {
      fail++;
    }
  }
  if (success > 0) {
    showToast(`已删除 ${success} 个项目`, 'success');
    onSuccess?.();
  }
  if (fail > 0) {
    showToast(`删除 ${fail} 个项目失败，请检查权限`, 'error');
  }
}

export async function copyFile(
  source: string,
  dest: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    const targetExists = await window.electron.exists(dest);
    if (targetExists) {
      showToast(`复制失败：${fileName(dest)} 已存在`, 'error');
      return;
    }
    await window.electron.copyFile(source, dest);
    const destDir = dest.split('/').slice(0, -1).pop() || '';
    showToast(`${fileName(source)} → ${destDir}/${fileName(dest)}`, 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('复制', `${fileName(source)} -> ${fileName(dest)}`, e), 'error');
  }
}

export async function moveFile(
  source: string,
  dest: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    const targetExists = await window.electron.exists(dest);
    if (targetExists) {
      showToast(`移动失败：${fileName(dest)} 已存在`, 'error');
      return;
    }
    await window.electron.moveFile(source, dest);
    const destDir = dest.split('/').slice(0, -1).pop() || '';
    showToast(`${fileName(source)} → ${destDir}/${fileName(dest)}`, 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError('移动', `${fileName(source)} -> ${fileName(dest)}`, e), 'error');
  }
}

export async function extractFile(
  filePath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    const ok = await window.electron.extractFile(filePath);
    if (ok) {
      showToast(`${fileName(filePath)} 已解压`, 'success');
      onSuccess?.();
    } else {
      showToast(`解压 ${fileName(filePath)} 失败: 不支持的压缩格式`, 'error');
    }
  } catch (e) {
    showToast(formatFileOpError('解压', fileName(filePath), e), 'error');
  }
}

interface PasteEntry {
  path: string;
  name: string;
  isDir?: boolean;
}

export async function pasteFiles(
  entries: PasteEntry[],
  operation: 'copy' | 'cut',
  destDir: string,
  existingNames: string[],
  clearClipboard?: () => void,
  onSuccess?: () => void,
  onConflict?: (conflicts: ConflictEntry[]) => Promise<ConflictResult>,
): Promise<void> {
  const baseDir = destDir.endsWith('/') ? destDir : destDir + '/';

  const conflictEntries = await checkConflicts(
    entries.map((e) => ({ path: e.path, name: e.name, isDir: !!e.isDir })),
    destDir,
  );

  let renameMap: Map<string, string> | undefined;
  let conflictAction: 'skip' | 'auto-rename' = 'skip';

  if (conflictEntries.length > 0 && onConflict) {
    const result = await onConflict(conflictEntries);
    conflictAction = result.action;
    if (result.renames) renameMap = result.renames;
  }

  const conflictNames = new Set(conflictEntries.map((c) => c.entry.name));
  const usedNames = new Set(existingNames);

  const toProcess: { entry: PasteEntry; destName: string }[] = [];

  for (const entry of entries) {
    if (conflictNames.has(entry.name)) {
      if (conflictAction === 'skip') continue;
      if (renameMap) {
        const renamed = renameMap.get(entry.name);
        if (!renamed || !renamed.trim()) continue;
        toProcess.push({ entry, destName: renamed.trim() });
      } else {
        const { base, ext } = splitNameExt(entry.name, !!entry.isDir);
        const safe = generateSafeName(base, ext, usedNames, !!entry.isDir);
        usedNames.add(safe);
        toProcess.push({ entry, destName: safe });
      }
    } else {
      toProcess.push({ entry, destName: entry.name });
    }
  }

  let success = 0;
  let fail = 0;
  for (const { entry, destName } of toProcess) {
    const destPath = baseDir + destName;
    if (destName.includes('/') || destName.includes('..')) {
      const ok = await prepareDestParent(destPath);
      if (!ok) { fail++; continue; }
    }
    try {
      if (operation === 'copy') {
        await window.electron.copyFile(entry.path, destPath);
      } else {
        await window.electron.moveFile(entry.path, destPath);
      }
      success++;
    } catch (e) {
      fail++;
      console.error(`${operation} ${entry.name} 失败:`, e);
    }
  }

  if (success > 0) {
    showToast(`已粘贴 ${success} 个项目`, 'success');
    if (operation === 'cut') clearClipboard?.();
    onSuccess?.();
  }
  if (fail > 0) {
    showToast(`粘贴 ${fail} 个项目失败`, 'error');
  }
}

export async function openFile(
  filePath: string,
): Promise<void> {
  try {
    const err = await window.electron.openPath(filePath);
    if (err) {
      showToast(`打开 ${fileName(filePath)} 失败: ${err}`, 'error');
    }
  } catch (e) {
    showToast(formatFileOpError('打开', fileName(filePath), e), 'error');
  }
}

export async function importFiles(
  fileEntries: { path: string }[],
  destDir: string,
  onSuccess?: () => void,
): Promise<void> {
  let count = 0;
  for (const entry of fileEntries) {
    const name = fileName(entry.path);
    const destPath = destDir.endsWith('/') ? destDir + name : destDir + '/' + name;
    try {
      await window.electron.copyFile(entry.path, destPath);
      count++;
    } catch (e) {
      console.error(`导入 ${name} 失败:`, e);
    }
  }
  if (count > 0) {
    showToast(`已导入 ${count} 个文件`, 'success');
    onSuccess?.();
  }
}

export function copyToClipboard(
  count: number,
): void {
  showToast(`已复制 ${count} 个项目`, 'info');
}

export function cutToClipboard(
  count: number,
): void {
  showToast(`已剪切 ${count} 个项目`, 'info');
}
