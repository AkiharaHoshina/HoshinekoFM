import { ipcMain, app, shell } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { exec, spawn, type ChildProcess } from 'child_process';
import { detectMimeBatch } from '../fsUtils';
import { getMountMap, resolveAccessibleParent, getExecError } from '../shared';

const execAsync = promisify(exec);

/** Virtual filesystems where MIME detection via `file` command is wasteful */
const VIRTUAL_FS_TYPES = new Set([
  'proc', 'sysfs', 'devtmpfs', 'devpts',
  'debugfs', 'tracefs', 'securityfs', 'configfs',
  'cgroup', 'cgroup2', 'pstore', 'bpf',
  'hugetlbfs', 'mqueue', 'fusectl',
]);

/**
 * Find the filesystem type for a given path by longest mountpoint prefix match.
 * Returns null if no mountpoint covers the path.
 */
function resolveFstype(
  mountMap: Map<string, { source: string; fstype: string }>,
  targetPath: string,
): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const [mp, info] of mountMap) {
    const mpLen = mp.length;
    if (mpLen > bestLen && (targetPath === mp || targetPath.startsWith(mp + '/'))) {
      best = info.fstype;
      bestLen = mpLen;
    }
  }
  return best;
}

/**
 * Build a Map from home directory path → `{ username, uid }` by parsing
 * `/etc/passwd`. Falls back to `getent passwd` if the file read fails
 * (e.g. in NIS/LDAP environments where not all users are in `/etc/passwd`).
 *
 * Entries with home directory `/` (root) are excluded to avoid treating
 * system accounts as "home directory" owners of the entire filesystem.
 *
 * Memoized at module level — the map does not change during the app
 * lifetime, so we read it once and reuse across all `listDirectoryContents`
 * calls.
 */
/**
 * Cached `/etc/passwd` derived maps:
 * - `homeMap`: home directory path → `{ username, uid }`
 * - `uidMap`: numeric UID → username
 */
let _passwdMaps: {
  homeMap: Map<string, { username: string; uid: number }>;
  uidMap: Map<number, string>;
} | undefined;

/**
 * Build the passwd-derived maps by parsing `/etc/passwd`. Falls back to
 * `getent passwd` if the file read fails (e.g. in NIS/LDAP environments
 * where not all users are in `/etc/passwd`).
 *
 * Entries with home directory `/` (root) are excluded from `homeMap` to
 * avoid treating system accounts as "home directory" owners of the entire
 * filesystem, but their UID→username mapping is kept in `uidMap`.
 *
 * Memoized at module level — the maps do not change during the app
 * lifetime, so we read once and reuse across all `listDirectoryContents`
 * calls.
 */
async function getPasswdMaps(): Promise<{
  homeMap: Map<string, { username: string; uid: number }>;
  uidMap: Map<number, string>;
}> {
  if (_passwdMaps) return _passwdMaps;

  const homeMap = new Map<string, { username: string; uid: number }>();
  const uidMap = new Map<number, string>();
  let content: string;

  try {
    content = await fs.readFile('/etc/passwd', 'utf-8');
  } catch {
    try {
      const { stdout } = await execAsync('getent passwd');
      content = stdout;
    } catch {
      _passwdMaps = { homeMap, uidMap };
      return _passwdMaps;
    }
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(':');
    if (fields.length < 7) continue;
    const username = fields[0];
    const uid = parseInt(fields[2], 10);
    const home = fields[5];
    if (!username || isNaN(uid)) continue;
    uidMap.set(uid, username);
    if (!home || home === '/') continue;
    homeMap.set(home, { username, uid });
  }

  _passwdMaps = { homeMap, uidMap };
  return _passwdMaps;
}

async function getPasswdHomeMap(): Promise<Map<string, { username: string; uid: number }>> {
  return (await getPasswdMaps()).homeMap;
}

/** Cached GID → group name map parsed from `/etc/group` */
let _groupGidMap: Map<number, string> | undefined;

/**
 * Build a GID → group name map by parsing `/etc/group`. Falls back to
 * `getent group` if the file read fails. Memoized at module level.
 */
async function getGroupGidMap(): Promise<Map<number, string>> {
  if (_groupGidMap) return _groupGidMap;

  const map = new Map<number, string>();
  let content: string;

  try {
    content = await fs.readFile('/etc/group', 'utf-8');
  } catch {
    try {
      const { stdout } = await execAsync('getent group');
      content = stdout;
    } catch {
      _groupGidMap = map;
      return map;
    }
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(':');
    if (fields.length < 3) continue;
    const name = fields[0];
    const gid = parseInt(fields[2], 10);
    if (!name || isNaN(gid)) continue;
    map.set(gid, name);
  }

  _groupGidMap = map;
  return map;
}

