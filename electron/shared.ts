import { promises as fs, constants } from 'fs';
import path from 'path';

export function getExecError(e: unknown): { stderr: string; message: string } {
  const err = e as { stderr?: string; message?: string };
  return { stderr: err.stderr || '', message: err.message || String(e) };
}

export async function resolveAccessibleParent(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    try {
      await fs.access(current, constants.R_OK);
      return current;
    } catch {
      // continue walking up
    }
  }
  return null;
}

/** TTL (ms) for mount-map cache. Mounts rarely change during normal browsing. */
const MOUNT_MAP_CACHE_TTL = 30_000;

let _mountMapCache: { map: Map<string, { source: string; fstype: string }>; ts: number } | undefined;

/**
 * Parse `/proc/mounts` into a Map keyed by mountpoint.
 * Cached for {@link MOUNT_MAP_CACHE_TTL} ms to avoid re-reading on every
 * directory listing.
 */
export async function getMountMap(): Promise<Map<string, { source: string; fstype: string }>> {
  if (_mountMapCache && Date.now() - _mountMapCache.ts < MOUNT_MAP_CACHE_TTL) {
    return _mountMapCache.map;
  }

  const map = new Map<string, { source: string; fstype: string }>();
  try {
    const content = await fs.readFile('/proc/mounts', 'utf-8');
    for (const line of content.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(' ');
      if (parts.length < 3) continue;
      const source = parts[0];
      let mountpoint = parts[1];
      const fstype = parts[2];
      mountpoint = mountpoint.replace(/\\040/g, ' ')
        .replace(/\\011/g, '\t')
        .replace(/\\012/g, '\n')
        .replace(/\\134/g, '\\');
      map.set(mountpoint, { source, fstype });
    }
  } catch {
    // /proc/mounts not available
  }

  _mountMapCache = { map, ts: Date.now() };
  return map;
}
