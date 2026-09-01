import { t } from '../i18n';
import type { IFile } from '../types/files';
import { FileSystemService } from '../services/FileSystemService';
import { formatSize } from '../components/FileList/utils';
import {
  showToast,
  showProgressToast,
  updateProgress,
  finishToast,
  dismissToast,
} from './toast';
import {
  checkConflicts,
  generateSafeName,
  splitNameExt,
  prepareDestParent,
  type ConflictEntry,
  type ConflictResult,
} from './fileConflict';

export function formatFileOpError(operation: string, fileRef: string, error: unknown): string {
  const err = error as { code?: string; message?: string } | undefined;
  let code: string = err?.code || '';
  const msg = (err?.message || String(error) || '').toLowerCase();

  if (!code) {
    const m = msg.match(/error:\s*(\w+):/);
    if (m) code = m[1].toUpperCase();
  }

  switch (code) {
  case 'EEXIST':  return t('file_op.exists', operation, fileRef);
  case 'ENOENT':  return t('file_op.not_found', operation, fileRef);
  case 'EACCES':
  case 'EPERM':   return t('file_op.permission', operation, fileRef);
  case 'ENOSPC':  return t('file_op.no_space', operation, fileRef);
  case 'EROFS':   return t('file_op.read_only', operation, fileRef);
  case 'EISDIR':  return t('file_op.is_dir', operation, fileRef);
  case 'ENOTDIR': return t('file_op.not_dir', operation, fileRef);
  case 'EXDEV':   return t('file_op.cross_device', operation, fileRef);
  case 'EBUSY':   return t('file_op.busy', operation, fileRef);
  }

  if (msg.includes('same file') || msg.includes('same path') || msg.includes('source and destination')) {
    return t('file_op.same_target', operation, fileRef);
  }
  if (msg.includes('already exists') || msg.includes('exists')) {
    return t('file_op.exists', operation, fileRef);
  }
  if (msg.includes('no such file') || msg.includes('not found') || msg.includes('不存在')) {
    return t('file_op.not_found', operation, fileRef);
  }
  if (msg.includes('permission denied') || msg.includes('not permitted') || msg.includes('eacces') || msg.includes('eperm')) {
    return t('file_op.permission', operation, fileRef);
  }
  if (msg.includes('not a directory')) {
    return t('file_op.not_dir', operation, fileRef);
  }
  if (msg.includes('is a directory')) {
    return t('file_op.is_dir', operation, fileRef);
  }
  if (msg.includes('no space') || msg.includes('device') || msg.includes('enospc')) {
    return t('file_op.no_space', operation, fileRef);
  }
  if (msg.includes('read-only') || msg.includes('erofs')) {
    return t('file_op.read_only', operation, fileRef);
  }
  if (msg.includes('busy') || msg.includes('ebusy')) {
    return t('file_op.busy', operation, fileRef);
  }

  return t('file_op.generic', operation, fileRef, err?.message || String(error));
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
    showToast(t('toast.file_created', fileName(filePath)), 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.create_file'), fileName(filePath), e), 'error');
  }
}

export async function createDirectory(
  dirPath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await window.electron.createDirectory(dirPath);
    showToast(t('toast.folder_created', fileName(dirPath)), 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.create_folder'), fileName(dirPath), e), 'error');
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
      showToast(t('error.name_exists', newName), 'error');
      return;
    }
    if (newParent !== oldParent) {
      const ok = await prepareDestParent(newPath);
      if (!ok) return;
    }
    await window.electron.renameFile(oldPath, newPath);
    if (oldParent === newParent) {
      showToast(t('toast.rename_success', oldName, newName), 'success');
    } else {
      showToast(t('toast.rename_move_success', oldName, normalizePath(newPath)), 'success');
    }
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.rename_op'), `${oldName} -> ${normalizePath(newPath)}`, e), 'error');
  }
}

/**
 * 修改文件/目录权限（3 位八进制模式，如 '755'）。
 * 后端已做路径/模式校验；成功时回调新 mode 数值（供属性对话框
 * 刷新显示），失败按错误码弹 toast。
 *
 * @param filePath - 绝对路径
 * @param modeStr - 3 位八进制字符串（rwxrwxrwx）
 * @param onSuccess - 成功后回调（参数为新的 mode 数值）
 */