/**
 * Process items with a concurrency limit, preserving input order.
 *
 * Spawning thousands of parallel filesystem operations saturates the
 * UV thread pool and causes severe contention.  This worker-pool pattern
 * keeps at most `concurrency` operations in-flight simultaneously.
 *
 * @returns Results in the same order as `items` (nulls preserved).
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await processor(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Lists all entries under `targetPath` with full metadata.
 *
 * **Phase 1 — readdir**: Enumerate directory entries via
 * `fs.readdir({ withFileTypes: true })`.
 *
 * **Phase 2 — Per-entry classification** (concurrency-limited, batch MIME):
 * - Processed with {@link processWithConcurrency} (limit 16) to avoid
 *   UV thread-pool saturation.
 * - Special files (block, char, fifo, socket) are classified with `inode/*`
 *   MIME types. Block devices additionally query `/sys/class/block/` for
 *   partition/DM status (→ `isMountable`, `canAutoMount`) and `/sys/block/`
 *   for removable status (→ `isExternal`, `parentDisk`).
 * - Symlinks are resolved with `fs.readlink`, then `fs.stat` on the resolved
 *   target to get the real target's metadata. Broken symlinks (`ENOENT`) are
 *   reported with `mime: "inode/symlink"`.
 * - Regular files/directories get size/mtime via `fs.stat`.
 * - MIME detection is deferred: all paths needing MIME are collected and
 *   resolved in a single batched `detectMimeBatch` call (which internally
 *   batches `file --mime-type` commands).
 *
 * **Phase 3 — Device ↔ mount map**: Parse `/proc/mounts` (via
 * `getMountMap`) and index by device source path. Device-path symlink
 * resolution (e.g. `/dev/disk/by-uuid/...` → `/dev/sda1`) happens in
 * parallel via `Promise.all`.
 *
 * **Phase 4 — Enrich entries with mount info** (second pass):
 * - Directories matching a mountpoint get `isMountpoint`, `mountSource`,
 *   `mountFstype`.
 * - Entries with a `devicePath` or `symlinkTarget` that match a device in the
 *   mount map get `mountFstype` and `mountedAt`.
 * - Block device symlinks in `/dev` get `isMountable`, `canAutoMount`, and
 *   `isExternal` computed from `/sys/class/block/<targetName>` and
 *   `/sys/block/<targetName>`.
 *
 * **Phase 5 — Enrich entries with home directory owner info** (third pass):
 * - Parse `/etc/passwd` (with `getent passwd` fallback for NIS/LDAP) into a
 *   Map keyed by home directory path.
 * - For each entry whose `path` matches a home directory, set `homeOwner`
 *   (username) and `homeOwnerUid` (numeric UID).
 *
 * @returns Filtered array (null entries removed) of file entry objects
 * matching the `IFile` shape.
 */
