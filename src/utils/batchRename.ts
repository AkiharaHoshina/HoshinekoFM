import type { IFile } from '../types/files';
import { splitNameExt } from './fileConflict';

/** 批量重命名模式 */
export type BatchRenameMode = 'individual' | 'find_replace' | 'prefix' | 'suffix' | 'number';

/** 批量重命名选项（对应对话框各模式的输入） */
export interface BatchRenameOptions {
  /** 模式 */
  mode: BatchRenameMode;
  /** 逐个重命名：每个条目的新名称（与 files 下标对应，缺失时保留原名） */
  names?: string[];
  /** 查找替换：查找串（空 = 无操作） */
  find?: string;
  /** 查找替换：替换串 */
  replace?: string;
  /** 前缀 */
  prefix?: string;
  /** 后缀（插在扩展名前，目录直接追加） */
  suffix?: string;
  /** 序号模式：基础名 */
  baseName?: string;
  /** 序号模式：起始序号 */
  start?: number;
  /** 序号模式：序号位数（补零） */
  digits?: number;
}

/** 单个条目的重命名计划 */
export interface BatchRenamePlan {
  file: IFile;
  /** 计算出的新名称 */
  newName: string;
  /** 冲突描述（无效名/重名），null = 可安全重命名 */
  conflict: string | null;
}

/**
 * 按模式计算批量重命名计划（纯函数，不执行任何文件操作）。
 *
 * 冲突判定：
 * - 新名为空 / 含路径分隔符 → `invalid`
 * - 与现有条目名重复或计划内部重复 → `exists`
 * 名称未发生变化的条目不视为冲突（允许用户保留原名）。
 *
 * @param files - 待重命名条目（同一目录）
 * @param options - 模式与参数
 * @param existingNames - 目标目录中已有的条目名（用于冲突检测）
 */
export function planBatchRename(
  files: IFile[],
  options: BatchRenameOptions,
  existingNames: Set<string>,
): BatchRenamePlan[] {
  const used = new Set(existingNames);
  return files.map((file, i) => {
    const { base, ext } = splitNameExt(file.name, file.isDirectory);
    let newName = file.name;
    switch (options.mode) {
    case 'individual':
      newName = options.names?.[i] ?? file.name;
      break;
    case 'find_replace':
      if (options.find) {
        newName = file.name.split(options.find).join(options.replace ?? '');
      }
      break;
    case 'prefix':
      newName = (options.prefix ?? '') + file.name;
      break;
    case 'suffix':
      newName = base + (options.suffix ?? '') + (file.isDirectory ? '' : ext);
      break;
    case 'number':
      newName =
        (options.baseName ?? '') +
        '_' +
        String((options.start ?? 1) + i).padStart(Math.max(1, options.digits ?? 2), '0') +
        (file.isDirectory ? '' : ext);
      break;
    }

    if (newName === file.name) {
      return { file, newName, conflict: null };
    }
    let conflict: string | null = null;
    if (!newName || newName.includes('/') || newName.includes('..')) {
      conflict = 'invalid';
    } else if (used.has(newName)) {
      conflict = 'exists';
    } else {
      used.add(newName);
    }
    return { file, newName, conflict };
  });
}

/**
 * 默认基础名（序号模式输入框初值）：第一个条目的基础名
 * （去扩展名），列表为空时返回空串。
 */
export function defaultBatchBaseName(files: IFile[]): string {
  if (files.length === 0) return '';
  const { base } = splitNameExt(files[0].name, files[0].isDirectory);
  return base;
}
