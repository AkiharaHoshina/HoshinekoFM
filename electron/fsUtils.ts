import { promises as fs } from 'fs';
import { writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { EXT_TO_MIME, ZIP_CONTAINER_EXTS, EXT_PREFERRED, BASENAME_TO_MIME, DOTFILE_TO_MIME } from './mimeMap';

const execFileAsync = promisify(execFile);

// ── MIME detection by magic bytes ──────────────────────────────────

// Read first N bytes of a file and return them as a Buffer
async function readHead(filePath: string, bytes = 16): Promise<Buffer | null> {
  try {
    const fd = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    // 循环读满：大块 read 不保证一次返回全部字节，尾部补零会破坏
    // 解析（JPEG SOF 扫描依赖完整段头）
    let offset = 0;
    while (offset < bytes) {
      const { bytesRead } = await fd.read(buf, offset, bytes - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
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

/**
 * 从文件头（不解码）读取图片像素尺寸：PNG IHDR / GIF 逻辑屏幕 /
 * JPEG SOF / BMP DIB / WebP VP8(X|L)。返回 null 表示无法解析。
 * 用途：主进程同步 nativeImage 解码前的**像素数护栏**——文件字节数
 * 无法反映解码成本（450MP PNG 仅 6MB），只有像素数才能拦住巨图。
 */
async function probeImageDimensions(filePath: string): Promise<{ w: number; h: number } | null> {
  const head = await readHead(filePath, 65536);
  if (!head || head.length < 24) return null;
  // PNG：IHDR 宽高位于固定偏移 16/20（大端）
  if (bufStartsWith(head, [0x89, 0x50, 0x4E, 0x47])) {
    const w = head.readUInt32BE(16);
    const h = head.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // GIF：逻辑屏幕宽高位于偏移 6/8（小端）
  if (bufStartsWith(head, [0x47, 0x49, 0x46])) {
    const w = head.readUInt16LE(6);
    const h = head.readUInt16LE(8);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // BMP：DIB 头宽高位于偏移 18/22（小端，有符号高度）
  if (bufStartsWith(head, [0x42, 0x4D])) {
    const w = head.readInt32LE(18);
    const h = Math.abs(head.readInt32LE(22));
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // WebP：VP8X 画布（偏移 24/27，3 字节小端 +1）或 VP8L（21/24，14 位 +1）
  if (bufStartsWith(head, [0x52, 0x49, 0x46, 0x46]) && bufStartsWith(head.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])) {
    if (bufStartsWith(head.subarray(12, 16), [0x56, 0x50, 0x38, 0x58]) && head.length >= 30) {
      const w = 1 + (head[24] | (head[25] << 8) | (head[26] << 16));
      const h = 1 + (head[27] | (head[28] << 8) | (head[29] << 16));
      return w > 0 && h > 0 ? { w, h } : null;
    }
    if (bufStartsWith(head.subarray(12, 16), [0x56, 0x50, 0x38, 0x4C]) && head.length >= 25) {
      const bits = head.readUInt32LE(21);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return w > 0 && h > 0 ? { w, h } : null;
    }
    // 有损 VP8（关键帧）：帧头位于 26，宽高为 16 位小端（掩 0x3fff）
    if (bufStartsWith(head.subarray(12, 16), [0x56, 0x50, 0x38, 0x20]) && head.length >= 30) {
      const w = head.readUInt16LE(26) & 0x3fff;
      const h = head.readUInt16LE(28) & 0x3fff;
      return w > 0 && h > 0 ? { w, h } : null;
    }
    return null;
  }
  // JPEG：扫描 SOF0–SOF15（C0–CF 除 C4/C8/CC）标记
  if (bufStartsWith(head, [0xFF, 0xD8])) {
    let off = 2;
    while (off + 9 < head.length) {
      if (head[off] !== 0xFF) return null; // 段对齐破坏
      let marker = head[off];
      while (marker === 0xFF) {
        off++;
        marker = head[off];
      }
      if (marker === 0xD9 || marker === 0xDA) return null; // EOI/SOS：SOF 已过
      const len = head.readUInt16BE(off + 1);
      if (len < 2) return null;
      if (
        (marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)
      ) {
        const h = head.readUInt16BE(off + 3);
        const w = head.readUInt16BE(off + 5);
        return w > 0 && h > 0 ? { w, h } : null;
      }
      off += 2 + len;
    }
    return null;
  }
  return null;
}

/** nativeImage 回退的像素数上限（≈36MP）：超限的主进程同步解码会卡死 UI */
const NATIVE_IMAGE_MAX_PIXELS = 36_000_000;

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

/** 应用缓存根目录（缩略图/拖拽图标等） */
const APP_CACHE_DIR = path.join(os.homedir(), '.cache', 'hoshineko-fm');
const THUMB_CACHE_DIR = path.join(APP_CACHE_DIR, 'thumbnails');

/**
 * ImageMagick 磁盘像素缓存目录：**必须落在真实磁盘**而非 /tmp tmpfs。
 * 巨图（450MP 等）+ `-limit memory/map 128MiB` 强制走磁盘像素缓存，
 * 单张约 1–2GB；6 并发时 /tmp tmpfs 配额耗尽，convert 报「超出磁盘
 * 配额」失败 → 回退到主进程同步 nativeImage 解码 → 卡死 UI 数秒。
 * 目录懒创建（幂等），clearThumbnailCache 一并清理。
 */
const IM_TMP_DIR = path.join(APP_CACHE_DIR, 'im-tmp');
let imTmpDirReady = false;

/** 创建 ImageMagick 磁盘像素缓存目录（进程内一次；清缓存后重置） */
function ensureImTmpDir(): void {
  if (imTmpDirReady) return;
  if (!existsSync(IM_TMP_DIR)) {
    mkdirSync(IM_TMP_DIR, { recursive: true });
  }
  imTmpDirReady = true;
}

/** p 是否位于 dir 内部（不含 dir 自身；相对路径不逃逸） */
function isPathInside(dir: string, p: string): boolean {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 缩略图目录就绪标记：目录创建是幂等操作，进程内只做一次——
 *  每个请求一次 existsSync 的同步 stat 在滚动风暴（每秒数百请求）
 *  下会阻塞主进程事件循环，波及所有 IPC（点击/hover/滚动定位）。
 *  clearThumbnailCache 删除目录后会重置此标记以重建目录。 */
let thumbCacheDirReady = false;

function ensureThumbCacheDir(): void {
  if (thumbCacheDirReady) return;
  if (!existsSync(THUMB_CACHE_DIR)) {
    mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  }
  thumbCacheDirReady = true;
}

function thumbCacheKey(key: string, ext: 'png' | 'jpg'): string {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(THUMB_CACHE_DIR, `${hash}.${ext}`);
}

/**
 * 缓存命中内存 LRU：cacheKeyBase → 缓存文件路径。
 * 命中后直接返回，跳过每请求 2 次 existsSync 同步 stat（来回滚动时
 * 主进程事件循环不被磁盘 stat 阻塞）。只记录确认存在的命中条目。
 */
const thumbHitCache = new Map<string, string>();
/** LRU 上限：超出后淘汰最久未命中的条目（Map 插入序 = 命中序） */
const THUMB_HIT_CACHE_MAX = 10_000;

/** 记录（或刷新）缓存命中条目；生成成功后也经此写入 */
function rememberThumbHit(key: string, cachePath: string): void {
  thumbHitCache.delete(key);
  thumbHitCache.set(key, cachePath);
  if (thumbHitCache.size > THUMB_HIT_CACHE_MAX) {
    const oldest = thumbHitCache.keys().next().value;
    if (oldest !== undefined) thumbHitCache.delete(oldest);
  }
}

/**
 * 队列淘汰哨兵：缩略图**未生成**（队列满被淘汰 / 请求已被渲染侧取消），
 * 协议层应回退占位图而非原图——原图回退会让渲染进程并发解码几十张
 * 全尺寸大图（24MP ≈ 96MB/张解码位图），直接 OOM 崩溃。
 * 与 `null` 区分：null = 生成失败（真·非图片/解码失败，回退原图合理）。
 */
export const THUMB_QUEUE_DROPPED = '__hoshineko_thumb_queue_dropped__';

/** 诊断日志开关（HOSHINEKO_DEBUG_LOG=1 时启用；复现缩略图卡顿用，事后移除） */
const DEBUG_LOG = process.env.HOSHINEKO_DEBUG_LOG === '1';
/** 诊断日志起点（相对时间戳，便于对比事件顺序） */
const DEBUG_T0 = Date.now();
/** 诊断日志输出：仅调试开关开启时打印，带相对毫秒时间戳 */
function dlog(...args: unknown[]): void {
  if (!DEBUG_LOG) return;
  console.log(`[thumb-dbg +${Date.now() - DEBUG_T0}ms]`, ...args);
}

/**
 * 生成图片缩略图并返回可服务路径（命中缓存直接返回缓存文件）。
 * 返回 `null` 表示无法生成缩略图（非图片/生成失败）。
 *
 * 递归防护：源文件位于应用缓存目录（~/.cache/hoshineko-fm，含
 * thumbnails/drag-icons）内时**不缓存**——直接返回原文件路径。
 * 否则打开缩略图目录浏览时，会为每个缩略图再生成一份缩略图，
 * 文件数在几分钟内从个位数滚雪球到数千（递归膨胀 + IO 卡顿）。
 *
 * **批量保护**（v0.11.31）：冷缓存首次打开大图片目录时，可见条目
 * 会同时发起几十上百个请求，每个请求 spawn 一个 ImageMagick
 * `convert`（完整解码、峰值内存数百 MB）——瞬间 fork 风暴导致系统
 * 卡顿甚至 OOM 崩溃。因此未命中缓存的生成走**全局队列**：
 * - 并发上限 THUMB_MAX_CONCURRENT（可经 HOSHINEKO_THUMB_CONCURRENCY
 *   覆盖，e2e 用）；
 * - **世代优先 + 世代内 FIFO**：请求携带 `epoch`（渲染侧在排序/
 *   目录变化时 +1，经 `media://<path>?v=<epoch>` 传入）——新世代的
 *   请求整体插到旧世代之前（排序切换后从视觉第一个缩略图重新开始
 *   加载），同世代内按到达序 = DOM 序 = 上→下；去重命中的请求携带
 *   更高世代时提升既有排队条目的优先级（生成中的不打断）；
 * - in-flight 去重：同一文件同尺寸的并发请求共享同一个 Promise；
 * - 队列长度上限 THUMB_MAX_QUEUE：超出淘汰最陈旧（队尾 = 最低世代，
 *   resolve null，协议层回退以原文件服务，优雅降级）。
 * 命中缓存/缓存目录直通的请求不占队列（毫秒级）。
 *
 * **提速**（v0.11.31）：
 * - JPEG 源加 `-define jpeg:size` 按目标分辨率解码（DCT 降采样，
 *   不完整解码 12MP 原图，解码提速约 5–10 倍），输出 `-quality 80`
 *   的 .jpg 缩略图（编码更快、缓存体积约 10 倍小）；
 * - 非 JPEG 源输出 PNG 并降编码级别（png:compression-level=1，
 *   提速约 3 倍，文件略大），透明图片无黑底风险。
 *
 * Strategy:
 *   1. If ImageMagick `convert` is available, use it (fast, subprocess).
 *   2. Otherwise fall back to Electron's `nativeImage`.
 *
 * @param cropToSquare — when true, center-crop to a square (for drag icons).
 * @param epoch — 缩略图世代（排序/目录变化时 +1，见「批量保护」注释）。
 * @param signal — 渲染侧请求取消信号（行卸载即 abort）：未开始的排队
 *   项直接撤出队列，convert 槽位只留给真正可见的文件；已开始的
 *   不打断（继续写缓存，滚回来即命中）。可省略（如拖拽图标用）。
 */
/**
 * 缩略图缓存命中探测的到达序链：探测改为异步 stat 后（见 getThumbnail），
 * 并发请求的 stat 完成顺序可能偏离到达顺序——此链按到达序串行推进，
 * 保证 scheduleThumbnailGeneration 的入队顺序与请求到达序一致
 * （队列 FIFO/世代优先语义依赖它，e2e 34 断言首屏顶部优先生成）。
 * stat 本身异步执行，不阻塞主进程事件循环。
 */
let thumbStatChain: Promise<unknown> = Promise.resolve();

/**
 * 缩略图缓存命中探测（异步）：探测 png/jpg 两个候选缓存文件。
 * 不用 existsSync——同步磁盘 stat 在滚动进入新区域时每秒数百次，
 * 全部堆积在主进程事件循环上（冷缓存 + convert IO 风暴下 dcache
 * 命中率低，单次可达毫秒级），卡死所有 IPC 与协议响应。
 */
function probeThumbCacheHit(cachePng: string, cacheJpg: string): Promise<string | null> {
  const probeAt = Date.now();
  const probe = (async () => {
    const [pngOk, jpgOk] = await Promise.all([
      fs.stat(cachePng).then(() => true, () => false),
      fs.stat(cacheJpg).then(() => true, () => false),
    ]);
    dlog('probe done', path.basename(cachePng), `hit=${pngOk || jpgOk}`, `${Date.now() - probeAt}ms`);
    return pngOk ? cachePng : jpgOk ? cacheJpg : null;
  })();
  // 到达序链：本请求的探测等前一个请求的探测结束后才提交（结果不回传）
  const chained = thumbStatChain.then(() => probe);
  thumbStatChain = chained.catch(() => undefined);
  return chained;
}

export function getThumbnail(
  filePath: string,
  maxSize: number,
  cropToSquare = false,
  epoch = 0,
  signal?: AbortSignal,
): Promise<string | null> {
  // 缓存目录内的文件不参与缓存（防递归雪球），直接以原文件服务
  if (isPathInside(APP_CACHE_DIR, filePath)) return Promise.resolve(filePath);

  const entryAt = Date.now();
  dlog('getThumbnail', path.basename(filePath), `size=${maxSize}`, `epoch=${epoch}`, `signal=${signal ? 'y' : 'n'}`);
  ensureThumbCacheDir();
  const cacheKeyBase = cropToSquare ? `${filePath}@${maxSize}-square` : `${filePath}@${maxSize}`;
  // 内存 LRU 快路径优先：命中时零磁盘 stat
  const memHit = thumbHitCache.get(cacheKeyBase);
  if (memHit) {
    dlog('memHit', path.basename(filePath), `${Date.now() - entryAt}ms`);
    return Promise.resolve(memHit);
  }
  const cachePng = thumbCacheKey(cacheKeyBase, 'png');
  const cacheJpg = thumbCacheKey(cacheKeyBase, 'jpg');

  // 异步探测命中（快路径不进队列）；命中写入 LRU
  return probeThumbCacheHit(cachePng, cacheJpg).then((hit) => {
    if (hit) {
      dlog('diskHit', path.basename(filePath), `${Date.now() - entryAt}ms`);
      rememberThumbHit(cacheKeyBase, hit);
      return hit;
    }
    dlog('miss→queue', path.basename(filePath), `${Date.now() - entryAt}ms`);
    return scheduleThumbnailGeneration(filePath, maxSize, cropToSquare, cacheKeyBase, cachePng, cacheJpg, epoch, signal);
  });
}

/** 缩略图生成并发上限（ImageMagick 子进程数；环境变量可覆盖，e2e 用）。
 *  6：jpeg:size 提示生效后单进程峰值内存约 20MB（24MP 照片），
 *  6 并发 ≈ 120MB，远低于完整解码（297MB/进程，3 并发即近 1GB）——
 *  解码并行度是几百张照片冷缓存的主要瓶颈（实测 24MP 单张约 40ms）。 */
const THUMB_MAX_CONCURRENT = (() => {
  const raw = Number(process.env.HOSHINEKO_THUMB_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 6;
})();
/** 等待队列上限：超出淘汰最陈旧（队尾 = 最低世代，其请求 resolve null，回退原文件服务） */
const THUMB_MAX_QUEUE = 256;
/** in-flight 去重表：cacheKey → Promise 与其当前世代（去重命中时提升） */
const thumbInFlight = new Map<string, { promise: Promise<string | null>; epoch: number }>();
/** 等待队列项：key 用于去重命中时重排；start 启动生成；drop 在淘汰时 resolve null */
interface ThumbQueueEntry {
  key: string;
  epoch: number;
  seq: number;
  start: () => void;
  drop: () => void;
  /** 是否已开始生成（abort 信号只撤出未开始的排队项） */
  started: boolean;
}
const thumbQueue: ThumbQueueEntry[] = [];
/** 正在生成的数量（≤ THUMB_MAX_CONCURRENT） */
let thumbActive = 0;
/** 全局到达序号（同世代内 FIFO 依据） */
let thumbSeq = 0;

/** 取出队首任务直到并发满（队首 = 最高世代、同世代最早到达） */
function pumpThumbQueue(): void {
  while (thumbActive < THUMB_MAX_CONCURRENT && thumbQueue.length > 0) {
    thumbQueue.shift()!.start();
  }
}

/** 按「世代降序、同世代到达序升序」插入队列 */
function insertThumbEntry(entry: ThumbQueueEntry): void {
  let i = 0;
  while (i < thumbQueue.length && thumbQueue[i].epoch > entry.epoch) i++;
  while (i < thumbQueue.length && thumbQueue[i].epoch === entry.epoch && thumbQueue[i].seq < entry.seq) i++;
  thumbQueue.splice(i, 0, entry);
}

/** 去重命中且新请求世代更高：提升既有排队条目的优先级（生成中的不打断） */
function reprioritizeThumbEntry(key: string, epoch: number): void {
  const idx = thumbQueue.findIndex((e) => e.key === key);
  if (idx === -1) return; // 已在生成中
  const entry = thumbQueue[idx];
  entry.epoch = epoch;
  entry.seq = ++thumbSeq;
  thumbQueue.splice(idx, 1);
  insertThumbEntry(entry);
}

/**
 * 未命中缓存时的缩略图生成（getThumbnail 的慢路径主体）。
 * 魔数校验非图片返回 null；ImageMagick 优先、nativeImage 兜底。
 * JPEG 源按目标分辨率解码（jpeg:size 提示）并输出 q80 .jpg；
 * 其余源输出 PNG（压缩级别 1）。
 */
async function generateThumbnailUncached(
  filePath: string,
  maxSize: number,
  cropToSquare: boolean,
  cachePng: string,
  cacheJpg: string,
): Promise<string | null> {
  // e2e 钩子：HOSHINEKO_THUMB_STALL_MS 在生成前 sleep——1px 测试图
  // 生成太快（约 10ms），观察不到队列顺序/世代优先，人为放慢
  // （与 fs.ts 的 HOSHINEKO_DU_STALL_MS 同款测试钩子）
  const stallMs = Number(process.env.HOSHINEKO_THUMB_STALL_MS) || 0;
  if (stallMs > 0) await new Promise((r) => setTimeout(r, stallMs));

  // Verify file is an image by magic bytes
  const mime = await detectMimeByMagic(filePath);
  if (!mime || !mime.startsWith('image/')) return null;

  const isJpeg = mime === 'image/jpeg';
  const isGif = mime === 'image/gif';
  const cachePath = isJpeg ? cacheJpg : cachePng;

  // Try ImageMagick `convert` first
  try {
    const convertAt = Date.now();
    // 注意：`-define jpeg:size` 必须放在**输入文件之前**才生效——
    // ImageMagick 按参数顺序解析，输入之后的 define 在解码时已经错过
    // （实测 24MP 照片：放在输入前 40ms/20MB，放在输入后 160ms/297MB，
    // 提示完全失效）。它让 JPEG 源按目标分辨率解码（DCT 降采样），
    // 内存占用降约 15 倍，是并发上限能安全提高的前提。
    // `-limit` 是硬内存护栏：超限的巨图（大 PNG/多层文件等）强制
    // ImageMagick 改用磁盘缓存而非继续吃内存——防 OOM，宁慢不崩。
    // GIF 只解码第一帧（`[0]`）：动画帧全量解码的内存是单帧的数十倍。
    const args: string[] = [
      '-limit', 'memory', '128MiB',
      '-limit', 'map', '128MiB',
    ];
    if (isJpeg) {
      args.push('-define', `jpeg:size=${maxSize * 2}x${maxSize * 2}`);
    }
    args.push(isGif ? `${filePath}[0]` : filePath, '-auto-orient');
    if (cropToSquare) {
      args.push('-thumbnail', `${maxSize}x${maxSize}^`);
      args.push('-gravity', 'center');
      args.push('-extent', `${maxSize}x${maxSize}`);
    } else {
      args.push('-thumbnail', `${maxSize}x${maxSize}>`);
    }
    args.push('-strip');
    if (isJpeg) {
      args.push('-quality', '80');
      args.push('jpg:' + cachePath);
    } else {
      // 透明图片保持 PNG（防黑底），降编码级别提速
      args.push('-define', 'png:compression-level=1');
      args.push('png:' + cachePath);
    }
    dlog('convert-spawn', path.basename(filePath), `size=${maxSize}`);
    ensureImTmpDir();
    await execFileAsync('convert', args, {
      timeout: 90_000,
      // 像素缓存写真实磁盘（~/.cache/hoshineko-fm/im-tmp）而非 /tmp
      // tmpfs：巨图 + 128MiB limit 强制磁盘缓存，/tmp 配额耗尽会让
      // convert 失败并触发主进程同步 nativeImage 解码（卡死 UI）
      env: { ...process.env, TMPDIR: IM_TMP_DIR, MAGICK_TMPDIR: IM_TMP_DIR },
    });
    dlog('convert-done', path.basename(filePath), `${Date.now() - convertAt}ms`);
    if (existsSync(cachePath)) return cachePath;
  } catch {
    dlog('convert-FAILED', path.basename(filePath));
    // Fall through to nativeImage
  }

  // Fallback to Electron's nativeImage（始终写 .png，下次查找会命中）。
  // 护栏：nativeImage 在主进程**同步**全尺寸解码——文件字节数不可信
  // （450MP PNG 压缩后仅 6MB），必须按**像素数**拦住巨图。已知尺寸的
  // 巨图返回 THUMB_QUEUE_DROPPED（占位图，绝不回退原图：渲染进程解码
  // 巨图会 OOM 崩溃）；尺寸未知（TIFF/PSD 等罕见格式）保持旧行为——
  // nativeImage 尝试解码，空图再回退原图。
  // 大文件（>25MB）同样直接放弃。
  try {
    if (statSync(filePath).size > 25 * 1024 * 1024) return null;
    const dims = await probeImageDimensions(filePath);
    if (dims && dims.w * dims.h > NATIVE_IMAGE_MAX_PIXELS) {
      dlog('nativeImage-skip-oversized', path.basename(filePath), `${dims.w}x${dims.h}`);
      return THUMB_QUEUE_DROPPED;
    }
    const { nativeImage } = await import('electron');
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const resized = img.resize({ width: maxSize, height: maxSize });
    writeFileSync(cachePng, resized.toPNG());
    return cachePng;
  } catch {
    return null;
  }
}

/**
 * 把未命中缓存的缩略图生成排入全局队列（并发上限 + 去重 + 世代优先）。
 * 见 getThumbnail 的「批量保护」注释。
 *
 * 返回哨兵 THUMB_QUEUE_DROPPED 表示**未生成**（队列满被淘汰 / 请求被
 * 取消）：调用方（media 协议层）必须回退占位图而非原图——原图回退会
 * 让渲染进程解码全尺寸大图导致 OOM 崩溃。
 *
 * @param signal — 渲染侧取消信号：未开始的排队项直接撤出队列
 *   （resolve 哨兵）；已开始的不打断（继续写缓存）。
 */
function scheduleThumbnailGeneration(
  filePath: string,
  maxSize: number,
  cropToSquare: boolean,
  cacheKeyBase: string,
  cachePng: string,
  cacheJpg: string,
  epoch: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const existing = thumbInFlight.get(cacheKeyBase);
  if (existing) {
    // 同路径重叠请求（排序切换前后都可见的文件）：更高世代时
    // 提升既有排队条目的优先级，生成中的不打断
    if (epoch > existing.epoch) {
      existing.epoch = epoch;
      reprioritizeThumbEntry(cacheKeyBase, epoch);
    }
    dlog('dedupe-hit', path.basename(filePath), `epoch=${epoch}`, `queue=${thumbQueue.length}`, `active=${thumbActive}`);
    return existing.promise;
  }

  const seq = ++thumbSeq;
  const p = new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const entry: ThumbQueueEntry = {
      key: cacheKeyBase,
      epoch,
      seq,
      start: () => {
        if (settled) return;
        entry.started = true;
        thumbActive++;
        dlog('START', path.basename(filePath), `epoch=${entry.epoch}`, `queue=${thumbQueue.length}`, `active=${thumbActive}`);
        void generateThumbnailUncached(filePath, maxSize, cropToSquare, cachePng, cacheJpg)
          .then((v) => {
            // 生成成功写入内存 LRU：后续请求零同步 stat
            if (v && v !== THUMB_QUEUE_DROPPED) rememberThumbHit(cacheKeyBase, v);
            settle(v);
          })
          .catch(() => settle(null))
          .finally(() => {
            thumbActive--;
            dlog('DONE', path.basename(filePath), `active=${thumbActive}`, `queue=${thumbQueue.length}`);
            pumpThumbQueue();
          });
      },
      drop: () => {
        const idx = thumbQueue.indexOf(entry);
        if (idx !== -1) thumbQueue.splice(idx, 1);
        dlog('DROP(queue-full)', path.basename(filePath), `queue=${thumbQueue.length}`);
        settle(THUMB_QUEUE_DROPPED);
      },
      started: false,
    };
    // 渲染侧取消（行卸载）：未开始的排队项直接撤出——6 个 convert
    // 槽位只留给可见文件；已开始的不打断（继续写缓存，滚回来即命中）
    if (signal) {
      const onAbort = () => {
        if (!entry.started) {
          const idx = thumbQueue.indexOf(entry);
          if (idx !== -1) thumbQueue.splice(idx, 1);
          dlog('ABORT(queued)', path.basename(filePath), `queue=${thumbQueue.length}`, `active=${thumbActive}`);
          settle(THUMB_QUEUE_DROPPED);
        } else {
          dlog('ABORT(started, continue)', path.basename(filePath));
        }
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    if (settled) return; // 入队前已被 abort：不再入队
    if (thumbActive < THUMB_MAX_CONCURRENT) {
      entry.start();
    } else {
      // 队列满：淘汰队尾（最低世代的最陈旧项），保留新世代可见项
      if (thumbQueue.length >= THUMB_MAX_QUEUE) {
        dlog('queue-full evict', path.basename(thumbQueue[thumbQueue.length - 1].key), `queue=${thumbQueue.length}`);
        thumbQueue.pop()!.drop();
      }
      insertThumbEntry(entry);
      dlog('ENQUEUE', path.basename(filePath), `epoch=${entry.epoch}`, `seq=${entry.seq}`, `queue=${thumbQueue.length}`, `active=${thumbActive}`);
    }
  });
  thumbInFlight.set(cacheKeyBase, { promise: p, epoch });
  // 去重表条目在生成结束后清理（p 只 resolve 不 reject）
  p.then(
    () => thumbInFlight.delete(cacheKeyBase),
    () => thumbInFlight.delete(cacheKeyBase),
  );
  return p;
}

const DRAG_ICON_DIR = path.join(os.homedir(), '.cache', 'hoshineko-fm', 'drag-icons');

/**
 * 统计缩略图缓存目录占用（文件数 + 总字节）。目录不存在/读取失败返回 0。
 * 供设置页「缩略图缓存」行显示当前占用。
 */
export async function getThumbnailCacheInfo(): Promise<{ fileCount: number; totalBytes: number }> {
  try {
    const entries = await fs.readdir(THUMB_CACHE_DIR, { withFileTypes: true });
    let fileCount = 0;
    let totalBytes = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      fileCount++;
      try {
        totalBytes += (await fs.stat(path.join(THUMB_CACHE_DIR, e.name))).size;
      } catch { /* 单文件统计失败忽略 */ }
    }
    return { fileCount, totalBytes };
  } catch {
    return { fileCount: 0, totalBytes: 0 };
  }
}

/**
 * 清空缩略图缓存目录（整目录删除后重建空目录，保持后续写入路径可用）。
 * 返回清除前的文件数与释放字节数。
 */
export async function clearThumbnailCache(): Promise<{ removedCount: number; freedBytes: number }> {
  const before = await getThumbnailCacheInfo();
  try {
    await fs.rm(THUMB_CACHE_DIR, { recursive: true, force: true });
  } catch { /* 删除失败保持现状 */ }
  // 目录被整删：重置就绪标记让 ensureThumbCacheDir 重建；
  // 清空内存 LRU（路径已失效，否则清缓存后仍命中旧路径）
  thumbCacheDirReady = false;
  thumbHitCache.clear();
  ensureThumbCacheDir();
  // ImageMagick 磁盘像素缓存一并清理（巨图残留可达 GB 级）
  try {
    await fs.rm(IM_TMP_DIR, { recursive: true, force: true });
  } catch { /* 清理失败不影响主流程 */ }
  imTmpDirReady = false;
  return { removedCount: before.fileCount, freedBytes: before.totalBytes };
}

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
  const outPath = path.join(os.tmpdir(), `hoshineko-fm-generic-${Date.now()}.png`);
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
  _fallbackIconPath = path.join(os.tmpdir(), 'hoshineko-fm-fallback-icon.png');
  writeFileSync(_fallbackIconPath, PNG_1x1);
  return _fallbackIconPath;
}
