import type { IFile } from '../types/files';
import { t } from '../i18n';

const mimeDescriptionMap: Record<string, string> = {
  'inode/directory': t('mime.folder'),
  'inode/symlink': t('mime.symlink'),
  'inode/blockdevice': t('mime.block_device'),
  'inode/chardevice': t('mime.char_device'),
  'inode/fifo': t('mime.named_pipe'),
  'inode/socket': t('mime.socket'),

  'text/plain': t('mime.text'),
  'text/html': t('mime.html'),
  'text/css': t('mime.css'),
  'text/javascript': t('mime.javascript'),
  'text/xml': t('mime.xml'),
  'text/csv': t('mime.csv'),
  'text/markdown': t('mime.markdown'),
  'text/x-python': t('mime.python'),
  'text/x-c': t('mime.c_source'),
  'text/x-c++': t('mime.cpp_source'),
  'text/x-java': t('mime.java_source'),
  'text/x-go': t('mime.go_source'),
  'text/x-rust': t('mime.rust_source'),
  'text/x-shell': t('mime.shell'),
  'text/x-yaml': t('mime.yaml'),
  'text/x-toml': t('mime.toml'),

  'image/png': t('mime.png'),
  'image/jpeg': t('mime.jpeg'),
  'image/gif': t('mime.gif'),
  'image/svg+xml': t('mime.svg'),
  'image/webp': t('mime.webp'),
  'image/bmp': t('mime.bmp'),
  'image/tiff': t('mime.tiff'),
  'image/x-icon': t('mime.icon'),
  'image/heic': t('mime.heic'),

  'audio/mpeg': t('mime.mp3'),
  'audio/ogg': t('mime.ogg'),
  'audio/flac': t('mime.flac'),
  'audio/wav': t('mime.wav'),
  'audio/mp4': t('mime.aac'),

  'video/mp4': t('mime.mp4'),
  'video/webm': t('mime.webm'),
  'video/x-msvideo': t('mime.avi'),
  'video/quicktime': t('mime.quicktime'),

  'application/pdf': t('mime.pdf'),
  'application/zip': t('mime.zip'),
  'application/gzip': t('mime.gzip'),
  'application/x-bzip2': t('mime.bzip2'),
  'application/x-xz': t('mime.xz'),
  'application/x-7z-compressed': t('mime._7z'),
  'application/vnd.rar': t('mime.rar'),
  'application/x-rar-compressed': t('mime.rar'),
  'application/x-tar': t('mime.tar'),
  'application/x-iso9660-image': t('mime.iso'),

  'application/vnd.oasis.opendocument.text': t('mime.odt'),
  'application/vnd.oasis.opendocument.spreadsheet': t('mime.ods'),
  'application/vnd.oasis.opendocument.presentation': t('mime.odp'),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': t('mime.docx'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': t('mime.xlsx'),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': t('mime.pptx'),
  'application/msword': t('mime.doc'),
  'application/vnd.ms-excel': t('mime.xls'),
  'application/vnd.ms-powerpoint': t('mime.ppt'),
  'application/rtf': t('mime.rtf'),

  'application/x-elf': t('mime.elf'),
  'application/x-executable': t('mime.executable'),
  'application/x-sharedlib': t('mime.shared_lib'),
  'application/x-python-bytecode': t('mime.python_bytecode'),

  'application/json': t('mime.json'),
  'application/xml': t('mime.xml'),
};

const categoryDescriptions: Record<string, string> = {
  'text': t('mime.cat.text'),
  'image': t('mime.cat.image'),
  'audio': t('mime.cat.audio'),
  'video': t('mime.cat.video'),
  'font': t('mime.cat.font'),
  'inode': t('mime.cat.system'),
  'application': t('mime.cat.other'),
};

export function getFileTypeDescription(file: IFile): string {
  if (file.isDirectory) return t('mime.folder');

  const mime = file.mime;
  if (file.symlinkTarget && mime === 'inode/symlink') {
    return t('mime.broken_symlink');
  }
  if (mime && mimeDescriptionMap[mime]) {
    return mimeDescriptionMap[mime];
  }

  if (mime) {
    const cat = mime.split('/')[0];
    if (categoryDescriptions[cat]) return categoryDescriptions[cat];
  }

  const ext = file.name.split('.').pop()?.toUpperCase();
  return ext ? t('mime.unknown_ext', ext) : t('mime.other_file');
}

export function getMimeIcon(description: string): string {
  if (description === t('mime.folder')) return 'folder';
  if (description === t('mime.symlink')) return 'link';
  if (description === t('mime.broken_symlink')) return 'link_off';
  if (description === t('mime.block_device')) return 'hard_drive';
  if (description === t('mime.char_device')) return 'keyboard';
  if (description === t('mime.named_pipe')) return 'swap_vert';
  if (description === t('mime.socket')) return 'hub';
  return 'insert_drive_file';
}
