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

const codeMimeSubtypes = new Set([
  'javascript', 'typescript', 'html', 'css', 'x-scss', 'x-python',
  'x-java', 'x-c', 'x-c++', 'x-csharp', 'x-go', 'x-rust', 'x-lua',
  'x-php', 'x-ruby', 'x-sql', 'x-shell', 'x-yaml', 'x-toml', 'x-perl',
  'x-swift', 'x-kotlin', 'x-dart', 'x-haskell', 'x-scala',
  'xml', 'json',
]);

const archiveMimeTypes = new Set([
  'application/zip', 'application/gzip', 'application/x-bzip2',
  'application/x-xz', 'application/x-7z-compressed', 'application/vnd.rar',
  'application/x-rar-compressed', 'application/x-tar',
  'application/x-iso9660-image',
]);

const docMimeTypes = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'application/x-krita',
  'application/x-scratch',
]);

const execMimeTypes = new Set([
  'application/x-elf', 'application/x-executable',
  'application/x-sharedlib', 'application/x-python-bytecode',
]);

export function getSemanticGroup(file: IFile): FileGroup {
  if (file.isDirectory) return 'Folders';

  const mime = file.mime;
  if (!mime) return 'Others';

  const [cat, sub] = mime.split('/');

  switch (cat) {
  case 'image':
  case 'audio':
  case 'video':
    return 'Media';
  case 'text':
    return codeMimeSubtypes.has(sub) ? 'Code' : 'Documents';
  case 'application':
    if (codeMimeSubtypes.has(sub)) return 'Code';
    if (docMimeTypes.has(mime)) return 'Documents';
    if (archiveMimeTypes.has(mime)) return 'Archives';
    if (execMimeTypes.has(mime)) return 'Executables';
    return 'Others';
  default:
    return 'Others';
  }
}