async function listDirectoryContents(targetPath: string): Promise<{
  name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null;
  symlinkTarget?: string; isMountpoint?: boolean; mountSource?: string; mountFstype?: string; devicePath?: string; isMountable?: boolean; parentDisk?: string; isExternal?: boolean; mountedAt?: string; canAutoMount?: boolean; homeOwner?: string; homeOwnerUid?: number; mode?: number; uid?: number; gid?: number; userName?: string; groupName?: string;
}[]> {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  // Build mount map before processing entries so we can skip MIME detection
  // on virtual filesystems where `file --mime-type` would be wasteful
  const mountMap = await getMountMap();
  const targetFstype = resolveFstype(mountMap, targetPath);
  const skipMime = targetFstype !== null && VIRTUAL_FS_TYPES.has(targetFstype);

  // ── Phase 2: Classify entries with concurrency limit ──────────
  // MIME detection is deferred: we store the path that needs MIME
  // in `_mimePath` and resolve all of them at once in Phase 2b.

  interface ClassifiedEntry {
    name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null;
    symlinkTarget?: string; devicePath?: string; isMountable?: boolean;
    parentDisk?: string; isExternal?: boolean; canAutoMount?: boolean;
    /** Non-null when this entry needs batch MIME detection on this path */
    _mimePath?: string;
    /** Set in Phase 4 — mount enrichment */
    isMountpoint?: boolean; mountSource?: string; mountFstype?: string; mountedAt?: string;
    /** Set in Phase 5 — home directory owner enrichment */
    homeOwner?: string; homeOwnerUid?: number;
    /** Permissions bits (`mode & 0o777`) from `fs.stat` */
    mode?: number;
    /** Numeric owner UID from `fs.stat` */
    uid?: number;
    /** Numeric group GID from `fs.stat` */
    gid?: number;
    /** Owner username resolved from UID in Phase 6 */
    userName?: string;
    /** Group name resolved from GID in Phase 6 */
    groupName?: string;
  }

  const results = await processWithConcurrency(entries, 16, async (entry): Promise<ClassifiedEntry | null> => {
    try {
      const fullPath = path.join(targetPath, entry.name);
      const isSymlink = entry.isSymbolicLink();
      const isBlock = entry.isBlockDevice();
      const isChar = entry.isCharacterDevice();
      const isFIFO = entry.isFIFO();
      const isSock = entry.isSocket();
      const isSpecial = isBlock || isChar || isFIFO || isSock;

      if (isSpecial) {
        let mime: string;
        if (isBlock) mime = 'inode/blockdevice';
        else if (isChar) mime = 'inode/chardevice';
        else if (isFIFO) mime = 'inode/fifo';
        else mime = 'inode/socket';
        let isMountable: boolean | undefined;
        let parentDisk: string | undefined;
        let isExternal: boolean | undefined;
        let canAutoMount: boolean | undefined;
        if (isBlock) {
          const hasPartition = await fs.access(`/sys/class/block/${entry.name}/partition`).then(() => true).catch(() => false);
          const hasDm = await fs.access(`/sys/class/block/${entry.name}/dm/`).then(() => true).catch(() => false);
          isMountable = hasPartition || hasDm;
          canAutoMount = isMountable && !hasDm;

          let diskNameForExternal = entry.name;
          if (hasPartition) {
            try {
              const linkTarget = await fs.readlink(`/sys/class/block/${entry.name}`);
              const segments = linkTarget.split('/').filter(Boolean);
              if (segments.length >= 2) {
                const parentName = segments[segments.length - 2];
                if (parentName && parentName !== entry.name) {
                  parentDisk = `/dev/${parentName}`;
                  diskNameForExternal = parentName;
                }
              }
            } catch { /* continue */ }
          }

          try {
            const removable = await fs.readFile(`/sys/block/${diskNameForExternal}/removable`, 'utf-8');
            isExternal = removable.trim() === '1';
          } catch { /* continue */ }
          if (!isExternal) {
            try {
              const link = await fs.readlink(`/sys/block/${diskNameForExternal}`);
              isExternal = link.includes('usb');
            } catch { /* continue */ }
          }
        }
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: false,
          size: 0,
          mtime: new Date(0),
          mime,
          devicePath: isBlock ? fullPath : undefined,
          isMountable,
          parentDisk,
          isExternal,
          canAutoMount,
        };
      }

      if (isSymlink) {
        let symlinkTarget: string | undefined;
        try {
          const rawTarget = await fs.readlink(fullPath);
          symlinkTarget = path.resolve(path.dirname(fullPath), rawTarget);
        } catch {
          return null;
        }

        if (symlinkTarget) {
          try {
            const stats = await fs.stat(fullPath);
            if (stats.isDirectory()) {
              return {
                name: entry.name, path: fullPath, isDirectory: true,
                size: stats.size, mtime: stats.mtime,
                mime: 'inode/directory', symlinkTarget,
                mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid,
              };
            }
            if (stats.isBlockDevice() || stats.isCharacterDevice() ||
                stats.isFIFO() || stats.isSocket()) {
              let mime: string | null;
              if (stats.isBlockDevice()) mime = 'inode/blockdevice';
              else if (stats.isCharacterDevice()) mime = 'inode/chardevice';
              else if (stats.isFIFO()) mime = 'inode/fifo';
              else mime = 'inode/socket';
              return {
                name: entry.name, path: fullPath, isDirectory: false,
                size: stats.size, mtime: stats.mtime,
                mime, symlinkTarget,
              };
            }
            // Regular file via symlink → defer MIME to batch
            return {
              name: entry.name, path: fullPath, isDirectory: false,
              size: stats.size, mtime: stats.mtime,
              mime: skipMime ? null : undefined as unknown as string | null,
              symlinkTarget,
              _mimePath: skipMime ? undefined : symlinkTarget,
              mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid,
            };
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
              return {
                name: entry.name, path: fullPath, isDirectory: false,
                size: 0, mtime: new Date(0),
                mime: 'inode/symlink', symlinkTarget,
              };
            }
            return {
              name: entry.name, path: fullPath, isDirectory: false,
              size: 0, mtime: new Date(0),
              mime: null, symlinkTarget,
            };
          }
        }
        return null;
      }

      // Regular file or directory
      const stats = await fs.stat(fullPath);
      if (entry.isDirectory()) {
        return {
          name: entry.name, path: fullPath, isDirectory: true,
          size: stats.size, mtime: stats.mtime,
          mime: 'inode/directory',
          mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid,
        };
      }
      return {
        name: entry.name, path: fullPath, isDirectory: false,
        size: stats.size, mtime: stats.mtime,
        mime: skipMime ? null : undefined as unknown as string | null,
        _mimePath: skipMime ? undefined : fullPath,
        mode: stats.mode & 0o777, uid: stats.uid, gid: stats.gid,
      };
    } catch {
      return null;
    }
  });

  // ── Phase 2b: Batch MIME detection ────────────────────────────
  const filtered: ClassifiedEntry[] = [];
  const mimePathSet = new Set<string>();

  for (const r of results) {
    if (!r) continue;
    filtered.push(r);
    if (r._mimePath) {
      mimePathSet.add(r._mimePath);
    }
  }

  if (mimePathSet.size > 0) {
    const mimeMap = await detectMimeBatch([...mimePathSet]);
    for (const entry of filtered) {
      if (entry._mimePath) {
        entry.mime = mimeMap.get(entry._mimePath) ?? null;
      }
    }
  }

  // Ensure any entries with mime=undefined (skipped batch) are set to null
  for (const entry of filtered) {
    if (entry.mime === (undefined as unknown)) {
      entry.mime = null;
    }
  }

  // ── Phase 3: Device ↔ mount map (parallel symlink resolution) ─
  const deviceMountMap = new Map<string, { source: string; fstype: string; mountpoint: string }>();
  for (const [mp, info] of mountMap) {
    if (info.source && info.source !== 'none') {
      deviceMountMap.set(info.source, { ...info, mountpoint: mp });
    }
  }

  // Resolve device symlinks in parallel, then write results sequentially
  const symlinkResolutions = await Promise.all(
    [...deviceMountMap].map(async ([source, info]) => {
      try {
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) {
          const target = path.resolve(path.dirname(source), await fs.readlink(source));
          return { source, target, info } as const;
        }
      } catch { /* continue */ }
      return null;
    }),
  );
  for (const res of symlinkResolutions) {
    if (res && !deviceMountMap.has(res.target)) {
      deviceMountMap.set(res.target, res.info);
    }
  }

  // ── Phase 4: Enrich entries with mount info ───────────────────
  for (const entry of filtered) {
    if (entry.isDirectory) {
      const mount = mountMap.get(entry.path);
      if (mount) {
        entry.isMountpoint = true;
        entry.mountSource = mount.source;
        entry.mountFstype = mount.fstype;
      }
    }
    if (entry.devicePath) {
      const dm = deviceMountMap.get(entry.devicePath);
      if (dm) {
        entry.mountFstype = dm.fstype;
        entry.mountedAt = dm.mountpoint;
      }
    }
    if (entry.symlinkTarget) {
      const dm = deviceMountMap.get(entry.symlinkTarget);
      if (dm) {
        entry.mountFstype = dm.fstype;
        entry.mountedAt = dm.mountpoint;
      }
      if (entry.mime === 'inode/blockdevice') {
        const targetName = path.basename(entry.symlinkTarget);
        try {
          const hasPartition = await fs.access(`/sys/class/block/${targetName}/partition`).then(() => true).catch(() => false);
          const hasDm = await fs.access(`/sys/class/block/${targetName}/dm/`).then(() => true).catch(() => false);
          entry.isMountable = hasPartition || hasDm;
          entry.canAutoMount = entry.isMountable && !hasDm;
        } catch { /* continue */ }
        try {
          const removable = await fs.readFile(`/sys/block/${targetName}/removable`, 'utf-8');
          entry.isExternal = removable.trim() === '1';
        } catch { /* continue */ }
        if (!entry.isExternal) {
          try {
            const link = await fs.readlink(`/sys/block/${targetName}`);
            entry.isExternal = link.includes('usb');
          } catch { /* continue */ }
        }
      }
    }
  }

  // Phase 5 — Enrich entries with home directory owner info from /etc/passwd.
  const homeMap = await getPasswdHomeMap();
  for (const entry of filtered) {
    const owner = homeMap.get(entry.path);
    if (owner) {
      entry.homeOwner = owner.username;
      entry.homeOwnerUid = owner.uid;
    }
  }

  // Phase 6 — Resolve owner/group names from UID/GID for the properties dialog.
  const uidMap = (await getPasswdMaps()).uidMap;
  const gidMap = await getGroupGidMap();
  for (const entry of filtered) {
    if (entry.uid !== undefined && entry.userName === undefined) {
      entry.userName = uidMap.get(entry.uid);
    }
    if (entry.gid !== undefined && entry.groupName === undefined) {
      entry.groupName = gidMap.get(entry.gid);
    }
  }

  // Strip internal `_mimePath` field before returning
  for (const entry of filtered) {
    delete (entry as unknown as Record<string, unknown>)._mimePath;
  }
  return filtered as unknown as {
    name: string; path: string; isDirectory: boolean; size: number; mtime: Date; mime: string | null;
    symlinkTarget?: string; isMountpoint?: boolean; mountSource?: string; mountFstype?: string; devicePath?: string; isMountable?: boolean; parentDisk?: string; isExternal?: boolean; mountedAt?: string; canAutoMount?: boolean; homeOwner?: string; homeOwnerUid?: number; mode?: number; uid?: number; gid?: number; userName?: string; groupName?: string;
  }[];
}