export async function changePermissions(
  filePath: string,
  modeStr: string,
  onSuccess?: (mode: number) => void,
): Promise<void> {
  try {
    const result = await window.electron.chmodFile(filePath, modeStr);
    if (result.success) {
      showToast(t('toast.permissions_changed'), 'success');
      onSuccess?.(parseInt(modeStr, 8));
    } else if (result.code === 'INVALID_MODE') {
      showToast(t('error.chmod_invalid_mode'), 'error');
    } else {
      showToast(t('error.chmod_failed', result.error || t('error.unknown')), 'error');
    }
  } catch (e) {
    showToast(t('error.chmod_failed', (e as Error)?.message || t('error.unknown')), 'error');
  }
}

/**
 * 执行批量重命名（对话框已校验过名称冲突）。
 *
 * 逐条 rename，收集失败数，最后给出汇总 toast（部分失败会追加
 * 失败条数提示）。rename 通常很快，不走任务管线；目标与源同目录，
 * 不涉及跨设备。
 *
 * @param plans - { src 旧绝对路径, dest 新绝对路径 } 列表
 * @param onSuccess - 至少一项成功后的回调（通常用于刷新文件列表）
 */
export async function executeBatchRename(
  plans: { src: string; dest: string }[],
  onSuccess?: () => void,
): Promise<void> {
  if (plans.length === 0) return;
  let ok = 0;
  let fail = 0;
  for (const p of plans) {
    try {
      await window.electron.renameFile(p.src, p.dest);
      ok++;
    } catch {
      fail++;
    }
  }
  if (ok > 0) onSuccess?.();
  if (fail === 0) {
    showToast(t('toast.batch_renamed', ok), 'success');
  } else if (ok > 0) {
    showToast(t('toast.batch_renamed', ok), 'warning');
    showToast(t('toast.failed_items', fail), 'error');
  } else {
    showToast(t('toast.failed_items', fail), 'error');
  }
}

export async function trashFile(
  filePath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await window.electron.trashFile(filePath);
    showToast(t('toast.file_deleted', fileName(filePath)), 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.delete_op'), fileName(filePath), e), 'error');
  }
}

export async function trashFiles(
  paths: string[],
  onSuccess?: () => void,
): Promise<void> {
  if (paths.length === 0) return;
  if (paths.length === 1) return trashFile(paths[0], onSuccess);

  const items = paths.map((p) => ({ path: p }));
  const jobId = await window.electron.startJob({ type: 'trash', items });

  const toastId = showProgressToast(t('toast.deleting_items'), {
    total: items.length,
    onCancel: () => { window.electron.cancelJob(jobId); },
  });

  const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
    updateProgress(toastId, data.current);
  });

  window.electron.onJobComplete(jobId, (data) => {
    unsubProgress();

    if (data.cancelled) {
      finishToast(toastId, t('toast.operation_cancelled'), 'warning');
      return;
    }

    if (data.success > 0) onSuccess?.();

    if (data.success > 0 && data.fail === 0) {
      finishToast(toastId, t('toast.deleted_items', data.success), 'success');
    } else if (data.success > 0 && data.fail > 0) {
      finishToast(toastId, t('toast.deleted_items', data.success), 'warning');
      showToast(t('toast.failed_items', data.fail), 'error');
      showToast(t('toast.delete_fail_permission'), 'warning');
    } else {
      finishToast(toastId, t('toast.failed_items', data.fail), 'error');
      showToast(t('toast.delete_fail_permission'), 'warning');
    }
  });
}

/**
 * 计算一批路径的总大小（用于永久删除确认提示）。
 * 目录用 `du -sb`（getDirectorySize），文件用 fs:stat。
 * 任一路径计算失败时返回 null——不阻塞删除，只是不显示大小。
 *
 * @param paths - 待统计的绝对路径
 * @returns 总字节数；无法统计时为 null
 */
