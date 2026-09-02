import type { IFile } from '../types/files';
import { getSemanticGroup, GROUP_ORDER } from './fileUtils';

/** 排序字段（与 settings.sortBy 持久化键对应） */
export type SortBy = 'name' | 'size' | 'date';
/** 排序方向（与 settings.sortOrder 持久化键对应） */
export type SortOrder = 'asc' | 'desc';

/**
 * 自然排序 collator（惰性单例）：数字段按数值比较，
 * 避免逐字符比较把多位数拆开（file2 < file3 < file23）；
 * 大小写不敏感。主窗口与文件选择器共用同一实例。
 */
let naturalCollator: Intl.Collator | null = null;
function getNaturalCollator(): Intl.Collator {
  if (!naturalCollator) {
    naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }
  return naturalCollator;
}

export interface SortOptions {
  showHiddenFiles: boolean;
  sortBy: SortBy;
  sortOrder: SortOrder;
  groupingEnabled: boolean;
}

/**
 * 过滤 + 分组 + 排序文件列表（主窗口与文件选择器共用同一份逻辑，
 * 排序/分组偏好经 settings.sortBy / settings.sortOrder /
 * settings.groupingEnabled 持久化键跨窗口完全同步）。
 *
 * - 分组开启：按语义分组优先（Folders → Media → … → Others）
 * - 分组关闭：目录优先
 * - 组内按 sortBy 比较，sortOrder 翻转
 *
 * @param files - 原始文件列表
 * @param options - 过滤与排序选项
 * @returns 过滤并排序后的新数组
 */
export function sortFiles(files: IFile[], options: SortOptions): IFile[] {
  const filtered = files.filter((f) => options.showHiddenFiles || !f.name.startsWith('.'));
  return filtered.sort((a: IFile, b: IFile) => {
    if (options.groupingEnabled) {
      const groupA = getSemanticGroup(a);
      const groupB = getSemanticGroup(b);
      if (groupA !== groupB) {
        return GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB);
      }
    } else if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }

    let result = 0;
    switch (options.sortBy) {
    case 'name':
      result = getNaturalCollator().compare(a.name, b.name);
      break;
    case 'size':
      result = a.size - b.size;
      break;
    case 'date':
      result = a.mtime.getTime() - b.mtime.getTime();
      break;
    }
    return options.sortOrder === 'asc' ? result : -result;
  });
}

/**
 * 搜索结果按所在目录分组排序（设置「搜索分类」开启时）：
 * - 隐藏文件过滤与 sortFiles 一致；
 * - 组间：按父目录完整路径的自然序（数字段数值比较）；
 * - 组内：文件与目录混合（分类包含两者），目录优先，其余按配置的
 *   sortBy/sortOrder 排序——与普通列表组内语义一致。
 * 输出为「同目录条目连续」的扁平数组，FileList 的 flattenItems
 * 再按相邻条目的父目录切分组头（见 FileList 的 groupByDir）。
 *
 * @param files - 搜索结果（跨目录）
 * @param options - 排序选项
 * @returns 按目录聚簇排序后的新数组
 */
export function sortFilesByDir(files: IFile[], options: SortOptions): IFile[] {
  const filtered = files.filter((f) => options.showHiddenFiles || !f.name.startsWith('.'));
  const byDir = new Map<string, IFile[]>();
  for (const f of filtered) {
    const parent = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
    const list = byDir.get(parent);
    if (list) list.push(f);
    else byDir.set(parent, [f]);
  }
  const collator = getNaturalCollator();
  const dirs = [...byDir.keys()].sort((a, b) => collator.compare(a, b));
  const out: IFile[] = [];
  for (const dir of dirs) {
    const group = byDir.get(dir)!;
    group.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let result = 0;
      switch (options.sortBy) {
      case 'name':
        result = collator.compare(a.name, b.name);
        break;
      case 'size':
        result = a.size - b.size;
        break;
      case 'date':
        result = a.mtime.getTime() - b.mtime.getTime();
        break;
      }
      return options.sortOrder === 'asc' ? result : -result;
    });
    out.push(...group);
  }
  return out;
}
