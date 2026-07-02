import { showToast } from './toast';

export interface ConflictEntry {
  entry: { path: string; name: string };
  destPath: string;
  isDir: boolean;
}

export interface ConflictResult {
  action: 'skip' | 'auto-rename';
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
  const conflicts: ConflictEntry[] = [];
  const base = destDir.endsWith('/') ? destDir : destDir + '/';

  for (const entry of entries) {
    const destPath = base + entry.name;
    try {
      const exists = await window.electron.exists(destPath);
      if (exists) {
        conflicts.push({ entry, destPath, isDir: entry.isDir });
      }
    } catch {
      // ignore, assume no conflict
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
    showToast(`创建目标目录失败: ${parent}`, 'error');
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