export function registerFsHandlers() {
  // List directory contents. Falls back to nearest accessible parent on permission errors.
  ipcMain.handle('fs:list-dir', async (_, dirPath: string) => {
    const targetPath = dirPath || app.getPath('home');
    try {
      const data = await listDirectoryContents(targetPath);
      return { data, actualPath: targetPath };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error('Failed to list dir', targetPath, err);
      const resolvedPath = await resolveAccessibleParent(targetPath);
      if (resolvedPath) {
        console.warn(`[fs:list-dir] resolved "${targetPath}" → "${resolvedPath}"`);
        const data = await listDirectoryContents(resolvedPath);
        return {
          data,
          actualPath: resolvedPath,
          error: { code: err.code || 'UNKNOWN', originalPath: targetPath },
        };
      }
      throw error;
    }
  });

  // Standard user directory shortcuts for the sidebar (Home, Desktop, Documents, etc.).
  ipcMain.handle('fs:get-places', () => {
    const home = app.getPath('home');
    return [
      { name: 'Home', path: home, icon: '🏠' },
      { name: 'Desktop', path: app.getPath('desktop'), icon: '🖥️' },
      { name: 'Documents', path: app.getPath('documents'), icon: '📄' },
      { name: 'Downloads', path: app.getPath('downloads'), icon: '⬇️' },
      { name: 'Music', path: app.getPath('music'), icon: '🎵' },
      { name: 'Pictures', path: app.getPath('pictures'), icon: '🖼️' },
      { name: 'Videos', path: app.getPath('videos'), icon: '🎥' },
      { name: 'Trash', path: 'trash://', icon: '🗑️' },
    ];
  });

  /**
   * freedesktop 规范的回收站根目录（~/.local/share/Trash）。
   */
  function getTrashRoot(): string {
    return path.join(app.getPath('home'), '.local/share/Trash');
  }

  /**
   * 返回回收站 files 目录的真实路径。前端在 trash:// 视图下监听该目录，
   * 外部应用改动回收站时可自动刷新。
   */
  ipcMain.handle('fs:get-trash-dir', () => {
    return path.join(getTrashRoot(), 'files');
  });

  /**
   * 列出回收站内容。每条目解析 `info/<name>.trashinfo` 中的 `Path=`
   * （原始绝对路径，percent-encoded）与 `DeletionDate=` 字段。
   */
  ipcMain.handle('fs:trash-list', async () => {
    const filesDir = path.join(getTrashRoot(), 'files');
    const infoDir = path.join(getTrashRoot(), 'info');

    let names: string[];
    try {
      names = await fs.readdir(filesDir);
    } catch {
      return [];
    }

    interface TrashListing {
      name: string; path: string; isDirectory: boolean; size: number;
      mtime: Date; mime: string | null;
      trashOriginalPath?: string; trashInfoPath?: string;
      _mimePath?: string;
    }

    const results = await processWithConcurrency(names, 16, async (name): Promise<TrashListing | null> => {
      try {
        const filePath = path.join(filesDir, name);
        const infoPath = path.join(infoDir, name + '.trashinfo');
        const stats = await fs.lstat(filePath);

        let trashOriginalPath: string | undefined;
        let deletionDate: Date | undefined;
        try {
          const content = await fs.readFile(infoPath, 'utf-8');
          const pathMatch = content.match(/^Path=(.*)$/m);
          if (pathMatch) {
            trashOriginalPath = decodeURIComponent(pathMatch[1].trim());
          }
          const dateMatch = content.match(/^DeletionDate=(.*)$/m);
          if (dateMatch) {
            deletionDate = new Date(dateMatch[1].trim());
          }
        } catch { /* no .trashinfo — keep original fields undefined */ }

        return {
          name,
          path: filePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtime: deletionDate && !isNaN(deletionDate.getTime()) ? deletionDate : stats.mtime,
          mime: stats.isDirectory() ? 'inode/directory' : undefined as unknown as string | null,
          trashOriginalPath,
          trashInfoPath: infoPath,
          _mimePath: stats.isDirectory() ? undefined : filePath,
        };
      } catch {
        return null;
      }
    });

    const filtered = results.filter((r): r is TrashListing => r !== null);

    // 批量 MIME 检测（与普通目录列表一致，供图标与类型描述使用）
    const mimePaths = new Set<string>();
    for (const entry of filtered) {
      if (entry._mimePath) mimePaths.add(entry._mimePath);
    }
    if (mimePaths.size > 0) {
      const mimeMap = await detectMimeBatch([...mimePaths]);
      for (const entry of filtered) {
        if (entry._mimePath) {
          entry.mime = mimeMap.get(entry._mimePath) ?? null;
        }
      }
    }

    for (const entry of filtered) {
      delete entry._mimePath;
    }

    // 按删除时间倒序（最近删除的在前）
    filtered.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return filtered;
  });

  /**
   * 从回收站永久删除条目（同时清理对应的 .trashinfo）。
   * 只接受文件名（不含路径分隔符），防止路径逃逸。
   * @returns 成功删除的条目数
   */
  ipcMain.handle('fs:trash-remove', async (_, names: string[]) => {
    const filesDir = path.join(getTrashRoot(), 'files');
    const infoDir = path.join(getTrashRoot(), 'info');
    let success = 0;

    await Promise.all(names.map(async (name) => {
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || !name) {
        return;
      }
      try {
        await fs.rm(path.join(filesDir, name), { recursive: true, force: true });
        await fs.rm(path.join(infoDir, name + '.trashinfo'), { force: true }).catch(() => { /* info 可能不存在 */ });
        success++;
      } catch { /* skip */ }
    }));

    return success;
  });

  /**
   * 仅删除回收站条目的 .trashinfo 元数据（条目本体已被移动出去时清理残留）。
   * 用于"拖出回收站 = 还原到目标位置"成功后清理孤儿 info 文件。
   * 只接受文件名（不含路径分隔符），防止路径逃逸。
   */
  ipcMain.handle('fs:trash-remove-info', async (_, names: string[]) => {
    const infoDir = path.join(getTrashRoot(), 'info');

    await Promise.all(names.map(async (name) => {
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || !name || name === '.' || name === '..') {
        return;
      }
      await fs.rm(path.join(infoDir, name + '.trashinfo'), { force: true }).catch(() => { /* info 可能不存在 */ });
    }));
  });

  /**
   * 清空回收站（删除 files/ 与 info/ 下全部条目）。
   * @returns 被删除的条目数
   */
  ipcMain.handle('fs:trash-empty', async () => {
    const filesDir = path.join(getTrashRoot(), 'files');
    const infoDir = path.join(getTrashRoot(), 'info');

    let names: string[];
    try {
      names = await fs.readdir(filesDir);
    } catch {
      return 0;
    }

    await Promise.all(names.map(async (name) => {
      await fs.rm(path.join(filesDir, name), { recursive: true, force: true }).catch(() => { /* skip */ });
      await fs.rm(path.join(infoDir, name + '.trashinfo'), { force: true }).catch(() => { /* skip */ });
    }));

    return names.length;
  });

  // Copy source to dest recursively. Does not overwrite existing files.
  ipcMain.handle('fs:copy', async (_, source: string, dest: string) => {
    await fs.cp(source, dest, { recursive: true, force: false });
    return true;
  });

  // Move/rename source to dest.
  ipcMain.handle('fs:move', async (_, source: string, dest: string) => {
    await fs.rename(source, dest);
    return true;
  });

  /**
   * 修改文件/目录权限（chmod）。
   *
   * - 只接受绝对路径与 3 位八进制模式（rwxrwxrwx，如 '755'）——
   *   不接受符号模式与 4 位特殊位（setuid/setgid/sticky），
   *   从输入源头杜绝意外设置特权位。
   * - 返回结构化结果：success / code（INVALID_PATH、INVALID_MODE）
   *   / error（chmod 系统错误消息），由前端翻译提示。
   */
  ipcMain.handle('fs:chmod', async (_, filePath: string, modeStr: string) => {
    if (typeof filePath !== 'string' || !filePath.startsWith('/')) {
      return { success: false, code: 'INVALID_PATH' };
    }
    if (typeof modeStr !== 'string' || !/^[0-7]{3}$/.test(modeStr)) {
      return { success: false, code: 'INVALID_MODE' };
    }
    try {
      await fs.chmod(filePath, parseInt(modeStr, 8));
      return { success: true };
    } catch (e) {
      console.error('chmod failed', e);
      return { success: false, error: (e as NodeJS.ErrnoException).message };
    }
  });

  // Move a single file/directory to the system trash.
  ipcMain.handle('fs:trash', async (_, filePath: string) => {
    await shell.trashItem(filePath);
    return true;
  });

  // Rename oldPath to newPath.
  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath);
    return true;
  });

  // Create a directory recursively.
  ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  });

  // Create an empty file at filePath.
  ipcMain.handle('fs:create-file', async (_, filePath: string) => {
    await fs.writeFile(filePath, '', 'utf-8');
    return true;
  });

  /**
   * Open a file/directory with the system default handler. Returns error string if failed.
   *
   * 不用 shell.openPath：它在 Linux/Wayland 上会为 xdg-activation 令牌
   * 跑嵌套消息循环（focus_launched_process），合成器未及时应答（例如
   * 打开文件后立刻切换目录、焦点变化）时 promise 永不落定，导致
   * ipcMain.handle 的回复通道被 GC 后以「reply was never sent」拒绝。
   * 这里直接 spawn xdg-open，spawn/error 事件必然落定 promise。
   */
  ipcMain.handle('fs:open', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return 'Invalid path';
    return new Promise<string>((resolve) => {
      try {
        const child = spawn('xdg-open', [filePath], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, MM_NOTTTY: '1' },
        });
        child.on('error', (err: Error) => resolve(err.message));
        child.on('spawn', () => {
          child.unref();
          resolve('');
        });
      } catch (e) {
        resolve(getExecError(e).message);
      }
    });
  });

  // Extract archives: .zip via unzip, .tar/.gz/.xz via tar. Extracts to archive's parent dir.
  ipcMain.handle('fs:extract', async (_, filePath: string) => {
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.zip') {
        await execAsync(`unzip "${filePath}" -d "${dir}"`);
      } else if (ext === '.tar' || ext === '.gz' || ext === '.xz') {
        await execAsync(`tar -xf "${filePath}" -C "${dir}"`);
      } else {
        return false;
      }
      return true;
    } catch (e) {
      console.error('Extract failed', e);
      return false;
    }
  });

  /**
   * 把一组文件/目录压缩为 zip 或 tar.gz 归档。
   *
   * - zip 走系统 `zip -r`，tar.gz 走 `tar -czf`；两者都以 argv 数组
   *   spawn（路径含空格/引号安全），cwd 设为归档所在目录、条目用
   *   basename 传入——归档内不包含源路径的目录层级。
   * - 源路径必须为绝对路径（防止相对路径逃逸）；条目名取自 basename，
   *   因此源条目必须位于同一目录（由前端保证，归档语义如此）。
   * - 压缩工具缺失（zip 不是所有发行版预装）时返回结构化错误码
   *   `NO_TOOL`，由前端翻译提示安装。
   *
   * @param paths - 待压缩的绝对路径数组（同目录下的文件/目录）
   * @param destPath - 归档文件完整路径（含 .zip / .tar.gz 后缀）
   * @param format - 归档格式：'zip' | 'tar.gz'
   * @returns success 表示压缩完成；失败时携带错误码与消息
   */
  ipcMain.handle('fs:compress', async (_, params: { paths: string[]; destPath: string; format: 'zip' | 'tar.gz' }) => {
    const { paths: sourcePaths, destPath, format } = params || ({} as { paths?: string[]; destPath?: string; format?: string });
    if (
      !Array.isArray(sourcePaths) || sourcePaths.length === 0 ||
      typeof destPath !== 'string' || !destPath ||
      (format !== 'zip' && format !== 'tar.gz')
    ) {
      return { success: false, code: 'INVALID_ARGS', error: 'invalid arguments' };
    }
    // 只允许绝对路径，防相对路径解析到工作目录之外
    if (!destPath.startsWith('/') || sourcePaths.some((p) => typeof p !== 'string' || !p.startsWith('/'))) {
      return { success: false, code: 'INVALID_ARGS', error: 'paths must be absolute' };
    }
    try {
      // 归档文件已存在时直接失败，绝不静默覆盖（zip/tar 默认都会覆盖）
      const destExists = await fs.access(destPath).then(() => true).catch(() => false);
      if (destExists) {
        return { success: false, code: 'EXISTS', error: destPath };
      }
      const destDir = path.dirname(destPath);
      const names = sourcePaths.map((p) => path.basename(p));

      await new Promise<void>((resolve, reject) => {
        let child: ChildProcess;
        if (format === 'zip') {
          child = spawn('zip', ['-r', destPath, ...names], { cwd: destDir });
        } else {
          child = spawn('tar', ['-czf', destPath, ...names], { cwd: destDir });
        }
        let stderr = '';
        child.stderr?.on('data', (d: Buffer) => { stderr += String(d); });
        child.on('error', (err: Error) => reject(err));
        child.on('close', (code: number | null) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `compress exited with code ${code}`));
        });
      });
      return { success: true };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      console.error('Compress failed', e);
      if (err.code === 'ENOENT') {
        // zip 未安装（tar 为 coreutils，基本必有）
        return { success: false, code: 'NO_TOOL', error: format === 'zip' ? 'zip' : 'tar' };
      }
      return { success: false, error: err.message };
    }
  });

  // Check if a single path exists via fs.access.
  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Check existence of multiple paths in parallel. Returns Record<string, boolean>.
  ipcMain.handle('fs:exists-batch', async (_, paths: string[]) => {
    const results: Record<string, boolean> = {};
    await Promise.all(paths.map(async (p) => {
      try {
        await fs.access(p);
        results[p] = true;
      } catch {
        results[p] = false;
      }
    }));
    return results;
  });

  // Return parent directory path of the given dirPath.
  ipcMain.handle('fs:get-parent', (_, dirPath: string) => {
    return path.dirname(dirPath);
  });

  // Return the user's home directory path.
  ipcMain.handle('fs:get-home', () => {
    return app.getPath('home');
  });

  // Return the full passwd home directory map for breadcrumbs multi-user home detection.
  ipcMain.handle('fs:get-home-map', async () => {
    const passwdMap = await getPasswdHomeMap();
    const result: Record<string, { username: string; uid: number }> = {};
    for (const [home, info] of passwdMap) {
      result[home] = info;
    }
    return result;
  });

  // Resolve a symlink target. Returns { isSymlink, target?, targetExists? }.
  ipcMain.handle('fs:get-symlink-target', async (_event, filePath: string) => {
    try {
      const lstat = await fs.lstat(filePath);
      if (!lstat.isSymbolicLink()) return { isSymlink: false };
      const rawTarget = await fs.readlink(filePath);
      const target = path.resolve(path.dirname(filePath), rawTarget);
      let targetExists = false;
      try { await fs.access(target); targetExists = true; } catch { /* continue */ }
      return { isSymlink: true, target, targetExists };
    } catch {
      return { isSymlink: false };
    }
  });

  // Batch symlink resolution for multiple paths. Returns array of { path, isSymlink, target? }.
  ipcMain.handle('fs:check-symlinks', async (_event, paths: string[]) => {
    const results: { path: string; isSymlink: boolean; target?: string }[] = [];
    for (const p of paths) {
      try {
        const lstat = await fs.lstat(p);
        if (lstat.isSymbolicLink()) {
          const rawTarget = await fs.readlink(p);
          const target = path.resolve(path.dirname(p), rawTarget);
          results.push({ path: p, isSymlink: true, target });
        } else {
          results.push({ path: p, isSymlink: false });
        }
      } catch {
        results.push({ path: p, isSymlink: false });
      }
    }
    return results;
  });

  // Read a file's contents as UTF-8 text. Returns null on failure.
  ipcMain.handle('fs:read-file', async (_, filePath: string) => {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  // Resolve a path to its canonical absolute path, following all symlinks.
  // Uses fs.realpath — throws ENOENT if the path does not exist.
  ipcMain.handle('fs:realpath', async (_, p: string) => {
    return fs.realpath(p);
  });

  // Return basic file info for a single path (used by dashboard pins).
  ipcMain.handle('fs:stat', async (_, p: string) => {
    try {
      const stats = await fs.stat(p);
      return { isDirectory: stats.isDirectory(), size: stats.size, mtime: stats.mtime };
    } catch {
      return null;
    }
  });

  // Compute directory size in bytes using du -sb. Returns 0 on failure.
  ipcMain.handle('system:get-directory-size', async (_, dirPath: string) => {
    try {
      const { stdout } = await execAsync(`du -sb "${dirPath}"`);
      const match = stdout.match(/^(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
      return 0;
    } catch (error) {
      const err = error as { stdout?: string };
      if (err.stdout) {
        const match = err.stdout.match(/^(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
      return 0;
    }
  });
}
