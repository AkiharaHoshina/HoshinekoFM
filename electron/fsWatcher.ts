import { watch, FSWatcher } from 'fs';
import path from 'path';

interface WatcherEntry {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, WatcherEntry>();

/** Normalize directory path for consistent Map key comparison */
function normalizeDir(dir: string): string {
  const resolved = path.resolve(dir);
  return resolved.endsWith('/') && resolved !== '/' ? resolved.slice(0, -1) : resolved;
}

export function startWatching(
  dir: string,
  onChange: (changedDir: string) => void,
): void {
  const normalized = normalizeDir(dir);
  if (watchers.has(normalized)) return;

  try {
    const watcher = watch(normalized, () => {
      const entry = watchers.get(normalized);
      if (!entry) return;

      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        onChange(normalized);
      }, 300);
    });

    watcher.on('error', (err: Error) => {
      console.warn(`[fsWatcher] error on "${normalized}":`, err.message);
      stopWatching(normalized);
    });

    watchers.set(normalized, { watcher, timer: null });
  } catch (err) {
    console.warn(`[fsWatcher] cannot watch "${normalized}":`, (err as Error).message);
  }
}

export function stopWatching(dir: string): void {
  const normalized = normalizeDir(dir);
  const entry = watchers.get(normalized);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watchers.delete(normalized);
}

export function stopAllWatching(): void {
  for (const [dir] of watchers) {
    stopWatching(dir);
  }
}
