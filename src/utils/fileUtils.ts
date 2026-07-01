import type { IFile } from '../types/files';

export type FileGroup = 'Folders' | 'Code' | 'Media' | 'Documents' | 'Archives' | 'Executables' | 'Others';

export const GROUP_ORDER: FileGroup[] = [
  'Folders',
  'Media',
  'Documents',
  'Code',
  'Archives',
  'Executables',
  'Others'
];

// 1. 添加国际化汉化映射表
export const groupLocaleMap: Record<FileGroup, string> = {
  'Folders': '文件夹',
  'Media': '媒体文件',
  'Documents': '文档',
  'Code': '代码文件',
  'Archives': '压缩包',
  'Executables': '可执行文件',
  'Others': '其他文件'
};

// 2. 导出获取中文分组名称的辅助函数
export function getSemanticGroupLabel(group: FileGroup): string {
  return groupLocaleMap[group] || group;
}

export function getSemanticGroup(file: IFile): FileGroup {
  if (file.isDirectory) return 'Folders';

  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
  // Media
  case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': case 'ico':
  case 'mp3': case 'wav': case 'ogg': case 'flac':
  case 'mp4': case 'mkv': case 'webm': case 'avi': case 'mov':
    return 'Media';

    // Documents
  case 'pdf': case 'doc': case 'docx': case 'xls': case 'xlsx': case 'ppt': case 'pptx':
  case 'odt': case 'ods': case 'odp': case 'rtf': case 'txt': case 'md': case 'csv':
    return 'Documents';

    // Code
  case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'java': case 'c': case 'cpp': case 'h': case 'cs':
  case 'html': case 'css': case 'scss': case 'json': case 'xml': case 'yaml': case 'yml': case 'sql': case 'sh': case 'bash':
  case 'php': case 'rb': case 'go': case 'rs': case 'lua':
    return 'Code';

    // Archives
  case 'zip': case 'tar': case 'gz': case 'xz': case '7z': case 'rar': case 'iso':
    return 'Archives';

    // Executables
  case 'exe': case 'appimage': case 'deb': case 'rpm': case 'apk':
    return 'Executables';

  default:
    return 'Others';
  }
}
