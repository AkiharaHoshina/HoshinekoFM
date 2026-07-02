// Extension → MIME lookup table, lower-cased extensions
// Used as Tier ② fallback when magic bytes fail to identify a file.
// MIME strings must match what src/utils/fileUtils.ts grouping logic expects.

export const EXT_TO_MIME: Record<string, string> = {
  // ── Images ──────────────────────────────────────────────────────
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.dib': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.pcx': 'image/x-pcx',
  '.xcf': 'image/x-xcf',
  '.tga': 'image/x-targa',
  '.nef': 'image/x-nikon-nef',
  '.cr2': 'image/x-canon-cr2',
  '.dng': 'image/x-adobe-dng',
  '.arw': 'image/x-sony-arw',

  // ── Audio ───────────────────────────────────────────────────────
  '.mp3': 'audio/mpeg',
  '.mp2': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.ogx': 'audio/ogg',
  '.spx': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.m4p': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.ra': 'audio/x-realaudio',
  '.ram': 'audio/x-realaudio',

  // ── Video ───────────────────────────────────────────────────────
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.f4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mka': 'audio/x-matroska',
  '.mk3d': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.f4v_': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.mpe': 'video/mpeg',
  '.mpv': 'video/mpeg',
  '.m2v': 'video/mpeg',
  '.vob': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.m2ts': 'video/mp2t',
  '.rm': 'video/x-realaudio',
  '.rmvb': 'video/x-realaudio',

  // ── Documents ───────────────────────────────────────────────────
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlt': 'application/vnd.ms-excel',
  '.xla': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pot': 'application/vnd.ms-powerpoint',
  '.pps': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pptm': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ott': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.ots': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.odg': 'application/vnd.oasis.opendocument.graphics',
  '.odf': 'application/vnd.oasis.opendocument.formula',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.log': 'text/plain',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.djvu': 'image/vnd.djvu',
  '.djv': 'image/vnd.djvu',
  '.tex': 'text/x-tex',
  '.ltx': 'text/x-tex',
  '.cls': 'text/x-tex',
  '.sty': 'text/x-tex',
  '.bib': 'text/x-bibtex',

  // ── Archives ────────────────────────────────────────────────────
  '.zip': 'application/zip',
  '.zipx': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.tbz': 'application/x-bzip2',
  '.tbz2': 'application/x-bzip2',
  '.tb2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
  '.txz': 'application/x-xz',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar',
  '.iso': 'application/x-iso9660-image',
  '.img': 'application/x-iso9660-image',
  '.lz': 'application/x-lzip',
  '.lzo': 'application/x-lzop',
  '.lz4': 'application/x-lz4',
  '.zst': 'application/zstd',
  '.cab': 'application/vnd.ms-cab-compressed',
  '.arj': 'application/x-arj',
  '.lzh': 'application/x-lzh',
  '.lha': 'application/x-lzh',
  '.rpm': 'application/x-rpm',
  '.deb': 'application/vnd.debian.binary-package',

  // ── Code — JavaScript / TypeScript ──────────────────────────────
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.mts': 'text/typescript',
  '.cts': 'text/typescript',
  '.tsx': 'text/typescript',

  // ── Code — Web ──────────────────────────────────────────────────
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-scss',
  '.less': 'text/css',
  '.vue': 'text/html',
  '.svelte': 'text/html',

  // ── Code — Python ───────────────────────────────────────────────
  '.py': 'text/x-python',
  '.pyw': 'text/x-python',
  '.pyi': 'text/x-python',
  '.pyx': 'text/x-python',
  '.pxd': 'text/x-python',

  // ── Code — Java / JVM ───────────────────────────────────────────
  '.java': 'text/x-java',
  '.class': 'application/x-java-bytecode',
  '.jar': 'application/java-archive',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.sc': 'text/x-scala',
  '.groovy': 'text/x-groovy',
  '.clj': 'text/clojure',
  '.cljs': 'text/clojure',

  // ── Code — C / C++ / Systems ────────────────────────────────────
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cc': 'text/x-c++',
  '.cpp': 'text/x-c++',
  '.cxx': 'text/x-c++',
  '.c++': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.hh': 'text/x-c++',
  '.hxx': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rlib': 'text/x-rust',
  '.swift': 'text/x-swift',
  '.dart': 'text/x-dart',
  '.zig': 'text/x-zig',
  '.nim': 'text/x-nim',

  // ── Code — Scripting ────────────────────────────────────────────
  '.lua': 'text/x-lua',
  '.php': 'text/x-php',
  '.phtml': 'text/x-php',
  '.rb': 'text/x-ruby',
  '.rbw': 'text/x-ruby',
  '.pl': 'text/x-perl',
  '.pm': 'text/x-perl',
  '.r': 'text/x-r',
  '.rmd': 'text/x-r',
  '.rdata': 'text/x-r',
  '.jl': 'text/x-julia',

  // ── Code — Shell ────────────────────────────────────────────────
  '.sh': 'text/x-shell',
  '.bash': 'text/x-shell',
  '.zsh': 'text/x-shell',
  '.fish': 'text/x-shell',
  '.bat': 'text/x-shell',
  '.cmd': 'text/x-shell',
  '.ps1': 'text/x-shell',
  '.psm1': 'text/x-shell',

  // ── Code — Func / FP ────────────────────────────────────────────
  '.hs': 'text/x-haskell',
  '.lhs': 'text/x-haskell',
  '.elm': 'text/x-elm',
  '.erl': 'text/x-erlang',
  '.hrl': 'text/x-erlang',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.ml': 'text/x-ocaml',
  '.mli': 'text/x-ocaml',
  '.fs': 'text/x-fsharp',
  '.fsi': 'text/x-fsharp',
  '.fsx': 'text/x-fsharp',

  // ── Code — Data / Config ────────────────────────────────────────
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.json5': 'application/json',
  '.xml': 'application/xml',
  '.xsl': 'application/xml',
  '.xsd': 'application/xml',
  '.yaml': 'text/x-yaml',
  '.yml': 'text/x-yaml',
  '.toml': 'text/x-toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',

  // ── Code — SQL / DB ─────────────────────────────────────────────
  '.sql': 'text/x-sql',
  '.psql': 'text/x-sql',

  // ── Code — Other ────────────────────────────────────────────────
  '.cmake': 'text/x-cmake',
  '.dockerfile': 'text/plain',
  '.graphql': 'application/graphql',
  '.gql': 'application/graphql',
  '.proto': 'text/x-protobuf',

  // ── Fonts ───────────────────────────────────────────────────────
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.ttc': 'font/collection',

  // ── Executables / Shared Libs / Packages ────────────────────────
  '.exe': 'application/x-msdownload',
  '.dll': 'application/x-msdownload',
  '.msi': 'application/x-msdownload',
  '.so': 'application/x-sharedlib',
  '.dylib': 'application/x-sharedlib',
  '.wasm': 'application/wasm',
  '.pyc': 'application/x-python-bytecode',
  '.pyo': 'application/x-python-bytecode',
  '.appimage': 'application/x-elf',
  '.apk': 'application/vnd.android.package-archive',
  '.whl': 'application/zip',

  // ── Misc binary / data ──────────────────────────────────────────
  '.sqlite': 'application/x-sqlite3',
  '.sqlite3': 'application/x-sqlite3',
  '.db': 'application/x-sqlite3',
  '.pem': 'application/x-pem-file',
  '.crt': 'application/x-x509-ca-cert',
  '.cer': 'application/x-x509-ca-cert',
  '.key': 'application/x-pem-file',
  '.pub': 'application/x-pem-file',
  '.torrent': 'application/x-bittorrent',
  '.ipynb': 'application/json',
} as const;