export async function computeDeleteTotalSize(paths: string[]): Promise<number | null> {
  try {
    let total = 0;
    for (const p of paths) {
      const stat = await window.electron.stat(p);
      if (!stat) return null;
      if (stat.isDirectory) {
        const dirSize = await window.electron.getDirectorySize(p);
        total += dirSize;
      } else {
        total += stat.size;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * 构建永久删除确认消息：条目数 + （可统计时的）总大小。
 */
export async function buildPermanentDeleteMessage(paths: string[]): Promise<string> {
  const base = t('dialog.delete.permanent_confirm', paths.length);
  const total = await computeDeleteTotalSize(paths);
  if (total === null) return base;
  return base + '\n' + t('dialog.delete.total_size', formatSize(total));
}

/**
 * 永久删除（不进回收站，不可恢复）。通过批量任务系统执行，
 * 带进度条与取消。调用方必须在调用前自行向用户确认。
 */
export async function deleteFilesPermanently(
  paths: string[],
  onSuccess?: () => void,
): Promise<void> {
  if (paths.length === 0) return;

  const items = paths.map((p) => ({ path: p }));
  const jobId = await window.electron.startJob({ type: 'delete', items });

  const toastId = showProgressToast(t('toast.deleting_items'), {
    total: items.length,
    onCancel: () => { window.electron.cancelJob(jobId); },
  });

  const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
    updateProgress(toastId, data.current);
  });

  window.electron.onJobComplete(jobId, (data) => {
    unsubProgress();

    if (data.cancelled) {
      finishToast(toastId, t('toast.operation_cancelled'), 'warning');
      return;
    }

    if (data.success > 0) onSuccess?.();

    if (data.success > 0 && data.fail === 0) {
      finishToast(toastId, t('toast.deleted_permanently', data.success), 'success');
    } else if (data.success > 0 && data.fail > 0) {
      finishToast(toastId, t('toast.deleted_permanently', data.success), 'warning');
      showToast(t('toast.failed_items', data.fail), 'error');
      showToast(t('toast.delete_fail_permission'), 'warning');
    } else {
      finishToast(toastId, t('toast.failed_items', data.fail), 'error');
      showToast(t('toast.delete_fail_permission'), 'warning');
    }
  });
}

export async function copyFile(
  source: string,
  dest: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    const targetExists = await window.electron.exists(dest);
    if (targetExists) {
      showToast(t('error.copy_exists', fileName(dest)), 'error');
      return;
    }
    await window.electron.copyFile(source, dest);
    const destDir = dest.split('/').slice(0, -1).pop() || '';
    showToast(t('toast.copy_success', fileName(source), destDir, fileName(dest)), 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.copy_op'), `${fileName(source)} -> ${fileName(dest)}`, e), 'error');
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
      showToast(t('error.move_exists', fileName(dest)), 'error');
      return;
    }
    await window.electron.moveFile(source, dest);
    const destDir = dest.split('/').slice(0, -1).pop() || '';
    showToast(t('toast.move_success', fileName(source), destDir, fileName(dest)), 'success');
    onSuccess?.();
  } catch (e) {
    showToast(formatFileOpError(t('operation.move_op'), `${fileName(source)} -> ${fileName(dest)}`, e), 'error');
  }
}

export async function extractFile(
  filePath: string,
  onSuccess?: () => void,
): Promise<void> {
  try {
    const ok = await window.electron.extractFile(filePath);
    if (ok) {
      showToast(t('toast.file_extracted', fileName(filePath)), 'success');
      onSuccess?.();
    } else {
      showToast(t('error.unsupported_format'), 'error');
    }
  } catch (e) {
    showToast(formatFileOpError(t('operation.extract_op'), fileName(filePath), e), 'error');
  }
}

/**
 * 压缩一组同目录条目为 zip / tar.gz 归档。
 *
 * 压缩走主进程 spawn 系统命令，期间显示不确定进度 toast；
 * 完成后刷新当前目录（onSuccess），失败按错误码提示：
 * - `NO_TOOL`：zip 未安装（tar 为 coreutils，基本必有）
 * - 其余：压缩失败 + 原始错误消息
 *
 * @param paths - 待压缩的绝对路径数组（同一目录下）
 * @param destPath - 归档文件完整路径（含 .zip / .tar.gz 后缀）
 * @param format - 归档格式：'zip' | 'tar.gz'
 * @param onSuccess - 压缩成功后回调（通常用于刷新文件列表）
 */
export async function compressFiles(
  paths: string[],
  destPath: string,
  format: 'zip' | 'tar.gz',
  onSuccess?: () => void,
): Promise<void> {
  const toastId = showProgressToast(t('toast.compressing', fileName(destPath)));
  try {
    const result = await window.electron.compress({ paths, destPath, format });
    if (result.success) {
      finishToast(toastId, t('toast.compressed', fileName(destPath)), 'success');
      onSuccess?.();
    } else if (result.code === 'EXISTS') {
      finishToast(toastId, t('error.name_exists', fileName(destPath)), 'error');
    } else if (result.code === 'NO_TOOL') {
      finishToast(toastId, t('error.compress_no_tool'), 'error');
    } else {
      finishToast(
        toastId,
        t('error.compress_failed', result.error || t('error.unknown')),
        'error',
      );
    }
  } catch (e) {
    finishToast(
      toastId,
      t('error.compress_failed', (e as Error)?.message || t('error.unknown')),
      'error',
    );
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
  let conflictAction: 'skip' | 'auto-rename' | 'cancel' = 'skip';

  if (conflictEntries.length > 0 && onConflict) {
    const result = await onConflict(conflictEntries);
    conflictAction = result.action;
    if (result.renames) renameMap = result.renames;
    if (conflictAction === 'cancel') {
      showToast(t('dialog.conflict.cancelled'), 'info');
      return;
    }
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

  if (toProcess.length === 0) return;

  // Ensure parent directories exist for nested destination names
  for (const { destName } of toProcess) {
    if (destName.includes('/') || destName.includes('..')) {
      const ok = await prepareDestParent(baseDir + destName);
      if (!ok) return;
    }
  }

  // Build job items and start batch operation
  const jobItems = toProcess.map(({ entry, destName }) => ({
    src: entry.path,
    dest: baseDir + destName,
  }));

  const jobId = await window.electron.startJob({
    type: operation === 'copy' ? 'copy' : 'move',
    items: jobItems,
  });

  const toastId = showProgressToast(t('toast.pasting_items'), {
    total: jobItems.length,
    onCancel: () => { window.electron.cancelJob(jobId); },
  });

  const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
    updateProgress(toastId, data.current);
  });

  window.electron.onJobComplete(jobId, (data) => {
    unsubProgress();

    if (data.cancelled) {
      finishToast(toastId, t('toast.operation_cancelled'), 'warning');
      return;
    }

    if (data.success > 0) {
      if (data.fail === 0) {
        finishToast(toastId, t('toast.pasted_items', data.success), 'success');
      } else {
        finishToast(toastId, t('toast.pasted_items', data.success), 'warning');
        showToast(t('toast.failed_items', data.fail), 'error');
      }
      if (operation === 'cut') clearClipboard?.();
      onSuccess?.();
    } else if (data.fail > 0) {
      finishToast(toastId, t('toast.failed_items', data.fail), 'error');
    }
  });
}

export async function openFile(
  filePath: string,
): Promise<void> {
  try {
    const err = await window.electron.openPath(filePath);
    if (err) {
      showToast(t('error.file_open_failed', fileName(filePath), err), 'error');
    }
  } catch (e) {
    showToast(formatFileOpError(t('operation.open_op'), fileName(filePath), e), 'error');
  }
}

export async function importFiles(
  fileEntries: { path: string }[],
  destDir: string,
  onSuccess?: () => void,
): Promise<void> {
  const base = destDir.endsWith('/') ? destDir : destDir + '/';

  const destPaths = fileEntries.map((e) => {
    const name = fileName(e.path);
    return { name, destPath: base + name };
  });
  const existsMap = await window.electron.existsBatch(destPaths.map((d) => d.destPath));

  const conflictNames = new Set<string>();
  const jobItems: { src: string; dest: string }[] = [];
  let skip = 0;

  for (let i = 0; i < fileEntries.length; i++) {
    const dp = destPaths[i];
    if (existsMap[dp.destPath]) {
      conflictNames.add(dp.name);
      skip++;
      continue;
    }
    jobItems.push({ src: fileEntries[i].path, dest: dp.destPath });
  }

  if (jobItems.length === 0) {
    if (skip > 0) showToast(t('toast.import_all_skipped', skip), 'info');
    return;
  }

  const jobId = await window.electron.startJob({ type: 'copy', items: jobItems });

  const toastId = showProgressToast(t('toast.importing_items'), {
    total: jobItems.length,
    onCancel: () => { window.electron.cancelJob(jobId); },
  });

  const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
    updateProgress(toastId, data.current);
  });

  window.electron.onJobComplete(jobId, (data) => {
    unsubProgress();

    if (data.cancelled) {
      finishToast(toastId, t('toast.operation_cancelled'), 'warning');
      return;
    }

    const success = data.success;
    const fail = data.fail;

    if (success > 0) {
      if (skip > 0) {
        finishToast(toastId, t('toast.imported_skipped', success, skip), 'success');
      } else {
        finishToast(toastId, t('toast.imported_files', success), 'success');
      }
      onSuccess?.();
    } else if (skip > 0) {
      finishToast(toastId, t('toast.import_all_skipped', skip), 'info');
    } else {
      dismissToast(toastId);
    }

    if (fail > 0) {
      showToast(t('toast.failed_items', fail), 'error');
    }
  });
}

