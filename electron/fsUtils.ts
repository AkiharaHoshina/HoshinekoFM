import { promises as fs } from 'fs';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { EXT_TO_MIME, ZIP_CONTAINER_EXTS, EXT_PREFERRED, BASENAME_TO_MIME, DOTFILE_TO_MIME } from './mimeMap';

const execFileAsync = promisify(execFile);

// ── MIME detection by magic bytes ──────────────────────────────────

// Read first 16 bytes of a file and return them as a Buffer
async function readHead(filePath: string, bytes = 16): Promise<Buffer | null> {
  try {
    const fd = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    await fd.read(buf, 0, bytes, 0);
    await fd.close();
    return buf;
  } catch {
    return null;
  }
}

function bufStartsWith(buf: Buffer, pattern: number[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (buf[i] !== pattern[i]) return false;
  }
  return true;
}

/** Fast MIME detection by reading file magic bytes. Returns null on failure (caller may fall back to `file` command). */
export async function detectMimeByMagic(filePath: string): Promise<string | null> {
  const head = await readHead(filePath, 16);
  if (!head || head.length < 4) return null;

  // PNG
  if (bufStartsWith(head, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  // JPEG
  if (bufStartsWith(head, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  // GIF87a / GIF89a
  if (bufStartsWith(head, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      bufStartsWith(head, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  // BMP
  if (bufStartsWith(head, [0x42, 0x4D])) return 'image/bmp';
  // TIFF (little-endian / big-endian)
  if (bufStartsWith(head, [0x49, 0x49, 0x2A, 0x00]) ||
      bufStartsWith(head, [0x4D, 0x4D, 0x00, 0x2A])) return 'image/tiff';
  // ICO
  if (bufStartsWith(head, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  // WebP (RIFF .... WEBP)
  if (bufStartsWith(head, [0x52, 0x49, 0x46, 0x46]) && head.length >= 12 &&
      bufStartsWith(head.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])) return 'image/webp';

  // PDF
  if (bufStartsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';

  // ZIP (empty / spanned / normal)
  if (bufStartsWith(head, [0x50, 0x4B, 0x03, 0x04]) ||
      bufStartsWith(head, [0x50, 0x4B, 0x05, 0x06]) ||
      bufStartsWith(head, [0x50, 0x4B, 0x07, 0x08])) return 'application/zip';
  // GZip
  if (bufStartsWith(head, [0x1F, 0x8B])) return 'application/gzip';
  // BZip2
  if (bufStartsWith(head, [0x42, 0x5A, 0x68])) return 'application/x-bzip2';
  // XZ
  if (bufStartsWith(head, [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return 'application/x-xz';
  // 7z
  if (bufStartsWith(head, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) return 'application/x-7z-compressed';
  // RAR5
  if (bufStartsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00])) return 'application/vnd.rar';
  // RAR (older)
  if (bufStartsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00])) return 'application/x-rar-compressed';

  // ELF (executable)
  if (bufStartsWith(head, [0x7F, 0x45, 0x4C, 0x46])) return 'application/x-elf';

  // MP3 (ID3 tag)
  if (bufStartsWith(head, [0x49, 0x44, 0x33])) return 'audio/mpeg';
  // OGG
  if (bufStartsWith(head, [0x4F, 0x67, 0x67, 0x53])) return 'audio/ogg';
  // FLAC
  if (bufStartsWith(head, [0x66, 0x4C, 0x61, 0x43])) return 'audio/flac';
  // WAV / AVI (RIFF)
  if (bufStartsWith(head, [0x52, 0x49, 0x46, 0x46]) && head.length >= 12) {
    const sub = head.subarray(8, 12).toString('ascii');
    if (sub === 'WAVE') return 'audio/wav';
    if (sub === 'AVI ') return 'video/x-msvideo';
  }
  // MP4 / QuickTime / HEIC (ftyp box)
  if (head.length >= 12) {
    const subtype = head.subarray(4, 8).toString('ascii');
    const brand = head.subarray(8, 12).toString('ascii');
    if (subtype === 'ftyp') {
      if (['isom', 'mp42', 'mp41', 'avc1'].includes(brand)) return 'video/mp4';
      if (['M4A ', 'M4B ', 'M4P '].includes(brand)) return 'audio/mp4';
      if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return 'image/heic';
      if (brand === 'qt  ') return 'video/quicktime';
      return 'video/mp4';
    }
  }
  // WEBM / MKV (Matroska)
  if (bufStartsWith(head, [0x1A, 0x45, 0xDF, 0xA3])) return 'video/webm';

  // SVG — starts with <?xml or <svg
  // Read a larger chunk to detect SVG reliably
  if (head.length >= 4) {
    const ascii = head.toString('ascii').toLowerCase();
    if (ascii.startsWith('<?xml') || ascii.startsWith('<svg') || ascii.startsWith('<!doc')) {
      // Confirm by reading the full first 512 bytes
      const fullHead = await readHead(filePath, 512);
      if (fullHead) {
        const text = fullHead.toString('utf-8').toLowerCase();
        if (text.includes('<svg')) return 'image/svg+xml';
      }
      return 'text/plain';
    }
  }

  // MPEG Transport Stream — sync byte 0x47 at 188-byte boundaries
  if (bufStartsWith(head, [0x47])) {
    const tsHead = await readHead(filePath, 512);
    if (tsHead && tsHead.length >= 377) {
      if (tsHead[0] === 0x47 && tsHead[188] === 0x47 && tsHead[376] === 0x47) {
        return 'video/mp2t';
      }
    }
  }

  return null;
}

// ── Cached MIME detection (4-tier hybrid) ────────────────────────

const MIME_CACHE_TTL = 30_000; // 30 seconds
const MIME_CACHE_MAX_SIZE = 5000; // prevent unbounded growth across long sessions
const mimeCache = new Map<string, { mime: string; ts: number }>();

/** Run `file --mime-type --brief` as an external subprocess. Returns stdout or null. */
async function fileMimeCommand(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('file', ['--mime-type', '--brief', filePath]);
    const mime = stdout.trim();
    return mime && mime !== 'application/octet-stream' ? mime : null;
  } catch {
    return null;
  }
}

/** Resolve known filenames without extensions (Makefile, Dockerfile) and dotfiles (.bashrc). */
function detectByBasename(filePath: string): string | null {
  const base = path.basename(filePath).toLowerCase();

  if (base.startsWith('.')) {
    if (DOTFILE_TO_MIME[base]) return DOTFILE_TO_MIME[base];
    const dotExt = path.extname(base).toLowerCase();
    if (dotExt && EXT_TO_MIME[dotExt]) return EXT_TO_MIME[dotExt];
    return null;
  }

  return BASENAME_TO_MIME[base] ?? null;
}

/** Container types that might be ZIP but contain a more specific inner format. */
const CONTAINER_TYPES = new Set([
  'application/zip', 'application/gzip', 'application/x-bzip2',
  'application/x-xz', 'application/x-7z-compressed',
  'application/vnd.rar', 'application/x-rar-compressed',
]);

/**
 * Hybrid MIME detection: 4 tiers, from most to least reliable.
 *
 *   ① Magic bytes  →  read first 16 bytes, match known signatures
 *   ② Extension map  →  fast lookup for 150+ known extensions
 *   ③ Basename map   →  extensionless files (Makefile, Dockerfile, dotfiles)
 *   ④ `file --mime-type` command  →  shell fallback
 *
  * Conflict resolution:
 *   - Magic=zip + extension in ZIP_CONTAINER_EXTS (.docx, etc.) → trust extension
 *   - Extension in EXT_PREFERRED (.nef, .avif, .rar, etc.) → trust extension
 *   - All other magic/ext conflicts → trust magic bytes, warn to console
 */
export async function detectMime(filePath: string): Promise<string | null> {
  // Check cache — also evict expired entries on access
  const cached = mimeCache.get(filePath);
  if (cached && Date.now() - cached.ts < MIME_CACHE_TTL) {
    return cached.mime || null;
  }
  if (cached) {
    mimeCache.delete(filePath); // evict stale entry
  }

  const ext = path.extname(filePath).toLowerCase();
  let mime: string | null = null;

  // ── Tier ①: Magic bytes ────────────────────────────────────
  const magicMime = await detectMimeByMagic(filePath);

  if (magicMime) {
    const extMime = ext ? EXT_TO_MIME[ext] : null;

    if (!ext || !extMime || extMime === magicMime) {
      // No conflict → trust magic bytes
      mime = magicMime;

      // For generic containers, shell out to `file` for subtype
      if (CONTAINER_TYPES.has(mime)) {
        const specific = await fileMimeCommand(filePath);
        if (specific && !CONTAINER_TYPES.has(specific)) {
          mime = specific;
        }
      }
    } else if (magicMime === 'application/zip' && ZIP_CONTAINER_EXTS.has(ext)) {
      // ZIP-backed document/package → trust extension
      mime = extMime;
    } else if (EXT_PREFERRED.has(ext)) {
      // Extension-specific MIME is more precise/standard than generic magic
      mime = extMime;
    } else {
      // Extension disagrees with magic bytes → trust content
      console.warn(
        `[detectMime] conflict "${filePath}" → magic="${magicMime}" ext="${ext}→${extMime}". Using magic bytes.`,
      );
      mime = magicMime;
    }
  }

  // ── Tier ②: Extension map ──────────────────────────────────
  if (!mime && ext && EXT_TO_MIME[ext]) {
    mime = EXT_TO_MIME[ext];
  }

  // ── Tier ③: Basename match (no extension or dotfile) ───────
  if (!mime) {
    const basenameMime = detectByBasename(filePath);
    if (basenameMime) mime = basenameMime;
  }

  // ── Tier ④: `file` command ─────────────────────────────────
  if (!mime) {
    mime = await fileMimeCommand(filePath);
    if (mime === 'inode/x-empty') mime = null;
  }

  // Cache result
  mimeCache.set(filePath, { mime: mime ?? '', ts: Date.now() });
  // Evict oldest entries if cache exceeds max size
  if (mimeCache.size > MIME_CACHE_MAX_SIZE) {
    const entries = [...mimeCache.entries()];
    const toDelete = entries.length - Math.floor(MIME_CACHE_MAX_SIZE * 0.75);
    if (toDelete > 0) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < toDelete; i++) {
        mimeCache.delete(entries[i][0]);
      }
    }
  }
  return mime ?? null;
}

export function clearMimeCache(): void {
  mimeCache.clear();
}

// ── Batch MIME detection ──────────────────────────────────────────

/** Maximum paths per `file --mime-type` invocation to stay within command-line limits. */
const BATCH_CHUNK_SIZE = 200;

/**
 * Run `file --mime-type --brief` for multiple paths in one subprocess
 * call and parse the output.  Returns a Map<path, mime|null>.
 */
async function fileMimeBatchCommand(filePaths: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const p of filePaths) result.set(p, null);

  if (filePaths.length === 0) return result;

  try {
    const { stdout } = await execFileAsync('file', ['--mime-type', '--brief', ...filePaths]);
    const lines = stdout.split('\n');
    for (let i = 0; i < filePaths.length; i++) {
      const mime = lines[i]?.trim();
      if (mime && mime !== 'application/octet-stream' && mime !== 'inode/x-empty') {
        result.set(filePaths[i], mime);
      }
    }
  } catch {
    // On failure, all paths remain null (caller may handle individually if needed)
  }
  return result;
}

/**
 * Fast-path MIME detection without spawning `file` command.
 * Runs tiers ① (magic bytes), ② (extension), and ③ (basename) only.
 * Returns null if the file command fallback is needed.
 */
async function detectMimeFast(filePath: string, ext: string): Promise<string | null> {
  // Tier ①: Magic bytes
  const magicMime = await detectMimeByMagic(filePath);
  if (magicMime) {
    const extMime = ext ? EXT_TO_MIME[ext] : null;
    if (!ext || !extMime || extMime === magicMime) {
      // No conflict → trust magic bytes.  Container types need file fallback
      // to get sub-type, so return the magic type and let caller decide.
      return magicMime;
    }
    if (magicMime === 'application/zip' && ZIP_CONTAINER_EXTS.has(ext)) {
      return extMime;
    }
    if (EXT_PREFERRED.has(ext)) {
      return extMime;
    }
    // Conflict → trust magic (same as detectMime)
    return magicMime;
  }

  // Tier ②: Extension map
  if (ext && EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext];
  }

  // Tier ③: Basename match
  const basenameMime = detectByBasename(filePath);
  if (basenameMime) return basenameMime;

  return null;
}

/**
 * Batch MIME detection for multiple file paths.
 *
 * Uses the same 4-tier logic as {@link detectMime} but batches tier-④
 * (`file --mime-type`) invocations: all paths unresolved after fast
 * detection are passed to a single `file` command (chunked at
 * {@link BATCH_CHUNK_SIZE}).
 *
 * @returns Map from file path to MIME type (or null if unknown).
 */
export async function detectMimeBatch(filePaths: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const pending: string[] = [];
  const now = Date.now();

  for (const filePath of filePaths) {
    // Check cache
    const cached = mimeCache.get(filePath);
    if (cached && now - cached.ts < MIME_CACHE_TTL) {
      result.set(filePath, cached.mime || null);
      continue;
    }
    if (cached) {
      mimeCache.delete(filePath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = await detectMimeFast(filePath, ext);

    if (mime) {
      // Container types still need `file` for sub-type
      if (CONTAINER_TYPES.has(mime)) {
        pending.push(filePath);
      } else {
        result.set(filePath, mime);
      }
    } else {
      pending.push(filePath);
    }
  }

  // Batch `file` command for pending paths (chunked to avoid arg overflow)
  for (let i = 0; i < pending.length; i += BATCH_CHUNK_SIZE) {
    const chunk = pending.slice(i, i + BATCH_CHUNK_SIZE);
    const fileResults = await fileMimeBatchCommand(chunk);
    for (const [p, mime] of fileResults) {
      result.set(p, mime);
    }
  }

  // Write cache for all results
  for (const [p, mime] of result) {
    mimeCache.set(p, { mime: mime ?? '', ts: now });
  }

  // Evict oldest entries if cache exceeds max size
  if (mimeCache.size > MIME_CACHE_MAX_SIZE) {
    const entries = [...mimeCache.entries()];
    const toDelete = entries.length - Math.floor(MIME_CACHE_MAX_SIZE * 0.75);
    if (toDelete > 0) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      for (let j = 0; j < toDelete; j++) {
        mimeCache.delete(entries[j][0]);
      }
    }
  }

  return result;
}

// ── Thumbnail generation & caching ────────────────────────────────

const THUMB_CACHE_DIR = path.join(os.homedir(), '.cache', 'material3', 'thumbnails');

function ensureThumbCacheDir(): void {
  if (!existsSync(THUMB_CACHE_DIR)) {
    mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  }
}

function thumbCacheKey(key: string): string {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(THUMB_CACHE_DIR, `${hash}.png`);
}

/**
 * Generate a thumbnail for the given file (image only) and return the
 * cache file path.  Returns `null` if the file cannot be thumbnailed.
 *
 * Strategy:
 *   1. If ImageMagick `convert` is available, use it (fast, subprocess).
 *   2. Otherwise fall back to Electron's `nativeImage`.
 *
 * @param cropToSquare — when true, center-crop to a square (for drag icons).
 */
export async function getThumbnail(filePath: string, maxSize: number, cropToSquare = false): Promise<string | null> {
  ensureThumbCacheDir();
  const cacheKey = cropToSquare ? `${filePath}@${maxSize}-square` : `${filePath}@${maxSize}`;
  const cachePath = thumbCacheKey(cacheKey);

  // Return cached thumbnail if it exists
  if (existsSync(cachePath)) return cachePath;

  // Verify file is an image by magic bytes
  const mime = await detectMimeByMagic(filePath);
  if (!mime || !mime.startsWith('image/')) return null;

  // Try ImageMagick `convert` first
  try {
    const args: string[] = [
      filePath,
      '-auto-orient',
    ];
    if (cropToSquare) {
      args.push('-thumbnail', `${maxSize}x${maxSize}^`);
      args.push('-gravity', 'center');
      args.push('-extent', `${maxSize}x${maxSize}`);
    } else {
      args.push('-thumbnail', `${maxSize}x${maxSize}>`);
    }
    args.push('-strip', 'png:' + cachePath);
    await execFileAsync('convert', args);
    if (existsSync(cachePath)) return cachePath;
  } catch {
    // Fall through to nativeImage
  }

  // Fallback to Electron's nativeImage
  try {
    const { nativeImage } = await import('electron');
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const resized = img.resize({ width: maxSize, height: maxSize });
    writeFileSync(cachePath, resized.toPNG());
    return cachePath;
  } catch {
    return null;
  }
}

const DRAG_ICON_DIR = path.join(os.homedir(), '.cache', 'material3', 'drag-icons');

/** Path for a cached Material Symbols drag icon by icon name */
export function getCachedDragIconPath(iconName: string): string {
  if (!existsSync(DRAG_ICON_DIR)) {
    mkdirSync(DRAG_ICON_DIR, { recursive: true });
  }
  return path.join(DRAG_ICON_DIR, `${iconName}.png`);
}

/**
 * Generate a drag icon (square PNG) for any file.
 * - For images: a square-cropped thumbnail (center crop).
 * - For non-images: Material Symbols icon pre-rendered by the frontend
 *   and cached on disk.  Falls back to a visible generic colored square.
 */
export async function getDragIcon(filePath: string, filled = false): Promise<string> {
  const mime = await detectMime(filePath);
  if (mime && mime.startsWith('image/')) {
    const thumb = await getThumbnail(filePath, 96, true);
    if (thumb) return thumb;
  }
  // Check if a pre-cached Material icon exists
  if (!mime) return getGenericFileIcon('Others');
  const iconName = getIconNameForMime(mime, false);
  const cacheKey = filled ? `${iconName}:filled` : iconName;
  const cached = getCachedDragIconPath(cacheKey);
  if (existsSync(cached)) return cached;
  // Try unfilled fallback
  const fallback = getCachedDragIconPath(iconName);
  if (existsSync(fallback)) return fallback;
  return getGenericFileIcon(mime);
}

/** Map MIME → Material Symbols icon name (mirrors frontend logic) */
function getIconNameForMime(mime: string | null, isDirectory: boolean): string {
  if (isDirectory || mime === 'inode/directory') return 'folder';
  if (!mime) return 'insert_drive_file';

  if (mime.startsWith('font/')) return 'font_download';

  switch (mime) {
  // ── Text — markup ──
  case 'text/markdown':
    return 'markdown';
  case 'text/x-tex':
    return 'article';

  // ── Text — code (specific languages) ──
  case 'text/javascript':
    return 'javascript';
  case 'text/html':
    return 'html';
  case 'text/css':
  case 'text/x-scss':
    return 'css';
  case 'text/x-shell':
    return 'terminal';
  case 'text/x-sql':
    return 'database';

  // ── Text — data/config ──
  case 'text/x-yaml':
  case 'text/x-toml':
    return 'data_object';

  // ── Text — table data ──
  case 'text/csv':
  case 'text/tab-separated-values':
    return 'csv';

  // ── Text — plain ──
  case 'text/plain':
    return 'article';

  // ── Images (overrides) ──
  case 'image/vnd.djvu':
    return 'book_2';

  // ── Documents ──
  case 'application/pdf':
    return 'picture_as_pdf';
  case 'application/msword':
  case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
  case 'application/vnd.oasis.opendocument.text':
  case 'application/vnd.oasis.opendocument.formula':
    return 'description';
  case 'application/vnd.ms-excel':
  case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
  case 'application/vnd.oasis.opendocument.spreadsheet':
    return 'table';
  case 'application/vnd.ms-powerpoint':
  case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
  case 'application/vnd.oasis.opendocument.presentation':
    return 'slideshow';
  case 'application/vnd.oasis.opendocument.graphics':
    return 'stylus';
  case 'application/rtf':
    return 'article';

  // ── Ebooks ──
  case 'application/epub+zip':
  case 'application/x-mobipocket-ebook':
    return 'import_contacts';

  // ── Archives ──
  case 'application/x-iso9660-image':
    return 'album';
  case 'application/x-rpm':
  case 'application/vnd.debian.binary-package':
    return 'package_2';
  case 'application/zip':
  case 'application/gzip':
  case 'application/x-bzip2':
  case 'application/x-xz':
  case 'application/x-7z-compressed':
  case 'application/vnd.rar':
  case 'application/x-rar-compressed':
  case 'application/x-tar':
  case 'application/x-lzip':
  case 'application/x-lzop':
  case 'application/x-lz4':
  case 'application/zstd':
  case 'application/vnd.ms-cab-compressed':
  case 'application/x-arj':
  case 'application/x-lzh':
    return 'folder_zip';

  // ── Executables ──
  case 'application/x-msdownload':
    return 'deployed_code';
  case 'application/java-archive':
    return 'deployed_code';
  case 'application/vnd.android.package-archive':
    return 'android';
  case 'application/wasm':
  case 'application/x-python-bytecode':
  case 'application/x-java-bytecode':
    return 'code';
  case 'application/x-elf':
  case 'application/x-executable':
  case 'application/x-sharedlib':
    return 'terminal';

  // ── Data ──
  case 'application/json':
    return 'file_json';
  case 'application/xml':
    return 'data_object';
  case 'application/graphql':
    return 'data_object';
  case 'application/x-sqlite3':
    return 'database';
  case 'application/x-pem-file':
  case 'application/x-x509-ca-cert':
    return 'key';
  case 'application/x-bittorrent':
    return 'cloud_download';

  case 'application/x-krita':
    return 'brush';
  case 'application/x-scratch':
    return 'extension';

  // ── Fonts (non-font/* MIMEs) ──
  case 'application/vnd.ms-fontobject':
    return 'font_download';
  }

  const cat = mime.split('/')[0];
  switch (cat) {
  case 'image': return 'image';
  case 'audio': return 'audio_file';
  case 'video': return 'movie';
  case 'text': return 'code';
  }

  return 'insert_drive_file';
}

/** Generate a visible fallback PNG when the cached Material icon is not yet available. */
async function getGenericFileIcon(mime: string): Promise<string> {
  const cat = mime.split('/')[0];
  let color: string;
  switch (cat) {
  case 'image':  color = '#4A90D9'; break;
  case 'audio':  color = '#9B59B6'; break;
  case 'video':  color = '#E74C3C'; break;
  case 'text':   color = '#1ABC9C'; break;
  case 'inode':  color = '#3498DB'; break;
  default:
    switch (mime) {
    case 'application/pdf':                     color = '#E74C3C'; break;
    case 'application/zip':
    case 'application/gzip':
    case 'application/x-bzip2':
    case 'application/x-xz':
    case 'application/x-7z-compressed':
    case 'application/vnd.rar':
    case 'application/x-rar-compressed':
    case 'application/x-tar':
      color = '#F39C12'; break;
    case 'application/x-elf':
    case 'application/x-executable':
    case 'application/x-sharedlib':
      color = '#2C3E50'; break;
    default:                                    color = '#7F8C8D'; break;
    }
  }

  const { nativeImage } = await import('electron');
  const outPath = path.join(os.tmpdir(), `material3-generic-${Date.now()}.png`);
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
      <rect width="96" height="96" fill="${color}"/>
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const colored = nativeImage.createFromDataURL(dataUrl);
    writeFileSync(outPath, colored.toPNG());
    if (existsSync(outPath)) return outPath;
  } catch { /* fall through */ }
  return getFallbackIcon();
}

// ── Fallback 1×1 transparent PNG ──────────────────────────────────

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

let _fallbackIconPath: string | null = null;

function getFallbackIcon(): string {
  if (_fallbackIconPath && existsSync(_fallbackIconPath)) return _fallbackIconPath;
  _fallbackIconPath = path.join(os.tmpdir(), 'material3-fallback-icon.png');
  writeFileSync(_fallbackIconPath, PNG_1x1);
  return _fallbackIconPath;
}