/**
 * Well-known filenames without extensions (e.g. Makefile, dotfiles).
 * Checked when `path.extname()` returns `''`.
 */
export const BASENAME_TO_MIME: Record<string, string> = {
  'makefile': 'text/x-makefile',
  'gnumakefile': 'text/x-makefile',
  'dockerfile': 'text/x-dockerfile',
  'dockerfile.': 'text/x-dockerfile',
  'containerfile': 'text/x-dockerfile',
  'jenkinsfile': 'text/x-groovy',
  'vagrantfile': 'text/x-ruby',
  'rakefile': 'text/x-ruby',
  'gemfile': 'text/x-ruby',
  'procfile': 'text/plain',
  'cmakelists.txt': 'text/x-cmake',
  'license': 'text/plain',
  'copying': 'text/plain',
  'readme': 'text/markdown',
  'changelog': 'text/plain',
  'authors': 'text/plain',
  'contributing': 'text/plain',
  'todo': 'text/plain',
};

/**
 * Dotfiles whose entire name (including the dot) is a well-known config file.
 */
export const DOTFILE_TO_MIME: Record<string, string> = {
  '.bashrc': 'text/x-shell',
  '.bash_profile': 'text/x-shell',
  '.bash_logout': 'text/x-shell',
  '.profile': 'text/x-shell',
  '.zshrc': 'text/x-shell',
  '.zprofile': 'text/x-shell',
  '.zshenv': 'text/x-shell',
  '.zlogin': 'text/x-shell',
  '.zlogout': 'text/x-shell',
  '.vimrc': 'text/plain',
  '.gvimrc': 'text/plain',
  '.tmux.conf': 'text/plain',
  '.screenrc': 'text/plain',
  '.gitconfig': 'text/plain',
  '.gitignore': 'text/plain',
  '.gitattributes': 'text/plain',
  '.editorconfig': 'text/plain',
  '.eslintrc': 'application/json',
  '.eslintrc.json': 'application/json',
  '.eslintrc.js': 'text/javascript',
  '.eslintrc.cjs': 'text/javascript',
  '.eslintrc.yaml': 'text/x-yaml',
  '.eslintrc.yml': 'text/x-yaml',
  '.prettierrc': 'application/json',
  '.prettierrc.json': 'application/json',
  '.prettierrc.js': 'text/javascript',
  '.prettierrc.yaml': 'text/x-yaml',
  '.prettierrc.yml': 'text/x-yaml',
  '.prettierrc.toml': 'text/x-toml',
  '.stylelintrc': 'application/json',
  '.npmrc': 'text/plain',
  '.yarnrc': 'text/plain',
  '.env': 'text/plain',
  '.env.local': 'text/plain',
  '.env.development': 'text/plain',
  '.env.production': 'text/plain',
  '.dockerignore': 'text/plain',
  '.hgignore': 'text/plain',
  '.babelrc': 'application/json',
  '.browserslistrc': 'text/plain',
  '.nvmrc': 'text/plain',
  '.node-version': 'text/plain',
  '.ruby-version': 'text/plain',
  '.python-version': 'text/plain',
  '.tool-versions': 'text/plain',
};