export function copyToClipboard(
  count: number,
): void {
  showToast(t('toast.copied_items', count), 'info');
}

export function cutToClipboard(
  count: number,
): void {
  showToast(t('toast.cut_items', count), 'info');
}

/**
 * 还原回收站条目到原始位置。
 *
 * - 目标位置已有同名文件时：提供 `onConflict`（App 的冲突对话框）则弹出
 *   跳过/自动重命名/手动重命名选择；不提供则直接跳过冲突条目。
 * - 缺少原始位置信息（无 .trashinfo）的条目无法还原。
 * - 按原始目录分组处理冲突（不同目录各自弹一次对话框）。
 * - 实际移动走批量任务系统（进度 + 取消）。
 *
 * @param files - 回收站条目列表（含 trashOriginalPath）
 * @param onSuccess - 全部完成后回调（通常用于刷新回收站视图）
 * @param onConflict - 冲突对话框入口，签名同 useConflictDialog 的 handleConflictDialog
 */
export async function restoreTrashItems(
  files: IFile[],
  onSuccess?: () => void,
  onConflict?: (
    conflicts: ConflictEntry[],
    destDir: string,
    existingNames: string[],
    sourcePath?: string,
    operation?: "move" | "copy",
  ) => Promise<ConflictResult>,
): Promise<void> {
  const valid = files.filter((f) => f.trashOriginalPath);
  if (valid.length < files.length) {
    showToast(t('trash.restore_no_origin'), 'warning');
  }
  if (valid.length === 0) return;

  // 按原始目录分组：不同目录的同名冲突需要各自解决
  const groups = new Map<string, IFile[]>();
  for (const f of valid) {
    const orig = f.trashOriginalPath!;
    const dir = orig.substring(0, orig.lastIndexOf('/')) || '/';
    const list = groups.get(dir);
    if (list) list.push(f);
    else groups.set(dir, [f]);
  }

  const jobItems: { src: string; dest: string }[] = [];
  let skippedConflicts = 0;

  for (const [dir, group] of groups) {
    // 目标目录里现有的文件名（目录不存在或不可读时视为无冲突，
    // 任务执行时会自动重建父目录）
    let existingNames: string[] = [];
    try {
      const { data } = await FileSystemService.listDir(dir);
      existingNames = data.map((f) => f.name);
    } catch { /* 目录尚不存在 */ }
    const existingSet = new Set(existingNames);

    const conflicts: ConflictEntry[] = group
      .filter((f) => existingSet.has(f.name))
      .map((f) => ({
        entry: { path: f.path, name: f.name },
        destPath: dir === '/' ? '/' + f.name : dir + '/' + f.name,
        isDir: f.isDirectory,
      }));

    // 条目名 → 最终还原名
    const destNames = new Map<string, string>();
    for (const f of group) destNames.set(f.name, f.name);

    if (conflicts.length > 0) {
      if (onConflict) {
        const result = await onConflict(conflicts, dir, existingNames, undefined, 'move');
        if (result.action === 'cancel') {
          // 取消 = 取消整个还原操作，明确提示
          showToast(t('dialog.conflict.cancelled'), 'info');
          return;
        }
        if (result.action === 'skip') {
          skippedConflicts += conflicts.length;
          for (const c of conflicts) destNames.delete(c.entry.name);
        } else {
          const renameMap = result.renames;
          for (const c of conflicts) {
            const manual = renameMap?.get(c.entry.name);
            if (manual && manual.trim()) {
              destNames.set(c.entry.name, manual.trim());
            } else {
              const { base, ext } = splitNameExt(c.entry.name, c.isDir);
              const safe = generateSafeName(base, ext, existingSet, c.isDir);
              existingSet.add(safe);
              destNames.set(c.entry.name, safe);
            }
          }
        }
      } else {
        skippedConflicts += conflicts.length;
        for (const c of conflicts) destNames.delete(c.entry.name);
      }
    }

    for (const f of group) {
      const name = destNames.get(f.name);
      if (!name) continue;
      jobItems.push({ src: f.path, dest: dir === '/' ? '/' + name : dir + '/' + name });
    }
  }

  if (skippedConflicts > 0) {
    showToast(t('trash.restore_conflicts', skippedConflicts), 'warning');
  }
  if (jobItems.length === 0) {
    // 全部因同名被跳过：明确告知，绝不静默
    showToast(t('dialog.conflict.all_skipped', skippedConflicts), 'warning');
    return;
  }

  const jobId = await window.electron.startJob({ type: 'move', items: jobItems });

  const toastId = showProgressToast(t('trash.restoring_items'), {
    total: jobItems.length,
    onCancel: () => { window.electron.cancelJob(jobId); },
  });

  const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
    updateProgress(toastId, data.current);
  });

  window.electron.onJobComplete(jobId, (data) => {
    unsubProgress();

    if (data.cancelled) {
      finishToast(toastId, t('toast.operation_cancelled'), 'warning');
      return;
    }

    if (data.success > 0) {
      finishToast(
        toastId,
        t('trash.restored_items', data.success),
        data.fail > 0 ? 'warning' : 'success',
      );
      onSuccess?.();
    } else {
      finishToast(toastId, t('toast.failed_items', data.fail), 'error');
    }

    if (data.fail > 0) {
      showToast(t('toast.failed_items', data.fail), 'error');
    }
  });
}

