import { showToast } from './toast';
import { t } from '../i18n';

export interface ConflictEntry {
  entry: { path: string; name: string };
  destPath: string;
  isDir: boolean;
}

export interface ConflictResult {
  /**
   * - skip：跳过所有冲突条目（其余继续执行）
   * - auto-rename：自动/手动重命名冲突条目后继续
   * - cancel：取消整个操作（不执行任何条目）
   */
  action: 'skip' | 'auto-rename' | 'cancel';
  renames?: Map<string, string>;
}

export function splitNameExt(name: string, isDir: boolean): { base: string; ext: string } {
  if (isDir || !name.includes('.')) {
    return { base: name, ext: '' };
  }
  const dotIndex = name.indexOf('.');
  return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
}

export function generateSafeName(
  base: string,
  ext: string,
  existingNames: Set<string>,
  isDir: boolean,
): string {
  let counter = 2;
  let candidate = isDir ? base + '_' + counter : base + '_' + counter + ext;
  while (existingNames.has(candidate)) {
    counter++;
    candidate = isDir ? base + '_' + counter : base + '_' + counter + ext;
  }
  return candidate;
}

export async function checkConflicts(
  entries: { path: string; name: string; isDir: boolean }[],
  destDir: string,
): Promise<ConflictEntry[]> {
  const base = destDir.endsWith('/') ? destDir : destDir + '/';
  const destPaths = entries.map((e) => base + e.name);
  const existsMap = await window.electron.existsBatch(destPaths);

  const conflicts: ConflictEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (existsMap[destPaths[i]]) {
      conflicts.push({ entry: entries[i], destPath: destPaths[i], isDir: entries[i].isDir });
    }
  }

  return conflicts;
}

export function truncateDirPath(fullPath: string, maxLen: number): string {
  if (fullPath.length <= maxLen) return fullPath;
  const segments = fullPath.split('/');
  let result = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg) continue;
    const candidate = seg + '/' + result;
    if (candidate.length + 3 > maxLen) {
      result = '.../' + result;
      break;
    }
    result = candidate;
  }
  return result || '.../';
}

export async function prepareDestParent(fullDestPath: string): Promise<boolean> {
  const lastSlash = fullDestPath.lastIndexOf('/');
  if (lastSlash <= 0) return true;
  const parent = fullDestPath.substring(0, lastSlash);
  try {
    await window.electron.createDirectory(parent);
    return true;
  } catch {
    showToast(t('error.create_parent_failed', parent), 'error');
    return false;
  }
}

export function resolveDestPath(parentDir: string, typedName: string): string {
  const base = parentDir.replace(/\/+$/, '');
  const raw = base + '/' + typedName;
  const parts = raw.replace(/\\/g, '/').split('/');
  const result: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { result.pop(); continue; }
    result.push(p);
  }
  return (raw.startsWith('/') ? '/' : '') + result.join('/');
}