/**
 * Extensions that represent file formats stored inside a ZIP container
 * (e.g. Office Open XML, OpenDocument, Java JAR, Android APK, Python wheel).
 *
 * When magic bytes detect `application/zip` but the extension is one of
 * these, the extension's MIME wins — the file is NOT an archive.
 */
export const ZIP_CONTAINER_EXTS = new Set([
  '.docx', '.docm', '.dotx', '.dotm',
  '.xlsx', '.xlsm', '.xltx', '.xltm', '.xlam',
  '.pptx', '.pptm', '.potx', '.potm', '.ppam', '.ppsx', '.ppsm',
  '.odt', '.ott', '.ods', '.ots', '.odp', '.otp', '.odg', '.otg', '.odf',
  '.jar', '.war', '.ear',
  '.apk', '.aab', '.ipa',
  '.epub',
  '.xpi',             // Firefox extension
  '.vsix',            // VS Code extension
  '.nupkg',           // NuGet package
  '.whl',             // Python wheel
  '.egg',             // Python egg
  '.cbz',             // Comic Book ZIP
  '.3mf',             // 3D Manufacturing Format
  '.sxc', '.sxd', '.sxi', '.sxg', '.sxm', // StarOffice / OpenOffice
  '.gltf',            // Could be ZIP-backed
]);

/**
 * Extensions where the extension-derived MIME is more precise/standard
 * than what magic bytes detect. Used in detectMime conflict resolution.
 *
 * Examples:
 *   - .nef (Nikon RAW) → TIFF-based, magic says image/tiff, but image/x-nikon-nef is more useful
 *   - .avif → ISOBMFF-based, magic may say video/mp4, but image/avif is IANA standard
 *   - .rar → magic detects legacy application/x-rar-compressed, but IANA says application/vnd.rar
 */
export const EXT_PREFERRED = new Set([
  // TIFF-based raw formats (magic says image/tiff, subtype is more specific)
  '.nef', '.cr2', '.dng', '.arw',
  // ISOBMFF-based image formats (magic may say video/mp4)
  '.avif', '.heic', '.heif', '.heifs',
  // IANA vnd.rar > legacy x-rar-compressed from magic
  '.rar',
]);