/**
 * 从回收站永久删除条目（连同 .trashinfo）。
 * @param names - 回收站条目名（仅文件名）
 */
export async function removeTrashItems(
  names: string[],
  onSuccess?: () => void,
): Promise<void> {
  if (names.length === 0) return;
  const success = await window.electron.removeFromTrash(names);
  if (success > 0) {
    showToast(t('toast.deleted_permanently', success), 'success');
    onSuccess?.();
  }
}

/**
 * 清空回收站。调用方必须在调用前自行向用户确认。
 */
export async function emptyTrash(onSuccess?: () => void): Promise<void> {
  const removed = await window.electron.emptyTrash();
  if (removed > 0) {
    showToast(t('trash.emptied', removed), 'success');
    onSuccess?.();
  } else {
    showToast(t('trash.empty'), 'info');
  }
}

/**
 * 按后端返回错误码弹出对应的终端启动失败提示。
 * @param code - 后端错误码（NO_TERMINAL 等）
 * @param error - 非错误码场景下的原始错误消息
 */
function showTerminalLaunchError(code: string | undefined, error: string | undefined): void {
  if (code === 'NO_TERMINAL') {
    showToast(t('toast.no_terminal_found'), 'error');
  } else {
    showToast(t('toast.terminal_launch_failed', error || t('error.unknown')), 'error');
  }
}

/**
 * 在系统默认终端中打开目录。失败时按错误码弹 toast 提示。
 * @param dir - 目标目录绝对路径
 */
export async function openInDefaultTerminal(dir: string): Promise<void> {
  const result = await window.electron.openTerminal(dir);
  if (!result.success) {
    showTerminalLaunchError(result.code, result.error);
  }
}

/**
 * 在系统默认终端中运行可执行文件。失败时按错误码弹 toast 提示。
 * @param filePath - 可执行文件绝对路径（调用方已确认含可执行位）
 */
export async function runInDefaultTerminal(filePath: string): Promise<void> {
  const result = await window.electron.runInTerminal(filePath);
  if (!result.success) {
    showTerminalLaunchError(result.code, result.error);
  }
}
