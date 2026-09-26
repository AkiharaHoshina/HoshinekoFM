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

/**
 * 剥掉 GTK 助记符下划线与尾部单字母括号快捷键提示（portal accept_label
 * 可含 mnemonic——单下划线标记助记键字母、双下划线转义字面下划线，且
 * 部分调用方会把快捷键写成「保存(_S)」括号后缀）。本应用按钮不实现
 * 助记键，原样显示会让用户误以为存在快捷键（实测点 Ctrl+S 无效、历史
 * 决策也从未定义过该快捷键）。剥离后「保存(_S)」→「保存」、「保_存」
 * →「保存」；仅剥尾部单个字母数字的括号提示（「(S)」「(1)」等），
 * 多字符括号内容保留（可能是合法文案）。
 */
export function stripMnemonicLabel(label: string): string {
  const ESCAPED_UNDERSCORE = '\uE000'; // 私有区占位：先保护双下划线
  const stripped = label
    .replace(/__/g, ESCAPED_UNDERSCORE)
    .replace(/_([\s\S])/g, '$1')
    .replace(new RegExp(ESCAPED_UNDERSCORE, 'g'), '_');
  return stripped.replace(/\s*\([A-Za-z0-9]\)\s*$/, '');
}

/** TTL (ms) for mount-map cache. Mounts rarely change during normal browsing. */
const MOUNT_MAP_CACHE_TTL = 30_000;

let _mountMapCache: { map: Map<string, { source: string; fstype: string }>; ts: number } | undefined;

/**
 * Parse `/proc/mounts` into a Map keyed by mountpoint.
 * Cached for {@link MOUNT_MAP_CACHE_TTL} ms to avoid re-reading on every
 * directory listing. Pass `force = true` to bypass the cache and read the
 * freshest mount table (e.g. eject pre-checks right after unmounting).
 */
export async function getMountMap(force = false): Promise<Map<string, { source: string; fstype: string }>> {
  if (!force && _mountMapCache && Date.now() - _mountMapCache.ts < MOUNT_MAP_CACHE_TTL) {
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

/**
 * Drop the cached mount map so the next {@link getMountMap} call re-reads
 * `/proc/mounts`. Call after mount/unmount/eject operations that change the
 * mount table — otherwise consumers (file-list mount enrichment etc.) keep
 * seeing stale mountpoints for up to {@link MOUNT_MAP_CACHE_TTL} ms.
 */
export function invalidateMountMapCache(): void {
  _mountMapCache = undefined;
}
