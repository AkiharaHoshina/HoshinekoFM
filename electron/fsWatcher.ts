import { watch, FSWatcher } from 'fs';
import path from 'path';

interface WatcherEntry {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, WatcherEntry>();

export function startWatching(
  dir: string,
  onChange: (changedDir: string) => void,
): void {
  if (watchers.has(dir)) return;

  try {
    const watcher = watch(dir, (_event, _filename) => {
      const entry = watchers.get(dir);
      if (!entry) return;

      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        onChange(dir);
      }, 300);
    });

    watcher.on('error', (err: Error) => {
      console.warn(`[fsWatcher] error on "${dir}":`, err.message);
      stopWatching(dir);
    });

    watchers.set(dir, { watcher, timer: null });
  } catch (err) {
    console.warn(`[fsWatcher] cannot watch "${dir}":`, (err as Error).message);
  }
}

export function stopWatching(dir: string): void {
  const entry = watchers.get(dir);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watchers.delete(dir);
}

export function stopAllWatching(): void {
  for (const [dir] of watchers) {
    stopWatching(dir);
  }
}
